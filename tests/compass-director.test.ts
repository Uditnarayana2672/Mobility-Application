import { describe, expect, it } from "vitest";
import { direct, LIMITS } from "@/ar/director";
import type { ArSceneModel } from "@/ar/sceneModel";
import { CompassFusion, cameraCompassHeading, norm360 } from "@/positioning/compass";
import { PdrPoseCore } from "@/positioning/pdrCore";
import { loadVenue } from "./helpers/synth";

/** Euler angles (alpha, beta, gamma) of a phone held upright with its back camera facing `heading` degrees clockwise from north. */
const upright = (heading: number) => ({ alpha: norm360(-heading), beta: 90, gamma: 0 });

describe("cameraCompassHeading", () => {
  it("an upright phone: the camera heading round-trips for every direction", () => {
    for (const h of [0, 30, 90, 135, 180, 225, 270, 359]) {
      const { alpha, beta, gamma } = upright(h);
      expect(cameraCompassHeading(alpha, beta, gamma)!).toBeCloseTo(h, 5);
    }
  });
  it("tilted up or down a bit keeps the heading; lying flat has none", () => {
    expect(cameraCompassHeading(norm360(-90), 70, 0)!).toBeCloseTo(90, 3);
    expect(cameraCompassHeading(norm360(-90), 120, 0)!).toBeCloseTo(90, 3);
    expect(cameraCompassHeading(10, 0, 0)).toBeNull();
  });
});

describe("CompassFusion", () => {
  const steadyAt = (f: CompassFusion, h: number) => {
    for (let i = 0; i < 10; i++) f.push(h + (i % 2 ? 1 : -1));
  };
  it("learns the map north from marker fixes and turns compass readings into map headings", () => {
    const f = new CompassFusion();
    expect(f.offset).toBeNull();
    expect(f.push(100)).toBeNull();
    f.learn(100, 70); // the compass said 100 while the map heading was 70 -> offset 30
    expect(f.offset).toBeCloseTo(30, 3);
    expect(f.push(130)).toBeCloseTo(100, 3);
  });
  it("averages several fixes (also across the 0/360 seam) and lets new evidence outvote a wrong first guess", () => {
    const f = new CompassFusion();
    f.learn(10, 350, 0.15); // a rough first guess: offset 20
    f.learn(15, 350, 1);
    f.learn(12, 349, 1);
    f.learn(14, 352, 1);
    const err = Math.abs(((f.offset! - 15 + 540) % 360) - 180);
    expect(err).toBeLessThan(180); // (distance on the circle below)
    const circ = Math.min(Math.abs(f.offset! - 15), 360 - Math.abs(f.offset! - 15));
    expect(circ).toBeLessThan(8);
    const g = new CompassFusion();
    g.learn(5, 355, 1);
    g.learn(8, 358, 1);
    expect(g.offset).toBeGreaterThan(5);
    expect(g.offset).toBeLessThan(15);
  });
  it("corrects the gyro gently, only when steady, and ignores readings that disagree wildly", () => {
    const f = new CompassFusion({ prior: 0 });
    expect(f.correction(90)).toBeNull(); // not enough readings yet
    steadyAt(f, 100);
    const c = f.correction(90)!; // the compass says about 100, the gyro 90
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThan(1); // 3 % of the 10 degree disagreement
    const noisy = new CompassFusion({ prior: 0 });
    for (let i = 0; i < 10; i++) noisy.push(i * 40);
    expect(noisy.correction(90)).toBeNull(); // swinging: interference
    const far = new CompassFusion({ prior: 0 });
    steadyAt(far, 250);
    expect(far.correction(10)).toBeNull(); // 120 degrees apart: believe the gyro
  });
  it("a venue prior is used until markers say otherwise", () => {
    expect(new CompassFusion({ prior: 35 }).offset).toBeCloseTo(35, 5);
  });
});

