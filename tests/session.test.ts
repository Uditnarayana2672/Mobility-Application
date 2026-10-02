import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { alternatives, isRouteError, parseVenue, pointAt, poseFromMarker, route, type Route, type Venue } from "@/core";
import type { Pose } from "@/navigator/poseSource";
import { advance, createSession, snapshot, type SessionEvent, type SessionInput, type SessionState } from "@/navigator/session";

const V: Venue = (() => {
  const r = parseVenue(JSON.parse(fs.readFileSync("public/venues/office-hq/venue.json", "utf8")));
  if (!r.ok) throw new Error("bad fixture");
  return r.data;
})();

function mustRoute(r: ReturnType<typeof route>): Route {
  if (isRouteError(r)) throw new Error("route error " + r.error);
  return r;
}

const marker1 = V.markers.find((m) => m.id === 1)!;
const from1 = poseFromMarker(marker1);
const cafe = (prefs?: { avoidStairs?: boolean; avoidLifts?: boolean }) => mustRoute(route(V, from1, { room: "F2-cafeteria" }, prefs));

const pose = (floor: string, x: number, y: number, extra: Partial<Pose> = {}): Pose => ({ floor, x, y, heading: 0, acc: 0.5, stale: false, markerId: null, source: "sim", ...extra });

/** Drives a session with a trace of poses 100 ms apart (or as given) and collects the events. */
class Run {
  state: SessionState;
  events: SessionEvent[] = [];
  t = 0;
  constructor(public readonly r: Route) {
    const c = createSession(r);
    this.state = c.state;
    this.events.push(...c.events);
  }
  feed(input: SessionInput) {
    const res = advance(this.state, input);
    this.state = res.state;
    this.events.push(...res.events);
    return res.events;
  }
  pose(p: Pose, dtMs = 100) {
    this.t += dtMs;
    return this.feed({ type: "pose", pose: p, tMs: this.t });
  }
  /** Walk the route from s0 to s1 at 1.3 m/s with the poses the route itself says (a perfect walker). */
  walk(s0: number, s1: number, hz = 10) {
    const step = 1.3 / hz;
    for (let s = s0; s < s1 + 1e-9; s += step) {
      const pa = pointAt(this.r, Math.min(s, this.r.total));
      if (pa.vertical) continue;
      this.pose(pose(pa.floor, pa.x, pa.y, { heading: pa.bearing }), 1000 / hz);
    }
  }
  count(type: SessionEvent["type"]) {
    return this.events.filter((e) => e.type === type).length;
  }
}

describe("session: same-floor route", () => {
  const r = mustRoute(route(V, poseFromMarker(marker1), { room: "F1-everest" }));

  it("starts with an announcement of the first step and nothing else", () => {
    const run = new Run(r);
    expect(run.events.map((e) => e.type)).toEqual(["start"]);
    const ev = run.events[0]!;
    expect(ev.type === "start" && ev.first).toBe(r.steps[0]);
  });

  it("announces each manoeuvre once at 15 m and once at 3 m, in order, then arrives", () => {
    const run = new Run(r);
    run.walk(0, r.total);
    const pre = run.events.filter((e) => e.type === "preannounce");
    const now = run.events.filter((e) => e.type === "turnNow");
    const manoeuvres = r.steps.length - 1; // all but "arrive"
    // Every manoeuvre gets its "turn now"; every manoeuvre except an initial / short one gets a pre-announce.
    expect(now).toHaveLength(manoeuvres);
    expect(new Set(now.map((e) => (e as { stepIndex: number }).stepIndex)).size).toBe(manoeuvres);
    const idx = now.map((e) => (e as { stepIndex: number }).stepIndex);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    for (const e of pre) {
      if (e.type !== "preannounce") continue;
      expect(e.remaining).toBeLessThanOrEqual(15 + 1e-6);
      expect(e.remaining).toBeGreaterThan(3);
    }
    expect(new Set(pre.map((e) => (e as { stepIndex: number }).stepIndex)).size).toBe(pre.length);
    expect(run.count("arrive")).toBe(1);
    expect(run.state.phase).toBe("arrived");
    expect(run.count("offRoute")).toBe(0);
  });

  it("'turn now' fires within 3 m of the manoeuvre and never earlier", () => {
    const run = new Run(r);
    for (let s = 0; s <= r.total; s += 0.13) {
      const pa = pointAt(r, s);
      const before = run.events.length;
      run.pose(pose(pa.floor, pa.x, pa.y));
      for (const e of run.events.slice(before)) {
        if (e.type !== "turnNow") continue;
        expect(e.step.sAt - run.state.s).toBeLessThanOrEqual(3 + 1e-6);
      }
    }
  });

  it("arrives within 3 m of the end, not before", () => {
    const run = new Run(r);
    run.walk(0, r.total - 3.5);
    expect(run.count("arrive")).toBe(0);
    run.walk(r.total - 3.5, r.total);
    expect(run.count("arrive")).toBe(1);
    const last = pointAt(r, r.total - 2.9);
    expect(r.total - 2.9 + 3).toBeGreaterThan(r.total);
    expect(last.floor).toBe(r.destFloor);
  });

  it("emits nothing after arrival", () => {
    const run = new Run(r);
    run.walk(0, r.total);
    const n = run.events.length;
    run.pose(pose(r.destFloor, 0, 0));
    expect(run.events).toHaveLength(n);
  });

  it("snapshot reports progress, next step, remaining distance and ETA", () => {
    const run = new Run(r);
    run.walk(0, 5);
    const snap = snapshot(run.state);
    expect(snap.s).toBeGreaterThan(4.5);
    expect(snap.total).toBeCloseTo(r.total, 6);
    expect(snap.remainingM).toBeLessThan(r.walkDist);
    expect(snap.etaSec).toBeLessThan(r.time);
    expect(snap.next.index).toBeGreaterThanOrEqual(0);
  });
});

