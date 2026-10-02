import { LANGS, type Lang } from "@/core/instructions";

// Minimal typings: SpeechRecognition is webkit-prefixed in Chrome and absent from lib.dom.
interface RecResult extends ArrayLike<{ transcript: string }> { isFinal?: boolean }
interface Rec {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex?: number; results: ArrayLike<RecResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecCtor = new () => Rec;

export type ListenResult = { ok: true; text: string } | { ok: false; reason: "unsupported" | "no-speech" | "denied" | "error" };

export function recognitionSupported(): boolean {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

/** One-shot listen in the given language. Never throws; the caller falls back to the text box on any `ok: false`. */
export function listenOnce(lang: Lang, onStart?: () => void, onPartial?: (text: string) => void): { result: Promise<ListenResult>; stop: () => void } {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return { result: Promise.resolve({ ok: false, reason: "unsupported" }), stop: () => undefined };
  let rec: Rec;
  try {
    rec = new Ctor();
  } catch {
    return { result: Promise.resolve({ ok: false, reason: "error" }), stop: () => undefined };
  }
  const result = new Promise<ListenResult>((resolve) => {
    let done = false;
    const finish = (r: ListenResult) => {
      if (done) return;
      done = true;
      resolve(r);
    };
    rec.lang = LANGS[lang].speech;
    let latest = "";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let text = "";
      let final = false;
      for (let i = 0; i < e.results.length; i++) {
        const part = e.results[i];
        text += `${part?.[0]?.transcript ?? ""} `;
        final ||= !!part?.isFinal;
      }
      latest = text.trim();
      if (latest) onPartial?.(latest);
      if (final && latest) finish({ ok: true, text: latest });
    };
    rec.onerror = (e) => finish({ ok: false, reason: e.error === "not-allowed" || e.error === "service-not-allowed" ? "denied" : e.error === "no-speech" ? "no-speech" : "error" });
    rec.onend = () => finish(latest ? { ok: true, text: latest } : { ok: false, reason: "no-speech" });
    try {
      rec.start();
      onStart?.();
    } catch {
      finish({ ok: false, reason: "error" });
    }
  });
  return {
    result,
    stop: () => {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    },
  };
}
