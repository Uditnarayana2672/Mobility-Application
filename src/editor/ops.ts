import { DICT_SIZE } from "@/core/aruco/dict";
import { distToSegment } from "@/core/geo";
import { doorNodeId, nearestDoor, roomDoors } from "@/core/doors";
import type { Background, Door, Edge, Floor, MapObject, Marker, Poi, Room, Side, VNode, Venue, Wall } from "@/core/schema";
import { OBJECT_KINDS, type ObjectKind, type PoiKind } from "@/core/cats";

/**
 * Pure venue editing operations. Each takes a venue and returns a NEW venue (never mutates its input);
 * the editor commits the result as one undo step. All coordinates are metres.
 */
export const GRID = 0.5;
export const NODE_SNAP = 1.0;
export const EDGE_SNAP = 0.6;
export const DOOR_LINK_RADIUS = 3;
export const MIN_ROOM = 1.5;

export interface Pt {
  x: number;
  y: number;
}

/**
 * Current grid step in metres; 0 = free drawing (coordinates are just rounded to 1 cm). The editor sets it from its Snap toggle;
 * everything below reads it, so one switch frees every tool. Defaults to the classic 0.5 m grid.
 */
let grid = GRID;
export const setGrid = (step: number): void => {
  grid = step > 0 ? step : 0;
};
export const getGrid = (): number => grid;
/** Radius within which a click joins an existing walk node (smaller when drawing freely). */
export const joinRadius = (): number => (grid > 0 ? NODE_SNAP : 0.4);
/** Smallest room side. */
export const minRoom = (): number => (grid > 0 ? MIN_ROOM : 0.6);

export const snap = (n: number, step = grid): number => (step > 0 ? Math.round(Math.round(n / step) * step * 100) / 100 : r2(n));
const r2 = (n: number): number => Math.round(n * 100) / 100;
const clone = (v: Venue): Venue => structuredClone(v);

/* ------------------------------------------------------------------ ids */

function nextNum(ids: Iterable<string>, re: RegExp): number {
  let max = 0;
  for (const id of ids) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

export const nodeId = (v: Venue, floor: string): string => `${floor}:n${nextNum(v.nodes.map((n) => n.id), new RegExp(`^${floor}:n(\\d+)$`))}`;
export const roomId = (v: Venue, floor: string): string => `${floor}-r${nextNum(v.rooms.map((r) => r.id), new RegExp(`^${floor}-r(\\d+)$`))}`;
export const wallId = (v: Venue): string => `W${String(nextNum(v.walls.map((w) => w.id), /^W(\d+)$/)).padStart(2, "0")}`;
export const poiId = (v: Venue): string => `P${String(nextNum(v.pois.map((p) => p.id), /^P(\d+)$/)).padStart(2, "0")}`;
export const floorId = (v: Venue): string => `F${nextNum(v.floors.map((f) => f.id), /^F(\d+)$/)}`;
/** Lowest free ArUco id, or null if the dictionary is exhausted. */
export function markerId(v: Venue): number | null {
  const used = new Set(v.markers.map((m) => m.id));
  for (let i = 0; i < DICT_SIZE; i++) if (!used.has(i)) return i;
  return null;
}

/* ------------------------------------------------------------------ geometry */

const OUTWARD: Record<Side, number> = { N: 0, E: 90, S: 180, W: 270 };

export interface EdgeHit {
  room: Room;
  side: Side;
  /** Nearest point on the room edge. */
  point: Pt;
  dist: number;
  /** Bearing pointing away from the room (the way a sticker on this wall faces). */
  normal: number;
  /** Edge endpoints (for sizing ad walls). */
  a: Pt;
  b: Pt;
}

function roomEdges(r: Room): { side: Side; a: Pt; b: Pt }[] {
  return [
    { side: "N", a: { x: r.x, y: r.y }, b: { x: r.x + r.w, y: r.y } },
    { side: "S", a: { x: r.x, y: r.y + r.h }, b: { x: r.x + r.w, y: r.y + r.h } },
    { side: "W", a: { x: r.x, y: r.y }, b: { x: r.x, y: r.y + r.h } },
    { side: "E", a: { x: r.x + r.w, y: r.y }, b: { x: r.x + r.w, y: r.y + r.h } },
  ];
}

function projectOnSegment(p: Pt, a: Pt, b: Pt): { pt: Pt; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return { pt: { x: a.x + t * dx, y: a.y + t * dy }, t };
}

/** Nearest room edge on a floor within maxD metres (optionally restricted to one room). */
export function nearestRoomEdge(v: Venue, floor: string, p: Pt, maxD: number, onlyRoom?: string): EdgeHit | null {
  let best: EdgeHit | null = null;
  for (const room of v.rooms) {
    if (room.floor !== floor || (onlyRoom && room.id !== onlyRoom)) continue;
    for (const e of roomEdges(room)) {
      const { pt } = projectOnSegment(p, e.a, e.b);
      const d = Math.hypot(p.x - pt.x, p.y - pt.y);
      if (d <= maxD && (!best || d < best.dist)) best = { room, side: e.side, point: pt, dist: d, normal: OUTWARD[e.side], a: e.a, b: e.b };
    }
  }
  return best;
}

export const findNode = (v: Venue, id: string): VNode | undefined => v.nodes.find((n) => n.id === id);
const hasEdge = (v: Venue, a: string, b: string): boolean => v.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
function linkWalk(v: Venue, a: string, b: string): void {
  if (a !== b && !hasEdge(v, a, b)) v.edges.push({ a, b, type: "walk" });
}

/** Nearest existing node on the floor within `radius`. */
export function nearestNode(v: Venue, floor: string, p: Pt, radius: number, kinds?: VNode["kind"][]): VNode | null {
  let best: { n: VNode; d: number } | null = null;
  for (const n of v.nodes) {
    if (n.floor !== floor || (kinds && !kinds.includes(n.kind))) continue;
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d <= radius && (!best || d < best.d)) best = { n, d };
  }
  return best ? best.n : null;
}

