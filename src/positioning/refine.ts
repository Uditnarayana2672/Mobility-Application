import { mulM, type M3, type V3 } from "./math";
import { project, type Intrinsics, type MarkerPose } from "@/spikes/aruco/pose";

/** Rotation matrix for the rotation vector w (Rodrigues). */
function expRot(w: V3): M3 {
  const th = Math.hypot(w[0], w[1], w[2]);
  if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const k = [w[0] / th, w[1] / th, w[2] / th] as V3;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const v = 1 - c;
  return [
    c + k[0] * k[0] * v, k[0] * k[1] * v - k[2] * s, k[0] * k[2] * v + k[1] * s,
    k[1] * k[0] * v + k[2] * s, c + k[1] * k[1] * v, k[1] * k[2] * v - k[0] * s,
    k[2] * k[0] * v - k[1] * s, k[2] * k[1] * v + k[0] * s, c + k[2] * k[2] * v,
  ];
}

function residuals(pose: Pick<MarkerPose, "R" | "t">, corners: readonly { x: number; y: number }[], model: V3[], K: Intrinsics): number[] {
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    const p = project(pose, K, model[i]!);
    out.push(p.x - corners[i]!.x, p.y - corners[i]!.y);
  }
  return out;
}

/** Solve the 6x6 system A x = b in place (Gaussian elimination, partial pivoting). Returns null if singular. */
function solve6(A: number[][], b: number[]): number[] | null {
  const n = 6;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    if (Math.abs(A[piv]![c]!) < 1e-18) return null;
    [A[c], A[piv]] = [A[piv]!, A[c]!];
    [b[c], b[piv]] = [b[piv]!, b[c]!];
    for (let r = c + 1; r < n; r++) {
      const f = A[r]![c]! / A[c]![c]!;
      for (let k = c; k < n; k++) A[r]![k]! -= f * A[c]![k]!;
      b[r]! -= f * b[c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let k = r + 1; k < n; k++) s -= A[r]![k]! * x[k]!;
    x[r] = s / A[r]![r]!;
  }
  return x;
}

/**
 * Levenberg-Marquardt refinement of a marker pose by minimising the corner reprojection error (6 DOF, numeric Jacobian).
 * The homography decomposition is exact for 4 noise-free corners but unstable with a 1 px error on a small marker; this is the fix.
 * Starts from `init` and also from its depth-mirrored twin (planar pose ambiguity); keeps the lower-error result.
 */
export function refineMarkerPose(corners: readonly { x: number; y: number }[], sizeM: number, K: Intrinsics, init: MarkerPose, iterations = 25): MarkerPose {
  const h = sizeM / 2;
  const model: V3[] = [
    [-h, -h, 0],
    [h, -h, 0],
    [h, h, 0],
    [-h, h, 0],
  ];
  const cost = (r: number[]): number => r.reduce((s, v) => s + v * v, 0);

  const run = (R0: M3, t0: V3): { R: M3; t: V3; c: number } => {
    let R = R0;
    let t = t0;
    let r = residuals({ R, t }, corners, model, K);
    let c = cost(r);
    let lambda = 1e-3;
    for (let it = 0; it < iterations; it++) {
      const J: number[][] = [];
      const eps = 1e-6;
      for (let p = 0; p < 6; p++) {
        const dw: V3 = [0, 0, 0];
        const dt: V3 = [0, 0, 0];
        if (p < 3) dw[p] = eps;
        else dt[p - 3] = eps;
        const R2 = mulM(R, expRot(dw));
        const t2: V3 = [t[0] + dt[0], t[1] + dt[1], t[2] + dt[2]];
        const r2 = residuals({ R: R2, t: t2 }, corners, model, K);
        J.push(r2.map((v, i) => (v - r[i]!) / eps));
      }
      const A = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => J[i]!.reduce((s, v, k) => s + v * J[j]![k]!, 0)));
      const g = J.map((row) => -row.reduce((s, v, k) => s + v * r[k]!, 0));
      let improved = false;
      for (let tries = 0; tries < 8 && !improved; tries++) {
        const Ad = A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v)));
        const d = solve6(Ad, [...g]);
        if (!d) {
          lambda *= 10;
          continue;
        }
        const R2 = mulM(R, expRot([d[0]!, d[1]!, d[2]!]));
        const t2: V3 = [t[0] + d[3]!, t[1] + d[4]!, t[2] + d[5]!];
        if (t2[2] <= 0) {
          lambda *= 10;
          continue;
        }
        const r2 = residuals({ R: R2, t: t2 }, corners, model, K);
        const c2 = cost(r2);
        if (c2 < c) {
          R = R2;
          t = t2;
          r = r2;
          const done = c - c2 < 1e-10;
          c = c2;
          lambda = Math.max(lambda / 5, 1e-9);
          improved = true;
          if (done) return { R, t, c };
        } else lambda *= 8;
      }
      if (!improved) break;
    }
    return { R, t, c };
  };

  const a = run(init.R as M3, init.t);
  // Depth-mirrored twin: reflect the marker normal about the line of sight (flip ambiguity of a planar pose).
  const tn = Math.hypot(init.t[0], init.t[1], init.t[2]);
  const v: V3 = [init.t[0] / tn, init.t[1] / tn, init.t[2] / tn];
  const nrm: V3 = [init.R[2]!, init.R[5]!, init.R[8]!];
  const dotNV = nrm[0] * v[0] + nrm[1] * v[1] + nrm[2] * v[2];
  const nm: V3 = [2 * dotNV * v[0] - nrm[0], 2 * dotNV * v[1] - nrm[1], 2 * dotNV * v[2] - nrm[2]];
  // Rotation taking nrm to nm about nrm x nm.
  const ax: V3 = [nrm[1] * nm[2] - nrm[2] * nm[1], nrm[2] * nm[0] - nrm[0] * nm[2], nrm[0] * nm[1] - nrm[1] * nm[0]];
  const s = Math.hypot(ax[0], ax[1], ax[2]);
  let best = a;
  if (s > 1e-6) {
    const ang = Math.atan2(s, nrm[0] * nm[0] + nrm[1] * nm[1] + nrm[2] * nm[2]);
    const Rtw = expRot([(ax[0] / s) * ang, (ax[1] / s) * ang, (ax[2] / s) * ang]);
    const b = run(mulM(Rtw, init.R as M3), init.t);
    if (b.c < a.c * 0.999) best = b;
  }
  return { R: [...best.R], t: best.t, distance: Math.hypot(best.t[0], best.t[1], best.t[2]) };
}
