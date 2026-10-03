import type { Venue } from "@/core/schema";
import type { Pose, PoseDebug } from "@/navigator/poseSource";
import { detectMarkers } from "@/spikes/aruco/detect";
import type { Intrinsics } from "@/spikes/aruco/pose";
import { LivePoseBase } from "./liveBase";
import { devicePoseFromMarker } from "./markers";
import { createBrowserEmbedder } from "@/vision/embedBrowser";
import { VprLocator, visionModeFromQuery } from "@/vision/VprLocator";
import { cameraCompassHeading } from "./compass";
import { PdrPoseCore } from "./pdrCore";

const HFOV_KEY = "indore.s2.hfov";
const SCAN_EVERY_MS = 130;
const RESCAN_MS = 3000;
const VISION_EVERY_MS = 1000;
const VISION_AFTER_MARKER_MS = 8000;
const VISION_MIN_CONFIDENCE = 0.5;
/** A recognised picture's heading replaces the gyro heading only when it is this close to it (otherwise the gyro is believed). */
const VISION_HEADING_TRUST_DEG = 35;

const hfov = (): number => {
  try {
    const v = Number(localStorage.getItem(HFOV_KEY));
    return v > 20 && v < 140 ? v : 65;
  } catch {
    return 65;
  }
};

const NORTH_KEY = (id: string) => `indore.northOffset.${id}`;
function readNorth(id: string): number | null {
  try {
    const v = Number(localStorage.getItem(NORTH_KEY(id)));
    return localStorage.getItem(NORTH_KEY(id)) !== null && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
function writeNorth(id: string, v: number): void {
  try {
    localStorage.setItem(NORTH_KEY(id), String(Math.round(v * 10) / 10));
  } catch {
    /* private mode */
  }
}

type MotionPermission = { requestPermission?: () => Promise<"granted" | "denied"> };

/**
 * Fallback live source without WebXR: a camera scan (getUserMedia) gives the absolute fix, then step detection + gyro heading drive the
 * particle filter. The maths is in PdrPoseCore; this class owns the camera, the devicemotion listener and the scan loop.
 */
export class PdrPoseSource extends LivePoseBase {
  readonly kind = "pdr" as const;
  private core: PdrPoseCore;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private scanTimer = 0;
  private canvas: HTMLCanvasElement | null = null;
  private motionOn = false;
  private lastScanAt = new Map<number, number>();
  private anchorAtMs: number | null = null;
  private lastReject: string | null = null;
  private lastReproj: number | null = null;
  private lastOblique: number | null = null;
  private detections = 0;
  private samples = 0;
  private fps = 0;
  private fpsT = 0;
  private lastError: string | null = null;
  private lastPose: Pose | null = null;
  private vpr: VprLocator | null = null;
  private visionTimer = 0;

  constructor(venue: Venue) {
    super(venue);
    this.core = new PdrPoseCore(venue);
    const saved = readNorth(venue.id);
    if (saved !== null) this.core.seedNorthOffset(saved);
  }

  get error(): string | null {
    return this.lastError;
  }

  override start(): void {
    super.start();
    void this.startSensors();
  }
  override stop(): void {
    super.stop();
    this.stopCamera();
    this.stopSensors();
  }

  /* ---- sensors ---- */
  private onMotion = (e: DeviceMotionEvent): void => {
    const a = e.accelerationIncludingGravity;
    const r = e.rotationRate;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    this.core.motion(performance.now(), [a.x, a.y, a.z], { alpha: r?.alpha ?? 0, beta: r?.beta ?? 0, gamma: r?.gamma ?? 0 });
    this.samples++;
    const now = performance.now() / 1000;
    if (now - this.fpsT >= 1) {
      this.fps = this.samples / (now - this.fpsT);
      this.samples = 0;
      this.fpsT = now;
    }
  };
  /** How far the camera looks below the horizon (deg): 0 = level, 90 = at the floor. Phone upright in portrait = beta 90. */
  private pitchDown = 6;
  get pitchDownDeg(): number {
    return this.pitchDown;
  }
  private onOrient = (e: DeviceOrientationEvent): void => {
    if (e.beta === null || e.beta === undefined) return;
    this.pitchDown = Math.max(-60, Math.min(90, 90 - e.beta));
  };
  /** Absolute orientation (Android Chrome): the way the camera faces on Earth. */
  private onCompass = (e: DeviceOrientationEvent): void => {
    if (!e.absolute || e.alpha === null || e.beta === null || e.gamma === null) return;
    const h = cameraCompassHeading(e.alpha, e.beta, e.gamma);
    if (h !== null) this.core.compass(h);
  };
  async startSensors(): Promise<void> {
    if (this.motionOn) return;
    try {
      const DME = (window as unknown as { DeviceMotionEvent?: MotionPermission }).DeviceMotionEvent;
      if (DME?.requestPermission) {
        const res = await DME.requestPermission();
        if (res !== "granted") throw new Error("motion permission denied");
      }
      window.addEventListener("deviceorientation", this.onOrient);
      window.addEventListener("deviceorientationabsolute", this.onCompass as EventListener);
      window.addEventListener("devicemotion", this.onMotion);
      this.motionOn = true;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
    }
  }
  private stopSensors(): void {
    window.removeEventListener("devicemotion", this.onMotion);
    window.removeEventListener("deviceorientation", this.onOrient);
    window.removeEventListener("deviceorientationabsolute", this.onCompass as EventListener);
    this.motionOn = false;
  }

  /* ---- camera scan ---- */
  /** Start the rear camera into `video` and look for markers until stopCamera(). Needs a tap (autoplay + permission). */
  async startCamera(video: HTMLVideoElement): Promise<void> {
    this.stopCamera();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      video.srcObject = this.stream;
      video.muted = true;
      video.setAttribute("playsinline", "true");
      await video.play();
      this.video = video;
      this.canvas = document.createElement("canvas");
      this.scanTimer = window.setInterval(() => this.scanOnce(), SCAN_EVERY_MS);
      // Place recognition: loads this venue's index (if it has one) and, if it is allowed, the image model, then looks once a second.
      if (!this.vpr) {
        const id = this.venue.id;
        this.vpr = new VprLocator(
          {
            fetchIndex: async () => {
              const r = await fetch(`/api/survey/${encodeURIComponent(id)}/index`, { cache: "no-store" });
              return r.ok ? await r.json() : null;
            },
            makeEmbedder: () => createBrowserEmbedder(),
          },
          visionModeFromQuery(typeof location === "undefined" ? "" : location.search),
        );
        void this.vpr.start();
      }
      this.visionTimer = window.setInterval(() => void this.visionOnce(), VISION_EVERY_MS);
      this.lastError = null;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }
  stopCamera(): void {
    if (this.scanTimer) window.clearInterval(this.scanTimer);
    this.scanTimer = 0;
    if (this.visionTimer) window.clearInterval(this.visionTimer);
    this.visionTimer = 0;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
  }
  get scanning(): boolean {
    return this.stream !== null;
  }

  /** One look with place recognition: what does the camera see, and where in the building is that? */
  private async visionOnce(): Promise<void> {
    const v = this.video;
    const vpr = this.vpr;
    if (!vpr?.ready || !v || v.videoWidth === 0) return;
    // A marker fix a moment ago is better than a guess from the picture.
    if (this.anchorAtMs !== null && performance.now() - this.anchorAtMs < VISION_AFTER_MARKER_MS) return;
    const W = 224;
    const H = Math.max(1, Math.round((W * v.videoHeight) / v.videoWidth));
    const c = (this.visionCanvas ??= document.createElement("canvas"));
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;
    const fix = await vpr.frame(px, W, H, performance.now());
    if (!fix || fix.confidence < VISION_MIN_CONFIDENCE) return;
    const cur = this.lastPose;
    if (cur) {
      // Already located: only correct a clear disagreement, or a position that is much less sure than this one.
      const off = cur.floor !== fix.floor ? Infinity : Math.hypot(cur.x - fix.x, cur.y - fix.y);
      if (!(off > Math.max(2, cur.acc) || cur.acc > fix.acc + 1)) return;
    }
    const gyro = this.core.currentHeading;
    const useHeading = fix.heading !== null && (!cur || Math.abs(((fix.heading - gyro + 540) % 360) - 180) < VISION_HEADING_TRUST_DEG);
    this.core.anchor({ floor: fix.floor, x: fix.x, y: fix.y, heading: useHeading ? fix.heading! : gyro, acc: fix.acc, markerId: null }, true, "vision");
  }

  private visionCanvas: HTMLCanvasElement | null = null;

  private scanOnce(): void {
    const v = this.video;
    const c = this.canvas;
    if (!v || !c || v.videoWidth === 0) return;
    const W = Math.min(640, v.videoWidth);
    const H = Math.round((W * v.videoHeight) / v.videoWidth);
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;
    const gray = new Uint8Array(W * H);
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (px[j]! * 77 + px[j + 1]! * 150 + px[j + 2]! * 29) >> 8;
    const dets = detectMarkers({ data: gray, width: W, height: H });
    if (!dets.length) return;
    this.detections += dets.length;
    const fx = W / 2 / Math.tan((hfov() * Math.PI) / 360);
    const K: Intrinsics = { fx, fy: fx, cx: W / 2, cy: H / 2 };
    let best: ReturnType<typeof devicePoseFromMarker> | null = null;
    for (const d of dets) {
      const r = devicePoseFromMarker(this.venue, d, K);
      if (!r.ok) {
        this.lastReject = r.reason;
        this.lastReproj = r.reprojPx ?? null;
        this.lastOblique = r.obliqueDeg ?? null;
        continue;
      }
      if (!best || (best.ok && r.fix.distance < best.fix.distance)) best = r;
    }
    if (!best || !best.ok) return;
    const f = best.fix;
    this.lastReject = null;
    this.lastReproj = f.reprojPx;
    this.lastOblique = f.obliqueDeg;
    const now = performance.now();
    const last = this.lastScanAt.get(f.markerId) ?? -1e9;
    const fresh = now - last >= RESCAN_MS;
    if (fresh) this.lastScanAt.set(f.markerId, now);
    this.anchorAtMs = now;
    this.core.anchor({ floor: f.floor, x: f.x, y: f.y, heading: f.heading, acc: Math.max(0.5, f.acc), markerId: f.markerId }, !fresh);
    const off = this.core.northOffset;
    if (off !== null) writeNorth(this.venue.id, off);
  }

  /* ---- ControllerPoseSource ---- */
  tick(dtSec: number): void {
    if (!this.running) return;
    const p = this.core.tick(dtSec);
    if (p) {
      this.lastPose = p;
      this.emit(p);
    }
  }
  applyFix(p: { floor: string; x: number; y: number; heading: number; acc: number; markerId: number | null }): void {
    this.core.anchor(p);
  }
  protected override venueChanged(v: Venue): void {
    this.core.setVenue(v);
  }
  override hold(on: boolean): void {
    if (!on) this.core.release();
  }
  onConnector(toFloor: string, x: number, y: number): void {
    this.core.changeFloor(toFloor, x, y);
  }

  getDebug(): PoseDebug {
    return {
      kind: "pdr",
      tracking: this.core.located ? `${this.motionOn ? "steps" : "no sensors"} (${this.core.stepCount})` : "not located",
      reprojPx: this.lastReproj,
      obliqueDeg: this.lastOblique,
      reject: this.lastReject ?? this.lastError,
      anchorAgeSec: this.anchorAtMs === null ? null : (performance.now() - this.anchorAtMs) / 1000,
      cloud: this.core.cloud(),
      detections: this.detections,
      fps: this.fps,
      vision: this.vpr ? `${this.vpr.state}${this.vpr.detail ? ` (${this.vpr.detail})` : ""}${this.vpr.lastSimilarity !== null ? ` · sim ${this.vpr.lastSimilarity.toFixed(2)}` : ""}` : undefined,
    };
  }
}