interface EdgeProj {
  edgeIndex: number;
  pt: Pt;
  t: number;
  dist: number;
}

/** Nearest walk edge between corridor nodes on the floor. */
function nearestWalkEdge(v: Venue, floor: string, p: Pt, radius: number): EdgeProj | null {
  let best: EdgeProj | null = null;
  v.edges.forEach((e, i) => {
    if (e.type !== "walk") return;
    const a = findNode(v, e.a);
    const b = findNode(v, e.b);
    if (!a || !b || a.floor !== floor || b.floor !== floor || a.kind !== "corridor" || b.kind !== "corridor") return;
    const { pt, t } = projectOnSegment(p, a, b);
    const d = Math.hypot(p.x - pt.x, p.y - pt.y);
    if (d <= radius && (!best || d < best.dist)) best = { edgeIndex: i, pt, t, dist: d };
  });
  return best;
}

/** Split walk edge `edgeIndex` with a new corridor node at pt; returns the new node (mutates `v`). */
function splitEdge(v: Venue, floor: string, edgeIndex: number, pt: Pt): VNode {
  const e = v.edges[edgeIndex]!;
  const n: VNode = { id: nodeId(v, floor), floor, x: r2(pt.x), y: r2(pt.y), kind: "corridor" };
  v.nodes.push(n);
  v.edges.splice(edgeIndex, 1);
  v.edges.push({ a: e.a, b: n.id, type: "walk" }, { a: n.id, b: e.b, type: "walk" });
  return n;
}

/* ------------------------------------------------------------------ rooms & doors */

/** Create the door nodes + room-centre node for a room and link them; drops nodes of doors that no longer exist (mutates `v`). */
function ensureRoomNodes(v: Venue, room: Room): void {
  const doors = roomDoors(room);
  const keep = new Set(doors.map((_, i) => doorNodeId(room.id, i)));
  v.nodes = v.nodes.filter((n) => !(n.kind === "door" && n.room === room.id && !keep.has(n.id)));
  const ids = new Set(v.nodes.map((n) => n.id));
  v.edges = v.edges.filter((e) => ids.has(e.a) && ids.has(e.b));
  const c = findNode(v, room.id);
  if (c) {
    c.x = r2(room.x + room.w / 2);
    c.y = r2(room.y + room.h / 2);
  } else v.nodes.push({ id: room.id, floor: room.floor, x: r2(room.x + room.w / 2), y: r2(room.y + room.h / 2), kind: "room", room: room.id });
  doors.forEach((d, i) => {
    const id = doorNodeId(room.id, i);
    const n = findNode(v, id);
    if (n) {
      n.x = d.x;
      n.y = d.y;
    } else v.nodes.push({ id, floor: room.floor, x: d.x, y: d.y, kind: "door", room: room.id });
    linkWalk(v, id, room.id);
  });
}

/** True when door `i` already has a walk link to something other than its own room node. */
function doorLinked(v: Venue, room: Room, i = 0): boolean {
  const doorId = doorNodeId(room.id, i);
  return v.edges.some((e) => e.type === "walk" && ((e.a === doorId && e.b !== room.id) || (e.b === doorId && e.a !== room.id)));
}

/** Link door `i` of a room to the nearest corridor node or walk edge within `radius` (mutates `v`). Returns whether it linked. */
function linkDoor(v: Venue, room: Room, radius: number, i = 0): boolean {
  const doorId = doorNodeId(room.id, i);
  const d = roomDoors(room)[i]!;
  const dp = { x: d.x, y: d.y };
  const node = nearestNode(v, room.floor, dp, radius, ["corridor"]);
  const edge = nearestWalkEdge(v, room.floor, dp, radius);
  const nodeD = node ? Math.hypot(node.x - dp.x, node.y - dp.y) : Infinity;
  if (edge && edge.t > 0.02 && edge.t < 0.98 && edge.dist < nodeD - 0.01) {
    const n = splitEdge(v, room.floor, edge.edgeIndex, edge.pt);
    linkWalk(v, doorId, n.id);
    return true;
  }
  if (node) {
    linkWalk(v, doorId, node.id);
    return true;
  }
  return false;
}

/** Nearest point of the floor's corridor network (walk edges between corridor nodes, else corridor nodes, else corridor rectangles). */
function nearestNetworkPoint(v: Venue, floor: string, p: Pt): Pt | null {
  let best: { pt: Pt; d: number } | null = null;
  const consider = (pt: Pt) => {
    const d = Math.hypot(p.x - pt.x, p.y - pt.y);
    if (!best || d < best.d) best = { pt, d };
  };
  for (const e of v.edges) {
    if (e.type !== "walk") continue;
    const a = findNode(v, e.a);
    const b = findNode(v, e.b);
    if (a && b && a.floor === floor && b.floor === floor && a.kind === "corridor" && b.kind === "corridor") consider(projectOnSegment(p, a, b).pt);
  }
  if (!best) for (const n of v.nodes) if (n.floor === floor && n.kind === "corridor") consider(n);
  if (!best) for (const c of v.corridors) if (c.floor === floor) consider({ x: c.x + c.w / 2, y: c.y + c.h / 2 });
  return best ? (best as { pt: Pt }).pt : null;
}

