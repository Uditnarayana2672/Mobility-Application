import { LANGS, type Lang } from "@/core/instructions";

export type SpeechPriority = "normal" | "urgent";

export interface Caption {
  text: string;
  lang: Lang;
  /** True when the line was also sent to a voice (false: muted, no voice for the language, or no speechSynthesis). */
  spoken: boolean;
}

/** Spoken output. Captions are always produced, whatever the voice situation. */
export interface SpeechOut {
  /** Show a caption and (when possible) speak. "urgent" cancels what is queued/playing. */
  say(text: string, lang: Lang, priority?: SpeechPriority): void;
  cancel(): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  onCaption(fn: (c: Caption) => void): () => void;
  /** Is there a voice that can speak this language on this device? */
  canSpeak(lang: Lang): boolean;
}

/** The slice of the Web Speech API we use (lets tests inject a fake). */
export interface SynthLike {
  speak(u: UtteranceLike): void;
  cancel(): void;
  resume?(): void;
  getVoices(): VoiceLike[];
  addEventListener?(type: "voiceschanged", fn: () => void): void;
}
export interface VoiceLike {
  lang: string;
  name?: string;
}
export interface UtteranceLike {
  text: string;
  lang: string;
  voice: VoiceLike | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
export type UtteranceCtor = new (text: string) => UtteranceLike;

const norm = (l: string) => l.replace("_", "-").toLowerCase();

/** Exact BCP-47 match first (hi-IN), then any voice of the same language (hi-*). */
export function pickVoice(voices: VoiceLike[], want: string): VoiceLike | undefined {
  return voices.find((v) => norm(v.lang) === norm(want)) ?? voices.find((v) => norm(v.lang).startsWith(norm(want).slice(0, 2)));
}

interface Item {
  text: string;
  lang: Lang;
}

const MAX_QUEUE = 2;

/**
 * speechSynthesis with a small queue: urgent lines (turn now, floor change, arrival) cancel everything and speak immediately;
 * normal lines (pre-announcements) queue, at most two deep, oldest dropped; an identical line is never repeated back to back.
 * If a language has no voice on the device the caption is shown and nothing is spoken (English falls back to the default voice).
 */
export class SpeechSynthesisOut implements SpeechOut {
  private readonly listeners = new Set<(c: Caption) => void>();
  private queue: Item[] = [];
  private speaking: { item: Item; watchdog: ReturnType<typeof setTimeout> } | null = null;
  private muted = false;
  private voices: VoiceLike[] = [];
  private last = "";

  constructor(
    private readonly synth: SynthLike | null = typeof speechSynthesis === "undefined" ? null : (speechSynthesis as unknown as SynthLike),
    private readonly Utterance: UtteranceCtor | null = typeof SpeechSynthesisUtterance === "undefined" ? null : (SpeechSynthesisUtterance as unknown as UtteranceCtor),
  ) {
    this.refreshVoices();
    this.synth?.addEventListener?.("voiceschanged", () => this.refreshVoices());
  }

  private refreshVoices(): void {
    try {
      this.voices = this.synth?.getVoices() ?? [];
    } catch {
      this.voices = [];
    }
  }

  canSpeak(lang: Lang): boolean {
    if (!this.synth || !this.Utterance) return false;
    if (pickVoice(this.voices, LANGS[lang].speech)) return true;
    return lang === "en"; // English falls back to the browser default voice
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.cancel();
  }
  isMuted(): boolean {
    return this.muted;
  }

  onCaption(fn: (c: Caption) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  say(text: string, lang: Lang, priority: SpeechPriority = "normal"): void {
    if (!text) return;
    const speakable = !this.muted && this.canSpeak(lang);
    for (const fn of [...this.listeners]) {
      try {
        fn({ text, lang, spoken: speakable });
      } catch (err) {
        console.error("caption listener failed", err);
      }
    }
    if (!speakable) return;
    if (priority === "urgent") {
      this.queue = [];
      this.stopCurrent();
    } else {
      if (text === this.last || this.queue.some((q) => q.text === text)) return;
      this.queue.push({ text, lang });
      while (this.queue.length > MAX_QUEUE) this.queue.shift();
    }
    this.last = text;
    if (priority === "urgent") this.queue.unshift({ text, lang });
    this.pump();
  }

  cancel(): void {
    this.queue = [];
    this.stopCurrent();
  }

  private stopCurrent(): void {
    if (this.speaking) clearTimeout(this.speaking.watchdog);
    this.speaking = null;
    try {
      this.synth?.cancel();
    } catch {
      /* ignore */
    }
  }

  private pump(): void {
    if (this.speaking || !this.synth || !this.Utterance) return;
    const item = this.queue.shift();
    if (!item) return;
    try {
      const u = new this.Utterance(item.text);
      const want = LANGS[item.lang].speech;
      u.lang = want;
      u.voice = pickVoice(this.voices, want) ?? null;
      const done = () => {
        if (this.speaking?.item !== item) return;
        clearTimeout(this.speaking.watchdog);
        this.speaking = null;
        this.pump();
      };
      u.onend = done;
      u.onerror = done;
      // Chrome sometimes never fires onend (long utterances, tab switches): don't let the queue stall.
      const watchdog = setTimeout(done, 3500 + item.text.length * 90);
      this.speaking = { item, watchdog };
      this.synth.resume?.();
      this.synth.speak(u);
    } catch {
      this.speaking = null;
    }
  }
}

/** Records everything; for tests and for running without speech. */
export class FakeSpeech implements SpeechOut {
  readonly lines: { text: string; lang: Lang; priority: SpeechPriority; spoken: boolean }[] = [];
  private muted = false;
  private readonly listeners = new Set<(c: Caption) => void>();
  constructor(private readonly voices: Lang[] = ["en", "hi", "te"]) {}
  say(text: string, lang: Lang, priority: SpeechPriority = "normal"): void {
    const spoken = !this.muted && this.canSpeak(lang);
    this.lines.push({ text, lang, priority, spoken });
    for (const fn of [...this.listeners]) fn({ text, lang, spoken });
  }
  cancel(): void {}
  setMuted(m: boolean): void {
    this.muted = m;
  }
  isMuted(): boolean {
    return this.muted;
  }
  onCaption(fn: (c: Caption) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  canSpeak(lang: Lang): boolean {
    return this.voices.includes(lang);
  }
  get texts(): string[] {
    return this.lines.map((l) => l.text);
  }
}