describe("session: progress tracking", () => {
  const r = cafe();
  it("is monotonic under jitter and tiny backward steps", () => {
    const run = new Run(r);
    let last = 0;
    let seed = 11;
    const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647 - 0.5) * 2;
    for (let s = 0; s < 25; s += 0.15) {
      const pa = pointAt(r, s);
      run.pose(pose(pa.floor, pa.x + rnd() * 0.6, pa.y + rnd() * 0.6));
      expect(run.state.s).toBeGreaterThanOrEqual(last - 1e-9);
      last = run.state.s;
    }
    expect(run.count("offRoute")).toBe(0);
  });

  it("stale poses are ignored for progress and announcements", () => {
    const run = new Run(r);
    run.walk(0, 4);
    const s = run.state.s;
    const n = run.events.length;
    const pa = pointAt(r, 30);
    run.pose(pose(pa.floor, pa.x, pa.y, { stale: true }));
    expect(run.state.s).toBe(s);
    expect(run.events).toHaveLength(n);
  });

  it("accepts a forward jump along the route (e.g. a marker scan ahead)", () => {
    const run = new Run(r);
    const pa = pointAt(r, 10);
    run.pose(pose(pa.floor, pa.x, pa.y));
    expect(run.state.s).toBeGreaterThan(9);
    expect(run.count("offRoute")).toBe(0);
  });
});

describe("session: floor change (Reception -> Cafeteria on F2)", () => {
  const stairs = alternatives(V, from1, { room: "F2-cafeteria" }).options.find((o) => o.via === "stairs")!;
  const lift = alternatives(V, from1, { room: "F2-cafeteria" }).options.find((o) => o.via === "lift")!;

  for (const [name, r] of [["stairs", stairs], ["lift", lift]] as const) {
    it(`${name}: waits at the connector, prompts on the new floor, confirm by tap, then arrives`, () => {
      expect(r).toBeTruthy();
      const run = new Run(r);
      const vi = r.hops.findIndex((h) => h.type !== "walk");
      const vStart = r.cum[vi] as number;
      run.walk(0, vStart);
      expect(run.state.phase).toBe("vertical");
      expect(run.count("connector")).toBe(1);
      // Standing on the old floor while "in the lift": nothing happens, no off-route even after a long time.
      const a = r.points[vi]!;
      for (let i = 0; i < 100; i++) run.pose(pose(a.floor, a.x, a.y), 100);
      expect(run.count("offRoute")).toBe(0);
      expect(run.count("floorPrompt")).toBe(0);
      // Floor flips.
      const b = r.points[vi + 1]!;
      run.pose(pose(b.floor, b.x, b.y));
      expect(run.count("floorPrompt")).toBe(1);
      expect(run.state.floorPrompt).toEqual({ floor: b.floor });
      expect(run.state.s).toBeCloseTo(r.cum[vi + 1] as number, 6);
      run.feed({ type: "confirmFloor" });
      expect(run.state.floorPrompt).toBeNull();
      const conf = run.events.find((e) => e.type === "floorConfirmed");
      expect(conf && conf.type === "floorConfirmed" && conf.how).toBe("tap");
      run.walk(r.cum[vi + 1] as number, r.total);
      expect(run.count("arrive")).toBe(1);
      expect(run.count("offRoute")).toBe(0);
    });
  }

  it("a lobby marker on the new floor confirms the prompt", () => {
    const r = stairs;
    const run = new Run(r);
    const vi = r.hops.findIndex((h) => h.type !== "walk");
    run.walk(0, r.cum[vi] as number);
    const b = r.points[vi + 1]!;
    run.pose(pose(b.floor, b.x, b.y));
    expect(run.state.floorPrompt).not.toBeNull();
    const m = V.markers.find((x) => x.floor === b.floor && x.name.toLowerCase().includes("stairs"))!;
    const mp = poseFromMarker(m);
    run.pose(pose(mp.floor, mp.x, mp.y, { source: "marker", markerId: m.id, acc: 0.3 }));
    const conf = run.events.find((e) => e.type === "floorConfirmed");
    expect(conf && conf.type === "floorConfirmed" && conf.how).toBe("marker");
    expect(run.state.floorPrompt).toBeNull();
  });

  it("does not announce the stairs/lift manoeuvre more than once", () => {
    const run = new Run(stairs);
    run.walk(0, stairs.total);
    const vsteps = run.events.filter((e) => (e.type === "preannounce" || e.type === "turnNow") && e.step.kind === "vertical");
    const keys = vsteps.map((e) => e.type);
    expect(keys.filter((k) => k === "turnNow").length).toBeLessThanOrEqual(1);
    expect(keys.filter((k) => k === "preannounce").length).toBeLessThanOrEqual(1);
  });

  it("being on the wrong floor counts as off route (after 3 s)", () => {
    const run = new Run(stairs);
    run.walk(0, 3);
    run.pose(pose("F2", 20, 20));
    run.pose(pose("F2", 20, 20), 2800);
    expect(run.count("offRoute")).toBe(0);
    run.pose(pose("F2", 20, 20), 300);
    expect(run.count("offRoute")).toBe(1);
  });
});

