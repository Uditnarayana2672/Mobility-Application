import { roomAt } from "@/core/graph";
import type { Room, Venue } from "@/core/schema";
import type { LastFix } from "@/shared/lastFix";

/**
 * "Where do you think you are?" when the camera has not found a marker yet: the few most likely places, so the visitor answers with
 * ONE tap instead of searching a list. Ordered by how good the evidence is:
 *   1. resume: where this phone was last time in this venue (if recent)
 *   2. entrance: the room next to the marker at the door the GPS says the visitor came in through
 *   3. reception / the main entrance
 *   4. the rest, nearest to the first guess
 */
export type SuggestReason = "resume" | "entrance" | "reception" | "nearby";

export interface Suggestion {
  roomId: string;
  name: string;
  floor: string;
  reason: SuggestReason;
}

export interface SuggestContext {
  last?: LastFix | null;
  /** Marker id at the entrance the GPS matched, if any. */
  entranceMarker?: number | null;
}

const visible = (r: Room) => r.access !== "staff" && r.cat !== "restricted" && r.cat !== "vertical";

function nearestRoom(v: Venue, floor: string, x: number, y: number): Room | undefined {
  const inside = roomAt(v, floor, x, y);
  if (inside && visible(inside)) return inside;
  let best: { r: Room; d: number } | undefined;
  for (const r of v.rooms) {
    if (r.floor !== floor || !visible(r)) continue;
    const d = Math.hypot(r.door.x - x, r.door.y - y);
    if (!best || d < best.d) best = { r, d };
  }
  return best?.r;
}

export function suggestPlaces(v: Venue, ctx: SuggestContext = {}, limit = 3): Suggestion[] {
  const out: Suggestion[] = [];
  const add = (r: Room | undefined, reason: SuggestReason) => {
    if (r && visible(r) && !out.some((o) => o.roomId === r.id) && out.length < limit) out.push({ roomId: r.id, name: r.name, floor: r.floor, reason });
  };
  const last = ctx.last;
  if (last && v.floors.some((f) => f.id === last.floor)) add(nearestRoom(v, last.floor, last.x, last.y), "resume");
  const m = ctx.entranceMarker !== null && ctx.entranceMarker !== undefined ? v.markers.find((x) => x.id === ctx.entranceMarker) : undefined;
  if (m) add(nearestRoom(v, m.floor, m.x, m.y), "entrance");
  for (const r of v.rooms.filter((x) => x.cat === "reception")) add(r, "reception");
  const entrance = v.pois.find((p) => p.kind === "entrance");
  if (entrance) add(nearestRoom(v, entrance.floor, entrance.x, entrance.y), "reception");
  const anchor = out[0] ? v.rooms.find((r) => r.id === out[0]!.roomId) : undefined;
  const rest = v.rooms
    .filter((r) => visible(r) && (!anchor || r.floor === anchor.floor))
    .sort((a, b) => (anchor ? Math.hypot(a.door.x - anchor.door.x, a.door.y - anchor.door.y) - Math.hypot(b.door.x - anchor.door.x, b.door.y - anchor.door.y) : 0));
  for (const r of rest) add(r, "nearby");
  return out;
}
