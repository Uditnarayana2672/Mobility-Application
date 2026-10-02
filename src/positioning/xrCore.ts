import type { Venue } from "@/core/schema";
import type { Pose } from "@/navigator/poseSource";
import type { Detection } from "@/spikes/aruco/detect";
import type { Intrinsics } from "@/spikes/aruco/pose";
import { PoseSmoother, type PlanePose } from "./corrector";
import { alignmentFromMarker, DEFAULT_GATE, devicePoseFromMarker, floorElevation, splitMatrix4, xrDevicePose, type MarkerGate, type XrAlignment } from "./markers";
import { col, DEG, mulV, rotZ, scale, sub, type V3 } from "./math";

export type XrTracking = "tracking" | "limited" | "lost";

export interface XrCoreOptions {
  /** Vertical distance from the anchor floor that proposes a floor change (m). */
  floorChangeM: number;
  /** Eye height above the floor when the phone is held to navigate (m). */
  eyeHeightM: number;
  /** Accuracy growth per metre walked since the last anchor. */
  driftPerM: number;
  maxAcc: number;
  /** Re-emit the same marker as a "scan" event at most this often (s). */
  rescanSec: number;
  gate: MarkerGate;
}
export const DEFAULT_XR: XrCoreOptions = { floorChangeM: 2.5, eyeHeightM: 1.35, driftPerM: 0.03, maxAcc: 3, rescanSec: 3, gate: DEFAULT_GATE };

export interface XrDebug {
  tracking: XrTracking;
  reprojPx: number | null;
  obliqueDeg: number | null;
  reject: string | null;
  anchorAgeSec: number | null;
  detections: number;
}

/**
 * The AR positioning brain, with no WebXR or DOM in it so it can be tested with synthetic matrices.
 *   mapPose = markerTransform x xrPose  (alignment = yaw + translation fixed by a marker sighting; see markers.ts)
 * The browser wrapper feeds it one `frame()` per XR frame (tracking state + camera-to-local matrix) and calls `marker()` when the
 * camera image contained a marker. `tick(dt)` returns the pose to publish (smoothed; marker fixes snap if > 1.5 m, otherwise ease 0.5 s).
 */
export class XrPoseCore {
  private al: XrAlignment | null = null;
  private view: ArrayLike<number> | null = null;
  private tracking: XrTracking = "lost";
  private t = 0;
  private anchorAcc = 0.3;
  private anchorT = 0;
  private walked = 0;
  private lastXY: { x: number; y: number; floor: string } | null = null;
  private raw: PlanePose | null = null;
  private lostSince: number | null = null;
  private heldRaw: PlanePose | null = null;
  private lastMarkerId: number | null = null;
  private pendingScan: number | null = null;
  private lastScanAt = new Map<number, number>();
  private smoother = new PoseSmoother();
  private lastReject: string | null = null;
  private lastReproj: number | null = null;
  private lastOblique: number | null = null;
  private detections = 0;

  constructor(
    private venue: Venue,
    private readonly opts: XrCoreOptions = DEFAULT_XR,
  ) {}

  /** A newer published venue: markers / floors may have moved. The current alignment stays (it was solved against the old map). */
  setVenue(v: Venue): void {
    this.venue = v;
  }

  get aligned(): boolean {
    return this.al !== null;
  }

  /** One XR frame: `viewToRef` is the view's camera-to-local matrix (column-major 4x4); null when the pose is unavailable. */
  frame(tSec: number, tracking: XrTracking, viewToRef: ArrayLike<number> | null): void {
    this.t = tSec;
    if (tracking === "lost" || !viewToRef) {
      if (this.lostSince === null) {
        this.lostSince = tSec;
        this.heldRaw = this.raw;
      }
      this.tracking = "lost";
      return;
    }
    if (this.lostSince !== null) this.lostSince = null;
    this.tracking = tracking;
    this.view = viewToRef;
    if (this.al) this.updateRaw();
  }

  private rawFrom(al: XrAlignment, view: ArrayLike<number>): PlanePose & { up: number } {
    const d = xrDevicePose(al, view);
    return { floor: this.floorFor(al, d.up), x: d.x, y: d.y, heading: d.heading, up: d.up };
  }

  /** Floor from height: stay on the anchor floor until the phone is > floorChangeM above/below it, then take the nearest floor. */
  private floorFor(al: XrAlignment, up: number): string {
    const rel = up - this.opts.eyeHeightM - al.floorElevation;
    if (Math.abs(rel) <= this.opts.floorChangeM) return al.floor;
    let best = al.floor;
    let bd = Infinity;
    for (const f of this.venue.floors) {
      const d = Math.abs(up - this.opts.eyeHeightM - f.elevation);
      if (d < bd) {
        bd = d;
        best = f.id;
      }
    }
    return best;
  }

  private updateRaw(): void {
    if (!this.al || !this.view) return;
    const r = this.rawFrom(this.al, this.view);
    if (this.lastXY && this.lastXY.floor === r.floor) this.walked += Math.min(3, Math.hypot(r.x - this.lastXY.x, r.y - this.lastXY.y));
    this.lastXY = { x: r.x, y: r.y, floor: r.floor };
    this.raw = { floor: r.floor, x: r.x, y: r.y, heading: r.heading };
  }

