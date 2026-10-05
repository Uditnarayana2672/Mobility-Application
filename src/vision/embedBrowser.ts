import { describePicture } from "./pool";
import { VPR_INPUT, VPR_MODEL } from "./vpr";

export interface FrameEmbedder {
  /** RGBA pixels of a picture (any size; it is scaled by the model's own preprocessing) -> descriptor. */
  embed(rgba: Uint8ClampedArray, width: number, height: number): Promise<number[]>;
}

/**
 * The image model in the browser (WebAssembly, one thread: no special server headers needed). Its files and the onnxruntime wasm come
 * from this server (/models, /ort), so after the first download it works with no internet. Loaded only when vision is switched on.
 */
export async function createBrowserEmbedder(origin: string = location.origin): Promise<FrameEmbedder> {
  const { env, pipeline, RawImage } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  env.remoteHost = `${origin}/models/`;
  env.remotePathTemplate = "{model}/";
  env.useBrowserCache = true;
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.numThreads = 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wasm as any).wasmPaths = { mjs: `${origin}/ort/ort-wasm-simd-threaded.jsep.mjs`, wasm: `${origin}/ort/ort-wasm-simd-threaded.jsep.wasm` };
  }
  const fe = (await pipeline("image-feature-extraction", VPR_MODEL, { dtype: "q8", device: "wasm" })) as unknown as (img: unknown) => Promise<{ dims: number[]; data: Float32Array }>;
  return {
    async embed(rgba, width, height) {
      const rgb = new Uint8ClampedArray(width * height * 3);
      for (let i = 0, j = 0; i < width * height * 4; i += 4, j += 3) {
        rgb[j] = rgba[i]!;
        rgb[j + 1] = rgba[i + 1]!;
        rgb[j + 2] = rgba[i + 2]!;
      }
      const out = await fe(new RawImage(rgb, width, height, 3));
      const [, rows, dim] = out.dims as [number, number, number];
      return describePicture(out.data, rows!, dim!);
    },
  };
}

/** Size the camera picture is shrunk to before it is embedded (the model looks at 224 px anyway). */
export const FRAME_W = VPR_INPUT;
