import type { Route } from "@/core/route";
import { poseFromMarker } from "@/core/poseFromMarker";
import type { Venue } from "@/core/schema";
import type { ControllerPoseSource, Pose, PoseDebug, PoseKind, PoseListener, SourceStatus } from "@/navigator/poseSource";

/**
 * Shared plumbing for the live pose sources (XR, PDR): listeners, a trivial status, and the demo-only controls as no-ops.
 * A marker "tapped" on screen (the demo chips, "Fix position") falls back to the heuristic pose in front of the marker.
 */
export abstract class LivePoseBase implements ControllerPoseSource {
  abstract readonly kind: PoseKind;
  protected readonly listeners = new Set<PoseListener>();
  private readonly statusListeners = new Set<() => void>();
  protected running = false;
  protected status: SourceStatus = { mode: "auto", playing: true, speed: 1, trans: null, held: false, lostFor: 0 };

  constructor(protected venue: Venue) {}

  setVenue(v: Venue): void {
    this.venue = v;
    this.venueChanged(v);
  }
  protected venueChanged(_v: Venue): void {}

  start(): void {
    this.running = true;
  }
  stop(): void {
    this.running = false;
  }
  subscribe(fn: PoseListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  protected emit(p: Pose): void {
    for (const fn of [...this.listeners]) fn(p);
  }
  getStatus(): SourceStatus {
    return this.status;
  }
  onStatus(fn: () => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }
  protected setStatus(p: Partial<SourceStatus>): void {
    this.status = { ...this.status, ...p };
    for (const fn of [...this.statusListeners]) fn();
  }

  abstract tick(dtSec: number): void;

  /** Hand-set position from a marker chip: acts like a (coarse) fix. Real scans come from the camera. */
  abstract applyFix(p: { floor: string; x: number; y: number; heading: number; acc: number; markerId: number | null }): void;

  scan(markerId: number): boolean {
    const m = this.venue.markers.find((x) => x.id === markerId);
    if (!m) return false;
    const p = poseFromMarker(m);
    this.applyFix({ ...p, acc: 1, markerId: m.id });
    return true;
  }
  anchor(markerId: number): void {
    this.scan(markerId);
  }
  teleport(p: Partial<Pose> & { floor: string; x: number; y: number }): void {
    this.applyFix({ floor: p.floor, x: p.x, y: p.y, heading: p.heading ?? 0, acc: p.acc ?? 4, markerId: null });
  }
  hold(_on: boolean): void {}
  setRoute(_route: Route | null): void {}
  setProgress(_s: number): void {}
  pause(): void {}
  wrongTurn(): boolean {
    return false;
  }
  loseTracking(_sec?: number): void {}
  getDebug?(): PoseDebug;
}
