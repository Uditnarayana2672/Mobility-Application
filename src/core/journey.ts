import { search } from "./search";
import type { Target } from "./intent";
import type { Venue } from "./schema";

/**
 * "I am near the lift lobby and I want to go to the pantry" -> where the visitor is AND where they want to go, in one sentence,
 * without a cloud model. English, romanised Hinglish and "from X to Y". Both places must exist in THIS venue (found with the venue's own
 * search), otherwise nothing is returned and the caller may ask the AI or the visitor.
 */
export interface Journey {
  from: Target;
  fromName: string;
  to: Target;
  toName: string;
}
export interface Here {
  at: Target;
  name: string;
}

const hit = (v: Venue, phrase: string): { target: Target; name: string; score: number } | null => {
  const q = phrase.trim();
  if (q.length < 2) return null;
  const best = search(v, q)[0];
  if (!best || best.score < (best.type === "poi" ? 50 : 55)) return null; // a point (entrance, water...) scores at most 50
  return best.type === "room" ? { target: { room: best.id }, name: best.room.name, score: best.score } : { target: { poi: best.id }, name: best.poi.name, score: best.score };
};

const sameTarget = (a: Target, b: Target): boolean => ("room" in a && "room" in b ? a.room === b.room : "poi" in a && "poi" in b ? a.poi === b.poi : false);

/** Words that say "I am here / at": removed from the front of the start phrase. */
const LOC = /^(?:(?:i|we)\s*(?:am|are|'m|’m|m)|im|currently|right\s+now|now|standing|waiting|sitting|stuck|main|mai|mein|hum)\s*/i;
const PREP = /^(?:near|nearby|at|in|inside|outside|by|beside|besides|next\s+to|close\s+to|around|opposite|in\s+front\s+of|just\s+(?:near|outside|inside)|the)\s+/i;
const TAIL = /\s*(?:ke\s+(?:paas|pass|pas|andar|bahar)|ke\s+saamne|ke\s+samne|hoon|hu|hun|hai|\bi|here|now|right\s+now|currently|,|\.|and|then|so|aur|lekin|but)+\s*$/i;

/** The place phrase of "I am near X and ...": with and without the leading "main" (Hinglish "I"), which can also begin a name ("Main Entrance"). */
function startCandidates(raw: string): string[] {
  const base = raw.trim().replace(/[.,!?]+$/g, "");
  const strip = (s0: string, loc: boolean): string => {
    let s = loc ? s0.replace(LOC, "") : s0;
    for (let i = 0; i < 6; i++) {
      const before = s;
      s = s.replace(PREP, "").replace(TAIL, "").trim();
      if (s === before) break;
    }
    return s.replace(/^thes+/i, "").trim();
  };
  return [...new Set([strip(base, true), strip(base, false)])];
}
const hitAny = (v: Venue, phrases: string[]) => {
  for (const p of phrases) {
    const h = hit(v, p);
    if (h) return h;
  }
  return null;
};
function cleanDest(raw: string): string {
  return raw
    .trim()
    .replace(/[.,!?]+$/g, "")
    .replace(/^(?:the|to|ko)\s+/i, "")
    .replace(/\s+(?:please|pls|now|jaana\s+hai|jana\s+hai|jaana|jana|tak|ko)\s*$/i, "")
    .replace(/^the\s+/i, "")
    .trim();
}

/** The part of a sentence that says where to go, and what came before it. English: after the go-marker; Hinglish: before "jaana hai". */
const GO_EN = /\b(?:(?:want|need|wanna|would\s+like|like|have|am\s+trying|trying)\s+to\s+(?:go|get|reach|walk|head|navigate)(?:\s+(?:to|towards))?|(?:want|need|wanna)\s+to\s+(?:see|visit)|go\s+to|get\s+to|reach|take\s+me\s+to|take\s+me|bring\s+me\s+to|navigate\s+to|directions?\s+to|heading\s+to|head\s+to|walk\s+to)\b/i;
const GO_HI = /\b(?:jaana\s+hai|jana\s+hai|jaana\s+chahta\s+hoon|jana\s+chahta\s+hoon|jaana\s+chahti\s+hoon|le\s+chalo|le\s+jao|leke\s+chalo)\b/i;

export function parseJourney(v: Venue, text: string): Journey | null {
  const t = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!t) return null;
  let startRaw: string | null = null;
  let destRaw: string | null = null;

  // "from X to Y"
  const fromTo = /\bfrom\s+(.+?)\s+to\s+(.+)$/i.exec(t);
  if (fromTo) {
    startRaw = fromTo[1]!;
    destRaw = fromTo[2]!;
  }
  // Hinglish: "main lift lobby ke paas hoon aur pantry jaana hai"
  if (!startRaw) {
    const hi = GO_HI.exec(t);
    if (hi && hi.index > 0) {
      const before = t.slice(0, hi.index);
      const m = /^(.*?)(?:\s+(?:aur|and|phir|fir|then)\s+)(.+)$/i.exec(before);
      if (m) {
        startRaw = m[1]!;
        destRaw = m[2]!;
      }
    }
  }
  // English: "<start> (and|,|then) I want to go to <dest>"
  if (!startRaw) {
    const go = GO_EN.exec(t);
    if (go && go.index > 0) {
      startRaw = t.slice(0, go.index);
      destRaw = t.slice(go.index + go[0].length);
    }
  }
  if (!startRaw || !destRaw) return null;
  const a = hitAny(v, startCandidates(startRaw));
  const b = hit(v, cleanDest(destRaw));
  if (!a || !b || sameTarget(a.target, b.target)) return null;
  return { from: a.target, fromName: a.name, to: b.target, toName: b.name };
}

/** "I am near the lift lobby" (no destination): where the visitor says they are. */
export function parseHere(v: Venue, text: string): Here | null {
  const t = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  const m = /^(?:(?:i|we)\s*(?:am|are|'m|’m)|im|main|mai|mein)\s+(?:currently\s+|right\s+now\s+|standing\s+|waiting\s+|sitting\s+)?(?:(?:near|nearby|at|in|inside|outside|by|beside|next\s+to|close\s+to|around|opposite|in\s+front\s+of)\s+)(.+)$/i.exec(t) ?? /^(.+?)\s+ke\s+(?:paas|pass)\s+(?:hoon|hu|hun|hai)\s*$/i.exec(t);
  if (!m) return null;
  const found = hitAny(v, startCandidates(m[1]!));
  return found ? { at: found.target, name: found.name } : null;
}
