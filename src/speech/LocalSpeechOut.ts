import type { Lang } from "@/core/instructions";
import type { Caption, SpeechOut, SpeechPriority } from "@/navigator/speech";
import { speechCaps, ttsUrl } from "./client";

export interface AudioLike {
  src: string;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  play(): Promise<void>;
  pause(): void;
}

interface Item {
  text: string;
  lang: Lang;
}

const MAX_QUEUE = 2;
const BAD_FOR_MS = 30_000;

/**
 * Spoken output through the local Piper voices (/api/tts). Same rules as SpeechSynthesisOut: urgent lines cancel the queue,
 * normal lines queue two deep, an identical line is never repeated back to back. If the local voice is missing for a language, the
 * server is unreachable or the audio fails, the line goes to the `fallback` (the phone's own speech synthesis) and the local voice is
 * left alone for 30 s. Captions are always produced.
 */
export class LocalSpeechOut implements SpeechOut {
  private readonly listeners = new Set<(c: Caption) => void>();
  private langs = new Set<Lang>();
  private queue: Item[] = [];
  private speaking: { item: Item; audio: AudioLike; watchdog: ReturnType<typeof setTimeout> } | null = null;
  private muted = false;
  private last = "";
  private badUntil = 0;

  constructor(
    private readonly fallback: SpeechOut,
    private readonly opts: {
      caps?: () => Promise<{ tts: Lang[] }>;
      makeAudio?: (url: string) => AudioLike;
      now?: () => number;
      warm?: (url: string) => void;
    } = {},
  ) {
    void (opts.caps ?? speechCaps)().then((c) => (this.langs = new Set(c.tts)));
  }

  private get now(): number {
    return (this.opts.now ?? Date.now)();
  }
  private audio(url: string): AudioLike {
    return this.opts.makeAudio ? this.opts.makeAudio(url) : (Object.assign(new Audio(url), { onended: null, onerror: null }) as unknown as AudioLike);
  }
  private useLocal(lang: Lang): boolean {
    return this.langs.has(lang) && this.now >= this.badUntil;
  }

  canSpeak(lang: Lang): boolean {
    return this.langs.has(lang) || this.fallback.canSpeak(lang);
  }
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.fallback.setMuted(muted);
    if (muted) this.cancel();
  }
  isMuted(): boolean {
    return this.muted;
  }
  onCaption(fn: (c: Caption) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Ask the server to synthesise these lines now (it caches them) so a later "turn now" starts at once. */
  prefetch(texts: string[], lang: Lang): void {
    if (!this.useLocal(lang)) return;
    for (const t of texts) {
      const url = ttsUrl(t, lang);
      if (this.opts.warm) this.opts.warm(url);
      else void fetch(url).then((r) => r.arrayBuffer()).catch(() => undefined);
    }
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
    if (!this.useLocal(lang)) {
      this.fallback.say(text, lang, priority);
      return;
    }
    if (priority === "urgent") {
      this.queue = [];
      this.stopCurrent();
      this.queue.unshift({ text, lang });
    } else {
      if (text === this.last || this.queue.some((q) => q.text === text)) return;
      this.queue.push({ text, lang });
      while (this.queue.length > MAX_QUEUE) this.queue.shift();
    }
    this.last = text;
    this.pump();
  }

  cancel(): void {
    this.queue = [];
    this.stopCurrent();
    this.fallback.cancel();
  }

  private stopCurrent(): void {
    const s = this.speaking;
    this.speaking = null;
    if (!s) return;
    clearTimeout(s.watchdog);
    s.audio.onended = null;
    s.audio.onerror = null;
    try {
      s.audio.pause();
    } catch {
      /* ignore */
    }
  }

  private pump(): void {
    if (this.speaking) return;
    const item = this.queue.shift();
    if (!item) return;
    let audio: AudioLike;
    try {
      audio = this.audio(ttsUrl(item.text, item.lang));
    } catch {
      this.fail(item);
      return;
    }
    const finish = (ok: boolean) => {
      if (this.speaking?.item !== item) return;
      clearTimeout(this.speaking.watchdog);
      this.speaking = null;
      if (!ok) this.fail(item);
      this.pump();
    };
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    // First synthesis of a line takes a second or two; after that it is cached on the server and in the browser.
    const watchdog = setTimeout(() => finish(false), 20_000);
    this.speaking = { item, audio, watchdog };
    audio.play().catch(() => finish(false));
  }

  /** The local voice failed for this line: say it with the phone's own voice and rest the local one briefly. */
  private fail(item: Item): void {
    this.badUntil = this.now + BAD_FOR_MS;
    this.fallback.say(item.text, item.lang, "urgent");
  }
}
