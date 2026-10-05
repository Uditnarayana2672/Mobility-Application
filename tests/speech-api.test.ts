import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createApi } from "../server/api";
import { cleanTranscript } from "../server/speech/stt";
import { cleanForSpeech } from "../server/speech/tts";
import type { SpeechService } from "../server/speech";
import { decodeWav, encodeWav, resample, rms } from "../src/speech/wav";

const heard: { n: number; rate: number; lang: string }[] = [];
const fake: SpeechService = {
  stt: {
    status: () => ({ available: true, state: "ready", model: "fake" }),
    transcribe: async (samples, lang) => {
      heard.push({ n: samples.length, rate: 16000, lang });
      return { text: "where is the balcony", ms: 5 };
    },
  },
  tts: {
    languages: () => ["en", "hi"],
    synth: async (text) => Buffer.from(encodeWav(new Float32Array(Math.min(2000, text.length * 10)), 22050)),
  },
  status: () => ({ stt: { available: true, state: "ready", model: "fake" }, tts: { available: true, languages: ["en", "hi"] } }),
};

let server: http.Server;
let base: string;
let root: string;
const call = (p: string, init?: RequestInit) => fetch(`http://${base}${p}`, init);

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "indore-speech-"));
  const api = createApi({ root, speech: fake });
  server = http.createServer((req, res) => void api(req, res, () => ((res.statusCode = 404), res.end("next"))));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("wav helpers", () => {
  it("round-trips 16-bit PCM and resamples to the right length", () => {
    const tone = new Float32Array(22050).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / 22050) * 0.5);
    const wav = encodeWav(tone, 22050);
    const back = decodeWav(wav);
    expect(back.rate).toBe(22050);
    expect(back.samples).toHaveLength(22050);
    expect(Math.abs(back.samples[100]! - tone[100]!)).toBeLessThan(0.001);
    const r16 = resample(back.samples, 22050, 16000);
    expect(r16.length).toBe(16000);
    expect(rms(r16)).toBeGreaterThan(0.3); // the tone survives
  });

  it("reads a streamed WAV whose data size is 0 / 0xFFFFFFFF, and rejects junk", () => {
    const wav = encodeWav(new Float32Array(100).fill(0.25), 16000);
    new DataView(wav.buffer).setUint32(40, 0xffffffff, true);
    expect(decodeWav(wav).samples).toHaveLength(100);
    expect(() => decodeWav(new Uint8Array(10))).toThrow();
    expect(() => decodeWav(new Uint8Array(60))).toThrow(/not a WAV/);
  });

  it("downmixes stereo", () => {
    const mono = encodeWav(new Float32Array(4).fill(0.5), 8000);
    const v = new DataView(mono.buffer);
    v.setUint16(22, 2, true); // pretend stereo: 2 samples of (0.5, 0.5)
    expect(decodeWav(mono).samples).toHaveLength(2);
  });
});

describe("text cleaning", () => {
  it("speech text loses emoji, arrows and control characters and is bounded", () => {
    expect(cleanForSpeech("↰ Turn left 📍\n in 4 m")).toBe("Turn left in 4 m");
    expect(cleanForSpeech("a".repeat(900))).toHaveLength(400);
  });
  it("transcripts lose non-speech markers and degenerate loops", () => {
    expect(cleanTranscript("[MUSIC] take me (laughs) to the pantry ♪")).toBe("take me to the pantry");
    expect(cleanTranscript(Array(30).fill("आप").join(" "))).toBe("");
    expect(cleanTranscript("go go to the room")).toBe("go go to the room");
  });
});

describe("/api/speech, /api/stt, /api/tts", () => {
  it("reports what is installed", async () => {
    const s = await (await call("/api/speech/status")).json();
    expect(s.stt.state).toBe("ready");
    expect(s.tts.languages).toEqual(["en", "hi"]);
  });

  it("transcribes an uploaded WAV at any sample rate (resampled to 16 kHz first)", async () => {
    const wav = encodeWav(new Float32Array(44100).fill(0.1), 44100);
    const r = await call("/api/stt?lang=hi", { method: "POST", body: wav });
    expect(r.status).toBe(200);
    expect((await r.json()).text).toBe("where is the balcony");
    expect(heard.at(-1)).toMatchObject({ lang: "hi", n: 16000 });
  });

  it("rejects a missing language, a non-WAV body and an oversized upload", async () => {
    expect((await call("/api/stt", { method: "POST", body: new Uint8Array(100) })).status).toBe(400);
    expect((await call("/api/stt?lang=en", { method: "POST", body: new Uint8Array(100) })).status).toBe(415);
    const big = await call("/api/stt?lang=en", { method: "POST", body: new Uint8Array(3 * 1024 * 1024) }).catch(() => null);
    if (big) expect(big.status).toBe(413); // (a reset connection is also an acceptable refusal)
  });

  it("speaks text as audio/wav, and refuses bad input or a language with no voice", async () => {
    const r = await call(`/api/tts?lang=en&text=${encodeURIComponent("Turn left in 4 metres")}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("audio/wav");
    expect(decodeWav(new Uint8Array(await r.arrayBuffer())).rate).toBe(22050);
    expect((await call("/api/tts?lang=en&text=")).status).toBe(400);
    expect((await call(`/api/tts?lang=en&text=${"x".repeat(500)}`)).status).toBe(400);
    expect((await call("/api/tts?lang=te&text=hello")).status).toBe(503);
    expect((await call("/api/tts?lang=fr&text=hello")).status).toBe(400);
  });
});
