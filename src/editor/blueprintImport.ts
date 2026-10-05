import type { PoiKind } from "@/core/cats";
import { parseVenue, type Room, type Venue } from "@/core/schema";
import { validate } from "@/core/validate";
import * as ops from "./ops";

/**
 * Import of the legacy Blueprint editor's JSON export (floors + elements in pixels) into a venue. It never writes the venue by hand:
 * it drives the same editing operations the editor uses (rooms, doors, walk lines with width, POIs, lift / stairs links), so an
 * imported venue is exactly as valid and as editable as a drawn one. Everything the file cannot say (scale, a main door, a walk
 * path between far rooms) is reported in `issues` instead of being guessed silently.
 */

export interface BpElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  floor: string;
  poiType?: string;
  /** Airport files: what part an element plays (island, counter, lane, zone, ...). */
  role?: string;
  tags?: string[];
  airlines?: string[];
  counterRange?: string;
}

export interface BpConnection {
  source: string;
  target: string;
}

export interface BpFile {
  floors: string[];
  /** Which elements really lead into each other (airport drawings). Optional. */
  connections?: BpConnection[];
  elements: BpElement[];
  trueNorth: number;
}

export interface ImportOptions {
  id: string;
  name: string;
  type?: string;
  city?: string;
  address?: string;
  /** Scale: how many Blueprint pixels are one real metre. */
  pxPerMetre: number;
}

export interface ImportIssue {
  level: "info" | "warn" | "fail";
  title: string;
  detail: string;
  element?: string;
}

export interface ImportResult {
  venue: Venue;
  issues: ImportIssue[];
  stats: { floors: number; rooms: number; corridors: number; doors: number; entrances: number; lifts: number; skipped: number };
  /** Size of the whole drawing at this scale, metres. */
  sizeM: { w: number; h: number };
}

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const GENERIC = /^(new\s+\w+|untitled|room|hallway|entry|custom|)$/i;
export const isGenericName = (n: string): boolean => GENERIC.test(n.trim());

/** Reads and checks the shape of a Blueprint export. Bad individual elements are dropped, not fatal. */
export function readBlueprint(json: unknown): { ok: true; file: BpFile; dropped: number } | { ok: false; error: string } {
  if (!json || typeof json !== "object") return { ok: false, error: "This is not a Blueprint export (not a JSON object)." };
  const j = json as Record<string, unknown>;
  if (!Array.isArray(j.floors) || !j.floors.every((f) => typeof f === "string") || j.floors.length === 0) return { ok: false, error: "Missing the floors list: is this a Blueprint export?" };
  if (!Array.isArray(j.elements)) return { ok: false, error: "Missing the elements list: is this a Blueprint export?" };
  const floors = j.floors as string[];
  let dropped = 0;
  const elements: BpElement[] = [];
  for (const raw of j.elements) {
    const e = raw as Record<string, unknown>;
    if (!e || typeof e !== "object" || typeof e.type !== "string" || !num(e.x) || !num(e.y) || !num(e.width) || !num(e.height) || e.width <= 0 || e.height <= 0) {
      dropped++;
      continue;
    }
    elements.push({
      id: typeof e.id === "string" ? e.id : `e${elements.length}`,
      type: e.type,
      x: e.x,
      y: e.y,
      width: e.width,
      height: e.height,
      name: typeof e.name === "string" ? e.name : "",
      floor: typeof e.floor === "string" && floors.includes(e.floor) ? e.floor : floors[0]!,
      poiType: typeof e.poiType === "string" ? e.poiType : undefined,
      role: typeof e.role === "string" ? e.role : undefined,
      tags: Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === "string") : undefined,
      airlines: Array.isArray(e.airlines) ? e.airlines.filter((t): t is string => typeof t === "string") : undefined,
      counterRange: typeof e.counterRange === "string" ? e.counterRange : undefined,
    });
  }
  const connections: BpConnection[] = [];
  if (Array.isArray(j.connections)) {
    for (const raw of j.connections) {
      const c = raw as Record<string, unknown>;
      if (c && typeof c.source === "string" && typeof c.target === "string") connections.push({ source: c.source, target: c.target });
    }
  }
  return { ok: true, file: { floors, elements, trueNorth: num(j.trueNorth) ? j.trueNorth : 0, ...(connections.length ? { connections } : {}) }, dropped };
}

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

