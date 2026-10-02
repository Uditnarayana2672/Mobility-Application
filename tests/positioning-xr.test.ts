import { describe, expect, it } from "vitest";
import { type V3 } from "@/positioning/math";
import { XrPoseCore } from "@/positioning/xrCore";
import { K, loadVenue, lookAt, synthDetection, xrView } from "./helpers/synth";

const venue = loadVenue();
const m1 = venue.markers.find((m) => m.id === 1)!;
const markerW: V3 = [m1.x, -m1.y, m1.z];
const theta0 = 2.1;
const tau0: V3 = [-7.5, 3.2, 0.4];

/** World camera at (x, y) on floor elevation `elev`, looking east. */
const east = (x: number, y: number, elev = 0, eye = 1.35) => {
  const pos: V3 = [x, -y, elev + eye];
  return { pos, view: xrView(lookAt(pos, [x + 5, -y, elev + eye]), pos, theta0, tau0) };
};

function anchored(): { core: XrPoseCore; t: number } {
  const core = new XrPoseCore(venue);
  const pos: V3 = [m1.x + 0.3, -(m1.y + 1.2), 1.35];
  const { det, Rcw } = synthDetection(venue, 1, pos, markerW);
  const view = xrView(Rcw, pos, theta0, tau0);
  core.frame(0, "tracking", view);
  expect(core.marker(det, K, view)).toBe(true);
  return { core, t: 0 };
}

