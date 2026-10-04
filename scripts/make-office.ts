/**
 * Builds the office, 1st floor, from the hand-drawn sketch (rough estimates):
 *   public/venues/my-office/venue.json
 * Scale read from the sketch: the long corridor A-B is 70 steps (about 49 m at 0.7 m a step), A-C is 15 steps. Rooms are placed where
 * they are drawn, in metres from the top-left corner of the building. Walk lines follow the dashed route on the sketch (Pantry door,
 * down the west aisle to the corridor at C) plus short aisles to every door. Edit the numbers below and run `npm run make:office`.
 */
import fs from "node:fs";
import path from "node:path";
import type { ObjectKind } from "../src/core/cats";
import type { Venue } from "../src/core/schema";
import { parseVenue } from "../src/core/schema";
import { validate } from "../src/core/validate";
import * as ops from "../src/editor/ops";

ops.setGrid(0);
let v: Venue = ops.blankVenue({ id: "my-office", name: "My Office · 1st Floor", type: "Office", city: "Indore", address: "", version: 1 });
v.status = "published";
v.scale = { metersPerUnit: 1, calibrated: true, reference: "From a hand sketch: corridor A-B = 70 steps (about 49 m). Rough estimates, check with a tape measure." };
v.floors = [{ id: "F1", name: "1st Floor", short: "1", elevation: 0, height: 3, w: 70, h: 56 }];
const F = "F1";

type Pt = { x: number; y: number };
const P = (x: number, y: number): Pt => ({ x, y });

/** A room from its corner to corner, with its door where the sketch shows it. */
function room(name: string, a: Pt, b: Pt, door: Pt, cat: string, tags: string[] = [], aliases: string[] = []): string {
  const r = ops.addRoom(v, F, a, b);
  if ("error" in r) throw new Error(`${name}: ${r.error}`);
  v = r.venue;
  v = ops.updateRoom(v, r.id, { name, cat: cat as never, tags: tags.length ? tags : undefined, aliases: [name.toLowerCase(), ...aliases] });
  const d = ops.setDoor(v, r.id, door, 0);
  if ("error" in d) throw new Error(`${name}: ${d.error}`);
  v = d;
  return r.id;
}

/** A walk line through the points; the first and last snap to what is already there. */
function walk(width: number, ...pts: Pt[]): void {
  let chain: string | null = null;
  let last: string | null = null;
  pts.forEach((p, i) => {
    const c = ops.walkClick(v, F, chain, p);
    v = c.venue;
    if (i > 0 && last) v = ops.setEdgeWidth(v, ops.edgeKey({ a: last, b: c.nodeId }), width);
    chain = c.nodeId;
    last = c.nodeId;
  });
}

/* ---- rooms (metres; x to the right, y down; origin = top-left of the building) ---- */
room("Pantry", P(0, 4), P(13.3, 11.1), P(6.2, 11.1), "food", ["food", "coffee", "water"], ["kitchen", "tea", "coffee", "h"]);
room("Meeting Room 2", P(0.8, 31.8), P(8.6, 38.1), P(6.2, 38.1), "meeting", ["meeting"], ["meeting room g", "g"]);
room("Meeting Room 1", P(2.4, 43.5), P(9.7, 49), P(6, 49), "meeting", ["meeting"], ["meeting room f", "f"]);
room("Meeting Room 3", P(22.4, 9.4), P(32.4, 16.4), P(22.4, 13.4), "meeting", ["meeting"], ["meeting room i", "i"]);
room("Server Rooms", P(15.8, 37.6), P(38, 45.3), P(26.3, 45.3), "workspace", ["it"], ["server room", "server", "d"]);
room("Workspace 1", P(33, 3.1), P(47.4, 22), P(33, 20), "workspace", [], ["open workspace"]);
room("Workspace 2", P(35, 22), P(47.4, 29.8), P(41.2, 29.8), "workspace", [], []);

