import type { Lang } from "../../src/core/instructions";
import { PiperTts, type TtsEngine } from "./tts";
import { WhisperStt, type SttEngine, type SttStatus } from "./stt";

export interface SpeechStatus {
  stt: SttStatus;
  tts: { available: boolean; languages: Lang[] };
}

/** The two local speech engines behind /api/stt and /api/tts. Tests pass fakes. */
export interface SpeechService {
  stt: SttEngine;
  tts: TtsEngine;
  status(): SpeechStatus;
}

export function createLocalSpeech(root: string, opts: { warm?: boolean } = {}): SpeechService {
  const stt = new WhisperStt(root);
  const tts = new PiperTts(root);
  if (opts.warm) stt.warm();
  return {
    stt,
    tts,
    status: () => ({ stt: stt.status(), tts: { available: tts.languages().length > 0, languages: tts.languages() } }),
  };
}

export type { SttEngine, TtsEngine };
