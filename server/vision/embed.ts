import os from "node:os";
import path from "node:path";
import { describePicture } from "../../src/vision/pool";
import { VPR_MODEL } from "../../src/vision/vpr";

type Pipe = (img: unknown) => Promise<{ dims: number[]; data: Float32Array }>;

export interface PictureEmbedder {
  model: string;
  /** A JPEG or PNG file's bytes -> descriptor. */
  embedImage(bytes: Uint8Array): Promise<number[]>;
}

/** The image-embedding model (DINOv2-small) running on this machine. Loaded on first use; cached in data/models/hf. */
export class NodeEmbedder implements PictureEmbedder {
  readonly model = VPR_MODEL;
  private pipe: Promise<{ run: Pipe; RawImage: typeof import("@huggingface/transformers").RawImage }> | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly root: string) {}

  private load() {
    this.pipe ??= (async () => {
      const { env, pipeline, RawImage } = await import("@huggingface/transformers");
      env.cacheDir = path.join(this.root, "data", "models", "hf");
      const threads = Number(process.env.STT_THREADS) || Math.max(1, Math.min(4, os.cpus().length));
      const fe = await pipeline("image-feature-extraction", this.model, { dtype: "q8", device: "cpu", session_options: { intraOpNumThreads: threads } });
      return { run: fe as unknown as Pipe, RawImage };
    })().catch((e: unknown) => {
      this.pipe = null;
      throw e;
    });
    return this.pipe;
  }

  embedImage(bytes: Uint8Array): Promise<number[]> {
    const job = async () => {
      const { run, RawImage } = await this.load();
      const img = await RawImage.fromBlob(new Blob([bytes as BlobPart]));
      const out = await run(img);
      const [, rows, dim] = out.dims as [number, number, number];
      return describePicture(out.data, rows!, dim!);
    };
    const next = this.chain.then(job, job);
    this.chain = next.catch(() => undefined);
    return next;
  }
}
