import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Lang } from "../../src/core/instructions";

export const MAX_TTS_CHARS = 400;
const TIMEOUT_MS = 120_000;
const VOICE_FILES: Record<Lang, string> = {
  en: "en_US-lessac-medium",
  hi: "hi_IN-pratham-medium",
  te: "te_IN-venkatesh-medium",
};

export interface TtsEngine {
  /** Languages with an installed voice. */
  languages(): Lang[];
  /** Speech as a WAV file. Cached by text + language. */
  synth(text: string, lang: Lang): Promise<Buffer>;
}

/** Piper neural text to speech running locally (data/models/piper, see `npm run setup:speech`). */
export class PiperTts implements TtsEngine {
  private readonly dir: string;
  private readonly cacheDir: string;
  private active = 0;
  private waiting: (() => void)[] = [];
  private inflight = new Map<string, Promise<Buffer>>();

  constructor(
    root: string,
    private readonly maxParallel = 2,
  ) {
    this.dir = path.join(root, "data", "models", "piper");
    this.cacheDir = path.join(root, "data", "tts-cache");
  }

  private get exe(): string {
    return path.join(this.dir, "piper", process.platform === "win32" ? "piper.exe" : "piper");
  }
  private voice(lang: Lang): string {
    return path.join(this.dir, `${VOICE_FILES[lang]}.onnx`);
  }

  languages(): Lang[] {
    if (!fs.existsSync(this.exe)) return [];
    return (Object.keys(VOICE_FILES) as Lang[]).filter((l) => fs.existsSync(this.voice(l)));
  }

  async synth(rawText: string, lang: Lang): Promise<Buffer> {
    const text = cleanForSpeech(rawText);
    if (!text) throw new Error("nothing to say");
    if (!this.languages().includes(lang)) throw new Error(`no ${lang} voice installed (run: npm run setup:speech)`);
    const key = createHash("sha256").update(`${VOICE_FILES[lang]}\n${text}`).digest("hex").slice(0, 40);
    const file = path.join(this.cacheDir, `${key}.wav`);
    try {
      return await fsp.readFile(file);
    } catch {
      /* not cached yet */
    }
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const job = this.slot(() => this.run(text, lang, file)).finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxParallel) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  private async run(text: string, lang: Lang, cacheFile: string): Promise<Buffer> {
    await fsp.mkdir(this.cacheDir, { recursive: true });
    const tmp = path.join(os.tmpdir(), `piper-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    await new Promise<void>((resolve, reject) => {
      const p = spawn(this.exe, ["--model", this.voice(lang), "--output_file", tmp], { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
      let err = "";
      const timer = setTimeout(() => {
        p.kill();
        reject(new Error("text to speech timed out"));
      }, TIMEOUT_MS);
      p.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-600)));
      p.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      p.on("close", (code) => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error(`piper exited ${code}: ${err.trim().split("\n").pop() ?? ""}`));
      });
      p.stdin.on("error", () => undefined);
      p.stdin.end(`${text}\n`, "utf8");
    });
    try {
      const wav = await fsp.readFile(tmp);
      await fsp.writeFile(cacheFile, wav);
      return wav;
    } finally {
      void fsp.rm(tmp, { force: true });
    }
  }
}

/** One line, no control characters, bounded; what the voice is given. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[\u{1F000}-\u{1FFFF}←-⇿☀-➿️]/gu, "") // emoji and arrows are not read aloud
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TTS_CHARS);
}
