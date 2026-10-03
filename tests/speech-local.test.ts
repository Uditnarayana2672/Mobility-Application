import { describe, expect, it } from "vitest";
import { createLocalSpeech } from "../server/speech";
import { decodeWav, resample } from "../src/speech/wav";

/**
 * Real engines, nothing mocked: Piper says a sentence, Whisper listens to it. Slow (model load) and needs `npm run setup:speech`,
 * so it only runs with SPEECH_REAL=1:   SPEECH_REAL=1 npx vitest run tests/speech-local.test.ts
 */
const run = process.env.SPEECH_REAL === "1" ? describe : describe.skip;

run("local speech round trip", () => {
  const speech = createLocalSpeech(process.cwd());

  it("English: spoken by Piper, heard by Whisper", { timeout: 300_000 }, async () => {
    expect(speech.tts.languages()).toContain("en");
    const wav = await speech.tts.synth("Take me to the balcony", "en");
    const pcm = decodeWav(new Uint8Array(wav));
    const out = await speech.stt.transcribe(resample(pcm.samples, pcm.rate, 16000), "en");
    console.log("heard:", JSON.stringify(out.text), `${out.ms} ms`);
    expect(out.text.toLowerCase()).toMatch(/balcon/);
  });

  it("Hindi: the sentence comes back in Devanagari", { timeout: 300_000 }, async () => {
    const wav = await speech.tts.synth("मुझे बालकनी जाना है", "hi");
    const pcm = decodeWav(new Uint8Array(wav));
    const out = await speech.stt.transcribe(resample(pcm.samples, pcm.rate, 16000), "hi");
    console.log("heard:", JSON.stringify(out.text), `${out.ms} ms`);
    expect(out.text).toMatch(/[ऀ-ॿ]/);
  });

  it("silence is answered with nothing, not a made-up sentence", async () => {
    const out = await speech.stt.transcribe(new Float32Array(16000 * 2), "en");
    expect(out.text).toBe("");
  });
});
