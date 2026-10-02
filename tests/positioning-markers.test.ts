import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseVenue, type Venue } from "@/core";
import { DEG, fromCols, markerAxesInWorld, mulM, mulV, rotZ, sub, transpose, type M3, type V3 } from "@/positioning/math";
import { alignmentFromMarker, cameraHeading, devicePoseFromMarker, markerInWorld, obliquityDeg, reprojectionError, xrDevicePose } from "@/positioning/markers";
import type { Detection } from "@/spikes/aruco/detect";
import { intrinsicsFromProjection, project, solveMarkerPose, type Intrinsics } from "@/spikes/aruco/pose";

const venue: Venue = (() => {
  const r = parseVenue(JSON.parse(fs.readFileSync("public/venues/office-hq/venue.json", "utf8")));
  if (!r.ok) throw new Error("fixture venue invalid");
  return r.data;
})();

const W = 640;
const H = 480;
const K: Intrinsics = { fx: 520, fy: 520, cx: W / 2, cy: H / 2 };

/** Camera world pose looking at `target` from `pos` (OpenCV axes: x right, y down, z forward), world = (E, N, up). */
function lookAt(pos: V3, target: V3): M3 {
  const f = sub(target, pos);
  const n = Math.hypot(f[0], f[1], f[2]);
  const z: V3 = [f[0] / n, f[1] / n, f[2] / n];
  // right = z x up_world (so the camera is not rolled), down = z x right
  let r: V3 = [z[1], -z[0], 0];
  const rn = Math.hypot(r[0], r[1]);
  r = [r[0] / rn, r[1] / rn, 0];
  const d: V3 = [z[1] * r[2] - z[2] * r[1], z[2] * r[0] - z[0] * r[2], z[0] * r[1] - z[1] * r[0]];
  return fromCols(r, d, z);
}

/** Synthetic detection of marker `id` seen from a known world camera. */
function synth(id: number, pos: V3, target: V3, noisePx = 0, seed = 1): { det: Detection; Rcw: M3 } {
  const m = venue.markers.find((x) => x.id === id)!;
  const mw = markerInWorld(venue, m);
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

describe("marker frame", () => {
  it("is right-handed and points into the wall", () => {
    const R = markerAxesInWorld(0); // sticker faces north, so z points south
    expect(R[2]).toBeCloseTo(0);
    expect(R[5]).toBeCloseTo(-1);
    expect(R[1]).toBeCloseTo(0);
    expect(R[7]).toBeCloseTo(-1); // marker y (image-down) is world-down
    expect(R[3]).toBeCloseTo(0);
    // viewer faces south, so their right (marker x) is west
    expect(R[0]).toBeCloseTo(-1);
  });
});

describe("devicePoseFromMarker (synthetic projections)", () => {
  // Marker 1: x=3,y=15, faces south (normal 180); the viewer stands south of it (larger y), looking north.
  const m1 = venue.markers.find((m) => m.id === 1)!;
  const markerW: V3 = [m1.x, -m1.y, m1.z];

  for (const [dist, lateral, label] of [
    [1, 0, "1 m face-on"],
    [2, 0.6, "2 m offset"],
    [2.4, -0.5, "2.4 m offset"],
  ] as const) {
    it(`recovers position and heading, ${label}`, () => {
      const pos: V3 = [m1.x + lateral, -(m1.y + dist), 1.3];
      const { det } = synth(1, pos, markerW);
      const r = devicePoseFromMarker(venue, det, K);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.fix.floor).toBe("F1");
      expect(Math.hypot(r.fix.x - pos[0], r.fix.y - -pos[1])).toBeLessThan(0.02);
      const expectHeading = (Math.atan2(markerW[0] - pos[0], markerW[1] - pos[1]) / DEG + 360) % 360;
      let dh = Math.abs(r.fix.heading - expectHeading);
      dh = Math.min(dh, 360 - dh);
      expect(dh).toBeLessThan(2);
      expect(r.fix.reprojPx).toBeLessThan(0.5);
    });
  }

  it("stays within 0.15 m at 1 m with 0.5 px corner noise", () => {
    let worst = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const pos: V3 = [m1.x + 0.2, -(m1.y + 1), 1.3];
      const { det } = synth(1, pos, markerW, 0.5, seed);
      const r = devicePoseFromMarker(venue, det, K, { maxReprojPx: 5, maxObliqueDeg: 80, minDistM: 0.2, maxDistM: 6 });
      expect(r.ok ? "ok" : JSON.stringify(r)).toBe("ok");
      if (r.ok) worst = Math.max(worst, Math.hypot(r.fix.x - pos[0], r.fix.y - -pos[1]));
    }
    expect(worst).toBeLessThan(0.15);
  });

  it("uses the marker floor elevation (F2 marker)", () => {
    const m5 = venue.markers.find((m) => m.floor === "F2")!;
    const mw = markerInWorld(venue, m5);
    expect(mw.p[2]).toBeCloseTo(4 + m5.z);
    const f = [Math.sin(m5.normal * DEG), Math.cos(m5.normal * DEG)]; // outward bearing vector in (E, N)
    const pos: V3 = [mw.p[0] + f[0]! * 1.5, mw.p[1] + f[1]! * 1.5, mw.p[2] - 0.1];
    const { det } = synth(m5.id, pos, mw.p);
    const r = devicePoseFromMarker(venue, det, K);
    expect(r.ok && r.fix.floor).toBe("F2");
    if (r.ok) expect(r.fix.camera.pos[2]).toBeCloseTo(pos[2], 1);
  });

  it("rejects an edge-on view", () => {
    const pos: V3 = [m1.x + 1.3, -(m1.y + 0.2), 1.4];
    const { det } = synth(1, pos, markerW);
    const r = devicePoseFromMarker(venue, det, K);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("oblique");
  });

  it("rejects too far, and an unknown id", () => {
    const far = synth(1, [m1.x, -(m1.y + 4), 1.4], markerW).det;
    const r = devicePoseFromMarker(venue, far, K);
    expect(!r.ok && r.reason).toBe("too-far");
    const u = devicePoseFromMarker(venue, { ...far, id: 49 }, K);
    expect(!u.ok && u.reason).toBe("unknown-marker");
  });

  it("rejects a quad that no rigid pose explains (high reprojection error)", () => {
    const { det } = synth(1, [m1.x, -(m1.y + 1.5), 1.4], markerW);
    const c = det.corners;
    const bad: Detection["corners"] = [c[0], c[1], { x: c[2].x + 25, y: c[2].y - 18 }, c[3]];
    const pose = solveMarkerPose(bad, 0.12, K);
    expect(reprojectionError(bad, pose, K, 0.12)).toBeGreaterThan(2.5);
    expect(devicePoseFromMarker(venue, { id: 1, corners: bad }, K).ok).toBe(false);
  });

  it("obliquity is ~0 face-on", () => {
    const { det } = synth(1, [m1.x, -(m1.y + 1.5), 1.4], markerW);
    expect(obliquityDeg(solveMarkerPose(det.corners, 0.12, K))).toBeLessThan(2);
  });

  it("heading falls back to the phone top when pointing at the floor", () => {
    const R = fromCols([1, 0, 0], [0, 1, 0], [0, 0, -1]); // forward = straight down, top (-y) = south
    expect(cameraHeading(R)).toBeCloseTo(180, 5);
  });
});

