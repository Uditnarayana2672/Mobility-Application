import type { Door, Room } from "./schema";

/** All doors of a room, the main one first. */
export const roomDoors = (r: Pick<Room, "door" | "extraDoors">): Door[] => [r.door, ...(r.extraDoors ?? [])];

/** Walk-graph node id of door number `i` (0 = main door, the id every older venue already uses). */
export const doorNodeId = (roomId: string, i: number): string => (i === 0 ? `${roomId}:door` : `${roomId}:door${i + 1}`);

const SIDE_BEARING = { N: 0, E: 90, S: 180, W: 270 } as const;

/** Bearing pointing out of the room through this door (from `normal`, else from the wall `side`, else south). */
export function doorOutward(d: Door): number {
  if (d.normal !== undefined) return d.normal;
  return d.side ? SIDE_BEARING[d.side] : 180;
}

/** The door of `r` nearest to a point. */
export function nearestDoor(r: Pick<Room, "door" | "extraDoors">, p: { x: number; y: number }): { door: Door; index: number; dist: number } {
  let best = { door: r.door, index: 0, dist: Math.hypot(r.door.x - p.x, r.door.y - p.y) };
  roomDoors(r).forEach((d, i) => {
    const dist = Math.hypot(d.x - p.x, d.y - p.y);
    if (dist < best.dist) best = { door: d, index: i, dist };
  });
  return best;
}
