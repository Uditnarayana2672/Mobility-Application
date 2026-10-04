/** Where a pose came from: sim = laptop simulator, marker = a marker fix, ar = WebXR tracking, steps = step counting + particle filter, vision = recognised by what the camera sees. */
export type PoseOrigin = "sim" | "marker" | "manual" | "ar" | "steps" | "vision";

/** One position estimate in the venue frame (metres; heading = bearing, 0 = north, clockwise). */
export interface Pose {
  floor: string;
  x: number;
  y: number;
  heading: number;
  /** Accuracy radius in metres. */
  acc: number;
  /** Tracking lost: the position is the last known one. */
  stale: boolean;
  /** ArUco id of the marker that produced / last anchored this pose, if any. */
  markerId: number | null;
  source: PoseOrigin;
}

export type PoseListener = (pose: Pose) => void;

/** Anything that can produce poses: the laptop simulator now, ARCore + markers / step counting in Phase 3. */
export interface PoseSource {
  start(): void;
  stop(): void;
  subscribe(fn: PoseListener): () => void;
}

/** Which implementation is producing poses. */
export type PoseKind = "sim" | "xr" | "pdr";

/** What the phone debug overlay (?debug=1) shows; every field is optional so each source fills what it has. */
export interface PoseDebug {
  kind: PoseKind;
  tracking: string;
  reprojPx: number | null;
  obliqueDeg: number | null;
  /** Why the last detection was rejected, or null. */
  reject: string | null;
  /** Seconds since the last accepted marker fix. */
  anchorAgeSec: number | null;
  /** Particle cloud in venue metres (PDR). */
  cloud: { floor: string; x: number; y: number }[];
  detections: number;
  /** Frames per second of the positioning loop (XR frames / sensor batches). */
  fps: number;
  /** Place recognition status (state and last similarity), when the source has it. */
  vision?: string;
}

/** Status shown in the demo panel; live sources report a trivial one. */
export interface SourceStatus {
  mode: "auto" | "manual";
  playing: boolean;
  speed: 1 | 3;
  trans: { via: "stairs" | "lift"; fromFloor: string; toFloor: string; t: number; dur: number } | null;
  held: boolean;
  lostFor: number;
}

/**
 * What NavController needs from a pose source. The simulator implements all of it; the live sources (XR, PDR) implement the
 * demo-only controls as no-ops. Poses reach the controller through subscribe(); time through tick().
 */
export interface ControllerPoseSource extends PoseSource {
  readonly kind: PoseKind;
  tick(dtSec: number): void;
  getStatus(): SourceStatus;
  onStatus(fn: () => void): () => void;
  scan(markerId: number): boolean;
  anchor(markerId: number): void;
  teleport(p: Partial<Pose> & { floor: string; x: number; y: number }): void;
  hold(on: boolean): void;
  setRoute(route: import("@/core/route").Route | null): void;
  setProgress(s: number): void;
  pause(): void;
  wrongTurn(): boolean;
  loseTracking(sec?: number): void;
  /** Live sources only. The session reached a lift/stairs: continue on `toFloor` at (x, y). */
  onConnector?(toFloor: string, x: number, y: number): void;
  /** Live (step counting) source only. The visitor faces this map heading: the gyro takes it and the compass learns the map's north. */
  alignHeading?(mapHeadingDeg: number): void;
  /** Live sources only. The visitor confirmed they are on `floor`. */
  forceFloor?(floor: string): void;
  /** A newer published venue replaces the one the source was built with. */
  setVenue?(venue: import("@/core/schema").Venue): void;
  getDebug?(): PoseDebug;
}