/** Door on the side of the room that faces the nearest corridor (default: south wall, centred). */
function defaultDoor(v: Venue, r: Omit<Room, "door">): Room["door"] {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const target = nearestNetworkPoint(v, r.floor, { x: cx, y: cy });
  if (!target) return { x: snap(cx), y: r.y + r.h, side: "S" };
  const dx = target.x - cx;
  const dy = target.y - cy;
  // Compare in room-relative units so a wide room still picks the side that actually faces the corridor.
  if (Math.abs(dx) / (r.w / 2) > Math.abs(dy) / (r.h / 2)) {
    const y = snap(clamp(target.y, r.y + 0.5, r.y + r.h - 0.5));
    return dx > 0 ? { x: r.x + r.w, y, side: "E" } : { x: r.x, y, side: "W" };
  }
  const x = snap(clamp(target.x, r.x + 0.5, r.x + r.w - 0.5));
  return dy > 0 ? { x, y: r.y + r.h, side: "S" } : { x, y: r.y, side: "N" };
}
/** Clamp n into [a, b]; if the range is empty (b < a) return its midpoint. */
const clamp = (n: number, a: number, b: number): number => (b < a ? (a + b) / 2 : Math.max(a, Math.min(b, n)));

export function addRoom(v0: Venue, floor: string, a: Pt, b: Pt): { venue: Venue; id: string } | { error: string } {
  const x = snap(Math.min(a.x, b.x));
  const y = snap(Math.min(a.y, b.y));
  const w = snap(Math.abs(b.x - a.x));
  const h = snap(Math.abs(b.y - a.y));
  const min = minRoom();
  if (w < min || h < min) return { error: `Too small: drag at least ${min} m × ${min} m` };
  const v = clone(v0);
  const id = roomId(v, floor);
  const base = { id, floor, name: "New room", cat: "workspace" as const, x, y, w, h, aliases: [], hours: "9:00 – 19:00", access: "public" as const, short: null, extraDoors: [] };
  const room: Room = { ...base, door: defaultDoor(v, base) };
  v.rooms.push(room);
  ensureRoomNodes(v, room);
  linkDoor(v, room, DOOR_LINK_RADIUS);
  return { venue: v, id };
}

/** The point on a room edge nearest to `p`, as a door position (kept 0.5 m from the corners of straight walls). */
function doorOnEdge(room: Room, hit: EdgeHit): Door {
  const pt = hit.side === "N" || hit.side === "S" ? { x: snap(clamp(hit.point.x, room.x + 0.5, room.x + room.w - 0.5)), y: hit.point.y } : { x: hit.point.x, y: snap(clamp(hit.point.y, room.y + 0.5, room.y + room.h - 0.5)) };
  return { x: r2(pt.x), y: r2(pt.y), side: hit.side };
}

/** Drop every walk link of door `i` except to its own room node. */
function unlinkDoor(v: Venue, room: Room, i: number): void {
  const doorId = doorNodeId(room.id, i);
  v.edges = v.edges.filter((e) => !(e.type === "walk" && ((e.a === doorId && e.b !== room.id) || (e.b === doorId && e.a !== room.id))));
}

/** Move door `index` (0 = the main door) to the nearest point of its own room's edge. */
export function setDoor(v0: Venue, rId: string, p: Pt, index = 0): Venue | { error: string } {
  const v = clone(v0);
  const room = v.rooms.find((r) => r.id === rId);
  if (!room) return { error: "No such room" };
  const hit = nearestRoomEdge(v, room.floor, p, Infinity, rId);
  if (!hit) return { error: "No edge found" };
  const door = doorOnEdge(room, hit);
  if (index === 0) room.door = door;
  else if (room.extraDoors[index - 1]) room.extraDoors[index - 1] = door;
  else return { error: "No such door" };
  unlinkDoor(v, room, index);
  ensureRoomNodes(v, room);
  linkDoor(v, room, DOOR_LINK_RADIUS, index);
  return v;
}

/** Add another door to a room, on the wall nearest to `p`. */
export function addDoor(v0: Venue, rId: string, p: Pt): { venue: Venue; index: number } | { error: string } {
  const v = clone(v0);
  const room = v.rooms.find((r) => r.id === rId);
  if (!room) return { error: "No such room" };
  const hit = nearestRoomEdge(v, room.floor, p, Infinity, rId);
  if (!hit) return { error: "No edge found" };
  room.extraDoors = [...room.extraDoors, doorOnEdge(room, hit)];
  const index = room.extraDoors.length;
  ensureRoomNodes(v, room);
  linkDoor(v, room, DOOR_LINK_RADIUS, index);
  return { venue: v, index };
}