describe("XR alignment", () => {
  const Sinv = (p: V3): V3 => [p[0], p[2], -p[1]];
  const CV_TO_XR: M3 = [1, 0, 0, 0, -1, 0, 0, 0, -1];

  /** Column-major view->local matrix for a world camera, given the true (to the code unknown) alignment. */
  function viewMatrix(Rcw: M3, pos: V3, theta0: number, tau0: V3): number[] {
    const inv = (v: V3): V3 => Sinv(mulV(rotZ(-theta0), v));
    const c0 = inv([Rcw[0], Rcw[3], Rcw[6]]);
    const c1 = inv([Rcw[1], Rcw[4], Rcw[7]]);
    const c2 = inv([Rcw[2], Rcw[5], Rcw[8]]);
    const R = mulM(fromCols(c0, c1, c2), CV_TO_XR);
    const t = inv(sub(pos, tau0));
    return [R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, t[0], t[1], t[2], 1];
  }

  it("recovers yaw + translation from one sighting, then maps later XR poses", () => {
    const m1 = venue.markers.find((m) => m.id === 1)!;
    const markerW: V3 = [m1.x, -m1.y, m1.z];
    const theta0 = 2.1;
    const tau0: V3 = [-7.5, 3.2, 0.4];
    const pos: V3 = [m1.x + 0.4, -(m1.y + 1.8), 1.35];
    const { det, Rcw } = synth(1, pos, markerW);
    const pose = solveMarkerPose(det.corners, 0.12, K);
    const al = alignmentFromMarker(venue, m1, viewMatrix(Rcw, pos, theta0, tau0), pose);
    expect(al.floor).toBe("F1");
    expect(Math.abs(Math.atan2(Math.sin(al.theta - theta0), Math.cos(al.theta - theta0)))).toBeLessThan(0.01);
    expect(Math.hypot(al.tau[0] - tau0[0], al.tau[1] - tau0[1], al.tau[2] - tau0[2])).toBeLessThan(0.03);
    // The phone has walked on: another camera pose, no marker in view.
    const pos2: V3 = [m1.x + 6, -(m1.y + 3), 1.3];
    const Rcw2 = lookAt(pos2, [m1.x + 12, -(m1.y + 3), 1.3]);
    const dev = xrDevicePose(al, viewMatrix(Rcw2, pos2, theta0, tau0));
    expect(dev.x).toBeCloseTo(pos2[0], 1);
    expect(dev.y).toBeCloseTo(-pos2[1], 1);
    expect(dev.up).toBeCloseTo(pos2[2], 1);
    expect(dev.heading).toBeCloseTo(90, 0); // looking east
  });

  it("intrinsicsFromProjection of a symmetric projection has the principal point in the middle", () => {
    const P = new Array<number>(16).fill(0);
    P[0] = 1.4;
    P[5] = 1.4 * (W / H);
    const k = intrinsicsFromProjection(P, W, H);
    expect(k.cx).toBeCloseTo(W / 2);
    expect(k.cy).toBeCloseTo(H / 2);
  });
});