/**
 * A starting guess for the scale: doors are about 1 m wide, so the median length of the "entry" boxes is one metre; with no entries a
 * room is taken to be about 3 m across its short side. Always a guess: the importer asks the user to confirm it.
 */
export function guessPxPerMetre(file: BpFile): number {
  const entries = file.elements.filter((e) => e.type === "entry").map((e) => Math.max(e.width, e.height));
  const rooms = file.elements.filter((e) => e.type === "room").map((e) => Math.min(e.width, e.height));
  const raw = entries.length ? median(entries) / 1.0 : rooms.length ? median(rooms) / 3 : 50;
  return Math.max(10, Math.min(300, Math.round(raw / 5) * 5 || 50));
}

/** Size of everything in the file at a scale (for the "does this look right?" line in the import dialog). */
export function drawingSizeM(file: BpFile, pxPerMetre: number): { w: number; h: number } {
  const b = bounds(file.elements);
  return { w: Math.round(((b.maxX - b.minX) / pxPerMetre) * 10) / 10, h: Math.round(((b.maxY - b.minY) / pxPerMetre) * 10) / 10 };
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
function rectOf(e: BpElement): Box {
  // A point of interest is stored by its centre, everything else by its top-left corner.
  return e.type === "poi" ? { minX: e.x - e.width / 2, minY: e.y - e.height / 2, maxX: e.x + e.width / 2, maxY: e.y + e.height / 2 } : { minX: e.x, minY: e.y, maxX: e.x + e.width, maxY: e.y + e.height };
}
function bounds(els: BpElement[]): Box {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const e of els) {
    const r = rectOf(e);
    b.minX = Math.min(b.minX, r.minX);
    b.minY = Math.min(b.minY, r.minY);
    b.maxX = Math.max(b.maxX, r.maxX);
    b.maxY = Math.max(b.maxY, r.maxY);
  }
  return Number.isFinite(b.minX) ? b : { minX: 0, minY: 0, maxX: 1, maxY: 1 };
}

type Cat = Room["cat"];
const CAT_RULES: [RegExp, Cat, string[]][] = [
  [/lift|elevator|stair/i, "vertical", []],
  [/toilet|washroom|restroom|bath|gents|ladies|\bloo\b|\bwc\b/i, "washroom", ["washroom"]],
  [/meeting|conference|board\s*room|discussion/i, "meeting", ["meeting"]],
  [/pantry|cafe|canteen|kitchen|dining|\bmess\b|food/i, "food", ["food", "coffee", "water"]],
  [/reception|lobby|front\s*desk/i, "reception", ["reception"]],
  [/server|\bit\b|network/i, "workspace", ["it"]],
  [/training|class/i, "training", []],
  [/admin|\bhr\b|account|finance/i, "admin", ["print"]],
];
function classify(name: string): { cat: Cat; tags: string[] } {
  for (const [re, cat, tags] of CAT_RULES) if (re.test(name)) return { cat, tags };
  return { cat: "workspace", tags: [] };
}

const POI_MAP: Record<string, PoiKind> = {
  water: "water", drinkingwater: "water", printer: "printer", coffee: "coffee", exit: "exit", firstaid: "firstaid", "first-aid": "firstaid", medical: "firstaid", atm: "atm", entrance: "entrance",
  info: "info", currency: "currency", trolley: "trolley", babycare: "babycare", charging: "charging", prayer: "prayer", taxi: "taxi",
};

