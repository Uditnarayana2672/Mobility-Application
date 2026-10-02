/** Geometry helpers. Frame: x east, y south, bearing 0 = north, clockwise. */
export const WALK = 1.3; // m/s
/** Default corridor width (m) for walk edges without an explicit `width`. */
export const CORRIDOR_W = 2.4;

export interface Pt {
  x: number;
  y: number;
}

export const rad = (d: number): number => (d * Math.PI) / 180;
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
export const bearingOf = (a: Pt, b: Pt): number => ((Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI + 360) % 360;
/** Signed turn in (-180, 180]. */
export const delta = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

/** Distance from p to segment a-b. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
