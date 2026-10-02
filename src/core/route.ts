import { doorNodeId, roomDoors } from "./doors";
import { WALK, bearingOf, delta, dist } from "./geo";
import { attachPoint, buildGraph, type GNode, type Graph } from "./graph";
import { MinHeap } from "./heap";
import type { Venue } from "./schema";

export interface RoutePrefs {
  avoidStairs: boolean;
  avoidLifts: boolean;
}

export type RouteFrom = { floor: string; x: number; y: number; heading?: number | null; node?: undefined } | { node: string; heading?: number | null; floor?: undefined; x?: undefined; y?: undefined };
export type RouteDest = { room: string; poi?: undefined } | { poi: string; room?: undefined };

export interface RouteHop {
  from: string;
  to: string;
  type: "walk" | "stairs" | "lift";
  len: number;
  sec: number;
  up: boolean | undefined;
}

export interface RoutePoint {
  node: string;
  floor: string;
  x: number;
  y: number;
}

export interface TurnStep {
  kind: "turn";
  dir: "left" | "right";
  angle: number;
  sAt: number;
  dist: number;
  into: string | null;
  landmark: string | null | undefined;
  afterV: boolean;
  via: "stairs" | "lift" | null;
  initial: boolean;
  at: { floor: string; x: number; y: number };
  heading: number;
}
export interface VerticalStep {
  kind: "vertical";
  via: "stairs" | "lift";
  up: boolean;
  toFloor: string;
  toFloorName: string | undefined;
  sAt: number;
  dist: number;
  at: { floor: string; x: number; y: number };
}
export interface ArriveStep {
  kind: "arrive";
  name: string;
  sAt: number;
  dist: number;
  at: { floor: string; x: number; y: number };
}
export type Step = TurnStep | VerticalStep | ArriveStep;

export interface Route {
  hops: RouteHop[];
  points: RoutePoint[];
  cum: number[];
  total: number;
  steps: Step[];
  time: number;
  walkDist: number;
  via: "stairs" | "lift" | null;
  destName: string;
  destRoom: string | null;
  destFloor: string;
  floors: string[];
  startFloor: string;
}

export interface RouteError {
  error: "unknown" | "restricted" | "unreachable";
  name?: string;
}

export const isRouteError = (r: Route | RouteError): r is RouteError => "error" in r;

/** A room-centre node may be walked through only if it is a lift/stairs room or marked as a passage; otherwise it is a dead end (a second door is not a shortcut). */
function blocksThrough(v: Venue, nodeId: string, G: Graph): boolean {
  const n = G.nodes[nodeId];
  if (!n || n.kind !== "room" || !n.room) return false;
  const r = v.rooms.find((x) => x.id === n.room);
  return !!r && !r.kind && !r.passThrough;
}

function isRestricted(v: Venue, nodeId: string, G: Graph): boolean {
  const n = G.nodes[nodeId];
  if (!n || !n.room) return false;
  const r = v.rooms.find((x) => x.id === n.room);
  return !!r && r.access === "staff";
}

/**
 * Time-cost routing with A* on a binary heap. Same costs and preferences as the mock's Dijkstra.
 * Heuristic: straight-line walking time when the node is on the goal's floor, else 0. This is admissible
 * (vertical hops may shift x,y for free) but not consistent, so stale heap entries are skipped and nodes may be re-opened.
 * Ties on f are broken by insertion order.
 */
export function route(v: Venue, from: RouteFrom, dest: RouteDest, prefsIn?: Partial<RoutePrefs>): Route | RouteError {
  const prefs: RoutePrefs = { avoidStairs: false, avoidLifts: false, ...prefsIn };
  const G = buildGraph(v);
  const startId = from.node !== undefined ? from.node : attachPoint(G, from.floor, from.x, from.y, "start");
  let goalId: string | null;
  let destName: string;
  let destRoom: Venue["rooms"][number] | null = null;
  let destFloor: string;
  if (dest.room !== undefined) {
    destRoom = v.rooms.find((r) => r.id === dest.room) ?? null;
    if (!destRoom) return { error: "unknown" };
    if (destRoom.access === "staff") return { error: "restricted", name: destRoom.name };
    goalId = destRoom.id;
    destName = destRoom.name;
    destFloor = destRoom.floor;
  } else {
    const p = v.pois.find((x) => x.id === dest.poi);
    if (!p) return { error: "unknown" };
    goalId = attachPoint(G, p.floor, p.x, p.y, "dest");
    destName = p.name;
    destFloor = p.floor;
  }
  if (!startId || !goalId || !G.nodes[startId] || !G.nodes[goalId]) return { error: "unreachable" };

  const goal = G.nodes[goalId] as GNode;
  const h = (id: string): number => {
    const n = G.nodes[id] as GNode;
    return n.floor === goal.floor ? dist(n, goal) / WALK : 0;
  };

  const D: Record<string, number> = { [startId]: 0 };
  const prev: Record<string, { from: string; hop: (typeof G.adj)[string][number] }> = {};
  const open = new MinHeap<{ id: string; g: number }>();
  open.push(h(startId), { id: startId, g: 0 });
  while (open.size) {
    const top = open.pop()!;
    const u = top.value.id;
    if (top.value.g > (D[u] as number)) continue; // stale entry
    if (u === goalId) break;
    for (const hop of G.adj[u] as NonNullable<(typeof G.adj)[string]>) {
      if (hop.type === "stairs" && prefs.avoidStairs) continue;
      if (hop.type === "lift" && prefs.avoidLifts) continue;
      if (hop.to !== goalId && isRestricted(v, hop.to, G)) continue;
      if (hop.to !== goalId && hop.to !== startId && blocksThrough(v, hop.to, G)) continue;
      const nd = (D[u] as number) + hop.sec;
      if (D[hop.to] === undefined || nd < (D[hop.to] as number)) {
        D[hop.to] = nd;
        prev[hop.to] = { from: u, hop };
        open.push(nd + h(hop.to), { id: hop.to, g: nd });
      }
    }
  }
  if (D[goalId] === undefined) return { error: "unreachable" };

  const hops: RouteHop[] = [];
  let cur = goalId;
  while (cur !== startId) {
    const p = prev[cur] as { from: string; hop: { type: "walk" | "stairs" | "lift"; len: number; sec: number; up?: boolean } };
    hops.unshift({ from: p.from, to: cur, type: p.hop.type, len: p.hop.len, sec: p.hop.sec, up: p.hop.up });
    cur = p.from;
  }
  return compile(v, G, startId, hops, from.heading, destName, destRoom, destFloor);
}

