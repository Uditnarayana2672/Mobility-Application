import * as THREE from "three";

export type TrackingState = "tracking" | "limited" | "lost" | "idle";

export interface ArFrameCtx {
  frame: XRFrame;
  time: number;
  refSpace: XRReferenceSpace;
  viewerPose: XRViewerPose | null;
  tracking: TrackingState;
}

export interface ArHandle {
  session: XRSession;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  refSpace: XRReferenceSpace;
  enabledFeatures: string[];
  stop(): void;
}

export interface StartArOptions {
  /** Element used as the dom-overlay root (must be in the document). */
  overlay: HTMLElement;
  optionalFeatures: string[];
  onFrame(ctx: ArFrameCtx, ar: ArHandle): void;
  onEnd(): void;
}

export async function arSupported(): Promise<boolean> {
  try {
    return !!navigator.xr && (await navigator.xr.isSessionSupported("immersive-ar"));
  } catch {
    return false;
  }
}

export function trackingOf(pose: XRViewerPose | null): TrackingState {
  if (!pose) return "lost";
  return pose.emulatedPosition ? "limited" : "tracking";
}

/** Start an immersive-ar session with a three.js renderer drawing into it. Must be called from a user gesture. */
export async function startAr(opts: StartArOptions): Promise<ArHandle> {
  if (!navigator.xr) throw new Error("navigator.xr missing (needs Chrome on Android over HTTPS)");
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local");
  const canvas = renderer.domElement;
  Object.assign(canvas.style, { position: "fixed", left: "0", top: "0", width: "100%", height: "100%", zIndex: "0" });
  document.body.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));

  let session: XRSession;
  try {
    session = await navigator.xr.requestSession("immersive-ar", {
      optionalFeatures: [...opts.optionalFeatures, "local"],
      domOverlay: { root: opts.overlay },
    } as XRSessionInit);
    await renderer.xr.setSession(session);
  } catch (e) {
    canvas.remove();
    renderer.dispose();
    throw e;
  }
  const refSpace = renderer.xr.getReferenceSpace();
  if (!refSpace) throw new Error("no reference space");

  let ended = false;
  const handle: ArHandle = {
    session,
    renderer,
    scene,
    camera,
    refSpace: refSpace as XRReferenceSpace,
    enabledFeatures: (session as unknown as { enabledFeatures?: string[] }).enabledFeatures ?? [],
    stop() {
      if (!ended) void session.end();
    },
  };

  session.addEventListener("end", () => {
    ended = true;
    renderer.setAnimationLoop(null);
    canvas.remove();
    renderer.dispose();
    opts.onEnd();
  });

  renderer.setAnimationLoop((time: number, frame?: XRFrame) => {
    if (!frame) return;
    const viewerPose = frame.getViewerPose(handle.refSpace) ?? null;
    opts.onFrame({ frame, time, refSpace: handle.refSpace, viewerPose, tracking: trackingOf(viewerPose) }, handle);
    renderer.render(scene, camera);
  });

  return handle;
}

/** Make an element swallow XR "select" so tapping HUD buttons doesn't place objects. */
export function blockXrSelect(el: HTMLElement | null): void {
  el?.addEventListener("beforexrselect", (e) => e.preventDefault());
}