/** Remove door `index`. A room keeps at least one door; removing the main door promotes the next one. */
export function deleteDoor(v0: Venue, rId: string, index: number): Venue | { error: string } {
  const v = clone(v0);
  const room = v.rooms.find((r) => r.id === rId);
  if (!room) return { error: "No such room" };
  const doors = roomDoors(room);
  if (doors.length < 2) return { error: "A room needs at least one door" };
  if (index < 0 || index >= doors.length) return { error: "No such door" };
  const rest = doors.filter((_, i) => i !== index);
  // Door node ids are positional, so rebuild all of them and re-link by position.
  doors.forEach((_, i) => unlinkDoor(v, room, i));
  room.door = rest[0]!;
  room.extraDoors = rest.slice(1);
  ensureRoomNodes(v, room);
  rest.forEach((_, i) => linkDoor(v, room, DOOR_LINK_RADIUS, i));
  return v;
}

/** The door of a room (any of them) within `radius` of `p`, as its index. */
export function doorNear(v: Venue, rId: string, p: Pt, radius: number): number | null {
  const room = v.rooms.find((r) => r.id === rId);
  if (!room) return null;
  const n = nearestDoor(room, p);
  return n.dist <= radius ? n.index : null;
}

/** Retry connecting a room's doors to the walk network with a wide search radius ("Connect to corridor"). */
export function connectRoom(v0: Venue, rId: string, radius = 12): Venue | { error: string } {
  const v = clone(v0);
  const room = v.rooms.find((r) => r.id === rId);
  if (!room) return { error: "No such room" };
  ensureRoomNodes(v, room);
  const n = roomDoors(room).length;
  let any = false;
  for (let i = 0; i < n; i++) {
    if (doorLinked(v, room, i) || linkDoor(v, room, radius, i)) any = true;
  }
  if (!any) return { error: `No walk path within ${radius} m: draw a walk path near the door first` };
  return v;
}

/** After the room's rectangle changed, keep a door on the wall it was on, at the same place along it. */
function refitDoor(v: Venue, room: Room, d: Door): Door {
  const hit = nearestRoomEdge(v, room.floor, { x: d.x, y: d.y }, Infinity, room.id);
  if (!hit) return d;
  return {
    ...d,
    x: r2(hit.side === "N" || hit.side === "S" ? clamp(d.x, room.x, room.x + room.w) : hit.point.x),
    y: r2(hit.side === "E" || hit.side === "W" ? clamp(d.y, room.y, room.y + room.h) : hit.point.y),
    side: hit.side,
  };
}

export function updateRoom(v0: Venue, rId: string, patch: Partial<Room>): Venue {
  const v = clone(v0);
  const room = v.rooms.find((r) => r.id === rId);
  if (!room) return v;
  Object.assign(room, patch);
  if (patch.kind) room.cat = "vertical";
  if (patch.x !== undefined || patch.y !== undefined || patch.w !== undefined || patch.h !== undefined) {
    // Keep the doors on their sides and the nodes in sync after a resize/move.
    room.door = refitDoor(v, room, room.door);
    room.extraDoors = room.extraDoors.map((d) => refitDoor(v, room, d));
    ensureRoomNodes(v, room);
  }
  return v;
}

export function moveRoom(v0: Venue, rId: string, dx: number, dy: number): Venue {
  const v = clone(v0);
  const room = v.rooms.find((r) => r.id === rId);
  if (!room) return v;
  const before = v0.rooms.find((r) => r.id === rId)!;
  room.x = snap(room.x + dx);
  room.y = snap(room.y + dy);
  const ddx = room.x - before.x;
  const ddy = room.y - before.y;
  const shift = (d: Door): Door => ({ ...d, x: r2(d.x + ddx), y: r2(d.y + ddy) });
  room.door = shift(room.door);
  room.extraDoors = room.extraDoors.map(shift);
  ensureRoomNodes(v, room);
  return v;
}

/* ------------------------------------------------------------------ walk network */

/**
 * One click of the walk-path tool. Joins an existing node within 1 m, else splits a nearby corridor edge,
 * else drops a new node on the 0.5 m grid; links it to the previous node of the chain and to door nodes within 1.5 m.
 */
export function walkClick(v0: Venue, floor: string, chain: string | null, p: Pt): { venue: Venue; nodeId: string } {
  const v = clone(v0);
  let n: VNode | null = nearestNode(v, floor, p, joinRadius(), ["corridor", "door"]);
  if (!n) {
    const edge = nearestWalkEdge(v, floor, p, EDGE_SNAP);
    if (edge && edge.t > 0.02 && edge.t < 0.98) n = splitEdge(v, floor, edge.edgeIndex, edge.pt);
  }
  if (!n) {
    n = { id: nodeId(v, floor), floor, x: snap(p.x), y: snap(p.y), kind: "corridor" };
    v.nodes.push(n);
  }
  if (chain) linkWalk(v, chain, n.id);
  if (n.kind === "corridor") {
    for (const room of v.rooms) {
      if (room.floor !== floor) continue;
      const doors = roomDoors(room);
      const near = doors.map((d, i) => (Math.hypot(d.x - n!.x, d.y - n!.y) <= 1.5 ? i : -1)).filter((i) => i >= 0);
      if (!near.length) continue;
      ensureRoomNodes(v, room);
      for (const i of near) linkWalk(v, doorNodeId(room.id, i), n.id);
    }
  }
  return { venue: v, nodeId: n.id };
}

export function moveNode(v0: Venue, id: string, p: Pt): Venue {
  const v = clone(v0);
  const n = findNode(v, id);
  if (!n || n.kind !== "corridor") return v; // door/room nodes follow their room
  n.x = snap(p.x);
  n.y = snap(p.y);
  return v;
}

/* ------------------------------------------------------------------ corridor editing (free layout) */

