/** Where a pose came from. 'ar' and 'steps' arrive in Phase 3. */
export type PoseOrigin = "sim" | "marker" | "manual" | "ar" | "steps";

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
