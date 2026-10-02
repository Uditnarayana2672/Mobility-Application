import type { Step, TurnStep, VerticalStep, ArriveStep } from "./route";

/** Turn-by-turn text in en / Hinglish (hi) / Telugu (te). Strings copied verbatim from the mock engine. */
export type Lang = "en" | "hi" | "te";

interface Strings {
  viaWord(v: string | null): string;
  turn(s: TurnStep): string;
  vertical(s: VerticalStep): string;
  arrive(s: ArriveStep): string;
  inM(d: number): string;
  now: string;
  then(d: number): string;
  walk(d: number): string;
  arrived(n: string): string;
  straight: string;
}

const T: Record<Lang, Strings> = {
  en: {
    viaWord: (v) => (v === "lift" ? "lift" : "stairs"),
    turn(s) {
      const pre = s.afterV ? `leave the ${this.viaWord(s.via)}, then ` : "";
      return pre + `turn ${s.dir}` + (s.into ? ` into ${s.into}` : s.landmark ? ` near ${s.landmark}` : "");
    },
    vertical: (s) => `take the ${s.via === "lift" ? "lift" : "stairs"} ${s.up ? "up" : "down"} to ${s.toFloorName}`,
    arrive: (s) => `arrive at ${s.name}`,
    inM: (d) => `In ${d} metres, `,
    now: "Now, ",
    then: (d) => `then walk ${d} m`,
    walk: (d) => `Walk ${d} m`,
    arrived: (n) => `You have arrived at ${n}.`,
    straight: "Continue straight",
  },
  hi: {
    viaWord: (v) => (v === "lift" ? "lift" : "seedhiyon"),
    turn(s) {
      const pre = s.afterV ? `${this.viaWord(s.via)} se bahar nikal kar, ` : "";
      return pre + `${s.dir === "left" ? "baayein" : "daayein"} mudiye` + (s.into ? ` (${s.into} ke andar)` : s.landmark ? ` (${s.landmark} ke paas)` : "");
    },
    vertical: (s) => `${s.via === "lift" ? "Lift" : "Seedhiyon"} se ${s.toFloorName} par ${s.up ? "upar" : "neeche"} jaiye`,
    arrive: (s) => `${s.name} par pahunch jayenge`,
    inM: (d) => `${d} meter baad, `,
    now: "Ab, ",
    then: (d) => `phir ${d} meter chaliye`,
    walk: (d) => `${d} meter chaliye`,
    arrived: (n) => `Aap ${n} par pahunch gaye hain.`,
    straight: "Seedhe chaliye",
  },
  te: {
    viaWord: (v) => (v === "lift" ? "లిఫ్ట్" : "మెట్ల"),
    turn(s) {
      const pre = s.afterV ? `${this.viaWord(s.via)} నుండి బయటకు వచ్చి, ` : "";
      return pre + `${s.dir === "left" ? "ఎడమవైపు" : "కుడివైపు"} తిరగండి` + (s.into ? ` (${s.into} లోకి)` : s.landmark ? ` (${s.landmark} దగ్గర)` : "");
    },
    vertical: (s) => `${s.via === "lift" ? "లిఫ్ట్" : "మెట్ల"} ద్వారా ${s.toFloorName} కి ${s.up ? "పైకి" : "కిందకి"} వెళ్లండి`,
    arrive: (s) => `${s.name} కి చేరుకుంటారు`,
    inM: (d) => `${d} మీటర్ల తర్వాత, `,
    now: "ఇప్పుడు, ",
    then: (d) => `తర్వాత ${d} మీటర్లు నడవండి`,
    walk: (d) => `${d} మీటర్లు నడవండి`,
    arrived: (n) => `మీరు ${n} కి చేరుకున్నారు.`,
    straight: "నేరుగా వెళ్ళండి",
  },
};

export const LANGS: Record<Lang, { label: string; speech: string }> = {
  en: { label: "English", speech: "en-IN" },
  hi: { label: "Hinglish", speech: "hi-IN" },
  te: { label: "తెలుగు", speech: "te-IN" },
};

const strings = (lang: string): Strings => (T as Record<string, Strings>)[lang] ?? T.en;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const round = (d: number): number => (d > 20 ? Math.round(d / 5) * 5 : Math.round(d));

function action(t: Strings, step: Step): string {
  return step.kind === "turn" ? t.turn(step) : step.kind === "vertical" ? t.vertical(step) : t.arrive(step);
}

export function stepAction(step: Step, lang: string): string {
  return cap(action(strings(lang), step));
}

export function stepSpeech(step: Step, lang: string, remaining: number): string {
  const t = strings(lang);
  const pre = remaining < 3 ? t.now : t.inM(round(remaining));
  return pre + action(t, step) + ".";
}

export const walkText = (d: number, lang: string): string => strings(lang).walk(Math.round(d));
export const thenText = (d: number, lang: string): string => strings(lang).then(Math.round(d));
export const arrivedText = (n: string, lang: string): string => strings(lang).arrived(n);
export const fmtTime = (sec: number): string => (sec < 55 ? `${Math.max(5, Math.round(sec / 5) * 5)} sec` : `${Math.round(sec / 30) / 2} min`);