/** Stable id of a walk edge: "a|b" (node ids never contain "|"). */
export const edgeKey = (e: Pick<Edge, "a" | "b">): string => `${e.a}|${e.b}`;
export const findEdge = (v: Venue, key: string): Edge | undefined => v.edges.find((e) => edgeKey(e) === key);

/** Put a new corridor node on a walk edge (at `pt` projected onto it, default its middle) and split the edge in two. */
export function insertNodeOnEdge(v0: Venue, key: string, pt?: Pt): { venue: Venue; nodeId: string } | { error: string } {
  const v = clone(v0);
  const e = findEdge(v, key);
  const a = e && findNode(v, e.a);
  const b = e && findNode(v, e.b);
  if (!e || !a || !b || e.type !== "walk") return { error: "No such walk line" };
  const at = pt ? projectOnSegment(pt, a, b).pt : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const n: VNode = { id: nodeId(v, a.floor), floor: a.floor, x: r2(at.x), y: r2(at.y), kind: "corridor" };
  v.nodes.push(n);
  const i = v.edges.indexOf(findEdge(v, key)!);
  const { width } = e;
  v.edges.splice(i, 1, { a: e.a, b: n.id, type: "walk", ...(width ? { width } : {}) }, { a: n.id, b: e.b, type: "walk", ...(width ? { width } : {}) });
  return { venue: v, nodeId: n.id };
}

/** Remove one walk line; corridor nodes left with no line at all are removed too. */
export function deleteEdge(v0: Venue, key: string): Venue {
  const v = clone(v0);
  const e = findEdge(v, key);
  if (!e) return v;
  v.edges = v.edges.filter((x) => x !== e);
  for (const id of [e.a, e.b]) {
    const n = findNode(v, id);
    if (n && n.kind === "corridor" && !v.edges.some((x) => x.a === id || x.b === id)) v.nodes = v.nodes.filter((x) => x.id !== id);
  }
  return v;
}

export function setEdgeWidth(v0: Venue, key: string, width: number | null): Venue {
  const v = clone(v0);
  const e = findEdge(v, key);
  if (!e) return v;
  if (width === null || !(width > 0)) delete e.width;
  else e.width = r2(width);
  return v;
}

/** Ids of the corridor nodes connected to `id` by walk lines (door and room nodes end the search). */
export function corridorComponent(v: Venue, id: string): Set<string> {
  const seen = new Set<string>();
  const start = findNode(v, id);
  if (!start || start.kind !== "corridor") return seen;
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of v.edges) {
      if (e.type !== "walk" || (e.a !== cur && e.b !== cur)) continue;
      const other = findNode(v, e.a === cur ? e.b : e.a);
      if (other && other.kind === "corridor" && other.floor === start.floor && !seen.has(other.id)) stack.push(other.id);
    }
  }
  return seen;
}

/**
 * Move a whole connected corridor by (dx, dy). Rooms stay where they are: a door that was linked to the corridor is re-linked to
 * wherever the corridor now passes (within the door link radius); if it no longer reaches, the old (longer) link is kept so nothing disconnects silently.
 */
export function moveComponent(v0: Venue, id: string, dx: number, dy: number): Venue {
  const v = clone(v0);
  const comp = corridorComponent(v, id);
  if (!comp.size) return v;
  const sdx = grid > 0 ? snap(dx) : dx;
  const sdy = grid > 0 ? snap(dy) : dy;
  for (const n of v.nodes) if (comp.has(n.id)) {
    n.x = r2(n.x + sdx);
    n.y = r2(n.y + sdy);
  }
  for (const room of v.rooms) {
    const doorId = `${room.id}:door`;
    const links = v.edges.filter((e) => e.type === "walk" && ((e.a === doorId && comp.has(e.b)) || (e.b === doorId && comp.has(e.a))));
    if (!links.length) continue;
    const before = v.edges.slice();
    v.edges = v.edges.filter((e) => !links.includes(e));
    if (!linkDoor(v, room, DOOR_LINK_RADIUS)) v.edges = before;
  }
  return v;
}

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const RESIZE_HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Where each resize handle of a rectangle room sits. */
export function resizeHandlePoint(r: Pick<Room, "x" | "y" | "w" | "h">, h: ResizeHandle): Pt {
  const x = h.includes("w") ? r.x : h.includes("e") ? r.x + r.w : r.x + r.w / 2;
  const y = h.includes("n") ? r.y : h.includes("s") ? r.y + r.h : r.y + r.h / 2;
  return { x, y };
}

/** Drag one handle of a rectangle room to `pt` (the opposite side stays put). Refuses to go below the minimum size. */
export function resizeRoom(v0: Venue, rId: string, handle: ResizeHandle, pt: Pt): Venue {
  const room = v0.rooms.find((r) => r.id === rId);
  if (!room) return v0;
  const min = minRoom();
  let x0 = room.x;
  let y0 = room.y;
  let x1 = room.x + room.w;
  let y1 = room.y + room.h;
  if (handle.includes("w")) x0 = Math.min(snap(pt.x), x1 - min);
  if (handle.includes("e")) x1 = Math.max(snap(pt.x), x0 + min);
  if (handle.includes("n")) y0 = Math.min(snap(pt.y), y1 - min);
  if (handle.includes("s")) y1 = Math.max(snap(pt.y), y0 + min);
  return updateRoom(v0, rId, { x: r2(x0), y: r2(y0), w: r2(x1 - x0), h: r2(y1 - y0) });
}

