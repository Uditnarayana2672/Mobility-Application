import { rad } from "./geo";
import type { Marker, Venue } from "./schema";

export function nearestMarker(v: Venue, floor: string, x: number, y: number, maxD: number): { marker: Marker; d: number } | null {
  let best: { marker: Marker; d: number } | null = null;
  for (const m of v.markers) {
    if (m.floor !== floor) continue;
    const d = Math.hypot(m.x - x, m.y - y);
    if (d <= maxD && (!best || d < best.d)) best = { marker: m, d };
  }
  return best;
}

/** Pose of a person who just scanned a marker: 1.5 m in front of it, looking at it. */
export function poseFromMarker(m: Pick<Marker, "floor" | "x" | "y" | "normal">): { floor: string; x: number; y: number; heading: number } {
  const nx = Math.sin(rad(m.normal));
  const ny = -Math.cos(rad(m.normal));
  return { floor: m.floor, x: m.x + nx * 1.5, y: m.y + ny * 1.5, heading: (m.normal + 180) % 360 };
}
