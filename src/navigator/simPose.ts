import { WALK, distToSegment } from "@/core/geo";
import { pointAt } from "@/core/playback";
import type { Route } from "@/core/route";
import type { Venue } from "@/core/schema";
import { poseFromMarker } from "@/core/poseFromMarker";
import { bearingDelta, bearingToVector, normaliseBearing } from "@/shared/frame";
import type { Pose, PoseListener, PoseSource } from "./poseSource";
import { snapToRoute } from "./session";

export type SimMode = "auto" | "manual";
export type SimSpeed = 1 | 3;

export interface SimTransition {
  via: "stairs" | "lift";
  fromFloor: string;
  toFloor: string;
  /** Seconds elapsed / total (sim time, already speed-scaled). */
  t: number;
  dur: number;
}

export interface SimStatus {
  mode: SimMode;
  playing: boolean;
  speed: SimSpeed;
  trans: SimTransition | null;
  /** Held by the controller (floor prompt showing) or by a detour waiting for a reroute. */
  held: boolean;
  /** Tracking lost for this many more seconds (0 = fine). */
  lostFor: number;
}

export interface ManualInput {
  fwd: number;
  strafe: number;
  turn: number;
}

/** Base durations of a floor change at 1x speed (s), as in the mock. */
const LIFT_SEC = 6;
const STAIRS_SEC = 4.8;
const TURN_DEG_PER_SEC = 100;

/**
 * Laptop simulator: a virtual walker producing the same Pose stream the real sensors will in Phase 3.
 * All time comes in through tick(dtSec), so it is deterministic and unit-testable; the browser drives it from ticker.ts.
 */
export class SimPoseSource implements PoseSource {
  private readonly listeners = new Set<PoseListener>();
  private running = false;
  private pose: Pose;
  private route: Route | null = null;
  private s = 0;
  private mode: SimMode = "auto";
  private playing = true;
  private speed: SimSpeed = 1;
  private trans: SimTransition | null = null;
  private held = false;
  private detour = false;
  private lostFor = 0;
  private sinceMarker = 0;
  private input: ManualInput = { fwd: 0, strafe: 0, turn: 0 };
  private statusListeners = new Set<() => void>();

  constructor(private readonly venue: Venue, start?: Pose) {
    const m = venue.markers[0];
    const p = m ? poseFromMarker(m) : { floor: venue.floors[0]!.id, x: 1, y: 1, heading: 0 };
    this.pose = start ?? { ...p, acc: 0.3, stale: false, markerId: m ? m.id : null, source: "marker" };
  }

