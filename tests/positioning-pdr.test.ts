import { describe, expect, it } from "vitest";
import { PdrPoseCore } from "@/positioning/pdrCore";
import { seededRandom } from "@/positioning/particleFilter";
import { loadVenue } from "./helpers/synth";

const venue = loadVenue();

/** Feed `seconds` of walking at 1.8 steps/s (60 Hz samples) with an optional constant gyro yaw rate (deg/s, flat phone, + = counter-clockwise). */
function walk(core: PdrPoseCore, t0: number, seconds: number, yawRate = 0): number {
  const hz = 60;
  for (let i = 0; i < seconds * hz; i++) {
    const t = t0 + (i / hz) * 1000;
    const az = 9.81 + 3 * Math.sin(2 * Math.PI * 1.8 * (i / hz));
    core.motion(t, [0.2, 0.1, az], { alpha: yawRate, beta: 0, gamma: 0 });
    if (i % 3 === 0) core.tick(1 / 20);
  }
  return t0 + seconds * 1000;
}

describe("PdrPoseCore", () => {
  it("publishes nothing until a marker anchors it", () => {
    const core = new PdrPoseCore(venue, { rnd: seededRandom(1) });
    walk(core, 0, 2);
    expect(core.tick(0.05)).toBeNull();
    expect(core.located).toBe(false);
  });

  it("anchor -> marker pose; then steps move the dot along the corridor", () => {
    const core = new PdrPoseCore(venue, { rnd: seededRandom(2) });
    core.anchor({ floor: "F1", x: 3, y: 17, heading: 90, acc: 0.5, markerId: 1 });
    const first = core.tick(0.05)!;
    expect(first.source).toBe("marker");
    expect(first.markerId).toBe(1);
    expect(first.acc).toBeCloseTo(0.5);
    const t = walk(core, 0, 20); // ~36 steps = ~25 m
    const p = core.tick(0.05)!;
    expect(p.source).toBe("steps");
    expect(p.markerId).toBe(1);
    expect(p.floor).toBe("F1");
    expect(p.y).toBeGreaterThan(15);
    expect(p.y).toBeLessThan(19);
    const steps = core.stepCount;
    expect(steps).toBeGreaterThan(30);
    expect(Math.abs(p.x - (3 + steps * 0.7))).toBeLessThan(3);
    expect(p.acc).toBeGreaterThan(0.5);
    expect(p.acc).toBeLessThanOrEqual(8);
    expect(t).toBeGreaterThan(0);
  });

  it("a gyro that keeps drifting is held in the corridor by the map", () => {
    const core = new PdrPoseCore(venue, { rnd: seededRandom(3) });
    core.anchor({ floor: "F1", x: 3, y: 17, heading: 90, acc: 0.5, markerId: 1 });
    walk(core, 0, 25, -0.4); // 0.4 deg/s of clockwise drift over 25 s = 10 deg
    const p = core.tick(0.05)!;
    expect(p.y).toBeGreaterThan(15);
    expect(p.y).toBeLessThan(19);
    expect(p.x).toBeGreaterThan(25);
  });

  it("a second marker fix re-seeds the cloud (and counts as a scan)", () => {
    const core = new PdrPoseCore(venue, { rnd: seededRandom(4) });
    core.anchor({ floor: "F1", x: 3, y: 17, heading: 90, acc: 0.5, markerId: 1 });
    walk(core, 0, 10);
    core.tick(0.05);
    core.anchor({ floor: "F1", x: 20, y: 16.5, heading: 90, acc: 0.4, markerId: 2 });
    let p = core.tick(0.05)!;
    expect(p.source).toBe("marker");
    expect(p.markerId).toBe(2);
    for (let i = 0; i < 20; i++) p = core.tick(0.05)!;
    expect(Math.hypot(p.x - 20, p.y - 16.5)).toBeLessThan(0.3);
    expect(p.acc).toBeLessThan(1);
  });

  it("changeFloor moves the cloud, holds steps until released", () => {
    const core = new PdrPoseCore(venue, { rnd: seededRandom(5) });
    core.anchor({ floor: "F1", x: 23, y: 19.5, heading: 180, acc: 0.5, markerId: 1 });
    core.tick(0.05);
    core.changeFloor("F2", 23, 19.5);
    let p = core.tick(5)!;
    expect(p.floor).toBe("F2");
    const before = { x: p.x, y: p.y };
    walk(core, 0, 3);
    p = core.tick(0.05)!;
    expect(Math.hypot(p.x - before.x, p.y - before.y)).toBeLessThan(0.5); // held
    core.release();
    walk(core, 4000, 3);
    p = core.tick(0.05)!;
    expect(p.floor).toBe("F2");
  });
});