  /**
   * A marker was detected in the camera image of the view `viewToRef`. Returns whether it was accepted as an anchor.
   * Accepted when it passes the gate and is at least as accurate as the current dead-reckoned estimate (or we have no alignment / tracking was lost).
   */
  marker(det: Detection, K: Intrinsics, viewToRef: ArrayLike<number>): boolean {
    this.detections++;
    const res = devicePoseFromMarker(this.venue, det, K, this.opts.gate);
    if (!res.ok) {
      this.lastReject = res.reason;
      this.lastReproj = res.reprojPx ?? null;
      this.lastOblique = res.obliqueDeg ?? null;
      return false;
    }
    const fix = res.fix;
    this.lastReject = null;
    this.lastReproj = fix.reprojPx;
    this.lastOblique = fix.obliqueDeg;
    if (this.al && this.tracking !== "lost" && fix.acc > this.currentAcc()) return false;

    const m = this.venue.markers.find((x) => x.id === fix.markerId)!;
    this.view = viewToRef;
    const before = this.raw;
    this.al = alignmentFromMarker(this.venue, m, viewToRef, fix.markerPose);
    this.lostSince = null;
    this.heldRaw = null;
    this.tracking = this.tracking === "lost" ? "tracking" : this.tracking;
    this.updateRaw();
    const after = this.raw!;
    // The marker is authoritative for the floor.
    after.floor = m.floor;
    this.raw = after;
    if (before) this.smoother.correct(before, after);
    this.anchorAcc = fix.acc;
    this.anchorT = this.t;
    this.walked = 0;
    this.lastMarkerId = fix.markerId;
    const last = this.lastScanAt.get(fix.markerId) ?? -1e9;
    if (this.t - last >= this.opts.rescanSec) {
      this.pendingScan = fix.markerId;
      this.lastScanAt.set(fix.markerId, this.t);
    }
    return true;
  }

  private currentAcc(): number {
    return Math.min(Math.max(this.opts.maxAcc, this.anchorAcc), this.anchorAcc + this.opts.driftPerM * this.walked);
  }

  /** A hand-set position ("I can't find a marker", +-4 m): align the XR frame so the phone is here, facing `heading`. Needs one tracked frame. */
  anchorManual(a: { floor: string; x: number; y: number; heading: number; acc: number }): boolean {
    if (!this.view || this.tracking === "lost") return false;
    const { R, t } = splitMatrix4(this.view);
    const fwd = scale(col(R, 2), -1);
    const sw = (p: V3): V3 => [p[0], -p[2], p[1]];
    const f = sw(fwd);
    const phiXr = Math.atan2(f[1], f[0]);
    const phiW = Math.PI / 2 - a.heading * DEG;
    const theta = phiW - phiXr;
    const wanted: V3 = [a.x, -a.y, floorElevation(this.venue, a.floor) + this.opts.eyeHeightM];
    const tau = sub(wanted, mulV(rotZ(theta), sw(t)));
    const before = this.raw;
    this.al = { theta, tau, floor: a.floor, floorElevation: floorElevation(this.venue, a.floor), markerId: -1 };
    this.lostSince = null;
    this.updateRaw();
    if (before && this.raw) this.smoother.correct(before, this.raw);
    this.anchorAcc = a.acc;
    this.anchorT = this.t;
    this.walked = 0;
    this.lastMarkerId = null;
    return true;
  }

  /** The visitor said "yes, I'm on `floor`": shift the vertical alignment so the current height reads as that floor. */
  forceFloor(floor: string): void {
    if (!this.al || !this.view) return;
    const target = floorElevation(this.venue, floor);
    const d = xrDevicePose(this.al, this.view);
    const dz = target + this.opts.eyeHeightM - d.up;
    this.al = { ...this.al, tau: [this.al.tau[0], this.al.tau[1], this.al.tau[2] + dz], floor, floorElevation: target };
    this.updateRaw();
    if (this.raw) this.smoother.correct(this.raw, this.raw);
  }

  /** Smoothed pose to publish, or null before the first marker. */
  tick(dtSec: number): Pose | null {
    const r = this.lostSince !== null ? this.heldRaw ?? this.raw : this.raw;
    if (!this.al || !r) return null;
    const d = this.smoother.update(r, dtSec);
    const lost = this.lostSince !== null;
    const lostFor = lost ? Math.max(0, this.t - this.lostSince!) : 0;
    let acc = this.currentAcc();
    if (this.tracking === "limited") acc = Math.min(this.opts.maxAcc * 1.5, acc * 1.5);
    if (lost) acc = Math.min(6, acc + 0.8 * lostFor);
    const scan = this.pendingScan;
    this.pendingScan = null;
    return {
      floor: d.floor,
      x: d.x,
      y: d.y,
      heading: d.heading,
      acc: scan !== null ? Math.max(0.25, this.anchorAcc) : acc,
      stale: lost,
      markerId: scan !== null ? scan : this.lastMarkerId,
      source: scan !== null ? "marker" : "ar",
    };
  }

  debug(): XrDebug {
    return { tracking: this.tracking, reprojPx: this.lastReproj, obliqueDeg: this.lastOblique, reject: this.lastReject, anchorAgeSec: this.al ? this.t - this.anchorT : null, detections: this.detections };
  }
}
