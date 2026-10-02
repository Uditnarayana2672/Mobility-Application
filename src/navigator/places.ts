import { nearestDoor } from "@/core/doors";
import { catOf, poiKindOf } from "@/core/cats";
import type { Target } from "@/core/intent";
import type { Room, Venue } from "@/core/schema";
import type { Pose } from "./poseSource";

export interface Place {
  kind: "room" | "poi";
  id: string;
  name: string;
  icon: string;
  floor: string;
  x: number;
  y: number;
  sub: string;
  hours: string;
  staffOnly: boolean;
  capacity: number | undefined;
  target: Target;
}

export const floorName = (v: Venue, id: string): string => v.floors.find((f) => f.id === id)?.name ?? id;

/** Port of the mock's placeOf(): everything the place card needs, from a room or POI target. */
export function placeOf(v: Venue, t: Target): Place | null {
  if ("room" in t) {
    const r = v.rooms.find((x) => x.id === t.room);
    if (!r) return null;
    const cat = catOf(r.cat);
    return {
      kind: "room",
      id: r.id,
      name: r.name,
      icon: r.icon || cat?.icon || "📍",
      floor: r.floor,
      x: r.x + r.w / 2,
      y: r.y + r.h / 2,
      sub: `${cat?.label ?? "Room"} · ${floorName(v, r.floor)}`,
      hours: r.hours,
      staffOnly: r.access === "staff",
      capacity: r.capacity,
      target: t,
    };
  }
  const p = v.pois.find((x) => x.id === t.poi);
  if (!p) return null;
  const k = poiKindOf(p.kind);
  return { kind: "poi", id: p.id, name: p.name, icon: k?.icon ?? "📍", floor: p.floor, x: p.x, y: p.y, sub: `${k?.label ?? "Point of interest"} · ${floorName(v, p.floor)}`, hours: "", staffOnly: false, capacity: undefined, target: t };
}

/** "Near Meeting Room Everest": the room you stand in, else the closest door within 9 m, else "the corridor". */
export function nearName(v: Venue, u: Pick<Pose, "floor" | "x" | "y">): string {
  const inside = v.rooms.find((r) => r.floor === u.floor && u.x > r.x && u.x < r.x + r.w && u.y > r.y && u.y < r.y + r.h);
  if (inside) return inside.name;
  let best: { d: number; n: string } | null = null;
  for (const r of v.rooms as Room[]) {
    if (r.floor !== u.floor) continue;
    const d = nearestDoor(r, u).dist;
    if (!best || d < best.d) best = { d, n: r.short || r.name };
  }
  return best && best.d < 9 ? best.n : "the corridor";
}

export type Confidence = { cls: "good" | "mid" | "bad"; txt: string };

export function confOf(u: Pick<Pose, "acc" | "stale"> | null): Confidence {
  if (!u) return { cls: "bad", txt: "—" };
  if (u.stale) return { cls: "bad", txt: "Tracking lost" };
  if (u.acc <= 0.9) return { cls: "good", txt: `±${u.acc.toFixed(1)} m` };
  if (u.acc <= 2.1) return { cls: "mid", txt: `±${u.acc.toFixed(1)} m` };
  return { cls: "bad", txt: `±${u.acc.toFixed(1)} m · scan marker` };
}
