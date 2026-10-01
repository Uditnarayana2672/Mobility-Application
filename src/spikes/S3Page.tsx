import { useEffect, useRef, useState } from "react";
import SpikeShell, { Btn, Readout, useLog } from "./SpikeShell";

const LANGS = ["en-IN", "hi-IN", "te-IN"] as const;
type Lang = (typeof LANGS)[number];

const SENTENCES: Record<Lang, string> = {
  "en-IN": "Walk straight for twenty metres, then turn left at the cafeteria.",
  "hi-IN": "सीधे बीस मीटर चलिए, फिर कैफेटेरिया पर बाएँ मुड़िए।",
  "te-IN": "ఇరవై మీటర్లు నేరుగా నడవండి, తర్వాత కెఫెటేరియా దగ్గర ఎడమవైపు తిరగండి.",
};

const PHRASES: Record<Lang, string> = {
  "en-IN": "where is the washroom",
  "hi-IN": "cafeteria kahan hai",
  "te-IN": "washroom ekkada undi",
};

// Minimal typings: SpeechRecognition is webkit-prefixed in Chrome and absent from lib.dom.
interface Rec {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
interface RecEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }>;
}
type RecCtor = new () => Rec;

const norm = (l: string) => l.replace("_", "-").toLowerCase();

interface Heard {
  lang: Lang;
  text: string;
  confidence: number;
}

export default function S3Page() {
  const { lines, log } = useLog();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speakOk, setSpeakOk] = useState<Partial<Record<Lang, boolean | null>>>({});
  const [recLang, setRecLang] = useState<Lang>("en-IN");
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [heard, setHeard] = useState<Heard[]>([]);
  const [notes, setNotes] = useState("");
  const rec = useRef<Rec | null>(null);

  const Ctor = ((window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: RecCtor }).webkitSpeechRecognition) as RecCtor | undefined;

  useEffect(() => {
    const load = () => setVoices(speechSynthesis.getVoices());
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      speechSynthesis.removeEventListener("voiceschanged", load);
      speechSynthesis.cancel();
      rec.current?.stop();
    };
  }, []);

  const voiceFor = (lang: Lang) => voices.find((v) => norm(v.lang) === norm(lang)) ?? voices.find((v) => norm(v.lang).startsWith(norm(lang).slice(0, 2)));

  const speak = (lang: Lang) => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(SENTENCES[lang]);
    u.lang = lang;
    const v = voiceFor(lang);
    if (v) u.voice = v;
    u.onstart = () => log(`speak ${lang}: started (voice: ${v ? `${v.name} [${v.lang}]` : "none, UA default"})`);
    u.onend = () => log(`speak ${lang}: finished`);
    u.onerror = (e) => log(`speak ${lang}: ERROR ${e.error}`);
    speechSynthesis.speak(u);
  };

  const listen = () => {
    if (!Ctor) {
      log("SpeechRecognition is not available in this browser");
      return;
    }
    rec.current?.stop();
    const r = new Ctor();
    r.lang = recLang;
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        const alt = res[0]!;
        if (res.isFinal) {
          setHeard((h) => [{ lang: recLang, text: alt.transcript, confidence: alt.confidence }, ...h]);
          setInterim("");
          log(`heard (${recLang}): "${alt.transcript}" (${alt.confidence.toFixed(2)})`);
        } else setInterim(alt.transcript);
      }
    };
    r.onerror = (e) => log(`recognition error: ${e.error}`);
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
    log(`listening in ${recLang}…`);
  };

  const getResults = () => ({
    recognitionAvailable: !!Ctor,
    totalVoices: voices.length,
    voicesByLang: Object.fromEntries(LANGS.map((l) => [l, voices.filter((v) => norm(v.lang) === norm(l)).map((v) => v.name)])),
    spokeAndHeardOk: speakOk,
    transcripts: heard,
    notes,
  });

  return (
    <SpikeShell name="s3" title="S3 · Voice" getResults={getResults} log={{ lines }}>
      <div className="grid grid-cols-2 gap-2">
        <Readout label="voices" value={voices.length} />
        <Readout label="recognition" value={Ctor ? "available" : "NO"} warn={!Ctor} />
      </div>

      <h2 className="font-semibold">Speech out</h2>
      {LANGS.map((l) => {
        const exact = voices.filter((v) => norm(v.lang) === norm(l));
        return (
          <div key={l} className="rounded-lg border border-neutral-800 p-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-mono text-lg font-bold">{l}</div>
                <div className={`text-xs ${exact.length ? "text-emerald-300" : "text-amber-300"}`}>
                  {exact.length ? `${exact.length} voice(s): ${exact.map((v) => v.name).join(", ")}` : "no exact voice installed"}
                </div>
              </div>
              <Btn onClick={() => speak(l)}>Speak</Btn>
            </div>
            <div className="mt-1 text-sm text-neutral-300">{SENTENCES[l]}</div>
            <div className="mt-1 flex gap-2 text-sm">
              Understandable?
              <button className={`rounded px-2 ${speakOk[l] === true ? "bg-emerald-600" : "bg-neutral-700"}`} onClick={() => setSpeakOk((s) => ({ ...s, [l]: true }))}>
                yes
              </button>
              <button className={`rounded px-2 ${speakOk[l] === false ? "bg-red-600" : "bg-neutral-700"}`} onClick={() => setSpeakOk((s) => ({ ...s, [l]: false }))}>
                no
              </button>
            </div>
          </div>
        );
      })}

      <h2 className="font-semibold">Speech in</h2>
      <div className="flex gap-2">
        {LANGS.map((l) => (
          <button key={l} className={`flex-1 rounded px-2 py-2 font-mono ${recLang === l ? "bg-sky-600" : "bg-neutral-800"}`} onClick={() => setRecLang(l)}>
            {l}
          </button>
        ))}
      </div>
      <div className="text-sm text-neutral-300">
        Say: <b>"{PHRASES[recLang]}"</b> (also try "cafeteria kahan hai" in hi-IN and "washroom ekkada undi" in te-IN)
      </div>
      <Btn disabled={listening || !Ctor} onClick={listen}>
        {listening ? "Listening…" : "Listen"}
      </Btn>
      <div className="min-h-8 font-mono text-lg text-amber-300">{interim}</div>
      <div className="space-y-1">
        {heard.map((h, i) => (
          <div key={i} className="font-mono text-sm">
            [{h.lang}] "{h.text}" ({h.confidence.toFixed(2)})
          </div>
        ))}
      </div>
      <label className="block text-sm">
        Notes
        <textarea className="mt-1 w-full rounded bg-neutral-800 p-2" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
    </SpikeShell>
  );
}
