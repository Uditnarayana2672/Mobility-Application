/**
 * Venue coordinate frame (same as mock-ui): x east, y south (screen-down), metres.
 * Bearing 0 = north (up, -y), clockwise, degrees in [0, 360).
 */
export interface Vec2 {
  x: number;
  y: number;
}

export const DEG = Math.PI / 180;

export function normaliseBearing(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

/** Smallest signed difference a - b in (-180, 180]. */
export function bearingDelta(a: number, b: number): number {
  const d = normaliseBearing(a - b);
  return d > 180 ? d - 360 : d;
}

/** Unit vector for a bearing. North = (0, -1), east = (1, 0). */
export function bearingToVector(deg: number): Vec2 {
  const r = deg * DEG;
  return { x: Math.sin(r), y: -Math.cos(r) };
}

export function vectorToBearing(v: Vec2): number {
  return normaliseBearing(Math.atan2(v.x, -v.y) / DEG);
}

/** Move `dist` metres from p along `bearing`. */
export function advance(p: Vec2, bearing: number, dist: number): Vec2 {
  const v = bearingToVector(bearing);
  return { x: p.x + v.x * dist, y: p.y + v.y * dist };
}