/* ------------------------------------------------------------------ furniture / fixtures (map-only) */

export const objectId = (v: Venue): string => `O${String(nextNum(v.objects.map((o) => o.id), /^O(\d+)$/)).padStart(2, "0")}`;

const rotPt = (p: Pt, deg: number): Pt => {
  const a = (deg * Math.PI) / 180;
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
};

/** World position of corner `i` (0 = top-left, clockwise) of an object's footprint. */
export function objectCorner(o: Pick<MapObject, "x" | "y" | "w" | "h" | "rotation">, i: number): Pt {
  const sx = i === 1 || i === 2 ? 1 : -1;
  const sy = i >= 2 ? 1 : -1;
  const r = rotPt({ x: (sx * o.w) / 2, y: (sy * o.h) / 2 }, o.rotation);
  return { x: o.x + r.x, y: o.y + r.y };
}

/** The rotate handle sits above the object's "top" edge. */
export function objectRotateHandle(o: Pick<MapObject, "x" | "y" | "w" | "h" | "rotation">): Pt {
  const r = rotPt({ x: 0, y: -(o.h / 2 + 0.9) }, o.rotation);
  return { x: o.x + r.x, y: o.y + r.y };
}

export function addObject(v0: Venue, floor: string, p: Pt, kind: ObjectKind, label = ""): { venue: Venue; id: string } {
  const v = clone(v0);
  const id = objectId(v);
  const k = OBJECT_KINDS[kind];
  v.objects.push({ id, floor, kind, x: snap(p.x), y: snap(p.y), w: k.w, h: k.h, rotation: 0, label });
  return { venue: v, id };
}

export function updateObject(v0: Venue, id: string, patch: Partial<MapObject>): Venue {
  const v = clone(v0);
  const o = v.objects.find((x) => x.id === id);
  if (o) Object.assign(o, patch);
  return v;
}

/** Move by a drag offset (the object keeps its grab point under the pointer). */
export function moveObjectBy(v0: Venue, id: string, dx: number, dy: number): Venue {
  const v = clone(v0);
  const o = v.objects.find((x) => x.id === id);
  const o0 = v0.objects.find((x) => x.id === id);
  if (!o || !o0) return v;
  o.x = snap(o0.x + dx);
  o.y = snap(o0.y + dy);
  return v;
}

/** Drag a corner: the footprint grows symmetrically about the centre, in the object's own axes. */
export function resizeObject(v0: Venue, id: string, p: Pt): Venue {
  const v = clone(v0);
  const o = v.objects.find((x) => x.id === id);
  if (!o) return v;
  const local = rotPt({ x: p.x - o.x, y: p.y - o.y }, -o.rotation);
  const step = grid > 0 ? grid / 2 : 0;
  o.w = Math.max(0.2, step ? snap(Math.abs(local.x) * 2, step) : r2(Math.abs(local.x) * 2));
  o.h = Math.max(0.2, step ? snap(Math.abs(local.y) * 2, step) : r2(Math.abs(local.y) * 2));
  return v;
}

/** Drag the rotate handle: the object turns so its top edge points at the pointer (15 degree steps while snapping). */
export function rotateObject(v0: Venue, id: string, p: Pt): Venue {
  const v = clone(v0);
  const o = v.objects.find((x) => x.id === id);
  if (!o) return v;
  let deg = (Math.atan2(p.y - o.y, p.x - o.x) * 180) / Math.PI + 90;
  deg = grid > 0 ? Math.round(deg / 15) * 15 : Math.round(deg * 10) / 10;
  o.rotation = ((deg % 360) + 360) % 360;
  return v;
}

/* ------------------------------------------------------------------ vertical links */

export const LIFT_SEC = { base: 30, perFloor: 14 };
export const STAIRS_SEC = { up: 18, down: 12 };

export function addVerticalLinks(v0: Venue, type: "lift" | "stairs", roomIds: string[]): { venue: Venue; added: number } | { error: string } {
  const v = clone(v0);
  const rooms = roomIds.map((id) => v.rooms.find((r) => r.id === id));
  if (rooms.some((r) => !r)) return { error: "Unknown room" };
  const rs = rooms as Room[];
  if (new Set(rs.map((r) => r.floor)).size !== rs.length) return { error: "Pick rooms on different floors" };
  if (rs.length < 2) return { error: "Pick at least two rooms" };
  const idx = (f: string) => v.floors.findIndex((x) => x.id === f);
  let added = 0;
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i]!;
      const b = rs[j]!;
      const lo = idx(a.floor) < idx(b.floor) ? a : b;
      const hi = lo === a ? b : a;
      const span = idx(hi.floor) - idx(lo.floor);
      if (type === "stairs" && span !== 1) return { error: "Stairs connect adjacent floors only: use a lift for longer rides" };
      if (v.edges.some((e) => e.type !== "walk" && ((e.a === lo.id && e.b === hi.id) || (e.a === hi.id && e.b === lo.id)))) continue;
      const up = type === "lift" ? LIFT_SEC.base + LIFT_SEC.perFloor * span : STAIRS_SEC.up * span;
      const down = type === "lift" ? up : STAIRS_SEC.down * span;
      v.edges.push({ a: lo.id, b: hi.id, type, len: 6 * span, upSec: up, downSec: down });
      added++;
    }
  }
  for (const r of rs) {
    r.kind = type;
    r.cat = "vertical";
  }
  return { venue: v, added };
}

