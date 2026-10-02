import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseVenue, type Venue } from "@/core";
import { PoseSmoother } from "@/positioning/corrector";
import { ParticleFilter, seededRandom, walkableFromVenue } from "@/positioning/particleFilter";

const venue: Venue = (() => {
  const r = parseVenue(JSON.parse(fs.readFileSync("public/venues/office-hq/venue.json", "utf8")));
  if (!r.ok) throw new Error("fixture venue invalid");
  return r.data;
})();

describe("PoseSmoother", () => {
  const P = (x: number, y: number, heading = 0, floor = "F1") => ({ floor, x, y, heading });

  it("snaps corrections larger than 1.5 m", () => {
    const s = new PoseSmoother();
    expect(s.correct(P(0, 0), P(2, 0))).toBe("snap");
    expect(s.update(P(2, 0), 0.016).x).toBeCloseTo(2);
    expect(s.easing).toBe(false);
  });

  it("snaps a floor change", () => {
    expect(new PoseSmoother().correct(P(0, 0), P(0, 0, 0, "F2"))).toBe("snap");
  });

  it("eases a 1 m correction over ~0.5 s without a visible jump", () => {
    const s = new PoseSmoother();
    expect(s.correct(P(10, 5, 0), P(11, 5, 20))).toBe("ease");
    // Raw is now at the corrected pose; the displayed dot starts where it was and moves smoothly.
    let prev = s.update(P(11, 5, 20), 0);
    expect(prev.x).toBeCloseTo(10, 5);
    expect(prev.heading).toBeCloseTo(0, 5);
    let maxStep = 0;
    for (let t = 0; t < 0.6; t += 0.05) {
      const d = s.update(P(11, 5, 20), 0.05);
      maxStep = Math.max(maxStep, Math.hypot(d.x - prev.x, d.y - prev.y));
      prev = d;
    }
    expect(maxStep).toBeLessThan(0.3); // 1 m over 10 frames, never one big jump
    expect(prev.x).toBeCloseTo(11, 5);
    expect(prev.heading).toBeCloseTo(20, 5);
    expect(s.easing).toBe(false);
  });

  it("composes overlapping corrections", () => {
    const s = new PoseSmoother();
    s.correct(P(0, 0), P(0.5, 0));
    s.update(P(0.5, 0), 0.25);
    s.correct(P(0.5, 0), P(0.5, 0.5));
    const d = s.update(P(0.5, 0.5), 0);
    // Displayed position is continuous with what it was before the second correction (somewhere between).
    expect(d.x).toBeGreaterThan(0);
    expect(d.x).toBeLessThan(0.5);
    expect(d.y).toBeCloseTo(0, 5);
  });

  it("wraps heading corrections the short way", () => {
    const s = new PoseSmoother();
    s.correct(P(0, 0, 355), P(0, 0, 5));
    expect(s.update(P(0, 0, 5), 0).heading).toBeCloseTo(355, 5);
    expect(s.update(P(0, 0, 5), 1).heading).toBeCloseTo(5, 5);
  });
});

describe("ParticleFilter", () => {
  const walk = walkableFromVenue(venue);

  it("walkable: corridor and room interiors, not the void", () => {
    expect(walk.contains("F1", 30, 17)).toBe(true);
    expect(walk.contains("F1", 30, -3)).toBe(false);
    expect(walk.canMove("F1", 24, 16, 24, 14)).toBe(false); // through the wall of the room north of the corridor
    expect(walk.canMove("F1", 7, 16, 7, 14)).toBe(true); // through Reception door at (7,15)
    expect(walk.distance("F1", 30, 17)).toBe(0);
    expect(walk.distance("F1", 30, -3)).toBeGreaterThan(0);
  });

  it("an editor-drawn venue has no corridor rectangles: the walk path edges define the corridor", () => {
    const drawn = { ...venue, corridors: [] };
    const w = walkableFromVenue(drawn);
    expect(venue.corridors.length).toBeGreaterThan(0);
    const e = venue.edges.find((x) => x.type === "walk")!;
    const a = venue.nodes.find((n) => n.id === e.a)!;
    const b = venue.nodes.find((n) => n.id === e.b)!;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    expect(w.contains(a.floor, mid.x, mid.y)).toBe(true);
    expect(w.contains("F1", 30, -3)).toBe(false);
    expect(w.canMove("F1", 24, 16, 24, 14)).toBe(false); // still no walking through a room wall
    // and the filter can walk it
    const pf = new ParticleFilter(w, "F1", seededRandom(11));
    pf.seed("F1", 5, 17, 90, 0.3);
    for (let i = 0; i < 30; i++) pf.step(0.7, 90);
    const est = pf.estimate();
    expect(est.x).toBeGreaterThan(20);
    expect(Math.abs(est.y - 17)).toBeLessThan(2);
  });

  it("keeps a walker with a drifting gyro inside the corridor", () => {
    const pf = new ParticleFilter(walk, "F1", seededRandom(7));
    pf.seed("F1", 5, 17, 90, 0.4);
    const rnd = seededRandom(99);
    let reported = 90;
    let worstY = 0;
    for (let i = 0; i < 50; i++) {
      reported += 0.35 + (rnd() - 0.5) * 0.5; // slow gyro drift
      pf.step(0.7 * (1 + (rnd() - 0.5) * 0.1), reported);
      const e = pf.estimate();
      worstY = Math.max(worstY, Math.abs(e.y - 17));
    }
    const e = pf.estimate();
    expect(e.floor).toBe("F1");
    expect(e.y).toBeGreaterThan(15);
    expect(e.y).toBeLessThan(19);
    expect(Math.abs(e.x - (5 + 50 * 0.7))).toBeLessThan(4);
    expect(worstY).toBeLessThan(2);
  });

  it("particles that cross a wall die", () => {
    const pf = new ParticleFilter(walk, "F1", seededRandom(3));
    pf.seed("F1", 24, 15.6, 0, 0.1); // walking north from the corridor's north edge
    for (let i = 0; i < 5; i++) pf.step(0.7, 0);
    // The cloud cannot have wandered through the wall: the estimate stays near the edge, not 3.5 m north of it.
    expect(pf.estimate().y).toBeGreaterThan(13.5);
  });

  it("a marker re-seed collapses the cloud and sets the accuracy", () => {
    const pf = new ParticleFilter(walk, "F1", seededRandom(1));
    pf.seed("F1", 5, 17, 90, 3);
    const wide = pf.estimate().acc;
    pf.seed("F1", 20, 17, 90, 0.2);
    const e = pf.estimate();
    expect(e.x).toBeCloseTo(20, 0);
    expect(e.acc).toBeLessThan(wide);
    expect(e.acc).toBeLessThan(1.5);
  });

  it("uses ~300 particles by default and is reproducible", () => {
    const run = () => {
      const pf = new ParticleFilter(walk, "F1", seededRandom(5));
      pf.seed("F1", 5, 17, 90, 0.5);
      for (let i = 0; i < 20; i++) pf.step(0.7, 90);
      return pf.estimate();
    };
    expect(new ParticleFilter(walk, "F1").count).toBe(300);
    expect(run()).toEqual(run());
  });
});
