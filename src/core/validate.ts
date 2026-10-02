import { DICT_SIZE } from "./aruco/dict";
import { distToSegment } from "./geo";
import { attachPoint, buildGraph, type Graph } from "./graph";
import type { Room, ValidationResult, Venue } from "./schema";

/**
 * Publish checklist. Ports the mock's checks (same titles/details on mock-shaped data) and generalises the ones that
 * assumed a single corridor at y=17; adds checks for marker dictionary range, vertical links and per-floor scale.
 * Publish is blocked on any `fail`.
 */
export function validate(v: Venue): ValidationResult[] {
  const out: ValidationResult[] = [];
  const add = (level: ValidationResult["level"], title: string, detail: string) => out.push({ level, title, detail });
  const floorName = (id: string) => v.floors.find((f) => f.id === id)?.name ?? id;

  // scale
  const uncal = v.floors.filter((f) => f.background && !f.background.calibrated);
  if (!v.scale.calibrated) add("fail", "Scale not calibrated", "Draw a line over a measured distance and enter its length in metres.");
  else if (uncal.length) add("fail", "Floor photo not calibrated", `${uncal.map((f) => f.name).join(", ")}: draw a line over a measured distance on the photo and enter its length in metres.`);
  else add("pass", "Scale calibrated", v.scale.reference || "1 unit = 1 m");

  // structural sanity (new)
  const nodeIds = new Set(v.nodes.map((n) => n.id));
  const dangling = v.edges.filter((e) => !nodeIds.has(e.a) || !nodeIds.has(e.b));
  if (dangling.length) add("fail", `${dangling.length} link(s) point to missing nodes`, dangling.map((e) => `${e.a} ↔ ${e.b}`).join(', '));
  const roomIds = v.rooms.map((r) => r.id);
  const dupRooms = roomIds.filter((x, i) => roomIds.indexOf(x) !== i);
  if (dupRooms.length) add("fail", "Duplicate room IDs", [...new Set(dupRooms)].join(", "));

  // reachability
  const unreachable = unreachableRooms(v);
  if (!unreachable.length) add("pass", `All ${v.rooms.length} rooms reachable from the entrance`, "Every room has a door linked to the walk network.");
  else add("fail", `${unreachable.length} room(s) not reachable`, unreachable.map((r) => r.name).join(", ") + " — select the room and use “Connect to corridor”.");
  const G = buildGraph(v);

  // vertical links
  const vert = v.edges.filter((e) => e.type !== "walk");
  const lifts = vert.filter((e) => e.type === "lift").length;
  const stairs = vert.filter((e) => e.type === "stairs").length;
  const disconnectedFloors = v.floors.filter((f) => !vert.some((e) => G.nodes[e.a]?.floor === f.id || G.nodes[e.b]?.floor === f.id));
  if (v.floors.length > 1 && disconnectedFloors.length) add("fail", "Floors not linked", disconnectedFloors.map((f) => f.name).join(", ") + " has no lift or stairs link.");
  else add("pass", "Floors linked", `${lifts} lift link(s), ${stairs} staircase link(s).`);
  if (v.floors.length > 1 && !lifts) add("warn", "No lift link", "Wheelchair / stroller routing will fail between floors.");
  const floorIndex = (id: string) => v.floors.findIndex((f) => f.id === id);
  for (const e of vert) {
    const a = G.nodes[e.a];
    const b = G.nodes[e.b];
    if (!a || !b) continue;
    if (a.floor === b.floor) add("fail", `${e.type === "lift" ? "Lift" : "Stairs"} link ${e.a} ↔ ${e.b} stays on one floor`, "A vertical link must connect two different floors.");
    else if (e.type === "stairs" && Math.abs(floorIndex(a.floor) - floorIndex(b.floor)) !== 1) add("fail", `Stairs link ${e.a} ↔ ${e.b} skips a floor`, "Stairs connect adjacent floors only; use a lift link for longer rides.");
  }
  for (const r of v.rooms.filter((x) => x.kind === "lift" || x.kind === "stairs")) {
    if (!vert.some((e) => e.a === r.id || e.b === r.id)) add("fail", `${r.name} (${floorName(r.floor)}) has no vertical link`, "Use the Vertical link tool to connect it to the same lift/stairs on another floor.");
  }

  // markers
  const ids = v.markers.map((m) => m.id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) add("fail", "Duplicate marker IDs", [...new Set(dup)].join(", "));
  const badIds = v.markers.filter((m) => !Number.isInteger(m.id) || m.id < 0 || m.id >= DICT_SIZE);
  if (badIds.length) add("fail", "Marker ID outside the printable dictionary", `${badIds.map((m) => m.id).join(", ")} (valid: 0–${DICT_SIZE - 1}).`);
  for (const f of v.floors) {
    const n = v.markers.filter((m) => m.floor === f.id).length;
    if (n === 0) add("fail", `${f.name}: no markers`, "Every floor needs at least one marker so visitors can fix their position (recommended 6–12: lift lobby, stairs door, junctions).");
    else if (n < 3) add("warn", `${f.name}: only ${n} marker(s)`, "Recommended 6–12 per floor (lift lobby, stairs door, junctions).");
    else add("pass", `${f.name}: ${n} markers placed`, "Good coverage for re-anchoring.");
  }
  for (const r of v.rooms.filter((x) => x.kind === "lift" || x.kind === "stairs")) {
    const near = v.markers.some((m) => m.floor === r.floor && Math.hypot(m.x - r.door.x, m.y - r.door.y) < 6);
    if (!near) add("fail", `No marker near ${r.name} (${floorName(r.floor)})`, "Needed to confirm the floor after a lift or stairs ride.");
  }
  const far = v.markers.filter((m) => {
    const d = distToWalkNetwork(v, G, m.floor, m.x, m.y);
    return d !== null && d > 6;
  });
  if (far.length) add("warn", "Markers far from corridors", far.map((m) => m.id).join(", "));

  // ad walls
  for (const w of v.walls) {
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    if (len < 1.5) add("warn", `Ad slot ${w.id} is narrow (${len.toFixed(1)} m)`, "Wider than 1.5 m looks better.");
    const door = v.rooms.find((r) => r.floor === w.floor && distToSegment(r.door, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }) < 0.6);
    if (door) add("fail", `Ad slot ${w.id} overlaps the door of ${door.name}`, "Move the slot onto a blank wall segment.");
  }
  if (v.walls.length && !out.some((o) => o.title.startsWith("Ad slot"))) add("pass", `${v.walls.length} ad slot(s) on blank walls`, "Awaiting venue-owner approval flags.");

  const blank = v.rooms.filter((r) => !r.name || !r.name.trim());
  if (blank.length) add("fail", "Unnamed rooms", `${blank.length} room(s) have no name.`);
  return out;
}

