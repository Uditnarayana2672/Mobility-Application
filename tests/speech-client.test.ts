import { describe, expect, it } from "vitest";
import { FakeSpeech } from "@/navigator/speech";
import { fetchSpeechCaps, NO_CAPS, ttsUrl } from "@/speech/client";
import { LocalSpeechOut, type AudioLike } from "@/speech/LocalSpeechOut";
import { concat, transcribeRecording } from "@/speech/recorder";
import { decodeWav } from "@/speech/wav";

class FakeAudio implements AudioLike {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  played = false;
  paused = false;
  constructor(readonly src: string, private readonly failPlay = false) {}
  play(): Promise<void> {
    this.played = true;
    return this.failPlay ? Promise.reject(new Error("blocked")) : Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

async function setup(langs: ("en" | "hi" | "te")[] = ["en", "hi"], failPlay = false) {
  const fallback = new FakeSpeech();
  const made: FakeAudio[] = [];
  let t = 1000;
  const out = new LocalSpeechOut(fallback, { caps: async () => ({ tts: langs }), makeAudio: (u) => { const a = new FakeAudio(u, failPlay); made.push(a); return a; }, now: () => t });
  await Promise.resolve();
  await Promise.resolve();
  return { out, fallback, made, advance: (ms: number) => (t += ms) };
}

describe("LocalSpeechOut", () => {
  it("speaks through the local voice and still produces the caption", async () => {
    const { out, made, fallback } = await setup();
    const captions: string[] = [];
    out.onCaption((c) => captions.push(`${c.text}|${c.spoken}`));
    out.say("Turn left in 4 metres", "en");
    expect(captions).toEqual(["Turn left in 4 metres|true"]);
    expect(made).toHaveLength(1);
    expect(made[0]!.src).toBe(ttsUrl("Turn left in 4 metres", "en"));
    expect(fallback.lines).toHaveLength(0);
  });

  it("queues two deep, never repeats the same line back to back, urgent cancels what is playing", async () => {
    const { out, made } = await setup();
    out.say("one", "en");
    out.say("two", "en");
    out.say("three", "en");
    out.say("three", "en");
    expect(made).toHaveLength(1); // one is playing
    made[0]!.onended?.();
    expect(made).toHaveLength(2);
    expect(made[1]!.src).toContain("two");
    out.say("NOW", "en", "urgent");
    expect(made[1]!.paused).toBe(true);
    expect(made.at(-1)!.src).toContain("NOW");
  });

  it("a language without a local voice goes to the phone's own voice", async () => {
    const { out, made, fallback } = await setup(["en"]);
    out.say("మీరు చేరుకున్నారు", "te");
    expect(made).toHaveLength(0);
    expect(fallback.lines.map((l) => l.text)).toEqual(["మీరు చేరుకున్నారు"]);
  });

  it("a failing local voice falls back for that line and rests for 30 s", async () => {
    const { out, made, fallback, advance } = await setup(["en"], true);
    out.say("Turn right", "en");
    await new Promise((r) => setTimeout(r, 0));
    expect(fallback.texts).toEqual(["Turn right"]);
    out.say("Next line", "en");
    expect(made).toHaveLength(1); // not tried again while resting
    expect(fallback.texts).toEqual(["Turn right", "Next line"]);
    advance(31_000);
    out.say("Third line", "en");
    expect(made).toHaveLength(2);
  });

  it("muted: caption only, nothing played", async () => {
    const { out, made, fallback } = await setup();
    out.setMuted(true);
    const c: boolean[] = [];
    out.onCaption((x) => c.push(x.spoken));
    out.say("hello", "en");
    expect(c).toEqual([false]);
    expect(made).toHaveLength(0);
    expect(fallback.lines.filter((l) => l.spoken)).toHaveLength(0);
  });

  it("prefetch asks the server for each line, but only when the local voice is usable", async () => {
    const warmed: string[] = [];
    const fallback = new FakeSpeech();
    const out = new LocalSpeechOut(fallback, { caps: async () => ({ tts: ["en"] }), warm: (u) => warmed.push(u) });
    await Promise.resolve();
    await Promise.resolve();
    out.prefetch(["a b", "c"], "en");
    out.prefetch(["x"], "te");
    expect(warmed).toEqual([ttsUrl("a b", "en"), ttsUrl("c", "en")]);
  });
});

describe("speech capabilities", () => {
  it("reads the status document, and treats any failure as 'nothing local'", async () => {
    const ok = (async () => new Response(JSON.stringify({ stt: { available: true, state: "ready" }, tts: { languages: ["en", "xx", "te"] } }))) as unknown as typeof fetch;
    expect(await fetchSpeechCaps(ok)).toEqual({ stt: true, sttState: "ready", tts: ["en", "te"] });
    const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await fetchSpeechCaps(down)).toEqual(NO_CAPS);
    const err = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect(await fetchSpeechCaps(err)).toEqual(NO_CAPS);
  });
});

describe("recording -> text", () => {
  const tone = (n: number, a: number) => new Float32Array(n).map((_, i) => Math.sin(i / 7) * a);

  it("concatenates chunks, sends a 16 kHz mono WAV, returns the text", async () => {
    let sent: Uint8Array | null = null;
    const r = await transcribeRecording([tone(24000, 0.3), tone(24000, 0.3)], 48000, "en", async (wav, lang) => {
      sent = wav;
      expect(lang).toBe("en");
      return "go to the balcony";
    });
    expect(r).toEqual({ ok: true, text: "go to the balcony" });
    const pcm = decodeWav(sent!);
    expect(pcm.rate).toBe(16000);
    expect(pcm.samples.length).toBe(16000);
  });

  it("too short or silent audio is 'no speech' and never reaches the server", async () => {
    let calls = 0;
    const post = async () => (calls++, "x");
    expect(await transcribeRecording([tone(1000, 0.3)], 16000, "en", post)).toEqual({ ok: false, reason: "no-speech" });
    expect(await transcribeRecording([new Float32Array(32000)], 16000, "en", post)).toEqual({ ok: false, reason: "no-speech" });
    expect(calls).toBe(0);
  });

  it("an empty answer is no speech; a server failure is an error", async () => {
    expect(await transcribeRecording([tone(16000, 0.3)], 16000, "hi", async () => "")).toEqual({ ok: false, reason: "no-speech" });
    expect(await transcribeRecording([tone(16000, 0.3)], 16000, "hi", async () => { throw new Error("500"); })).toEqual({ ok: false, reason: "error" });
  });

  it("concat joins in order", () => {
    expect(Array.from(concat([new Float32Array([1, 2]), new Float32Array([3])]))).toEqual([1, 2, 3]);
  });
});