/* ---- walk lines ---- */
walk(4.4, P(2.4, 51.3), P(51, 51.3)); // main corridor A - B
walk(2.6, P(6.2, 12.8), P(12, 12.8), P(12, 51.3)); // dashed route: Pantry door, east, then down the west aisle to the corridor at C
walk(2.4, P(12, 13.4), P(22.4, 13.4)); // to Meeting Room 3
walk(2.6, P(12, 33.5), P(56, 33.5)); // cross aisle through the middle of the floor
walk(2.4, P(12, 38.6), P(6.2, 38.6)); // to Meeting Room 2
walk(2.4, P(26.3, 46), P(26.3, 51.3)); // Server Rooms door (D) down to the corridor
walk(2.4, P(41.2, 33.5), P(41.2, 29.8)); // to Workspace 2
walk(2.4, P(29.5, 33.5), P(29.5, 20), P(33, 20)); // to Workspace 1
for (const r of v.rooms) {
  const c = ops.connectRoom(v, r.id, 8);
  if (!("error" in c)) v = c;
}

/* ---- entrance, exit, markers ---- */
v = ops.addPoi(v, F, P(2.4, 51.3), "entrance", "Main Entrance and lift lobby (A)").venue;
v = ops.addPoi(v, F, P(50.8, 49.2), "exit", "Exit (E)").venue;
v = ops.addPoi(v, F, P(6.2, 12.8), "water", "Drinking water (Pantry)").venue;
for (const p of [P(3.5, 50), P(12, 49.5), P(26.3, 49.5), P(49.5, 49.5), P(6.2, 12), P(22.8, 13.4), P(6.2, 38.6), P(41.2, 32.5)]) {
  const m = ops.addMarker(v, F, p);
  if (!("error" in m)) v = m.venue;
}

/* ---- desks and furniture drawn on the sketch (map only) ---- */
const desks: [string, number, number, number, number, ObjectKind][] = [
  ["Desk", 3, 18.3, 5, 2.4, "desk"], ["Desk", 3, 21.4, 5, 2.4, "desk"], ["Desk", 3, 24.4, 5, 2.4, "desk"], ["Desk", 3, 27.5, 5, 2.4, "desk"],
  ["", 3, 40, 1.6, 4, "table"], ["", 5.3, 40, 1.6, 4, "table"],
  ["Desk", 21.3, 3.4, 1.8, 3, "desk"], ["Desk", 25.8, 5.9, 2, 3.2, "desk"], ["Desk", 25, 17, 1.9, 4, "desk"], ["Desk", 25.8, 24.4, 1.8, 3.4, "desk"],
  ["Desk", 31, 16, 2, 4.2, "desk"], ["Desk", 32.2, 23.1, 1.8, 4.5, "desk"],
  ["Desk", 47.4, 4.6, 5.5, 2.2, "desk"], ["Desk", 48, 10.3, 5, 3.6, "desk"], ["Desk", 49, 18.3, 3.8, 2.6, "desk"],
];
for (const [label, x, y, w, h, kind] of desks) {
  const o = ops.addObject(v, F, P(x, y), kind, label);
  v = ops.updateObject(o.venue, o.id, { w, h });
}

const parsed = parseVenue(v);
if (!parsed.ok) throw new Error(parsed.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join("; "));
const bad = validate(parsed.data).filter((r) => r.level !== "pass");
for (const r of bad) console.log(`[${r.level}] ${r.title} - ${r.detail.slice(0, 200)}`);
const out = path.resolve(import.meta.dirname, "..", "public", "venues", "my-office", "venue.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(parsed.data, null, 2) + "\n");
console.log(`my-office: ${parsed.data.rooms.length} rooms, ${parsed.data.nodes.length} walk nodes, ${parsed.data.markers.length} markers, ${parsed.data.objects.length} furniture items -> ${path.relative(process.cwd(), out)}`);
