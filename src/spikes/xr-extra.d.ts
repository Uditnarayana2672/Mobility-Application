// WebXR raw camera access (not in @types/webxr yet). Written as a module augmentation because
// tsconfig uses moduleDetection: force.
export {};

declare global {
  interface XRCamera {
    readonly width: number;
    readonly height: number;
  }

  interface XRView {
    readonly camera?: XRCamera | null;
  }

  interface XRWebGLBinding {
    getCameraImage(camera: XRCamera): WebGLTexture;
  }
}
