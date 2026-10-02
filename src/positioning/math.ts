/** Tiny 3-vector / 3x3 helpers (row-major arrays) for the positioning maths. No dependencies, so it is trivially testable. */
export type V3 = [number, number, number];
export type M3 = [number, number, number, number, number, number, number, number, number];

export const DEG = Math.PI / 180;

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);

/** m * v. */
export function mulV(m: ArrayLike<number>, v: V3): V3 {
  return [m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2], m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2], m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2]];
}
/** a * b. */
export function mulM(a: ArrayLike<number>, b: ArrayLike<number>): M3 {
  const o = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c]! += a[r * 3 + k]! * b[k * 3 + c]!;
  return o as M3;
}
export function transpose(m: ArrayLike<number>): M3 {
  return [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!];
}
/** Column `i` of a row-major 3x3. */
export const col = (m: ArrayLike<number>, i: number): V3 => [m[i]!, m[3 + i]!, m[6 + i]!];
/** Matrix from three column vectors. */
export const fromCols = (a: V3, b: V3, c: V3): M3 => [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]];

/** Rotation by `theta` radians counter-clockwise (seen from +z / up) about the z axis. */
export function rotZ(theta: number): M3 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** Marker x/y/z (OpenCV style: x right, y down, z away from the viewer) in the venue's right-handed world (E, N, up). */
export function markerAxesInWorld(normalBearingDeg: number): M3 {
  const b = normalBearingDeg * DEG;
  // The sticker faces `normal` (towards the viewer); the marker z axis points the other way, into the wall.
  const f: V3 = [-Math.sin(b), -Math.cos(b), 0];
  const y: V3 = [0, 0, -1];
  const x: V3 = [f[1], -f[0], 0]; // y x z
  return fromCols(x, y, f);
}

/** Compass bearing (deg, 0 = north, clockwise, [0,360)) of a world (E, N) direction. */
export function bearingOfEN(e: number, n: number): number {
  const b = (Math.atan2(e, n) / DEG + 360) % 360;
  return b >= 360 ? 0 : b;
}