/** Airport element types that become rooms: their category and the "need" tag that finds them ("I need a gate", "where can I shop"). */
const AIRPORT_ROOM: Record<string, { cat: Cat; tag: string }> = {
  eatery: { cat: "food", tag: "food" },
  shop: { cat: "retail", tag: "shopping" },
  toilet: { cat: "washroom", tag: "washroom" },
  lounge: { cat: "lounge", tag: "lounge" },
  gate: { cat: "gate", tag: "gate" },
  baggage: { cat: "baggage", tag: "baggage" },
  checkin: { cat: "checkin", tag: "checkin" },
  security: { cat: "security", tag: "security" },
  // malls and bus stations
  entertainment: { cat: "entertainment", tag: "entertainment" },
  platform: { cat: "platform", tag: "platform" },
  ticket: { cat: "ticket", tag: "ticket" },
  waiting: { cat: "lounge", tag: "waiting" },
  service: { cat: "reception", tag: "info" },
};
const VERTICAL = new Set(["elevator", "stairs", "escalator"]);
const insideBox = (inner: Box, outer: Box): boolean => {
  const cx = (inner.minX + inner.maxX) / 2;
  const cy = (inner.minY + inner.maxY) / 2;
  return cx >= outer.minX && cx <= outer.maxX && cy >= outer.minY && cy <= outer.maxY;
};
/** Small parts inside a bigger area (check-in counters inside an island, security lanes inside a zone, belts inside a reclaim hall) are not imported one by one. */
function isDetail(e: BpElement, els: BpElement[]): boolean {
  if (e.type === "checkin") return e.role === "counter";
  if (e.type === "security") return e.role === "lane" || e.role === "counter";
  if (e.type === "baggage") return els.some((o) => o !== e && o.type === "baggage" && o.width * o.height > e.width * e.height && insideBox(rectOf(e), rectOf(o)));
  return false;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
const segDist = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const den = dx * dx + dy * dy;
  const t = den ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / den)) : 0;
  const q = { x: a.x + dx * t, y: a.y + dy * t };
  return { d: Math.hypot(p.x - q.x, p.y - q.y), q };
};

function airportClass(e: BpElement, air: { cat: Cat; tag: string }, name: string): { cat: Cat; tags: string[] } {
  const tags = [air.tag];
  if (e.type === "eatery" && (e.tags?.includes("coffee") || /coffee|cafe|café|tea\b/i.test(name))) tags.push("coffee");
  if (e.type === "lounge" || /sleep|pod|spa/i.test(name)) tags.push("rest");
  if (e.type === "shop" && /pharmacy|chemist|medical/i.test(name)) tags.push("firstaid");
  if (e.type === "waiting") tags.push("rest");
  if (e.type === "service") tags.push("reception");
  // a drawing can add need tags itself, written "need:baggage"
  for (const t of e.tags ?? []) if (t.startsWith("need:")) tags.push(t.slice(5));
  return { cat: air.cat, tags: [...new Set(tags)] };
}

/** Extra search words for an airport area: gents / ladies, the airlines of a check-in island, the belt numbers of a reclaim hall. */
function airportAliases(e: BpElement, els: BpElement[], name = e.name): string[] {
  const out: string[] = [];
  if (e.type === "toilet") {
    if (e.tags?.includes("male")) out.push("gents", "men's toilet");
    if (e.tags?.includes("female")) out.push("ladies", "women's toilet");
    if (e.tags?.includes("accessible")) out.push("accessible toilet", "wheelchair toilet");
    if (e.tags?.includes("family")) out.push("family restroom");
  }
  if (e.type === "checkin") {
    for (const a of e.airlines ?? []) out.push(a.toLowerCase(), `${a.toLowerCase()} check-in`);
    if (e.counterRange) out.push(`counters ${e.counterRange}`);
  }
  if (e.type === "baggage") {
    out.push("baggage claim", "luggage", "bags");
    for (const o of els) if (o !== e && o.type === "baggage" && insideBox(rectOf(o), rectOf(e))) out.push(o.name.toLowerCase());
  }
  if (e.type === "gate") out.push("boarding gate");
  if (e.type === "platform") {
    out.push(name.toLowerCase().replace(/platform/, "bay"));
    for (const t of e.tags ?? []) if (!t.startsWith("need:")) out.push(t.toLowerCase());
  }
  if (e.type === "ticket" || e.type === "service") out.push(...(e.tags ?? []).filter((t) => !t.startsWith("need:")).map((t) => t.toLowerCase()));
  return out;
}

/**
 * Where a hallway's walk line runs. A narrow hallway uses its centre line. A broad plaza would put the line through the shops and
 * islands that stand in it, so the line moves sideways (in 1 m steps, nearest to the centre first) to a lane that is clear of rooms.
 */