/* ------------------------------------------------------------------ markers, walls, POIs */

export function addMarker(v0: Venue, floor: string, p: Pt): { venue: Venue; id: number } | { error: string } {
  const id = markerId(v0);
  if (id === null) return { error: `All ${DICT_SIZE} printable marker IDs are used` };
  const v = clone(v0);
  const hit = nearestRoomEdge(v, floor, p, 3);
  const pos = hit ? hit.point : p;
  const m: Marker = { id, floor, name: `Marker ${id}`, x: snap(pos.x), y: snap(pos.y), z: 1.4, normal: hit ? hit.normal : 0, sizeM: 0.12, note: "" };
  v.markers.push(m);
  return { venue: v, id };
}

export function addWall(v0: Venue, floor: string, p: Pt): { venue: Venue; id: string } {
  const v = clone(v0);
  const hit = nearestRoomEdge(v, floor, p, 3);
  const id = wallId(v);
  let w: Wall;
  if (hit) {
    // 3 m slot centred on the click, kept inside the edge.
    const len = Math.hypot(hit.b.x - hit.a.x, hit.b.y - hit.a.y);
    const half = Math.min(1.5, len / 2);
    const horizontal = hit.side === "N" || hit.side === "S";
    const c = horizontal ? clamp(hit.point.x, hit.a.x + half, hit.b.x - half) : clamp(hit.point.y, hit.a.y + half, hit.b.y - half);
    w = horizontal
      ? { id, floor, label: "New blank wall", x1: snap(c - half), y1: hit.a.y, x2: snap(c + half), y2: hit.a.y, normal: hit.normal, bottom: 1, height: 1.6, approved: false }
      : { id, floor, label: "New blank wall", x1: hit.a.x, y1: snap(c - half), x2: hit.a.x, y2: snap(c + half), normal: hit.normal, bottom: 1, height: 1.6, approved: false };
  } else {
    w = { id, floor, label: "New blank wall", x1: snap(p.x - 1.5), y1: snap(p.y), x2: snap(p.x + 1.5), y2: snap(p.y), normal: 0, bottom: 1, height: 1.6, approved: false };
  }
  v.walls.push(w);
  return { venue: v, id };
}

export function addPoi(v0: Venue, floor: string, p: Pt, kind: PoiKind, label: string): { venue: Venue; id: string } {
  const v = clone(v0);
  const id = poiId(v);
  const poi: Poi = { id, floor, kind, name: label, x: snap(p.x), y: snap(p.y) };
  v.pois.push(poi);
  return { venue: v, id };
}

export function updateMarker(v0: Venue, id: number, patch: Partial<Marker>): Venue {
  const v = clone(v0);
  const m = v.markers.find((x) => x.id === id);
  if (m) Object.assign(m, patch);
  return v;
}

export function updateWall(v0: Venue, id: string, patch: Partial<Wall>): Venue {
  const v = clone(v0);
  const w = v.walls.find((x) => x.id === id);
  if (w) Object.assign(w, patch);
  return v;
}

export function updatePoi(v0: Venue, id: string, patch: Partial<Poi>): Venue {
  const v = clone(v0);
  const p = v.pois.find((x) => x.id === id);
  if (p) Object.assign(p, patch);
  return v;
}

export function moveItem(v0: Venue, type: "marker" | "wall" | "poi", id: string, p: Pt): Venue {
  const v = clone(v0);
  if (type === "marker") {
    const m = v.markers.find((x) => String(x.id) === id);
    if (m) (m.x = snap(p.x)), (m.y = snap(p.y));
  } else if (type === "poi") {
    const q = v.pois.find((x) => x.id === id);
    if (q) (q.x = snap(p.x)), (q.y = snap(p.y));
  } else {
    const w = v.walls.find((x) => x.id === id);
    if (w) {
      const cx = (w.x1 + w.x2) / 2;
      const cy = (w.y1 + w.y2) / 2;
      const dx = snap(p.x) - cx;
      const dy = snap(p.y) - cy;
      w.x1 = r2(w.x1 + dx);
      w.x2 = r2(w.x2 + dx);
      w.y1 = r2(w.y1 + dy);
      w.y2 = r2(w.y2 + dy);
    }
  }
  return v;
}

/* ------------------------------------------------------------------ delete */

export type Deletable = { type: "room" | "marker" | "wall" | "poi" | "node" | "edge" | "object"; id: string };

export function deleteItem(v0: Venue, item: Deletable): Venue {
  const v = clone(v0);
  switch (item.type) {
    case "room": {
      const ids = new Set(v.nodes.filter((n) => n.room === item.id || n.id === item.id).map((n) => n.id));
      v.rooms = v.rooms.filter((r) => r.id !== item.id);
      v.nodes = v.nodes.filter((n) => !ids.has(n.id));
      v.edges = v.edges.filter((e) => !ids.has(e.a) && !ids.has(e.b));
      break;
    }
    case "marker":
      v.markers = v.markers.filter((m) => String(m.id) !== item.id);
      break;
    case "wall":
      v.walls = v.walls.filter((w) => w.id !== item.id);
      break;
    case "poi":
      v.pois = v.pois.filter((p) => p.id !== item.id);
      break;
    case "node":
      v.nodes = v.nodes.filter((n) => n.id !== item.id);
      v.edges = v.edges.filter((e) => e.a !== item.id && e.b !== item.id);
      break;
    case "edge":
      return deleteEdge(v, item.id);
    case "object":
      v.objects = v.objects.filter((o) => o.id !== item.id);
      break;
  }
  return v;
}