/** Rooms that cannot be reached from the entrance over the walk network (used by the checklist and the room inspector). */
export function unreachableRooms(v: Venue): Room[] {
  const G = buildGraph(v);
  const seen = new Set<string>();
  const start = startNode(v, G);
  const stack: string[] = start ? [start] : [];
  while (stack.length) {
    const k = stack.pop() as string;
    if (seen.has(k) || !G.adj[k]) continue;
    seen.add(k);
    for (const h of G.adj[k] as NonNullable<(typeof G.adj)[string]>) stack.push(h.to);
  }
  return v.rooms.filter((r) => !seen.has(r.id));
}

/** Where reachability starts: the main-entrance POI (snapped onto the walk network), else the first corridor node of the first floor. */
function startNode(v: Venue, G: Graph): string | null {
  const first = v.floors[0];
  if (!first) return null;
  const entrance = v.pois.find((p) => p.kind === "entrance") ?? null;
  if (entrance) {
    const id = attachPoint(G, entrance.floor, entrance.x, entrance.y, "entrance");
    if (id) return id;
  }
  // Never start from a room/door node: that would make a room "reachable" from itself when there is no corridor at all.
  const n = v.nodes.find((x) => x.floor === first.id && x.kind === "corridor") ?? v.nodes.find((x) => x.kind === "corridor");
  return n ? n.id : null;
}

/** Distance (m) to the nearest walk edge on the floor, or null if the floor has none. */
function distToWalkNetwork(v: Venue, G: Graph, floor: string, x: number, y: number): number | null {
  let best: number | null = null;
  for (const e of v.edges) {
    if (e.type !== "walk") continue;
    const a = G.nodes[e.a];
    const b = G.nodes[e.b];
    if (!a || !b || a.floor !== floor || b.floor !== floor) continue;
    const d = distToSegment({ x, y }, a, b);
    if (best === null || d < best) best = d;
  }
  return best;
}