function freeLane(h: BpElement, horizontal: boolean, rooms: BpElement[], L: (px: number) => number): number {
  const lo = horizontal ? h.y : h.x;
  const span = horizontal ? h.height : h.width;
  const centre = lo + span / 2;
  if (L(span) <= 12) return centre;
  const pxPerM = 1 / (L(1) || 1);
  const along0 = horizontal ? h.x : h.y;
  const along1 = along0 + (horizontal ? h.width : h.height);
  const margin = 0.6 * pxPerM;
  const blocked = (c: number) =>
    rooms.some((o) => {
      const r = rectOf(o);
      const [c0, c1, a0, a1] = horizontal ? [r.minY, r.maxY, r.minX, r.maxX] : [r.minX, r.maxX, r.minY, r.maxY];
      return c >= c0 - margin && c <= c1 + margin && a1 > along0 && a0 < along1;
    });
  for (let d = 0; d <= span / 2 - margin; d += pxPerM) {
    for (const c of d === 0 ? [centre] : [centre - d, centre + d]) if (!blocked(c)) return c;
  }
  return centre;
}

export function importBlueprint(file: BpFile, opts: ImportOptions): ImportResult {
  const issues: ImportIssue[] = [];
  const s = opts.pxPerMetre;
  const oldGrid = ops.getGrid();
  ops.setGrid(0); // free coordinates: the file is not on a 0.5 m grid
  try {
    return run(file, opts, s, issues);
  } finally {
    ops.setGrid(oldGrid);
  }
}

