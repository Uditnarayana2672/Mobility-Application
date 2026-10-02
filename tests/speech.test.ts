import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { parseVenue, type Venue } from "@/core";
import { RuleIntentResolver } from "@/navigator/intentResolver";
import { SpeechSynthesisOut, pickVoice, type Caption, type SynthLike, type UtteranceLike, type VoiceLike } from "@/navigator/speech";

class FakeUtterance implements UtteranceLike {
  lang = "";
  voice: VoiceLike | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

class FakeSynth implements SynthLike {
  spoken: FakeUtterance[] = [];
  cancels = 0;
  resumes = 0;
  constructor(public voices: VoiceLike[]) {}
  speak(u: UtteranceLike): void {
    this.spoken.push(u as FakeUtterance);
  }
  cancel(): void {
    this.cancels++;
  }
  resume(): void {
    this.resumes++;
  }
  getVoices(): VoiceLike[] {
    return this.voices;
  }
  /** Finish the utterance currently "playing". */
  finish(): void {
    const u = this.spoken[this.spoken.length - 1];
    u?.onend?.();
  }
}

const VOICES: VoiceLike[] = [{ lang: "en-IN", name: "en" }, { lang: "hi-IN", name: "hi" }, { lang: "te-IN", name: "te" }];
const mk = (voices = VOICES) => {
  const synth = new FakeSynth(voices);
  const out = new SpeechSynthesisOut(synth, FakeUtterance);
  const caps: Caption[] = [];
  out.onCaption((c) => caps.push(c));
  return { synth, out, caps };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("pickVoice", () => {
  it("prefers the exact locale, then the same language", () => {
    expect(pickVoice([{ lang: "hi_IN" }, { lang: "en-US" }], "hi-IN")?.lang).toBe("hi_IN");
    expect(pickVoice([{ lang: "en-US" }, { lang: "en-IN" }], "en-IN")?.lang).toBe("en-IN");
    expect(pickVoice([{ lang: "en-GB" }], "en-IN")?.lang).toBe("en-GB");
    expect(pickVoice([{ lang: "en-GB" }], "te-IN")).toBeUndefined();
  });
});

describe("SpeechSynthesisOut", () => {
  it("speaks with the right voice and language, and always captions", () => {
    const { synth, out, caps } = mk();
    out.say("Walk 10 m", "hi");
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0]!.lang).toBe("hi-IN");
    expect(synth.spoken[0]!.voice?.name).toBe("hi");
    expect(caps).toEqual([{ text: "Walk 10 m", lang: "hi", spoken: true }]);
  });

  it("caption-only when the language has no voice (hi/te), but English falls back to the default voice", () => {
    const { synth, out, caps } = mk([{ lang: "en-IN" }]);
    out.say("namaste", "hi");
    out.say("hello", "en");
    expect(caps.map((c) => [c.text, c.spoken])).toEqual([["namaste", false], ["hello", true]]);
    expect(synth.spoken.map((u) => u.text)).toEqual(["hello"]);
    expect(out.canSpeak("te")).toBe(false);
    const none = mk([]);
    none.out.say("hello", "en");
    expect(none.synth.spoken).toHaveLength(1);
    expect(none.out.canSpeak("en")).toBe(true);
  });

  it("works without speechSynthesis at all (captions only, no throw)", () => {
    const out = new SpeechSynthesisOut(null, null);
    const caps: Caption[] = [];
    out.onCaption((c) => caps.push(c));
    expect(() => out.say("hi", "en")).not.toThrow();
    expect(caps).toEqual([{ text: "hi", lang: "en", spoken: false }]);
  });

  it("muted: captions only", () => {
    const { synth, out, caps } = mk();
    out.setMuted(true);
    out.say("hello", "en");
    expect(synth.spoken).toHaveLength(0);
    expect(caps[0]!.spoken).toBe(false);
    out.setMuted(false);
    out.say("hello again", "en");
    expect(synth.spoken).toHaveLength(1);
  });

  it("queues normal lines one at a time, at most two waiting, oldest dropped; no immediate repeats", () => {
    const { synth, out } = mk();
    out.say("one", "en");
    out.say("two", "en");
    out.say("three", "en");
    out.say("four", "en");
    out.say("four", "en"); // duplicate of a queued line
    expect(synth.spoken.map((u) => u.text)).toEqual(["one"]);
    synth.finish();
    expect(synth.spoken.map((u) => u.text)).toEqual(["one", "three"]);
    synth.finish();
    expect(synth.spoken.map((u) => u.text)).toEqual(["one", "three", "four"]);
  });

  it("urgent lines cancel the queue and play at once", () => {
    const { synth, out } = mk();
    out.say("one", "en");
    out.say("two", "en");
    out.say("NOW", "en", "urgent");
    expect(synth.cancels).toBeGreaterThan(0);
    expect(synth.spoken.map((u) => u.text)).toEqual(["one", "NOW"]);
    // the cancelled utterance's late onend/onerror must not start anything else
    synth.spoken[0]!.onerror?.();
    expect(synth.spoken).toHaveLength(2);
    synth.finish();
    expect(synth.spoken).toHaveLength(2); // "two" was dropped by the urgent line
  });

  it("a stuck utterance (no onend) does not block the queue forever", () => {
    const { synth, out } = mk();
    out.say("stuck", "en");
    out.say("next", "en");
    expect(synth.spoken).toHaveLength(1);
    vi.advanceTimersByTime(10_000);
    expect(synth.spoken.map((u) => u.text)).toEqual(["stuck", "next"]);
  });

  it("picks up voices that load late (voiceschanged)", () => {
    let handler: (() => void) | null = null;
    const synth = new FakeSynth([]);
    (synth as unknown as { addEventListener: (t: string, fn: () => void) => void }).addEventListener = (_t, fn) => (handler = fn);
    const out = new SpeechSynthesisOut(synth, FakeUtterance);
    expect(out.canSpeak("hi")).toBe(false);
    synth.voices = VOICES;
    (handler as (() => void) | null)?.();
    expect(out.canSpeak("hi")).toBe(true);
  });
});

describe("RuleIntentResolver", () => {
  const V: Venue = (() => {
    const r = parseVenue(JSON.parse(fs.readFileSync("public/venues/office-hq/venue.json", "utf8")));
    if (!r.ok) throw new Error("bad fixture");
    return r.data;
  })();
  const r = new RuleIntentResolver();
  const ctx = { venue: V, from: { floor: "F1", x: 3, y: 17, heading: 0 }, prefs: {}, lang: "en" as const };

  it("wraps core intent(): en, Hinglish and Telugu", async () => {
    expect(await r.resolve("Cafeteria kahan hai?", ctx)).toMatchObject({ type: "show", target: { room: "F2-cafeteria" } });
    expect(await r.resolve("take me to the cafeteria", ctx)).toMatchObject({ type: "goto", target: { room: "F2-cafeteria" } });
    expect(await r.resolve("avoid stairs", ctx)).toEqual({ type: "pref", avoidStairs: true });
    expect(await r.resolve("main kahan hoon", ctx)).toEqual({ type: "whereami" });
    expect(await r.resolve("", ctx)).toEqual({ type: "unknown" });
  });
  it("nearest washroom uses the position", async () => {
    const res = await r.resolve("nearest washroom", ctx);
    expect(res).toMatchObject({ type: "goto", nearest: true });
  });
});