describe("session: off route", () => {
  const r = cafe();
  const far = (run: Run) => {
    const pa = pointAt(r, 4);
    // 9 m off the corridor, on the same floor.
    return pose(pa.floor, pa.x, pa.y + (pa.y > 18 ? -9 : 9));
  };

  it("fires once after >5 m for 3 s of pose time, not before", () => {
    const run = new Run(r);
    run.walk(0, 4);
    const p = far(run);
    run.pose(p, 100);
    run.pose(p, 1400);
    run.pose(p, 1400); // 2.8 s off route
    expect(run.count("offRoute")).toBe(0);
    run.pose(p, 300); // 3.1 s
    expect(run.count("offRoute")).toBe(1);
    run.pose(p, 1000);
    run.pose(p, 1000);
    expect(run.count("offRoute")).toBe(1); // fires once per excursion
  });

  it("a short excursion (2 s) never fires", () => {
    const run = new Run(r);
    run.walk(0, 4);
    const p = far(run);
    for (let i = 0; i < 20; i++) run.pose(p, 100);
    const pa = pointAt(r, 4.2);
    run.pose(pose(pa.floor, pa.x, pa.y));
    for (let i = 0; i < 20; i++) run.pose(p, 100);
    expect(run.count("offRoute")).toBe(0);
  });

  it("stale poses do not count towards the timer", () => {
    const run = new Run(r);
    run.walk(0, 4);
    const p = far(run);
    run.pose(p, 100);
    run.pose({ ...p, stale: true }, 5000);
    run.pose(p, 100);
    run.pose(p, 2000);
    expect(run.count("offRoute")).toBe(0);
  });

  it("walking away within 5 m of the route is not off route", () => {
    const run = new Run(r);
    run.walk(0, 4);
    const pa = pointAt(r, 4);
    for (let i = 0; i < 80; i++) run.pose(pose(pa.floor, pa.x, pa.y + (pa.y > 18 ? -3 : 3)), 100);
    expect(run.count("offRoute")).toBe(0);
  });

  it("rebase resets progress, announcements and the timer", () => {
    const run = new Run(r);
    run.walk(0, 12);
    const p = far(run);
    run.pose(p, 100);
    run.pose(p, 3500);
    expect(run.count("offRoute")).toBe(1);
    const r2 = mustRoute(route(V, { floor: p.floor, x: p.x, y: p.y, heading: 0 }, { room: "F2-cafeteria" }));
    const before = run.count("start");
    run.feed({ type: "rebase", route: r2 });
    expect(run.count("start")).toBe(before + 1);
    expect(run.state.s).toBe(0);
    expect(run.state.offSince).toBeNull();
    expect(run.state.route).toBe(r2);
  });
});

describe("session: end to end", () => {
  it("Reception -> Cafeteria on F2, driven by a perfect walker incl. the floor change, ends in exactly one arrive", () => {
    for (const avoid of [{}, { avoidStairs: true }, { avoidLifts: true }]) {
      const r = cafe(avoid);
      const run = new Run(r);
      const vi = r.hops.findIndex((h) => h.type !== "walk");
      run.walk(0, r.cum[vi] as number);
      const b = r.points[vi + 1]!;
      run.pose(pose(b.floor, b.x, b.y));
      run.feed({ type: "confirmFloor" });
      run.walk(r.cum[vi + 1] as number, r.total);
      expect(run.count("arrive")).toBe(1);
      expect(run.count("offRoute")).toBe(0);
      expect(run.count("floorPrompt")).toBe(1);
      expect(run.state.phase).toBe("arrived");
    }
  });

  it("a zero-length route arrives immediately", () => {
    const r = mustRoute(route(V, { node: "F1-wsa" }, { room: "F1-wsa" }));
    const c = createSession(r);
    expect(c.events.map((e) => e.type)).toEqual(["start", "arrive"]);
    expect(c.state.phase).toBe("arrived");
  });
});
