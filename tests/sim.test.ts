import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { alternatives, isRouteError, parseVenue, poseFromMarker, route, type Route, type Venue } from "@/core";
import type { Pose } from "@/navigator/poseSource";
import { advance, createSession, type SessionEvent } from "@/navigator/session";
import { SimPoseSource } from "@/navigator/simPose";

const V: Venue = (() => {
  const r = parseVenue(JSON.parse(fs.readFileSync("public/venues/office-hq/venue.json", "utf8")));
  if (!r.ok) throw new Error("bad fixture");
  return r.data;
})();
const m1 = V.markers.find((m) => m.id === 1)!;
const from1 = poseFromMarker(m1);
const stairs = alternatives(V, from1, { room: "F2-cafeteria" }).options.find((o) => o.via === "stairs") as Route;

function mk() {
  const sim = new SimPoseSource(V);
  const poses: Pose[] = [];
  sim.subscribe((p) => poses.push(p));
  sim.start();
  return { sim, poses };
}

describe("SimPoseSource", () => {
  it("starts at marker 1 with a marker pose", () => {
    const { poses } = mk();
    expect(poses[0]).toMatchObject({ floor: m1.floor, markerId: 1, source: "marker", acc: 0.3, stale: false });
  });

  it("walks the route at 1.3 m/s (x1) and 3.9 m/s (x3)", () => {
    for (const [speed, v] of [[1, 1.3], [3, 3.9]] as const) {
      const { sim } = mk();
      sim.setRoute(stairs);
      sim.setSpeed(speed);
      for (let i = 0; i < 40; i++) sim.tick(0.05); // 2 s
      expect(sim.getProgress()).toBeCloseTo(2 * v, 6);
    }
  });

  it("pause stops it, play resumes", () => {
    const { sim } = mk();
    sim.setRoute(stairs);
    sim.pause();
    sim.tick(1);
    expect(sim.getProgress()).toBe(0);
    sim.play();
    sim.tick(1);
    expect(sim.getProgress()).toBeGreaterThan(1.2);
  });

  it("pauses at the connector, then flips the floor; held walker stays put", () => {
    const { sim, poses } = mk();
    sim.setRoute(stairs);
    sim.setSpeed(3);
    const vi = stairs.hops.findIndex((h) => h.type !== "walk");
    let guard = 0;
    while (!sim.getStatus().trans && guard++ < 2000) sim.tick(0.05);
    const tr = sim.getStatus().trans!;
    expect(tr.via).toBe("stairs");
    expect(sim.getProgress()).toBeCloseTo(stairs.cum[vi] as number, 6);
    expect(poses[poses.length - 1]!.floor).toBe(tr.fromFloor);
    guard = 0;
    while (sim.getStatus().trans && guard++ < 2000) sim.tick(0.05);
    expect(sim.getPose().floor).toBe(tr.toFloor);
    sim.tick(0.05);
    expect(sim.getPose().acc).toBeGreaterThanOrEqual(1.39);
    sim.hold(true);
    const s = sim.getProgress();
    sim.tick(1);
    expect(sim.getProgress()).toBe(s);
    sim.hold(false);
    sim.tick(1);
    expect(sim.getProgress()).toBeGreaterThan(s);
  });

  it("transition duration scales with speed", () => {
    const dur = (speed: 1 | 3) => {
      const { sim } = mk();
      sim.setRoute(stairs);
      sim.setSpeed(speed);
      let g = 0;
      while (!sim.getStatus().trans && g++ < 4000) sim.tick(0.05);
      return sim.getStatus().trans!.dur;
    };
    expect(dur(1)).toBeCloseTo(dur(3) * 3, 6);
  });

  it("accuracy grows with distance since the last marker and a scan resets it", () => {
    const { sim } = mk();
    sim.setRoute(stairs);
    for (let i = 0; i < 100; i++) sim.tick(0.05);
    const grown = sim.getPose().acc;
    expect(grown).toBeGreaterThan(0.4);
    expect(sim.scan(1)).toBe(true);
    expect(sim.getPose().acc).toBe(0.3);
    expect(sim.scan(999)).toBe(false);
  });

  it("scan emits a marker pose once, then back to sim poses", () => {
    const { sim, poses } = mk();
    const n = poses.length;
    sim.scan(3);
    const scanPose = poses[n]!;
    expect(scanPose).toMatchObject({ source: "marker", markerId: 3, acc: 0.3 });
    sim.tick(0.05);
    expect(poses[poses.length - 1]!.source).toBe("sim");
    expect(poses[poses.length - 1]!.markerId).toBe(3);
  });

  it("lose tracking makes poses stale, grows acc, and recovers", () => {
    const { sim, poses } = mk();
    sim.loseTracking(2);
    sim.tick(0.5);
    expect(poses[poses.length - 1]!.stale).toBe(true);
    const a0 = poses[poses.length - 1]!.acc;
    sim.tick(0.5);
    expect(poses[poses.length - 1]!.acc).toBeGreaterThan(a0);
    sim.tick(1.5);
    sim.tick(0.1);
    expect(poses[poses.length - 1]!.stale).toBe(false);
  });

  it("manual mode: W moves along the heading, D strafes, Q/E rotate, clamped to the plate", () => {
    const { sim } = mk();
    sim.setMode("manual");
    const p0 = sim.getPose();
    sim.setManualInput({ fwd: 1 });
    sim.tick(1);
    const p1 = sim.getPose();
    const moved = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    expect(moved).toBeCloseTo(1.3, 3);
    expect(p1.source).toBe("manual");
    sim.setManualInput({ fwd: 0, turn: 1 });
    sim.tick(0.9);
    expect(sim.getPose().heading).not.toBeCloseTo(p1.heading, 0);
    sim.setManualInput({ fwd: 1, turn: 0 });
    for (let i = 0; i < 400; i++) sim.tick(0.5);
    const fl = V.floors.find((f) => f.id === sim.getPose().floor)!;
    expect(sim.getPose().x).toBeGreaterThanOrEqual(0);
    expect(sim.getPose().x).toBeLessThanOrEqual(fl.w);
    expect(sim.getPose().y).toBeGreaterThanOrEqual(0);
    expect(sim.getPose().y).toBeLessThanOrEqual(fl.h);
  });

  it("switching back to auto re-joins the route at the nearest point", () => {
    const { sim } = mk();
    sim.setRoute(stairs);
    sim.setMode("manual");
    sim.setManualInput({ fwd: 1 });
    for (let i = 0; i < 10; i++) sim.tick(0.5);
    sim.setManualInput({ fwd: 0 });
    sim.setMode("auto");
    const s = sim.getProgress();
    sim.tick(1);
    expect(sim.getProgress()).toBeGreaterThan(s);
  });

  it("wrong turn puts the walker >6 m off the route and holds until a new route", () => {
    const { sim } = mk();
    sim.setRoute(stairs);
    for (let i = 0; i < 60; i++) sim.tick(0.05);
    expect(sim.wrongTurn()).toBe(true);
    const p = sim.getPose();
    let best = Infinity;
    for (let i = 0; i < stairs.hops.length; i++) {
      if (stairs.hops[i]!.type !== "walk" || stairs.points[i]!.floor !== p.floor) continue;
      const a = stairs.points[i]!;
      const b = stairs.points[i + 1]!;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2)));
      best = Math.min(best, Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y))));
    }
    expect(best).toBeGreaterThan(5);
    const s = sim.getProgress();
    sim.tick(1);
    expect(sim.getProgress()).toBe(s);
    const r2 = route(V, { floor: p.floor, x: p.x, y: p.y, heading: p.heading }, { room: "F2-cafeteria" });
    if (isRouteError(r2)) throw new Error("no route");
    sim.setRoute(r2);
    sim.tick(1);
    expect(sim.getProgress()).toBeGreaterThan(1);
  });

  it("drives a session from poses to 'arrive' (floor prompt confirmed by the test)", () => {
    const { sim, poses } = mk();
    sim.setRoute(stairs);
    sim.setSpeed(3);
    let { state } = createSession(stairs);
    const events: SessionEvent[] = [];
    let t = 0;
    let fed = 0;
    for (let i = 0; i < 6000 && state.phase !== "arrived"; i++) {
      sim.tick(0.05);
      t += 50;
      for (; fed < poses.length; fed++) {
        const res = advance(state, { type: "pose", pose: poses[fed]!, tMs: t });
        state = res.state;
        events.push(...res.events);
      }
      if (state.floorPrompt) {
        const res = advance(state, { type: "confirmFloor" });
        state = res.state;
        events.push(...res.events);
      }
    }
    expect(state.phase).toBe("arrived");
    expect(events.filter((e) => e.type === "arrive")).toHaveLength(1);
    expect(events.filter((e) => e.type === "offRoute")).toHaveLength(0);
    expect(events.filter((e) => e.type === "floorPrompt")).toHaveLength(1);
  });
});
