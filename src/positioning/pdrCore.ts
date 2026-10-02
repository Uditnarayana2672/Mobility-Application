import type { Venue } from "@/core/schema";
import { HeadingIntegrator, type RotationRate } from "@/core/heading";
import { StepDetector } from "@/core/steps";
import type { Pose } from "@/navigator/poseSource";
import { PoseSmoother, type PlanePose } from "./corrector";
import { ParticleFilter, seededRandom, walkableFromVenue, type Walkable } from "./particleFilter";

export interface PdrOptions {
  strideM: number;
  /** Particle count. */
  particles: number;
  rnd?: () => number;
}
export const DEFAULT_PDR = { strideM: 0.7, particles: 300 };

export interface MarkerAnchor {
  floor: string;
  x: number;
  y: number;
  heading: number;
  acc: number;
  markerId: number | null;
}

/**
 * Fallback positioning without WebXR: marker scan gives an absolute fix, then step detection + gyro heading drive a ~300-particle filter
 * constrained to corridors and room doors. No DOM, no sensors: the browser wrapper feeds devicemotion samples and marker fixes.
 */
export class PdrPoseCore {
  private readonly steps = new StepDetector();
  private readonly heading = new HeadingIntegrator(0);
  private readonly pf: ParticleFilter;
  private walk: Walkable;
  private readonly smoother = new PoseSmoother();
  private anchored = false;
  private held = false;
  private anchorAcc = 0.5;
  private anchorMarker: number | null = null;
  private stepsSince = 0;
  private pendingScan: number | null = null;
  private raw: PlanePose | null = null;
  private lastTMs = 0;
  private stride: number;

  constructor(
    venue: Venue,
    opts: Partial<PdrOptions> = {},
  ) {
    this.walk = walkableFromVenue(venue);
    this.pf = new ParticleFilter(this.walk, venue.floors[0]?.id ?? "", opts.rnd ?? Math.random, { count: opts.particles ?? DEFAULT_PDR.particles });
    this.stride = opts.strideM ?? DEFAULT_PDR.strideM;
  }

  setVenue(v: Venue): void {
    this.walk = walkableFromVenue(v);
    this.pf.setWalkable(this.walk);
  }

  get located(): boolean {
    return this.anchored;
  }
  get stepCount(): number {
    return this.stepsSince;
  }

  /** A marker fix (camera) or a manual position: re-seed the cloud and the gyro heading. */
  anchor(a: MarkerAnchor, silent = false): void {
    const before = this.raw;
    this.heading.reset(a.heading);
    this.pf.seed(a.floor, a.x, a.y, a.heading, Math.max(0.15, a.acc * 0.6));
    this.anchored = true;
    this.anchorAcc = a.acc;
    this.anchorMarker = a.markerId;
    this.stepsSince = 0;
    this.held = false;
    const after = { floor: a.floor, x: a.x, y: a.y, heading: a.heading };
    this.raw = after;
    if (before) this.smoother.correct(before, after);
    if (a.markerId !== null && !silent) this.pendingScan = a.markerId;
  }

  /** The route reached a lift/stairs; continue on `floor` at (x, y) and ignore steps until anchored/confirmed. */
  changeFloor(floor: string, x: number, y: number): void {
    if (!this.anchored) return;
    const heading = this.raw?.heading ?? 0;
    this.pf.moveToFloor(floor, x, y, 1.2);
    this.anchorAcc = 1.5;
    this.stepsSince = 0;
    const after = { floor, x, y, heading };
    if (this.raw) this.smoother.correct(this.raw, after);
    this.raw = after;
    this.held = true;
  }

  /** Release the hold after the floor prompt is answered. */
  release(): void {
    this.held = false;
  }

  /** One devicemotion sample (m/s^2 including gravity, deg/s) at time tMs. */
  motion(tMs: number, accel: [number, number, number], rate: RotationRate): void {
    this.lastTMs = tMs;
    this.heading.update(tMs, rate, accel);
    if (!this.anchored) return;
    if (this.steps.push(tMs, accel[0], accel[1], accel[2]) && !this.held) {
      this.stepsSince++;
      this.pf.step(this.stride, this.heading.bearing);
      const e = this.pf.estimate();
      this.raw = { floor: e.floor, x: e.x, y: e.y, heading: e.heading };
    } else if (this.raw) {
      // Between steps the displayed heading follows the gyro.
      this.raw = { ...this.raw, heading: this.pf.estimate().heading };
    }
  }

  /** Pose to publish (smoothed), or null until the first anchor. */
  tick(dtSec: number): Pose | null {
    if (!this.anchored || !this.raw) return null;
    const d = this.smoother.update(this.raw, dtSec);
    const scan = this.pendingScan;
    this.pendingScan = null;
    const acc = this.stepsSince === 0 ? this.anchorAcc : Math.max(this.anchorAcc, this.pf.estimate().acc);
    return { floor: d.floor, x: d.x, y: d.y, heading: d.heading, acc: scan !== null ? this.anchorAcc : acc, stale: false, markerId: scan !== null ? scan : this.anchorMarker, source: scan !== null ? "marker" : "steps" };
  }

  cloud(): { floor: string; x: number; y: number }[] {
    const floor = this.pf.currentFloor;
    return this.pf.cloud(150).map((p) => ({ floor, ...p }));
  }

  get lastSampleMs(): number {
    return this.lastTMs;
  }
}

export { seededRandom };
