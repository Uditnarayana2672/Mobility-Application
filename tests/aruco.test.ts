import { describe, expect, it } from "vitest";
import { DICTIONARY, DICT_SIZE, GRID, MIN_DIST, markerBits, rotate90 } from "@/spikes/aruco/dict";
import { applyH, detectMarkers, homography, type GrayImage, type Pt } from "@/spikes/aruco/detect";
import { intrinsicsFromProjection, project, solveMarkerPose } from "@/spikes/aruco/pose";

const pc = (x: number) => x.toString(2).split("1").length - 1;

describe("dictionary", () => {
  it("has 50 codes with min Hamming distance across rotations", () => {
    expect(DICTIONARY.length).toBe(DICT_SIZE);
    for (let i = 0; i < DICTIONARY.length; i++) {
      for (let j = 0; j < DICTIONARY.length; j++) {
        let c = DICTIONARY[j]!;
        for (let r = 0; r < 4; r++) {
          if (!(i === j && r === 0)) expect(pc(DICTIONARY[i]! ^ c)).toBeGreaterThanOrEqual(MIN_DIST);
          c = rotate90(c);
        }
      }
    }
  });
  it("rotate90 x4 is identity", () => {
    const c = DICTIONARY[7]!;
    expect(rotate90(rotate90(rotate90(rotate90(c))))).toBe(c);
  });
});

/** Render marker `id` (printed `side` cells wide incl. border, with a white quiet zone) through a homography into a gray image. */
function render(id: number, W: number, Hh: number, quadPx: Pt[], noise = 0): GrayImage {
  // quadPx = where the marker's TL,TR,BR,BL black-square corners land.
  const bits = markerBits(id);
  const CELLS = GRID + 2;
  const Hm = homography(quadPx, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]); // image -> unit marker square
  const data = new Uint8Array(W * Hh).fill(235);
  let seed = 1;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296 - 0.5) * 2;
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      const m = applyH(Hm, x, y);
      let v = 235;
      if (m.x >= 0 && m.x < 1 && m.y >= 0 && m.y < 1) {
        const cx = Math.floor(m.x * CELLS);
        const cy = Math.floor(m.y * CELLS);
        const border = cx === 0 || cy === 0 || cx === CELLS - 1 || cy === CELLS - 1;
        v = border ? 25 : bits[cy - 1]![cx - 1]! ? 235 : 25;
      }
      data[y * W + x] = Math.max(0, Math.min(255, v + rnd() * noise));
    }
  }
  return { data, width: W, height: Hh };
}

describe("detector", () => {
  const upright: Pt[] = [{ x: 200, y: 120 }, { x: 360, y: 120 }, { x: 360, y: 280 }, { x: 200, y: 280 }];
  it("finds an upright marker", () => {
    const dets = detectMarkers(render(5, 640, 400, upright));
    expect(dets.map((d) => d.id)).toEqual([5]);
    for (let i = 0; i < 4; i++) {
      expect(Math.hypot(dets[0]!.corners[i]!.x - upright[i]!.x, dets[0]!.corners[i]!.y - upright[i]!.y)).toBeLessThan(2.5);
    }
  });
  it("keeps TL corner identity for a rotated + perspective marker", () => {
    // TL lands at bottom-right-ish: marker rotated ~180 deg with perspective skew.
    const quad: Pt[] = [{ x: 420, y: 300 }, { x: 250, y: 310 }, { x: 240, y: 130 }, { x: 410, y: 150 }];
    const dets = detectMarkers(render(12, 640, 400, quad, 6));
    expect(dets.map((d) => d.id)).toEqual([12]);
    for (let i = 0; i < 4; i++) {
      expect(Math.hypot(dets[0]!.corners[i]!.x - quad[i]!.x, dets[0]!.corners[i]!.y - quad[i]!.y)).toBeLessThan(3.5);
    }
  });
  it("finds nothing in a blank image", () => {
    expect(detectMarkers({ data: new Uint8Array(640 * 400).fill(200), width: 640, height: 400 })).toEqual([]);
  });
});

describe("pose", () => {
  it("recovers distance and rotation from a synthetic projection", () => {
    // Projection matrix for 60 deg vertical FOV, 4:3 image, principal point at centre.
    const W = 640;
    const H = 480;
    const f = 1 / Math.tan((60 * Math.PI) / 360);
    const P = new Array(16).fill(0);
    P[0] = f / (W / H);
    P[5] = f;
    const K = intrinsicsFromProjection(P, W, H);
    expect(K.cx).toBeCloseTo(W / 2);
    const th = (25 * Math.PI) / 180; // tilt about y
    const R = [Math.cos(th), 0, Math.sin(th), 0, 1, 0, -Math.sin(th), 0, Math.cos(th)];
    const truth = { R, t: [0.1, -0.05, 1.5] as [number, number, number] };
    const s = 0.12;
    const model: [number, number, number][] = [[-s / 2, -s / 2, 0], [s / 2, -s / 2, 0], [s / 2, s / 2, 0], [-s / 2, s / 2, 0]];
    const corners = model.map((p) => project(truth, K, p));
    const est = solveMarkerPose(corners, s, K);
    expect(est.distance).toBeCloseTo(Math.hypot(0.1, 0.05, 1.5), 3);
    for (let i = 0; i < 9; i++) expect(est.R[i]!).toBeCloseTo(R[i]!, 3);
  });
});