describe("XrPoseCore", () => {
  it("has no pose before the first marker", () => {
    const core = new XrPoseCore(venue);
    core.frame(0, "tracking", east(3, 17).view);
    expect(core.tick(0.05)).toBeNull();
    expect(core.aligned).toBe(false);
  });

  it("the first sighting anchors: position within 0.1 m, floor, marker event once", () => {
    const { core } = anchored();
    const p = core.tick(0.05)!;
    expect(p.source).toBe("marker");
    expect(p.markerId).toBe(1);
    expect(p.floor).toBe("F1");
    expect(Math.hypot(p.x - (m1.x + 0.3), p.y - (m1.y + 1.2))).toBeLessThan(0.1);
    expect(p.acc).toBeLessThan(0.6);
    // The same marker staying in view does not re-fire a scan event every frame.
    const q = core.tick(0.05)!;
    expect(q.source).toBe("ar");
    expect(q.markerId).toBe(1);
  });

  it("follows the phone's own tracking after the marker is gone, and accuracy degrades with distance", () => {
    const { core } = anchored();
    core.tick(0.05);
    const start = { x: m1.x + 0.3, y: m1.y + 1.2 };
    let t = 0;
    let last = core.tick(0.05)!;
    const accs: number[] = [];
    for (let i = 1; i <= 60; i++) {
      t += 0.1;
      const x = start.x + i * 0.1;
      core.frame(t, "tracking", east(x, start.y).view);
      last = core.tick(0.1)!;
      if (i % 20 === 0) accs.push(last.acc);
    }
    expect(last.source).toBe("ar");
    expect(last.floor).toBe("F1");
    expect(Math.hypot(last.x - (start.x + 6), last.y - start.y)).toBeLessThan(0.1);
    expect(last.heading).toBeCloseTo(90, 0);
    expect(accs[0]!).toBeLessThan(accs[2]!);
    expect(accs[2]!).toBeLessThan(1.5);
  });

  it("a later marker corrects drift: small corrections ease in ~0.5 s, never jump", () => {
    const { core } = anchored();
    core.tick(0.05);
    // ARCore drifted by 0.8 m: the phone is really at (m1.x+0.3, m1.y+1.2) again but tracking says 0.8 m east.
    let t = 5;
    const real: V3 = [m1.x + 0.3, -(m1.y + 1.2), 1.35];
    const drifted: V3 = [real[0] + 0.8, real[1], real[2]];
    // walk away to build up accuracy error budget
    for (let i = 0; i < 80; i++) {
      t += 0.1;
      core.frame(t, "tracking", east(m1.x + 0.3 + i * 0.1, m1.y + 1.2).view);
      core.tick(0.1);
    }
    // Back at the marker but the XR frame reports `drifted`.
    const { det, Rcw } = synthDetection(venue, 1, real, markerW);
    const view = xrView(Rcw, drifted, theta0, tau0);
    t += 0.1;
    core.frame(t, "tracking", view);
    const before = core.tick(0.0)!;
    expect(core.marker(det, K, view)).toBe(true);
    const first = core.tick(0.0)!;
    expect(Math.hypot(first.x - before.x, first.y - before.y)).toBeLessThan(0.3); // no jump
    let p = first;
    let max = 0;
    for (let i = 0; i < 12; i++) {
      core.frame((t += 0.05), "tracking", view);
      const n = core.tick(0.05)!;
      max = Math.max(max, Math.hypot(n.x - p.x, n.y - p.y));
      p = n;
    }
    expect(max).toBeLessThan(0.3);
    expect(Math.hypot(p.x - real[0], p.y - -real[1])).toBeLessThan(0.15);
  });

  it("a correction > 1.5 m snaps", () => {
    const { core } = anchored();
    core.tick(0.05);
    let t = 0;
    for (let i = 0; i < 100; i++) {
      t += 0.1;
      core.frame(t, "tracking", east(m1.x + 0.3 + i * 0.1, m1.y + 1.2).view);
      core.tick(0.1);
    }
    const real: V3 = [m1.x - 0.5, -(m1.y + 1.2), 1.35];
    const { det, Rcw } = synthDetection(venue, 1, real, markerW);
    // The XR frame says the phone is ~10 m east of the marker (large drift), the marker says it is beside it.
    const view = xrView(Rcw, [real[0] + 10, real[1], real[2]], theta0, tau0);
    core.frame((t += 0.1), "tracking", view);
    core.tick(0.0);
    expect(core.marker(det, K, view)).toBe(true);
    const p = core.tick(0.0)!;
    expect(Math.hypot(p.x - real[0], p.y - -real[1])).toBeLessThan(0.15);
  });

  it("tracking lost -> stale with growing accuracy radius, position held", () => {
    const { core } = anchored();
    core.tick(0.05);
    core.frame(1, "tracking", east(5, 16.2).view);
    const ok = core.tick(0.1)!;
    core.frame(2, "lost", null);
    const a = core.tick(0.1)!;
    core.frame(5, "lost", null);
    const b = core.tick(0.1)!;
    expect(a.stale).toBe(true);
    expect(b.stale).toBe(true);
    expect(b.acc).toBeGreaterThan(a.acc);
    expect(b.x).toBeCloseTo(ok.x, 3);
    core.frame(6, "tracking", east(5, 16.2).view);
    expect(core.tick(0.1)!.stale).toBe(false);
  });

  it("floor changes after > 2.5 m of vertical displacement; forceFloor re-bases the height", () => {
    const { core } = anchored();
    core.tick(0.05);
    core.frame(1, "tracking", east(5, 16.2, 1.0).view);
    expect(core.tick(0.1)!.floor).toBe("F1");
    core.frame(2, "tracking", east(5, 16.2, 4.0).view); // F2 elevation is 4 m
    expect(core.tick(0.1)!.floor).toBe("F2");
    // The lift confused the height: the phone reads only +1.8 m. The visitor taps "yes, Floor 2".
    core.frame(3, "tracking", east(5, 16.2, 1.8).view);
    expect(core.tick(0.1)!.floor).toBe("F1");
    core.forceFloor("F2");
    expect(core.tick(0.1)!.floor).toBe("F2");
    core.frame(4, "tracking", east(6, 16.2, 1.8).view);
    expect(core.tick(0.1)!.floor).toBe("F2");
  });

  it("rejects an oblique or bad detection and records why", () => {
    const core = new XrPoseCore(venue);
    const pos: V3 = [m1.x + 1.3, -(m1.y + 0.2), 1.4];
    const { det, Rcw } = synthDetection(venue, 1, pos, markerW);
    const view = xrView(Rcw, pos, theta0, tau0);
    core.frame(0, "tracking", view);
    expect(core.marker(det, K, view)).toBe(false);
    expect(core.debug().reject).toBe("oblique");
    expect(core.aligned).toBe(false);
  });
});

describe("XrPoseCore manual anchor", () => {
  it("aligns the XR frame to a hand-set position and heading", () => {
    const core = new XrPoseCore(venue);
    expect(core.anchorManual({ floor: "F1", x: 20, y: 17, heading: 0, acc: 4 })).toBe(false); // no tracked frame yet
    core.frame(0, "tracking", east(5, 5).view); // looking east in truth, but the visitor says "I face north"
    expect(core.anchorManual({ floor: "F1", x: 20, y: 17, heading: 0, acc: 4 })).toBe(true);
    const p = core.tick(0.05)!;
    expect(p.x).toBeCloseTo(20, 1);
    expect(p.y).toBeCloseTo(17, 1);
    expect(p.heading).toBeCloseTo(0, 0);
    expect(p.acc).toBe(4);
    // Walking 3 m forward (really east in the XR frame) now moves the dot 3 m north.
    core.frame(1, "tracking", east(8, 5).view);
    const q = core.tick(0.05)!;
    expect(q.x).toBeCloseTo(20, 1);
    expect(q.y).toBeCloseTo(14, 1);
  });
});
