import type { Venue } from "@/core/schema";
import type { PoseDebug } from "@/navigator/poseSource";
import { arSupported, blockXrSelect, startAr, type ArFrameCtx, type ArHandle } from "@/spikes/ar";
import { detectMarkers } from "@/spikes/aruco/detect";
import { intrinsicsFromProjection } from "@/spikes/aruco/pose";
import { CameraReader } from "@/spikes/camera";
import { LivePoseBase } from "./liveBase";
import { XrPoseCore } from "./xrCore";

/** Camera readback is expensive; 250 ms = 4 Hz, inside the Phase 4 target of 3–5 Hz. */
const DETECT_INTERVAL_MS = 250;
export type XrSceneFrameListener = (ctx: ArFrameCtx, handle: ArHandle, mapPointToXr: (p: { x: number; y: number; z: number }) => [number, number, number] | null) => void;

/**
 * Primary live source: an immersive-ar session with the nav UI as its DOM overlay. ARCore tracking drives the dot between markers;
 * marker detection on the camera image (camera-access) aligns the XR frame to the map: mapPose = markerTransform x xrPose.
 * All the maths lives in XrPoseCore; this class is only the browser glue and cannot run without a phone.
 */
export class XrPoseSource extends LivePoseBase {
  readonly kind = "xr" as const;
  private core: XrPoseCore;
  private handle: ArHandle | null = null;
  private reader: CameraReader | null = null;
  private frames = 0;
  private lastDetectMs = -Infinity;
  private flipY = false;
  private miss = 0;
  private fps = 0;
  private fpsT = 0;
  private fpsN = 0;
  private lastError: string | null = null;
  private onEnd: (() => void) | null = null;
  private readonly sceneListeners = new Set<XrSceneFrameListener>();

  constructor(
    venue: Venue,
    private readonly overlay: () => HTMLElement | null,
  ) {
    super(venue);
    this.core = new XrPoseCore(venue);
  }

  static supported(): Promise<boolean> {
    return arSupported();
  }

  get active(): boolean {
    return this.handle !== null;
  }
  get error(): string | null {
    return this.lastError;
  }

  /** Must be called from a tap. Resolves when the AR session is running, rejects (with a readable message) if it cannot start. */
  async startAr(onEnd?: () => void): Promise<void> {
    if (this.handle) return;
    const root = this.overlay();
    if (!root) throw new Error("no overlay element");
    this.onEnd = onEnd ?? null;
    this.lastError = null;
    try {
      this.handle = await startAr({
        overlay: root,
        optionalFeatures: ["camera-access", "dom-overlay", "plane-detection"],
        onFrame: (ctx, h) => this.onFrame(ctx, h),
        onEnd: () => {
          this.handle = null;
          this.reader = null;
          this.onEnd?.();
        },
      });
      blockXrSelect(root);
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }

  stopAr(): void {
    void this.handle?.stop();
  }

  /** Attach Phase 4 content to this source's existing immersive session. */
  onSceneFrame(fn: XrSceneFrameListener): () => void {
    this.sceneListeners.add(fn);
    return () => this.sceneListeners.delete(fn);
  }

  private onFrame(ctx: ArFrameCtx, h: ArHandle): void {
    const tSec = ctx.time / 1000;
    this.frames++;
    this.fpsN++;
    if (tSec - this.fpsT >= 1) {
      this.fps = this.fpsN / (tSec - this.fpsT);
      this.fpsN = 0;
      this.fpsT = tSec;
    }
    const view = ctx.viewerPose?.views[0];
    const tracking = ctx.tracking === "tracking" || ctx.tracking === "limited" ? ctx.tracking : "lost";
    this.core.frame(tSec, tracking, view ? view.transform.matrix : null);
    if (view && tracking !== "lost" && ctx.time - this.lastDetectMs >= DETECT_INTERVAL_MS && view.camera) {
      this.lastDetectMs = ctx.time;
      try {
        this.reader ??= new CameraReader(h.renderer.getContext() as WebGL2RenderingContext, h.session);
        this.reader.flipY = this.flipY;
        const got = this.reader.read(view);
        h.renderer.resetState();
        if (got) {
          const K = intrinsicsFromProjection(view.projectionMatrix, got.image.width, got.image.height);
          const dets = detectMarkers(got.image);
          if (dets.length === 0) {
            // Some UAs deliver the camera texture upside down: while nothing is ever found, alternate the readback orientation.
            this.miss++;
            if (this.miss % 90 === 0 && !this.core.aligned) this.flipY = !this.flipY;
          } else {
            this.miss = 0;
            for (const d of dets) this.core.marker(d, K, view.transform.matrix);
          }
        }
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e);
      }
    }
    for (const fn of this.sceneListeners) fn(ctx, h, (p) => this.core.mapPointToXr(p));
  }

  tick(dtSec: number): void {
    if (!this.running) return;
    const p = this.core.tick(dtSec);
    if (p) this.emit(p);
  }

  protected override venueChanged(v: Venue): void {
    this.core.setVenue(v);
  }

  applyFix(p: { floor: string; x: number; y: number; heading: number; acc: number; markerId: number | null }): void {
    this.core.anchorManual(p);
  }

  forceFloor(floor: string): void {
    this.core.forceFloor(floor);
  }

  getDebug(): PoseDebug {
    const d = this.core.debug();
    return { kind: "xr", tracking: d.tracking, reprojPx: d.reprojPx, obliqueDeg: d.obliqueDeg, reject: d.reject ?? this.lastError, anchorAgeSec: d.anchorAgeSec, cloud: [], detections: d.detections, fps: this.fps };
  }
}
