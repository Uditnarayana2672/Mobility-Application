import { describe, expect, it } from "vitest";
import { advance, bearingDelta, bearingToVector, normaliseBearing, vectorToBearing } from "@/shared/frame";

describe("frame", () => {
  it("normalises bearings", () => {
    expect(normaliseBearing(-90)).toBe(270);
    expect(normaliseBearing(450)).toBe(90);
  });
  it("north is up (-y), east is +x", () => {
    const n = bearingToVector(0);
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBeCloseTo(-1);
    const e = bearingToVector(90);
    expect(e.x).toBeCloseTo(1);
    expect(e.y).toBeCloseTo(0);
  });
  it("round-trips", () => {
    for (const b of [0, 45, 135, 270, 359]) expect(vectorToBearing(bearingToVector(b))).toBeCloseTo(b);
  });
  it("signed delta", () => {
    expect(bearingDelta(10, 350)).toBe(20);
    expect(bearingDelta(350, 10)).toBe(-20);
  });
  it("advance south increases y", () => {
    const p = advance({ x: 0, y: 0 }, 180, 2);
    expect(p.y).toBeCloseTo(2);
  });
});
