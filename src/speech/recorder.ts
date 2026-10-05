import type { Lang } from "@/core/instructions";
import { postTranscribe } from "./client";
import { encodeWav, resample, rms } from "./wav";

export type ListenResult = { ok: true; text: string } | { ok: false; reason: "unsupported" | "no-speech" | "denied" | "error" };
export type ListenPhase = "listening" | "transcribing";

export interface Listener {
  result: Promise<ListenResult>;
  stop: () => void;
}

const TARGET_RATE = 16_000;
const MAX_MS = 12_000;
const MIN_MS = 350;

export function concat(chunks: Float32Array[]): Float32Array {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Recorded float chunks -> 16 kHz WAV -> the local Whisper server -> text. Exposed for tests. */
export async function transcribeRecording(
  chunks: Float32Array[],
  rate: number,
  lang: Lang,
  post: (wav: Uint8Array, lang: Lang) => Promise<string> = postTranscribe,
): Promise<ListenResult> {
  const samples = resample(concat(chunks), rate, TARGET_RATE);
  if (samples.length < (TARGET_RATE * MIN_MS) / 1000 || rms(samples) < 0.002) return { ok: false, reason: "no-speech" };
  try {
    const text = await post(encodeWav(samples, TARGET_RATE), lang);
    return text ? { ok: true, text } : { ok: false, reason: "no-speech" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** Push-to-talk recording from the microphone, understood by the local Whisper server. Never throws. */
export function recordLocal(lang: Lang, hooks: { onStart?: () => void; onPhase?: (p: ListenPhase) => void } = {}): Listener {
  let stopRequested = false;
  let stopNow: () => void = () => {
    stopRequested = true;
  };
  const result = (async (): Promise<ListenResult> => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") return { ok: false, reason: "unsupported" };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      return { ok: false, reason: e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "denied" : "error" };
    }
    const ctx = new AudioContext();
    const chunks: Float32Array[] = [];
    const source = ctx.createMediaStreamSource(stream);
    // ScriptProcessor is deprecated but is the one capture path that behaves the same on every Android Chrome.
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => {
      chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    source.connect(proc);
    proc.connect(ctx.destination);
    hooks.onStart?.();
    hooks.onPhase?.("listening");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, MAX_MS);
      stopNow = () => {
        clearTimeout(timer);
        resolve();
      };
      if (stopRequested) stopNow();
    });
    const rate = ctx.sampleRate;
    proc.disconnect();
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    hooks.onPhase?.("transcribing");
    return transcribeRecording(chunks, rate, lang);
  })();
  return { result, stop: () => stopNow() };
}
