import os from "node:os";
import path from "node:path";
import type { Lang } from "../../src/core/instructions";
import { rms } from "../../src/speech/wav";

export const STT_RATE = 16_000;
const WHISPER_LANG: Record<Lang, string> = { en: "english", hi: "hindi", te: "telugu" };
export const MIN_SECONDS = 0.3;
export const MAX_SECONDS = 20;
/** Below this loudness Whisper makes things up ("Thank you."), so we answer "nothing heard" ourselves. */
export const SILENCE_RMS = 0.004;

export interface SttStatus {
  available: boolean;
  state: "idle" | "loading" | "ready" | "error";
  model: string;
  error?: string;
}

export interface SttEngine {
  status(): SttStatus;
  /** 16 kHz mono floats -> text ("" when nothing was said). */
  transcribe(samples: Float32Array, lang: Lang): Promise<{ text: string; ms: number }>;
}

type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;

/** Whisper running on this machine through onnxruntime (transformers.js). Models are cached in data/models/hf; no cloud calls after the first download. */
export class WhisperStt implements SttEngine {
  private asr: Promise<Asr> | null = null;
  private state: SttStatus["state"] = "idle";
  private error: string | undefined;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly root: string,
    readonly model: string = process.env.STT_MODEL ?? "onnx-community/whisper-small",
  ) {}

  status(): SttStatus {
    return { available: this.state !== "error", state: this.state, model: this.model, error: this.error };
  }

  /** Start loading in the background so the first spoken question does not wait for the model. */
  warm(): void {
    void this.load().catch(() => undefined);
  }

  private load(): Promise<Asr> {
    if (this.asr) return this.asr;
    this.state = "loading";
    this.asr = (async () => {
      const { env, pipeline } = await import("@huggingface/transformers");
      env.cacheDir = path.join(this.root, "data", "models", "hf");
      // Using every core (22 on a laptop with efficiency cores) is 4x SLOWER than 4 threads: cap it.
      const threads = Number(process.env.STT_THREADS) || Math.max(1, Math.min(4, os.cpus().length));
      const pipe = await pipeline("automatic-speech-recognition", this.model, { dtype: "q8", device: "cpu", session_options: { intraOpNumThreads: threads } });
      this.state = "ready";
      return pipe as unknown as Asr;
    })().catch((e: unknown) => {
      this.state = "error";
      this.error = e instanceof Error ? e.message : String(e);
      this.asr = null;
      throw e;
    });
    return this.asr;
  }

  transcribe(samples: Float32Array, lang: Lang): Promise<{ text: string; ms: number }> {
    const run = async () => {
      const seconds = samples.length / STT_RATE;
      if (seconds < MIN_SECONDS || rms(samples) < SILENCE_RMS) return { text: "", ms: 0 };
      const clip = seconds > MAX_SECONDS ? samples.subarray(0, MAX_SECONDS * STT_RATE) : samples;
      const asr = await this.load();
      const t0 = Date.now();
      const out = await asr(clip, {
        language: WHISPER_LANG[lang],
        task: "transcribe",
        // Commands are short; these stop the repetition loops Whisper falls into on poor audio.
        max_new_tokens: 64,
        no_repeat_ngram_size: 3,
        repetition_penalty: 1.2,
      });
      const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text).replace(/\s+/g, " ").trim();
      return { text: cleanTranscript(text), ms: Date.now() - t0 };
    };
    // One decode at a time: two parallel Whisper runs on a laptop CPU are slower than two in a row.
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }
}

/** Drops Whisper's non-speech markers and obvious degenerate loops. */
export function cleanTranscript(text: string): string {
  const t = text.replace(/\[[^\]]*\]|\([^)]*\)|♪+/g, " ").replace(/\s+/g, " ").trim();
  const words = t.split(" ");
  if (words.length >= 8) {
    const uniq = new Set(words.map((w) => w.toLowerCase()));
    if (uniq.size / words.length < 0.25) return ""; // "आप आप आप आप …"
  }
  return t;
}

export async function preloadWhisper(root: string): Promise<void> {
  const s = new WhisperStt(root);
  await s.transcribe(new Float32Array(STT_RATE).map((_, i) => Math.sin(i / 20) * 0.2), "en");
}
