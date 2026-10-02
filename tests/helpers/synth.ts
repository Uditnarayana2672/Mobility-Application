import fs from "node:fs";
import { parseVenue, type Venue } from "@/core";
import { fromCols, mulM, mulV, rotZ, sub, transpose, type M3, type V3 } from "@/positioning/math";
import { markerInWorld } from "@/positioning/markers";
import type { Detection } from "@/spikes/aruco/detect";
import { project, type Intrinsics } from "@/spikes/aruco/pose";

export function loadVenue(): Venue {
  const r = parseVenue(JSON.parse(fs.readFileSync("public/venues/office-hq/venue.json", "utf8")));
  if (!r.ok) throw new Error("fixture venue invalid");
  return r.data;
}

export const K: Intrinsics = { fx: 520, fy: 520, cx: 320, cy: 240 };

/** Camera world pose looking at `target` from `pos` (OpenCV axes: x right, y down, z forward), world = (E, N, up). */
export function lookAt(pos: V3, target: V3): M3 {
  const f = sub(target, pos);
  const n = Math.hypot(f[0], f[1], f[2]);
  const z: V3 = [f[0] / n, f[1] / n, f[2] / n];
  let r: V3 = [z[1], -z[0], 0];
  const rn = Math.hypot(r[0], r[1]);
  r = [r[0] / rn, r[1] / rn, 0];
  const d: V3 = [z[1] * r[2] - z[2] * r[1], z[2] * r[0] - z[0] * r[2], z[0] * r[1] - z[1] * r[0]];
  return fromCols(r, d, z);
}

/** Synthetic detection of marker `id` as seen from a known world camera. */
export function synthDetection(v: Venue, id: number, pos: V3, target: V3, noisePx = 0, seed = 1): { det: Detection; Rcw: M3 } {
  const m = v.markers.find((x) => x.id === id)!;
  const mw = markerInWorld(v, m);
  const Rcw = lookAt(pos, target);
  const Rm2c = mulM(transpose(Rcw), mw.R);
  const t = mulV(transpose(Rcw), sub(mw.p, pos));
  const h = m.sizeM / 2;
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * 2;
  const pts: V3[] = [
    [-h, -h, 0],
    [h, -h, 0],
    [h, h, 0],
    [-h, h, 0],
  ];
  const corners = pts.map((p) => {
    const q = project({ R: Rm2c, t }, K, p);
    return { x: q.x + rnd() * noisePx, y: q.y + rnd() * noisePx };
  }) as Detection["corners"];
  return { det: { id, corners }, Rcw };
}

const Sinv = (p: V3): V3 => [p[0], p[2], -p[1]];
const CV_TO_XR: M3 = [1, 0, 0, 0, -1, 0, 0, 0, -1];

/** What WebXR would report (column-major camera-to-local) for a world camera, given the true XR<->venue alignment the code must discover. */
export function xrView(Rcw: M3, pos: V3, theta0: number, tau0: V3): number[] {
  const inv = (v: V3): V3 => Sinv(mulV(rotZ(-theta0), v));
  const c0 = inv([Rcw[0], Rcw[3], Rcw[6]]);
  const c1 = inv([Rcw[1], Rcw[4], Rcw[7]]);
  const c2 = inv([Rcw[2], Rcw[5], Rcw[8]]);
  const R = mulM(fromCols(c0, c1, c2), CV_TO_XR);
  const t = inv(sub(pos, tau0));
  return [R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, t[0], t[1], t[2], 1];
}
