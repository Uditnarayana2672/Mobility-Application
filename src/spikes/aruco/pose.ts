import { homography, type Pt } from "./detect";

export interface Intrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

/**
 * Intrinsics (pixels) from a WebXR/WebGL column-major projection matrix for an
 * image of width x height. Image origin top-left, y down.
 * x_ndc = P0 * X/Z + P8, y_ndc = P5 * Y/Z + P9 (Z forward-positive, Y up).
 */
export function intrinsicsFromProjection(P: ArrayLike<number>, width: number, height: number): Intrinsics {
  return {
    fx: (P[0]! * width) / 2,
    fy: (P[5]! * height) / 2,
    cx: ((1 + P[8]!) * width) / 2,
    cy: ((1 - P[9]!) * height) / 2,
  };
}

/** Rigid transform marker -> camera, OpenCV camera convention (x right, y down, z forward). */
export interface MarkerPose {
  /** Row-major 3x3 rotation. */
  R: number[];
  t: [number, number, number];
  /** Euclidean distance camera -> marker centre (m). */
  distance: number;
}

function cross(a: number[], b: number[]): number[] {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}
function norm(a: number[]): number {
  return Math.hypot(a[0]!, a[1]!, a[2]!);
}
function scale(a: number[], s: number): number[] {
  return a.map((v) => v * s);
}

/**
 * Planar pose from the 4 corners (marker order TL, TR, BR, BL) of a square of
 * side `size` metres, via homography decomposition. The marker frame has its
 * origin at the centre, x along TL->TR, y along TL->BL (image-down when upright),
 * z = x cross y (pointing away from the viewer).
 */
export function solveMarkerPose(corners: readonly Pt[], size: number, K: Intrinsics): MarkerPose {
  const h = size / 2;
  const model: Pt[] = [
    { x: -h, y: -h },
    { x: h, y: -h },
    { x: h, y: h },
    { x: -h, y: h },
  ];
  const H = homography(model, corners);
  // M = K^-1 * H, columns m1 m2 m3.
  const kinv = (u: number, v: number, w: number): number[] => [(u - K.cx * w) / K.fx, (v - K.cy * w) / K.fy, w];
  const m1 = kinv(H[0]!, H[3]!, H[6]!);
  const m2 = kinv(H[1]!, H[4]!, H[7]!);
  const m3 = kinv(H[2]!, H[5]!, H[8]!);
  const lambda = 2 / (norm(m1) + norm(m2));
  let r1 = scale(m1, lambda);
  let r2 = scale(m2, lambda);
  let t = scale(m3, lambda);
  if (t[2]! < 0) {
    // Marker must be in front of the camera.
    r1 = scale(r1, -1);
    r2 = scale(r2, -1);
    t = scale(t, -1);
  }
  // Orthonormalise: r1' = r1/|r1|, r3 = r1' x r2, r2' = r3 x r1'.
  const a = scale(r1, 1 / norm(r1));
  const r3 = cross(a, r2);
  const c = scale(r3, 1 / norm(r3));
  const b = cross(c, a);
  const R = [a[0]!, b[0]!, c[0]!, a[1]!, b[1]!, c[1]!, a[2]!, b[2]!, c[2]!];
  return { R, t: [t[0]!, t[1]!, t[2]!], distance: norm(t) };
}

/** Project a marker-frame point with a pose + intrinsics (for tests / reprojection error). */
export function project(pose: Pick<MarkerPose, "R" | "t">, K: Intrinsics, p: [number, number, number]): Pt {
  const { R, t } = pose;
  const X = R[0]! * p[0] + R[1]! * p[1] + R[2]! * p[2] + t[0];
  const Y = R[3]! * p[0] + R[4]! * p[1] + R[5]! * p[2] + t[1];
  const Z = R[6]! * p[0] + R[7]! * p[1] + R[8]! * p[2] + t[2];
  return { x: (K.fx * X) / Z + K.cx, y: (K.fy * Y) / Z + K.cy };
}

/** Mean edge length (px) of a quad given as 4 corners in order. */
export function meanSidePx(corners: readonly Pt[]): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    sum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return sum / 4;
}

/**
 * Horizontal FOV (degrees) from a face-on square of known size at a known distance:
 * side_px = fx * size / distance  ->  fx = side_px * distance / size,  hfov = 2 atan(W / 2fx).
 */
export function hfovFromSquare(sidePx: number, imageWidthPx: number, sizeM: number, distanceM: number): number {
  const fx = (sidePx * distanceM) / sizeM;
  return (2 * Math.atan(imageWidthPx / 2 / fx) * 180) / Math.PI;
}
