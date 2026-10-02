import { doorNodeId, roomDoors } from "./doors";
import { pointInRoom } from "./geom";
import { WALK, dist } from "./geo";
import type { Venue } from "./schema";

export interface GNode {
  id: string;
  floor: string;
  x: number;
  y: number;
  kind: "corridor" | "door" | "room" | "tmp";
  room?: string;
}

export interface Hop {
  to: string;
  type: "walk" | "stairs" | "lift";
  len: number;
  sec: number;
  up?: boolean;
}

export interface Graph {
  nodes: Record<string, GNode>;
  adj: Record<string, Hop[]>;
  v: Venue;
  tmp: number;
}

function floorIdx(v: Venue, id: string): number {
  return v.floors.findIndex((f) => f.id === id);
}

export function buildGraph(v: Venue): Graph {
  const nodes: Record<string, GNode> = {};
  const adj: Record<string, Hop[]> = {};
  for (const n of v.nodes) {
    nodes[n.id] = { ...n };
    adj[n.id] = [];
  }
  for (const e of v.edges) {
    const a = nodes[e.a];
    const b = nodes[e.b];
    if (!a || !b) continue;
    if (e.type === "walk") {
      const d = dist(a, b);
      adj[a.id]!.push({ to: b.id, type: "walk", len: d, sec: d / WALK });
      adj[b.id]!.push({ to: a.id, type: "walk", len: d, sec: d / WALK });
    } else {
      const abUp = floorIdx(v, a.floor) < floorIdx(v, b.floor);
      const len = e.len || 6;
      const up = e.upSec as number;
      const down = e.downSec as number;
      adj[a.id]!.push({ to: b.id, type: e.type, len, sec: abUp ? up : down, up: abUp });
      adj[b.id]!.push({ to: a.id, type: e.type, len, sec: abUp ? down : up, up: !abUp });
    }
  }
  return { nodes, adj, v, tmp: 0 };
}

export function roomAt(v: Venue, floor: string, x: number, y: number) {
  return v.rooms.find((r) => r.floor === floor && pointInRoom(r, x, y));
}

function link(G: Graph, a: string, b: string): void {
  const d = dist(G.nodes[a]!, G.nodes[b]!);
  G.adj[a]!.push({ to: b, type: "walk", len: d, sec: d / WALK });
  G.adj[b]!.push({ to: a, type: "walk", len: d, sec: d / WALK });
}

/**
 * Attach an arbitrary point to the walk network: inside a room -> its door node;
 * otherwise snap to the nearest corridor edge (splitting it) and, if farther than 1 m, link a temp node.
 * Returns the id of the node to route from/to, or null when nothing is reachable.
 */
export function attachPoint(G: Graph, floor: string, x: number, y: number, tag: string): string | null {
  const v = G.v;
  const id = `tmp:${tag}:${G.tmp++}`;
  const node: GNode = { id, floor, x, y, kind: "tmp" };
  const room = roomAt(v, floor, x, y);
  if (room) {
    // nearest of the room's door nodes
    let door: GNode | undefined;
    roomDoors(room).forEach((d, i) => {
      const cand = G.nodes[doorNodeId(room.id, i)];
      if (cand && (!door || Math.hypot(d.x - x, d.y - y) < dist(door, node))) door = cand;
    });
    if (!door) return null;
    G.nodes[id] = node;
    G.adj[id] = [];
    const d = dist(node, door);
    G.adj[id]!.push({ to: door.id, type: "walk", len: d, sec: d / WALK });
    G.adj[door.id]!.push({ to: id, type: "walk", len: d, sec: d / WALK });
    return id;
  }
  let best: { d: number; aId: string; bId: string; t: number; px: number; py: number } | null = null;
  for (const aId of Object.keys(G.adj)) {
    const a = G.nodes[aId]!;
    if (a.floor !== floor || a.kind !== "corridor") continue;
    for (const h of G.adj[aId]!) {
      const b = G.nodes[h.to]!;
      if (h.type !== "walk" || b.kind !== "corridor" || b.floor !== floor || aId > h.to) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L2));
      const px = a.x + t * dx;
      const py = a.y + t * dy;
      const d = Math.hypot(x - px, y - py);
      if (!best || d < best.d) best = { d, aId, bId: h.to, t, px, py };
    }
  }
  if (!best) return null;
  let snapId: string;
  if (best.t < 0.001) snapId = best.aId;
  else if (best.t > 0.999) snapId = best.bId;
  else {
    snapId = `${id}s`;
    G.nodes[snapId] = { id: snapId, floor, x: best.px, y: best.py, kind: "corridor" };
    G.adj[snapId] = [];
    G.adj[best.aId] = G.adj[best.aId]!.filter((h) => h.to !== best!.bId);
    G.adj[best.bId] = G.adj[best.bId]!.filter((h) => h.to !== best!.aId);
    link(G, snapId, best.aId);
    link(G, snapId, best.bId);
  }
  if (best.d <= 1.0) return snapId; // close enough: treat as standing on the corridor line
  G.nodes[id] = node;
  G.adj[id] = [];
  link(G, id, snapId);
  return id;
}