function run(file: BpFile, opts: ImportOptions, s: number, issues: ImportIssue[]): ImportResult {
  const all = bounds(file.elements);
  const MARGIN = 1.5;
  const X = (px: number) => r2((px - all.minX) / s + MARGIN);
  const Y = (px: number) => r2((px - all.minY) / s + MARGIN);
  const L = (px: number) => px / s;
  const sizeM = { w: (all.maxX - all.minX) / s, h: (all.maxY - all.minY) / s };

  let v = ops.blankVenue({ id: opts.id, name: opts.name, type: opts.type ?? "Office / Tech park", city: opts.city ?? "Indore", address: opts.address ?? "", version: 1 });
  v.scale = { metersPerUnit: 1, calibrated: true, reference: `Imported from a Blueprint file at ${s} px per metre (check this against a tape measure)` };
  if (file.trueNorth) v.northOffsetDeg = file.trueNorth;
  v.floors = file.floors.map((name, i) => ({
    id: `F${i + 1}`,
    name,
    short: String(i + 1),
    elevation: i * 3,
    height: 3,
    w: Math.ceil(sizeM.w + MARGIN * 2),
    h: Math.ceil(sizeM.h + MARGIN * 2),
  }));
  const stats = { floors: v.floors.length, rooms: 0, corridors: 0, doors: 0, entrances: 0, lifts: 0, skipped: 0 };
  const floorIdOf = (name: string) => v.floors[Math.max(0, file.floors.indexOf(name))]!.id;
  const lifts: { id: string; floor: string; x: number; y: number; type: "lift" | "stairs" }[] = [];

  for (const floorName of file.floors) {
    const floor = floorIdOf(floorName);
    const els = file.elements.filter((e) => e.floor === floorName);
    const fb = bounds(els);
    const area = (b: Box) => (b.maxX - b.minX) * (b.maxY - b.minY);

    // 1. A big unnamed "custom" box that holds the rest is the building outline, not a room.
    const boundary = new Set<string>();
    for (const e of els) {
      if (e.type !== "custom" || !isGenericName(e.name)) continue;
      const r = rectOf(e);
      const others = els.filter((o) => o !== e);
      const inside = others.filter((o) => {
        const c = rectOf(o);
        const cx = (c.minX + c.maxX) / 2;
        const cy = (c.minY + c.maxY) / 2;
        return cx >= r.minX && cx <= r.maxX && cy >= r.minY && cy <= r.maxY;
      });
      if (area(r) >= 0.5 * area(fb) && inside.length >= 3) {
        boundary.add(e.id);
        issues.push({ level: "info", title: `${floorName}: a large box is the building outline`, detail: `"${e.name || e.type}" holds ${inside.length} other items, so it is used as the floor outline, not as a room.`, element: e.id });
      }
    }

    // 2. Hallways -> walk lines with a width.
    const lines: { a: { x: number; y: number }; b: { x: number; y: number }; width: number; el: BpElement; na: string; nb: string }[] = [];
    for (const e of els.filter((x) => x.type === "hallway")) {
      const horizontal = e.width >= e.height;
      const len = L(horizontal ? e.width : e.height);
      const width = Math.max(0.8, Math.min(4, L(horizontal ? e.height : e.width)));
      if (len < 1) {
        issues.push({ level: "warn", title: `Hallway "${e.name || e.id}" is shorter than 1 m`, detail: "Skipped: draw it longer or check the scale.", element: e.id });
        stats.skipped++;
        continue;
      }
      const lane = freeLane(e, horizontal, els.filter((o) => o !== e && (AIRPORT_ROOM[o.type] || VERTICAL.has(o.type) || o.type === "room" || o.type === "custom") && !isDetail(o, els)), L);
      const a = horizontal ? { x: X(e.x), y: Y(lane) } : { x: X(lane), y: Y(e.y) };
      const b = horizontal ? { x: X(e.x + e.width), y: Y(lane) } : { x: X(lane), y: Y(e.y + e.height) };
      const c1 = ops.walkClick(v, floor, null, a);
      const c2 = ops.walkClick(c1.venue, floor, c1.nodeId, b);
      v = c2.venue;
      v = ops.setEdgeWidth(v, ops.edgeKey({ a: c1.nodeId, b: c2.nodeId }), Math.round(width * 10) / 10);
      lines.push({ a, b, width, el: e, na: c1.nodeId, nb: c2.nodeId });
      stats.corridors++;
    }
    // Hallways that meet in a T or an L: join an end to the other line when it lies within that hallway's width.
    for (const h of lines) {
      for (const [end, id] of [[h.a, h.na], [h.b, h.nb]] as const) {
        for (const o of lines) {
          if (o === h) continue;
          const { d, q } = segDist(end, o.a, o.b);
          if (d > 0.05 && d <= o.width / 2 + 0.8) {
            const via = ops.walkClick(v, floor, id, q);
            v = via.venue;
            break;
          }
        }
      }
    }

    // 3. Rooms (named or not), lifts and stairs.
    const roomEls = els.filter((e) => !boundary.has(e.id) && (e.type === "room" || e.type === "custom" || VERTICAL.has(e.type) || (!!AIRPORT_ROOM[e.type] && !isDetail(e, els))));
    const details = els.filter((e) => isDetail(e, els));
    if (details.length) issues.push({ level: "info", title: `${floorName}: ${details.length} small parts not imported one by one`, detail: "Check-in counters, security lanes and baggage belts sit inside bigger areas that are imported (the island, the zone, the reclaim hall). Their names and numbers are added as search words." });
    const restricted = els.filter((e) => e.type === "restricted").length;
    if (restricted) issues.push({ level: "info", title: `${floorName}: ${restricted} staff-only area(s) not imported`, detail: "Restricted areas are not part of a passenger's map." });
    const made = new Map<string, string>(); // element id -> room id
    let unnamed = 0;
    for (const e of roomEls) {
      const vertical = VERTICAL.has(e.type);
      let name = e.name.trim();
      if (isGenericName(name) || (vertical && !name)) {
        if (vertical) name = e.type === "elevator" ? "Lift" : e.type === "escalator" ? "Escalator" : "Staircase";
        else {
          unnamed++;
          name = `Room ${unnamed}`;
          issues.push({ level: "warn", title: `${floorName}: an unnamed ${e.type}`, detail: `Called "${name}". Rename it so visitors can search for it.`, element: e.id });
        }
      }
      const min = vertical ? 0.9 : 0.7;
      const w = Math.max(min, L(e.width));
      const h = Math.max(min, L(e.height));
      if (L(e.width) < min || L(e.height) < min) issues.push({ level: "info", title: `"${name}" is very small at this scale`, detail: `Grown to at least ${min} m. Check the scale if many rooms are tiny.`, element: e.id });
      const cx = X(e.x) + L(e.width) / 2;
      const cy = Y(e.y) + L(e.height) / 2;
      const res = ops.addRoom(v, floor, { x: cx - w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy + h / 2 });
      if ("error" in res) {
        issues.push({ level: "warn", title: `Skipped "${name}"`, detail: res.error, element: e.id });
        stats.skipped++;
        continue;
      }
      v = res.venue;
      const air = AIRPORT_ROOM[e.type];
      const cl = air ? airportClass(e, air, name) : classify(`${name} ${vertical ? e.type : ""}`);
      if (air && (air.cat === "security" || air.cat === "baggage")) v = ops.updateRoom(v, res.id, { passThrough: true });
      v = ops.updateRoom(v, res.id, { name, cat: cl.cat, tags: cl.tags.length ? cl.tags : undefined, aliases: [...new Set([name.toLowerCase(), ...(air ? airportAliases(e, els, name) : [])])] });
      made.set(e.id, res.id);
      stats.rooms++;
      if (vertical) lifts.push({ id: res.id, floor, x: cx, y: cy, type: e.type === "elevator" ? "lift" : "stairs" });
    }

    // 4. Entries -> doors on the nearest room wall, or building entrances.
    const doorsOf = new Map<string, number>();
    let entranceNo = 0;
    for (const e of els.filter((x) => x.type === "entry")) {
      const r = rectOf(e);
      const c = { x: X((r.minX + r.maxX) / 2), y: Y((r.minY + r.maxY) / 2) };
      const hit = ops.nearestRoomEdge(v, floor, c, Math.min(2.5, Math.max(0.6, L(Math.min(e.width, e.height)) + 0.4)));
      if (hit) {
        const roomId = hit.room.id;
        const n = doorsOf.get(roomId) ?? 0;
        const res = n === 0 ? ops.setDoor(v, roomId, c, 0) : ops.addDoor(v, roomId, c);
        if ("error" in res) {
          issues.push({ level: "warn", title: "A door could not be placed", detail: res.error, element: e.id });
          continue;
        }
        v = "venue" in res ? res.venue : res;
        doorsOf.set(roomId, n + 1);
        stats.doors++;
      } else {
        entranceNo++;
        const label = isGenericName(e.name) ? (entranceNo === 1 ? "Main entrance" : `Entrance ${entranceNo}`) : e.name;
        const res = ops.addPoi(v, floor, c, "entrance", label);
        v = res.venue;
        stats.entrances++;
        issues.push({ level: "info", title: `${floorName}: "${label}" is an entrance`, detail: "It is not on a room wall, so it became a building entrance point.", element: e.id });
      }
    }

    // 5. Points of interest.
    for (const e of els.filter((x) => x.type === "poi")) {
      const kind = POI_MAP[(e.poiType ?? "").toLowerCase()];
      const r = rectOf(e);
      if (!kind) {
        issues.push({ level: "warn", title: `Skipped a point of interest "${e.name || e.poiType || e.id}"`, detail: "This kind is not supported yet.", element: e.id });
        stats.skipped++;
        continue;
      }
      v = ops.addPoi(v, floor, { x: X((r.minX + r.maxX) / 2), y: Y((r.minY + r.maxY) / 2) }, kind, e.name || kind).venue;
    }
    const walls = els.filter((x) => x.type === "wall").length;
    if (walls) issues.push({ level: "info", title: `${floorName}: ${walls} wall element(s) not imported`, detail: "Walls come from the room outlines; ad slots are added in the editor." });

    // 5b. The drawing's own connections say which hallways and rooms really lead into each other (hall -> security -> plaza, gate -> concourse).
    // Small parts that are not imported (security lanes, belts) are looked through; an entry that touches two hallways joins them at its place.
    if (file.connections?.length) {
      type Pt2 = { x: number; y: number };
      type Ln = (typeof lines)[number];
      const detailIds = new Set(details.map((d) => d.id));
      const adj = new Map<string, Set<string>>();
      for (const c of file.connections) {
        for (const [p, q] of [[c.source, c.target], [c.target, c.source]] as const) {
          if (!adj.has(p)) adj.set(p, new Set());
          adj.get(p)!.add(q);
        }
      }
      const ends = (id: string): string[] => {
        const out = new Set<string>();
        const seen = new Set([id]);
        const stack = [...(adj.get(id) ?? [])];
        while (stack.length) {
          const n = stack.pop()!;
          if (seen.has(n)) continue;
          seen.add(n);
          if (detailIds.has(n)) stack.push(...(adj.get(n) ?? []));
          else out.add(n);
        }
        return [...out];
      };
      const lineById = new Map(lines.map((l) => [l.el.id, l]));
      const link = (p: Pt2, q: Pt2) => {
        const n1 = ops.walkClick(v, floor, null, p);
        const n2 = ops.walkClick(n1.venue, floor, n1.nodeId, q);
        v = n2.venue;
      };
      const joinLines = (A: Ln, B: Ln, at?: Pt2) => {
        if (at) return link(segDist(at, A.a, A.b).q, segDist(at, B.a, B.b).q);
        const axis = A.a.y === A.b.y && B.a.y === B.b.y ? "x" : A.a.x === A.b.x && B.a.x === B.b.x ? "y" : null;
        if (axis) {
          const lo = Math.max(Math.min(A.a[axis], A.b[axis]), Math.min(B.a[axis], B.b[axis]));
          const hi = Math.min(Math.max(A.a[axis], A.b[axis]), Math.max(B.a[axis], B.b[axis]));
          if (hi - lo >= 1) {
            const n = hi - lo > 200 ? 4 : hi - lo > 60 ? 2 : 1;
            for (let i = 0; i < n; i++) {
              const t = r2(lo + ((hi - lo) * (i + 0.5)) / n);
              link(axis === "x" ? { x: t, y: A.a.y } : { x: A.a.x, y: t }, axis === "x" ? { x: t, y: B.a.y } : { x: B.a.x, y: t });
            }
            return;
          }
        }
        let best: { d: number; p: Pt2; q: Pt2 } | null = null;
        for (const P of [A.a, A.b]) {
          const { d, q } = segDist(P, B.a, B.b);
          if (!best || d < best.d) best = { d, p: P, q };
        }
        for (const P of [B.a, B.b]) {
          const { d, q } = segDist(P, A.a, A.b);
          if (!best || d < best.d) best = { d, p: q, q: P };
        }
        if (best) link(best.p, best.q);
      };
      const linkRoom = (roomId: string, A: Ln) => {
        const room = v.rooms.find((r) => r.id === roomId);
        if (!room) return;
        const d = { x: room.door.x, y: room.door.y };
        const q = segDist(d, A.a, A.b).q;
        if (Math.hypot(q.x - d.x, q.y - d.y) >= 0.3) link(d, q);
      };
      // Two rooms that lead into each other (security zone to security zone, reclaim hall to its toilets): only when one of them is walked through.
      const linkRooms = (idA: string, idB: string) => {
        const ra = v.rooms.find((r) => r.id === idA);
        const rb = v.rooms.find((r) => r.id === idB);
        if (ra && rb && (ra.passThrough || rb.passThrough)) link({ x: ra.door.x, y: ra.door.y }, { x: rb.door.x, y: rb.door.y });
      };
      const done = new Set<string>();
      const once = (a: string, b: string) => {
        const k = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (done.has(k)) return false;
        done.add(k);
        return true;
      };
      for (const e of els.filter((x) => x.type === "entry")) {
        const hs = [...new Set(ends(e.id))].map((i) => lineById.get(i)).filter((l): l is Ln => !!l);
        const r = rectOf(e);
        const c = { x: X((r.minX + r.maxX) / 2), y: Y((r.minY + r.maxY) / 2) };
        for (let i = 1; i < hs.length; i++) if (once(`${e.id}|${hs[0]!.el.id}`, hs[i]!.el.id)) joinLines(hs[0]!, hs[i]!, c);
      }
      for (const id of [...lineById.keys(), ...made.keys()]) {
        for (const o of ends(id)) {
          if (!once(id, o)) continue;
          const A = lineById.get(id);
          const B = lineById.get(o);
          if (A && B) joinLines(A, B);
          else if (A && made.has(o)) linkRoom(made.get(o)!, A);
          else if (B && made.has(id)) linkRoom(made.get(id)!, B);
          else if (made.has(id) && made.has(o)) linkRooms(made.get(id)!, made.get(o)!);
        }
      }
    }

    // 6. Connect every room whose door has no walk path yet.
    for (const room of v.rooms.filter((r) => r.floor === floor)) {
      const linked = ops.connectRoom(v, room.id, 3);
      if (!("error" in linked)) {
        v = linked;
        continue;
      }
      const far = ops.connectRoom(v, room.id, Math.max(40, Math.round(Math.max(sizeM.w, sizeM.h) / 8)));
      if ("error" in far) {
        issues.push({ level: "warn", title: `"${room.name}" is not connected to any corridor`, detail: "Draw a walk path from its door to a corridor (Walk tool)." });
      } else {
        v = far;
        issues.push({ level: "warn", title: `"${room.name}" is far from any corridor`, detail: "It was joined by a straight line to the nearest corridor. Draw the real walk path (Walk tool) so routes follow your corridors." });
      }
    }
  }

  // 7. Lifts and stairs that stand in the same place on neighbouring floors are linked.
  if (v.floors.length > 1) {
    const idx = (f: string) => v.floors.findIndex((x) => x.id === f);
    for (const type of ["lift", "stairs"] as const) {
      for (const a of lifts.filter((l) => l.type === type)) {
        const next = lifts.filter((l) => l.type === type && idx(l.floor) === idx(a.floor) + 1).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[0];
        if (!next || Math.hypot(next.x - a.x, next.y - a.y) > 4) continue;
        const r = ops.addVerticalLinks(v, type, [a.id, next.id]);
        if (!("error" in r)) {
          v = r.venue;
          stats.lifts++;
        }
      }
    }
  } else if (lifts.length) {
    issues.push({ level: "info", title: "Lifts / stairs on a single floor", detail: "They are drawn as rooms. Add another floor and link them with the Lift / Stairs tool to route between floors." });
  }

  // 8. Suggested marker spots: beside the doors, spread out (farthest first), up to 8 per floor. They are only positions: the stickers still have to be printed.
  for (const f of v.floors) {
    const doors = v.rooms.filter((r) => r.floor === f.id).map((r) => ({ x: r.door.x, y: r.door.y }));
    // The checklist wants a marker within 6 m of every lift and staircase door (to confirm the floor after a ride): those come first.
    for (const r of v.rooms.filter((x) => x.floor === f.id && (x.kind === "lift" || x.kind === "stairs"))) {
      if (v.markers.some((m) => m.floor === f.id && Math.hypot(m.x - r.door.x, m.y - r.door.y) < 5)) continue;
      const m = ops.addMarker(v, f.id, { x: r.door.x, y: r.door.y });
      if (!("error" in m)) v = m.venue;
    }
    const picked: { x: number; y: number }[] = v.markers.filter((m) => m.floor === f.id).map((m) => ({ x: m.x, y: m.y }));
    const fixed = picked.length;
    while (picked.length < fixed + Math.min(8, doors.length)) {
      let best: { x: number; y: number } | null = null;
      let bestD = -1;
      for (const d of doors) {
        const dist = picked.length ? Math.min(...picked.map((p) => Math.hypot(p.x - d.x, p.y - d.y))) : 1;
        if (dist > bestD && !picked.includes(d)) {
          bestD = dist;
          best = d;
        }
      }
      if (!best || (picked.length > 0 && bestD < 1.2)) break;
      picked.push(best);
    }
    for (const p of picked.slice(fixed)) {
      const m = ops.addMarker(v, f.id, p);
      if (!("error" in m)) v = m.venue;
    }
    if (picked.length > fixed) issues.push({ level: "info", title: `${f.name}: ${picked.length - fixed} marker positions suggested`, detail: "Print them from the marker sheet and stick them where shown (about 1.4 m high). Move them in the editor if needed." });
  }

  // 9. Whatever the editor's own checklist says about the result.
  for (const r of validate(v)) {
    if (r.level === "pass") continue;
    issues.push({ level: r.level === "fail" ? "fail" : "warn", title: `Check: ${r.title}`, detail: r.detail });
  }
  const parsed = parseVenue(v);
  if (!parsed.ok) issues.push({ level: "fail", title: "The imported venue is not valid", detail: parsed.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join("; ") });
  return { venue: parsed.ok ? parsed.data : v, issues, stats, sizeM: { w: r2(sizeM.w), h: r2(sizeM.h) } };
}
