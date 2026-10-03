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
}

export interface BpFile {
  floors: string[];
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
    });
  }
  return { ok: true, file: { floors, elements, trueNorth: num(j.trueNorth) ? j.trueNorth : 0 }, dropped };
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

const POI_MAP: Record<string, PoiKind> = { water: "water", printer: "printer", coffee: "coffee", exit: "exit", firstaid: "firstaid", "first-aid": "firstaid", atm: "atm", entrance: "entrance" };

const r2 = (n: number): number => Math.round(n * 100) / 100;
const segDist = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const den = dx * dx + dy * dy;
  const t = den ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / den)) : 0;
  const q = { x: a.x + dx * t, y: a.y + dy * t };
  return { d: Math.hypot(p.x - q.x, p.y - q.y), q };
};

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
      const a = horizontal ? { x: X(e.x), y: Y(e.y + e.height / 2) } : { x: X(e.x + e.width / 2), y: Y(e.y) };
      const b = horizontal ? { x: X(e.x + e.width), y: Y(e.y + e.height / 2) } : { x: X(e.x + e.width / 2), y: Y(e.y + e.height) };
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
    const roomEls = els.filter((e) => !boundary.has(e.id) && (e.type === "room" || e.type === "custom" || e.type === "elevator" || e.type === "stairs"));
    const made = new Map<string, string>(); // element id -> room id
    let unnamed = 0;
    for (const e of roomEls) {
      const vertical = e.type === "elevator" || e.type === "stairs";
      let name = e.name.trim();
      if (isGenericName(name) || vertical) {
        if (vertical) name = e.type === "elevator" ? "Lift" : "Staircase";
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
      const cl = classify(`${name} ${vertical ? e.type : ""}`);
      v = ops.updateRoom(v, res.id, { name, cat: cl.cat, tags: cl.tags.length ? cl.tags : undefined, aliases: [name.toLowerCase()] });
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
      const hit = ops.nearestRoomEdge(v, floor, c, Math.max(0.6, L(Math.min(e.width, e.height)) + 0.4));
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

    // 6. Connect every room whose door has no walk path yet.
    for (const room of v.rooms.filter((r) => r.floor === floor)) {
      const linked = ops.connectRoom(v, room.id, 3);
      if (!("error" in linked)) {
        v = linked;
        continue;
      }
      const far = ops.connectRoom(v, room.id, 40);
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
    const picked: { x: number; y: number }[] = [];
    while (picked.length < Math.min(8, doors.length)) {
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
    for (const p of picked) {
      const m = ops.addMarker(v, f.id, p);
      if (!("error" in m)) v = m.venue;
    }
    if (picked.length) issues.push({ level: "info", title: `${f.name}: ${picked.length} marker positions suggested`, detail: "Print them from the marker sheet and stick them where shown (about 1.4 m high). Move them in the editor if needed." });
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