  /* ---- PoseSource ---- */
  start(): void {
    this.running = true;
    this.emit();
  }
  stop(): void {
    this.running = false;
  }
  subscribe(fn: PoseListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /* ---- state for the UI ---- */
  getPose(): Pose {
    return this.pose;
  }
  getStatus(): SimStatus {
    return { mode: this.mode, playing: this.playing, speed: this.speed, trans: this.trans, held: this.held || this.detour, lostFor: this.lostFor };
  }
  onStatus(fn: () => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /* ---- controls ---- */
  /** Walk this route from its start (the walker stands at the route start). Null stops auto-walking. */
  setRoute(route: Route | null): void {
    this.route = route;
    this.s = 0;
    this.trans = null;
    this.detour = false;
    this.changed();
  }
  /** Put the walker on a route at progress s (deep links, demo "next turn"). */
  setProgress(s: number): void {
    if (!this.route) return;
    this.s = Math.max(0, Math.min(this.route.total, s));
    const pa = pointAt(this.route, this.s);
    this.pose = { ...this.pose, floor: pa.floor, x: pa.x, y: pa.y, heading: this.s > 0.3 ? pa.bearing : this.pose.heading, source: "sim" };
    this.emit();
  }
  getProgress(): number {
    return this.s;
  }
  play(): void {
    this.playing = true;
    this.changed();
  }
  pause(): void {
    this.playing = false;
    this.changed();
  }
  togglePlay(): boolean {
    this.playing = !this.playing;
    this.changed();
    return this.playing;
  }
  setSpeed(speed: SimSpeed): void {
    this.speed = speed;
    this.changed();
  }
  setMode(mode: SimMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.input = { fwd: 0, strafe: 0, turn: 0 };
    if (mode === "auto" && this.route) {
      // Re-join the route at the nearest point (if the walker wandered off, auto-walk resumes from there).
      const snap = snapToRoute(this.route, this.pose.floor, this.pose.x, this.pose.y);
      if (snap) this.s = snap.s;
    }
    this.changed();
  }
  /** The controller holds the walker while a floor prompt is showing; release when confirmed. */
  hold(on: boolean): void {
    this.held = on;
    this.changed();
  }
  setManualInput(i: Partial<ManualInput>): void {
    this.input = { ...this.input, ...i };
  }
  /** Simulated marker scan: snap to the pose in front of the marker, accuracy 0.3 m. */
  scan(markerId: number): boolean {
    const m = this.venue.markers.find((x) => x.id === markerId);
    if (!m) return false;
    const p = poseFromMarker(m);
    this.pose = { ...p, acc: 0.3, stale: false, markerId: m.id, source: "marker" };
    this.sinceMarker = 0;
    this.lostFor = 0;
    // Keep auto-walking consistent: re-join the route at the nearest point.
    if (this.route && this.mode === "auto" && !this.trans) {
      const snap = snapToRoute(this.route, p.floor, p.x, p.y);
      if (snap && snap.d < 5) this.s = Math.max(this.s, snap.s);
    }
    this.emit();
    this.pose = { ...this.pose, source: this.mode === "manual" ? "manual" : "sim" };
    this.changed();
    return true;
  }
  /** A marker comes into view where the walker already is: confirms the floor and resets accuracy without moving the dot. */
  anchor(markerId: number): void {
    this.pose = { ...this.pose, acc: 0.3, stale: false, markerId, source: "marker" };
    this.sinceMarker = 0;
    this.lostFor = 0;
    this.emit();
    this.pose = { ...this.pose, source: this.mode === "manual" ? "manual" : "sim" };
  }
  /** Put the walker somewhere (manual picker "I can't find a marker", tests). */
  teleport(p: Partial<Pose> & { floor: string; x: number; y: number }): void {
    this.pose = { ...this.pose, heading: this.pose.heading, acc: 4, stale: false, source: "manual", ...p };
    this.sinceMarker = 30;
    this.emit();
  }
  loseTracking(sec = 5): void {
    this.lostFor = sec;
    this.changed();
  }
  /** Demo: walk the wrong way, to a corridor point more than 6 m from the route; auto-walk holds until a reroute (setRoute). */
  wrongTurn(): boolean {
    const route = this.route;
    if (!route || this.trans) return false;
    const { floor, x, y } = this.pose;
    const offRoute = (px: number, py: number): number => {
      let best = Infinity;
      for (let i = 0; i < route.hops.length; i++) {
        if (route.hops[i]!.type !== "walk" || route.points[i]!.floor !== floor) continue;
        best = Math.min(best, distToSegment({ x: px, y: py }, route.points[i]!, route.points[i + 1]!));
      }
      return best;
    };
    const cands = this.venue.nodes.filter((n) => n.floor === floor && n.kind === "corridor" && offRoute(n.x, n.y) > 6.5);
    cands.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
    const target = cands[0];
    if (!target) return false;
    this.pose = { ...this.pose, x: target.x, y: target.y, heading: normaliseBearing((Math.atan2(target.x - x, -(target.y - y)) * 180) / Math.PI), acc: 2.4, source: "sim" };
    this.sinceMarker = 30;
    this.detour = true;
    this.emit();
    this.changed();
    return true;
  }

  /* ---- time ---- */
  tick(dtSec: number): void {
    if (!this.running || dtSec <= 0) return;
    const dt = Math.min(dtSec, 1.5);
    const lost = this.lostFor > 0;
    if (lost) this.lostFor = Math.max(0, this.lostFor - dt);
    let moved = 0;

    if (this.trans) {
      this.trans = { ...this.trans, t: this.trans.t + dt };
      if (this.trans.t >= this.trans.dur) this.finishTransition();
      this.changed();
    } else if (this.mode === "manual") {
      moved = this.manualStep(dt);
    } else if (this.route && this.playing && !this.held && !this.detour) {
      moved = this.autoStep(dt);
    }

    this.sinceMarker += moved;
    const acc = this.lostFor > 0 || lost ? Math.min(6, this.pose.acc + dt * 0.8) : Math.min(3.2, Math.max(0.3, 0.3 + 0.05 * this.sinceMarker));
    this.pose = { ...this.pose, acc, stale: this.lostFor > 0 };
    this.emit();
  }

  private autoStep(dt: number): number {
    const route = this.route as Route;
    const adv = WALK * this.speed * dt;
    const before = this.s;
    this.s = Math.min(route.total, this.s + adv);
    const pa = pointAt(route, this.s);
    if (pa.vertical) {
      const hop = route.hops[pa.hop]!;
      const base = hop.type === "lift" ? LIFT_SEC : STAIRS_SEC;
      this.s = route.cum[pa.hop] as number;
      const from = route.points[pa.hop]!;
      this.pose = { ...this.pose, floor: from.floor, x: from.x, y: from.y };
      this.trans = { via: hop.type === "lift" ? "lift" : "stairs", fromFloor: from.floor, toFloor: route.points[pa.hop + 1]!.floor, t: 0, dur: base / this.speed };
      this.changed();
      return this.s - before;
    }
    const heading = normaliseBearing(this.pose.heading + bearingDelta(pa.bearing, this.pose.heading) * Math.min(1, dt * 7));
    this.pose = { ...this.pose, floor: pa.floor, x: pa.x, y: pa.y, heading, source: "sim" };
    return this.s - before;
  }

  private finishTransition(): void {
    const route = this.route;
    const tr = this.trans as SimTransition;
    this.trans = null;
    if (!route) return;
    let hop = route.hops.findIndex((h, i) => h.type !== "walk" && route.points[i]!.floor === tr.fromFloor && route.points[i + 1]!.floor === tr.toFloor && (route.cum[i] as number) >= this.s - 1e-6);
    if (hop < 0) hop = route.hops.findIndex((h) => h.type !== "walk");
    this.s = (route.cum[hop + 1] as number) + 0.01;
    const pa = pointAt(route, this.s);
    this.pose = { ...this.pose, floor: pa.floor, x: pa.x, y: pa.y, heading: pa.bearing, acc: Math.max(this.pose.acc, 1.4), source: "sim" };
    this.sinceMarker = 22; // floors cannot be sensed: ~1.4 m accuracy until a marker is seen
  }

  private manualStep(dt: number): number {
    const { fwd, strafe, turn } = this.input;
    let heading = this.pose.heading;
    if (turn) heading = normaliseBearing(heading + turn * TURN_DEG_PER_SEC * dt);
    const len = WALK * this.speed * dt;
    const f = bearingToVector(heading);
    const r = bearingToVector(heading + 90);
    let dx = (f.x * fwd + r.x * strafe) * len;
    let dy = (f.y * fwd + r.y * strafe) * len;
    const fl = this.venue.floors.find((x) => x.id === this.pose.floor);
    let x = this.pose.x + dx;
    let y = this.pose.y + dy;
    if (fl) {
      x = Math.max(0, Math.min(fl.w, x));
      y = Math.max(0, Math.min(fl.h, y));
    }
    dx = x - this.pose.x;
    dy = y - this.pose.y;
    this.pose = { ...this.pose, x, y, heading, source: "manual" };
    return Math.hypot(dx, dy);
  }

  private emit(): void {
    if (!this.running) return;
    for (const fn of [...this.listeners]) {
      try {
        fn(this.pose);
      } catch (err) {
        console.error("pose listener failed", err);
      }
    }
  }

  private changed(): void {
    for (const fn of [...this.statusListeners]) fn();
  }
}
