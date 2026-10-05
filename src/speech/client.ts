import type { Lang } from "@/core/instructions";

/** What the local speech server can do (GET /api/speech/status). */
export interface SpeechCaps {
  /** Local Whisper speech to text is usable. */
  stt: boolean;
  /** "idle" until the first request, "loading" while the model loads (first use takes a while), "ready". */
  sttState: "idle" | "loading" | "ready" | "error" | "none";
  /** Languages with a local Piper voice. */
  tts: Lang[];
}

export const NO_CAPS: SpeechCaps = { stt: false, sttState: "none", tts: [] };

interface StatusJson {
  stt?: { available?: boolean; state?: SpeechCaps["sttState"] };
  tts?: { languages?: Lang[] };
}

export async function fetchSpeechCaps(fetcher: typeof fetch = fetch): Promise<SpeechCaps> {
  try {
    const res = await fetcher("/api/speech/status", { cache: "no-store" });
    if (!res.ok) return NO_CAPS;
    const j = (await res.json()) as StatusJson;
    return {
      stt: !!j.stt?.available && j.stt.state !== "error",
      sttState: j.stt?.state ?? "none",
      tts: Array.isArray(j.tts?.languages) ? j.tts.languages.filter((l): l is Lang => l === "en" || l === "hi" || l === "te") : [],
    };
  } catch {
    return NO_CAPS;
  }
}

let cached: Promise<SpeechCaps> | null = null;
/** One shared lookup per page load (re-tried after a failure). */
export function speechCaps(): Promise<SpeechCaps> {
  cached ??= fetchSpeechCaps().then((c) => {
    if (c === NO_CAPS || c.sttState === "none") cached = null;
    return c;
  });
  return cached;
}
export function resetSpeechCaps(): void {
  cached = null;
}

export const ttsUrl = (text: string, lang: Lang): string => `/api/tts?lang=${lang}&text=${encodeURIComponent(text)}`;

export async function postTranscribe(wav: Uint8Array, lang: Lang, fetcher: typeof fetch = fetch): Promise<string> {
  const res = await fetcher(`/api/stt?lang=${lang}`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav as unknown as BodyInit });
  if (!res.ok) throw new Error(`speech to text failed (HTTP ${res.status})`);
  const j = (await res.json()) as { text?: string };
  return (j.text ?? "").trim();
}
