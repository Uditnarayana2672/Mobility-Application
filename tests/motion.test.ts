import { describe, expect, it } from "vitest";
import { StepDetector } from "@/core/steps";
import { HeadingIntegrator } from "@/core/heading";

function walk(freqHz: number, amp: number, seconds: number, sampleHz = 60) {
  const d = new StepDetector();
  const n = seconds * sampleHz;
  for (let i = 0; i < n; i++) {
    const t = (i / sampleHz) * 1000;
    const az = 9.81 + amp * Math.sin(2 * Math.PI * freqHz * (i / sampleHz));
    d.push(t, 0.2, 0.1, az);
  }
  return d.steps;
}

describe("StepDetector", () => {
  it("counts ~1.8 steps/s walking within 5%", () => {
    const steps = walk(1.8, 3, 30); // 54 expected
    expect(Math.abs(steps - 54) / 54).toBeLessThan(0.05);
  });
  it("ignores low-amplitude hand jitter", () => {
    expect(walk(2, 0.3, 20)).toBe(0);
  });
  it("debounces fast shake (8 Hz) to at most ~3.3 steps/s", () => {
    expect(walk(8, 4, 10)).toBeLessThanOrEqual(34);
  });
});

describe("HeadingIntegrator", () => {
  it("flat phone: clockwise 360 deg turn in 10 s", () => {
    const h = new HeadingIntegrator(0);
    for (let i = 0; i <= 600; i++) h.update(i * (1000 / 60), { alpha: -36, beta: 0, gamma: 0 }, [0, 0, 9.81]);
    expect(h.total).toBeCloseTo(360, 0);
  });
  it("upright phone uses gamma as yaw", () => {
    const h = new HeadingIntegrator(0);
    for (let i = 0; i <= 600; i++) h.update(i * (1000 / 60), { alpha: 0, beta: 0, gamma: 18 }, [0, 9.81, 0]);
    expect(h.total).toBeCloseTo(-180, 0);
    expect(h.bearing).toBeCloseTo(180, 0);
  });
});