function compile(
  v: Venue,
  G: Graph,
  startId: string,
  hops: RouteHop[],
  startHeading: number | null | undefined,
  destName: string,
  destRoom: Venue["rooms"][number] | null,
  destFloor: string,
): Route {
  const sn = G.nodes[startId] as GNode;
  const pts: RoutePoint[] = [{ node: startId, floor: sn.floor, x: sn.x, y: sn.y }];
  const cum = [0];
  for (const h of hops) {
    const n = G.nodes[h.to] as GNode;
    pts.push({ node: h.to, floor: n.floor, x: n.x, y: n.y });
    cum.push((cum[cum.length - 1] as number) + h.len);
  }
  const steps: Step[] = [];
  let acc = 0;
  let prevB: number | null = startHeading == null ? null : startHeading;
  let afterV = false;
  let lastVia: "stairs" | "lift" | null = null;
  hops.forEach((h, i) => {
    const a = G.nodes[h.from] as GNode;
    const b = G.nodes[h.to] as GNode;
    if (h.type === "walk") {
      const bB = bearingOf(a, b);
      if (prevB != null) {
        const d = delta(bB - prevB);
        if (Math.abs(d) >= 30) {
          let into: string | null = null;
          let landmark: string | null | undefined = null;
          if (b.kind === "door") {
            const rm = v.rooms.find((r) => r.id === b.room);
            const name = rm?.name;
            into = name && name.length > 20 && rm?.short ? rm.short : name || null;
          } else if (!afterV && i > 0) {
            let bd = 7;
            const destDoors = new Set(destRoom ? roomDoors(destRoom).map((_, di) => doorNodeId(destRoom.id, di)) : []);
            for (const n of v.nodes) {
              if (n.kind === "door" && n.floor === a.floor && dist(n, a) < bd && !destDoors.has(n.id)) {
                bd = dist(n, a);
                landmark = (v.rooms.find((r) => r.id === n.room) || { name: undefined }).name;
              }
            }
          }
          steps.push({ kind: "turn", dir: d > 0 ? "right" : "left", angle: Math.abs(d), sAt: cum[i] as number, dist: acc, into, landmark, afterV, via: lastVia, initial: i === 0, at: { floor: a.floor, x: a.x, y: a.y }, heading: bB });
          acc = 0;
          afterV = false;
        }
      }
      prevB = bB;
      acc += h.len;
    } else {
      steps.push({ kind: "vertical", via: h.type, up: !!h.up, toFloor: b.floor, toFloorName: v.floors.find((f) => f.id === b.floor)?.name, sAt: cum[i] as number, dist: acc, at: { floor: a.floor, x: a.x, y: a.y } });
      acc = 0;
      prevB = null;
      afterV = true;
      lastVia = h.type;
    }
  });
  const last = pts[pts.length - 1] as RoutePoint;
  steps.push({ kind: "arrive", name: destName, sAt: cum[cum.length - 1] as number, dist: acc, at: { floor: last.floor, x: last.x, y: last.y } });
  const walkDist = hops.filter((h) => h.type === "walk").reduce((s, h) => s + h.len, 0);
  const viaHop = hops.find((h) => h.type !== "walk");
  return {
    hops,
    points: pts,
    cum,
    total: cum[cum.length - 1] as number,
    steps,
    time: hops.reduce((s, h) => s + h.sec, 0),
    walkDist,
    via: viaHop ? (viaHop.type as "stairs" | "lift") : null,
    destName,
    destRoom: destRoom ? destRoom.id : null,
    destFloor,
    floors: [...new Set(pts.map((p) => p.floor))],
    startFloor: (pts[0] as RoutePoint).floor,
  };
}

export function alternatives(v: Venue, from: RouteFrom, dest: RouteDest, prefs?: Partial<RoutePrefs>): { error?: RouteError["error"]; options: Route[] } {
  const out: Route[] = [];
  const base = route(v, from, dest, { ...prefs, avoidStairs: false, avoidLifts: false });
  if (isRouteError(base)) return { error: base.error, options: [] };
  out.push(base);
  if (base.via) {
    const other = base.via === "stairs" ? { avoidStairs: true } : { avoidLifts: true };
    const alt = route(v, from, dest, { ...prefs, ...other });
    if (!isRouteError(alt)) out.push(alt);
  }
  return { options: out };
}