/* ------------------------------------------------------------------ floors, background, scale */

export function addFloor(v0: Venue): { venue: Venue; id: string } {
  const v = clone(v0);
  const id = floorId(v);
  const last = v.floors[v.floors.length - 1];
  const floor: Floor = { id, name: `Floor ${v.floors.length + 1}`, short: String(v.floors.length + 1), elevation: (last?.elevation ?? 0) + (last?.height ?? 4), height: last?.height ?? 3, w: last?.w ?? 60, h: last?.h ?? 36 };
  v.floors.push(floor);
  return { venue: v, id };
}

export function updateFloor(v0: Venue, id: string, patch: Partial<Omit<Floor, "id" | "background">>): Venue {
  const v = clone(v0);
  const f = v.floors.find((x) => x.id === id);
  if (f) Object.assign(f, patch);
  return v;
}

export function updateVenueMeta(v0: Venue, patch: Partial<Pick<Venue, "name" | "type" | "city" | "address">>): Venue {
  return { ...clone(v0), ...patch };
}

/** Recompute the venue-level calibrated flag: every floor with a photo must be calibrated. */
function syncScale(v: Venue): void {
  const withBg = v.floors.filter((f) => f.background);
  const allCal = withBg.every((f) => f.background!.calibrated);
  v.scale = { ...v.scale, metersPerUnit: 1, calibrated: allCal, reference: withBg.length ? withBg.map((f) => `${f.name}: ${f.background!.reference ?? "not calibrated"}`).join("; ") : "Drawn in metres (no photo)" };
}

/** Attach a photo to a floor, fitted inside the floor plate (scale is a guess until calibrated). */
export function setBackground(v0: Venue, floor: string, img: { imageUrl: string; widthPx: number; heightPx: number }): Venue {
  const v = clone(v0);
  const f = v.floors.find((x) => x.id === floor);
  if (!f) return v;
  const scale = Math.min(f.w / img.widthPx, f.h / img.heightPx);
  f.background = { ...img, opacity: 0.55, transform: { x: 0, y: 0, scale: r4(scale), rotationDeg: 0 }, calibrated: false };
  syncScale(v);
  return v;
}
const r4 = (n: number): number => Math.round(n * 10000) / 10000;

export function updateBackground(v0: Venue, floor: string, patch: Partial<Pick<Background, "opacity">> & { transform?: Partial<Background["transform"]> }): Venue {
  const v = clone(v0);
  const bg = v.floors.find((x) => x.id === floor)?.background;
  if (!bg) return v;
  if (patch.opacity !== undefined) bg.opacity = Math.max(0, Math.min(1, patch.opacity));
  if (patch.transform) {
    const before = bg.transform.scale;
    bg.transform = { ...bg.transform, ...patch.transform };
    // Changing the scale by hand invalidates an earlier calibration.
    if (patch.transform.scale !== undefined && patch.transform.scale !== before) {
      bg.calibrated = false;
      delete bg.reference;
    }
  }
  syncScale(v);
  return v;
}

export function removeBackground(v0: Venue, floor: string): Venue {
  const v = clone(v0);
  const f = v.floors.find((x) => x.id === floor);
  if (f) delete f.background;
  syncScale(v);
  return v;
}

/**
 * Calibrate a floor photo: the user drew a line from a to b (world metres under the CURRENT image scale) over something
 * measured as `metres` in real life. The image is scaled about point `a` so that line becomes exactly `metres` long.
 * Drawn geometry is never rescaled (coordinates are always metres).
 */
export function calibrateBackground(v0: Venue, floor: string, a: Pt, b: Pt, metres: number): Venue | { error: string } {
  const drawn = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(metres > 0) || drawn < 1e-6) return { error: "Enter a length greater than zero and draw a longer line" };
  const v = clone(v0);
  const bg = v.floors.find((x) => x.id === floor)?.background;
  if (!bg) return { error: "Upload a floor photo first" };
  const k = metres / drawn;
  bg.transform = { ...bg.transform, scale: r4(bg.transform.scale * k), x: r4(a.x + k * (bg.transform.x - a.x)), y: r4(a.y + k * (bg.transform.y - a.y)) };
  bg.calibrated = true;
  bg.reference = `drew ${drawn.toFixed(2)} m, set to ${metres} m`;
  syncScale(v);
  return v;
}

/* ------------------------------------------------------------------ misc */

export { distToSegment };

/** A venue with one empty floor, no photos (so metric by construction). Keeps id/name/city of `base` when given. */
export function blankVenue(base?: Pick<Venue, "id" | "name" | "type" | "city" | "address" | "version">): Venue {
  return {
    schemaVersion: 2,
    id: base?.id ?? "office-hq",
    name: base?.name ?? "New venue",
    type: base?.type ?? "Office / Tech park",
    city: base?.city ?? "Indore",
    address: base?.address ?? "",
    version: base?.version ?? 1,
    status: "draft",
    scale: { metersPerUnit: 1, calibrated: true, reference: "Drawn in metres (no photo)" },
    floors: [{ id: "F1", name: "Floor 1", short: "1", elevation: 0, height: 3, w: 60, h: 36 }],
    corridors: [],
    rooms: [],
    nodes: [],
    edges: [],
    markers: [],
    walls: [],
    pois: [],
    objects: [],
  };
}