describe("PdrPoseCore with the compass", () => {
  const V = loadVenue();
  const steady = (core: PdrPoseCore, h: number) => {
    for (let i = 0; i < 12; i++) core.compass(h + (i % 2 ? 0.5 : -0.5));
  };
  it("a marker fix teaches the offset; afterwards a steady compass pulls a drifted gyro heading back", () => {
    const core = new PdrPoseCore(V, { rnd: () => 0.5 });
    steady(core, 130);
    core.anchor({ floor: "F1", x: 3, y: 16.5, heading: 100, acc: 0.4, markerId: 1 });
    expect(Math.abs(core.northOffset! - 30)).toBeLessThan(1);
    // the gyro drifted: it now believes 90 while the compass still says 130 (= map 100)
    core.anchor({ floor: "F1", x: 3, y: 16.5, heading: 90, acc: 4, markerId: null });
    const settle = () => {
      let h = 0;
      for (let i = 0; i < 40; i++) h = core.tick(0.1)!.heading; // let the display ease finish
      return h;
    };
    const before = settle();
    expect(Math.abs(before - 90)).toBeLessThan(1); // the drifted heading
    for (let i = 0; i < 200; i++) core.compass(130 + (i % 2 ? 0.4 : -0.4));
    const after = settle();
    expect(Math.abs(after - 100)).toBeLessThan(Math.abs(before - 100) - 3);
  });
  it("turning on the spot (no steps) turns the heading: the arrow follows the phone", () => {
    const core = new PdrPoseCore(V, { rnd: () => 0.5 });
    core.anchor({ floor: "F1", x: 3, y: 16.5, heading: 0, acc: 0.4, markerId: 1 });
    // phone held flat: up = +z, a clockwise yaw of 90 deg/s is alpha = -90 deg/s
    for (let t = 0; t <= 1000; t += 10) core.motion(t, [0, 0, 9.81], { alpha: -90, beta: 0, gamma: 0 });
    let h = 0;
    for (let i = 0; i < 40; i++) h = core.tick(0.1)!.heading;
    expect(Math.abs(h - 90)).toBeLessThan(6);
  });

  it("without any north knowledge the compass changes nothing", () => {
    const core = new PdrPoseCore(V, { rnd: () => 0.5 });
    core.anchor({ floor: "F1", x: 3, y: 16.5, heading: 90, acc: 4, markerId: null });
    const before = core.tick(0.1)!.heading;
    steady(core, 200);
    expect(core.tick(0.1)!.heading).toBeCloseTo(before, 3);
  });
});

describe("AR director", () => {
  const p = (x: number) => ({ x, y: 0, z: 0 });
  const ad = (id: string) => ({ id, campaign: {} as never, wall: {} as never, corners: [p(0), p(1), p(2), p(3)] as never, centre: p(1), normal: { x: 0, y: 1 }, distanceM: 4 });
  const model: ArSceneModel = {
    floor: "F1",
    floorElevation: 0,
    chevrons: Array.from({ length: 14 }, (_, i) => ({ id: `c${i}`, at: p(i), bearing: 0, distanceM: i + 1, opacity: 1 })),
    turnArrows: [{ at: p(5), before: p(4), after: p(6), dir: "left", distanceM: 12, label: "Turn left" }],
    destinationPin: { at: p(20), label: "Pantry", distanceM: 20 },
    floorChangeArrow: null,
    adQuads: [ad("a"), ad("b")],
  };

  it("good position: up to 8 floor cues, the turn, the pin; one ad", () => {
    const d = direct(model, { acc: 0.8, stale: false });
    expect(d.model.chevrons).toHaveLength(LIMITS.maxChevronsGood);
    expect(d.model.turnArrows).toHaveLength(1);
    expect(d.model.destinationPin).not.toBeNull();
    expect(d.model.adQuads).toHaveLength(1);
    expect(d.compassOnly).toBe(false);
    expect(d.hint).toBeNull();
  });
  it("a turn is close: the ad steps aside", () => {
    const close = { ...model, turnArrows: [{ ...model.turnArrows[0]!, distanceM: 4 }] };
    expect(direct(close, { acc: 0.8, stale: false }).model.adQuads).toHaveLength(0);
  });
  it("fair position (1.5 - 2.5 m): fewer cues, a far turn is held back, no pin, no ads, and a hint", () => {
    const d = direct(model, { acc: 2, stale: false });
    expect(d.model.chevrons).toHaveLength(LIMITS.maxChevronsRough);
    expect(d.model.turnArrows).toHaveLength(0); // 12 m away > 10 m
    expect(d.model.destinationPin).toBeNull();
    expect(d.model.adQuads).toHaveLength(0);
    expect(d.hint).toMatch(/scan a marker/);
  });
  it("rough position: only the compass arrow", () => {
    const d = direct(model, { acc: 4, stale: false });
    expect(d.compassOnly).toBe(true);
    expect(d.model.chevrons).toHaveLength(0);
    expect(d.model.destinationPin).toBeNull();
    expect(d.hint).toMatch(/rough/);
  });
  it("tracking lost: nothing in the world", () => {
    const d = direct(model, { acc: 0.5, stale: true });
    expect(d.compassOnly).toBe(true);
    expect(d.model.chevrons).toHaveLength(0);
    expect(d.hint).toMatch(/Tracking lost/);
  });
  it("camera above the horizon: no floor cues, tells the visitor to aim lower; pointing at the floor is fine", () => {
    const up = direct(model, { acc: 0.8, stale: false, pitchDownDeg: -30 });
    expect(up.model.chevrons).toHaveLength(0);
    expect(up.model.turnArrows).toHaveLength(0);
    expect(up.hint).toMatch(/lower/);
    expect(direct(model, { acc: 0.8, stale: false, pitchDownDeg: 40 }).model.chevrons.length).toBeGreaterThan(0);
  });
  it("never mutates its input", () => {
    const copy = structuredClone(model);
    direct(model, { acc: 4, stale: false });
    expect(model).toEqual(copy);
  });
});
