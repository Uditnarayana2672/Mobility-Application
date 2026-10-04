import { isRouteError, route, type RouteFrom, type RoutePrefs } from "./route";
import { resolveNeed } from "./needs";
import { parseHere, parseJourney } from "./journey";
import { search, type SearchHit } from "./search";
import type { Venue } from "./schema";

const RE = {
  where: /(where\s+am\s+i|where\s+are\s+we|(?:main|mai|mein)\s+kaha+n?(?:\s+hoon)?|nenu\s+ekkada(?:\s+unnanu)?)|నేను\s*ఎక్కడ|मैं\s*कहाँ/i,
  repeat: /\b(repeat|again|once\s+more|dobara|phir\s+se|malli(?:\s+cheppu)?)\b|మళ్ళీ|మళ్లీ|फिर\s+से/i,
  stop: /\b(stop|cancel|band\s+karo|end\s+nav(?:igation)?|aapu|navigation\s+aapu)\b|ఆపు|रुको/i,
  avoidStairs: /\b(avoid\s+stairs|no\s+stairs|without\s+stairs|seedhi(?:yan)?\s+nahi|lift\s+se|metlu\s+vaddu|lift\s+lo)\b|మెట్లు\s*వద్దు|లిఫ్ట్\s*లో/i,
  nearest: /\b(nearest|nearby|closest|paas|pass\s+wala|sabse\s+paas|daggara|deggara|athi\s+daggara)\b|దగ్గర|नज़दीक|नजदीक/i,
  whereIs: /\b(where(?:\s+is|'s)?|kahan|kidhar|ekkada)\b|ఎక్కడ|कहाँ/i,
  go: /\b(take\s+me|bring\s+me|le\s+chalo|le\s+jao|leke\s+chalo|navigate|go\s+to|directions?(?:\s+to)?|jana\s+hai|jaana|nannu|teesukellu|teesukellandi|vellali)\b|తీసుకెళ్ళు|తీసుకెళ్లండి|వెళ్ళాలి|వెళ్లాలి|चलो|ले\s*चलो/i,
  ar: /\b(switch\s+to\s+ar|show\s+ar|open\s+ar|ar\s+mode|ar\s+(?:ki\s+)?(?:maaru|chupinchu))\b|ఏఆర్\s*(?:కి)?\s*మారు/i,
  map: /\b(switch\s+to\s+(?:the\s+)?map|show\s+(?:the\s+)?map|map\s+mode|map\s+(?:pe|par|ki)\s+(?:jao|maaru)|naksha\s+dikhao)\b|మ్యాప్\s*(?:కి)?\s*మారు|నక్షా/i,
  howLong: /\b(how\s+long|how\s+much\s+(?:longer|time)|time\s+left|eta|kitna\s+time|kitni\s+der|aur\s+kitna|entha\s+sepu|inka\s+entha\s+sepu)\b|ఎంత\s*సేపు|ఇంకా\s*ఎంత/i,
};

export type Target = { room: string } | { poi: string };

export type Intent =
  | { type: "unknown" }
  | { type: "answer"; text: string; suggestions?: Target[] }
  | { type: "stop" }
  | { type: "repeat" }
  | { type: "whereami" }
  | { type: "pref"; avoidStairs: true }
  | { type: "switch"; view: "ar" | "map" }
  | { type: "howlong" }
  | { type: "goto"; nearest?: true; target: Target; name: string }
  | { type: "show"; target: Target; name: string }
  /** "I am near X and I want to go to Y": where the visitor is, and where to. */
  | { type: "journey"; from: Target; fromName: string; target: Target; name: string }
  /** "I am near X": where the visitor says they are. */
  | { type: "locate"; target: Target; name: string };

export interface IntentContext {
  from?: RouteFrom;
  prefs?: Partial<RoutePrefs>;
}

export interface IntentMatch {
  intent: Intent;
  /** 0..1. The assistant endpoint is only eligible below the caller's threshold. */
  confidence: number;
}

function nearestCandidates(v: Venue, hit: SearchHit): SearchHit[] {
  if (hit.type === "room") {
    return v.rooms
      .filter((r) => r.access !== "staff" && r.cat === hit.room.cat && (hit.room.kind ? r.kind === hit.room.kind : true))
      .map((room) => ({ type: "room" as const, id: room.id, room, score: hit.score }));
  }
  return v.pois.filter((p) => p.kind === hit.poi.kind).map((poi) => ({ type: "poi" as const, id: poi.id, poi, score: hit.score }));
}

function targetOf(hit: SearchHit): Target {
  return hit.type === "room" ? { room: hit.id } : { poi: hit.id };
}

function nameOf(hit: SearchHit): string {
  return hit.type === "room" ? hit.room.name : hit.poi.name;
}

/** Deterministic intent matcher with confidence (English, romanised Hinglish, Telugu script and romanised Telugu). */
export function matchIntent(v: Venue, text: string, ctx?: IntentContext): IntentMatch {
  const t = (text || "").normalize("NFKC").trim();
  if (!t) return { intent: { type: "unknown" }, confidence: 0 };
  if (RE.stop.test(t)) return { intent: { type: "stop" }, confidence: 1 };
  if (RE.repeat.test(t)) return { intent: { type: "repeat" }, confidence: 1 };
  const journey = parseJourney(v, t);
  if (journey) return { intent: { type: "journey", from: journey.from, fromName: journey.fromName, target: journey.to, name: journey.toName }, confidence: 0.92 };
  const here = parseHere(v, t);
  if (here) return { intent: { type: "locate", target: here.at, name: here.name }, confidence: 0.85 };
  if (RE.where.test(t)) return { intent: { type: "whereami" }, confidence: 1 };
  if (RE.avoidStairs.test(t)) return { intent: { type: "pref", avoidStairs: true }, confidence: 1 };
  if (RE.ar.test(t)) return { intent: { type: "switch", view: "ar" }, confidence: 1 };
  if (RE.map.test(t)) return { intent: { type: "switch", view: "map" }, confidence: 1 };
  if (RE.howLong.test(t)) return { intent: { type: "howlong" }, confidence: 1 };

  const query = t.replace(RE.nearest, " ").replace(RE.go, " ").replace(RE.whereIs, " ").replace(/\b(the|a|an|mujhe|please|kripya|dayachesi|ka|ko|hai|undi)\b/gi, " ").replace(/(?:కు|కి)/g, " ").replace(/\s+/g, " ").trim().replace(/^to\s+/i, "");
  const results = search(v, query);
  const best = results.find((r) => r.score >= 55) ?? results[0];
  // No clear place name in the sentence: maybe a need ("I want a coffee", "I'm hungry", "I need to sleep").
  // (A sentence that already says "where is …" / "take me to …" about a weakly matched place keeps its old meaning.)
  const asksPlace = RE.go.test(t) || RE.whereIs.test(t) || RE.nearest.test(t);
  if (!best || best.score < 35 || (best.score < 70 && !asksPlace)) {
    const need = resolveNeed(v, t, ctx);
    if (need) {
      const it = need.intent;
      const asWhere = RE.whereIs.test(t) && !RE.go.test(t) && it.type === "goto";
      return { intent: asWhere ? { type: "show", target: it.target, name: it.name } : it, confidence: need.confidence };
    }
  }
  if (!best || best.score < 35) return { intent: { type: "unknown" }, confidence: Math.min(0.34, (best?.score ?? 0) / 100) };

  if (RE.nearest.test(t) && ctx?.from) {
    let pick: { hit: SearchHit; time: number } | null = null;
    for (const hit of nearestCandidates(v, best)) {
      const rt = route(v, ctx.from, targetOf(hit), ctx.prefs);
      if (!isRouteError(rt) && (!pick || rt.time < pick.time)) pick = { hit, time: rt.time };
    }
    if (pick) return { intent: { type: "goto", nearest: true, target: targetOf(pick.hit), name: nameOf(pick.hit) }, confidence: Math.max(0.82, best.score / 100) };
  }

  const target = targetOf(best);
  const name = nameOf(best);
  const explicit = RE.go.test(t) || RE.whereIs.test(t) || RE.nearest.test(t);
  const confidence = Math.min(0.99, Math.max(explicit ? 0.8 : 0.4, best.score / 100));
  if (RE.go.test(t) || (!RE.whereIs.test(t) && RE.nearest.test(t))) return { intent: { type: "goto", target, name }, confidence };
  if (RE.whereIs.test(t)) return { intent: { type: "show", target, name }, confidence };
  return best.score >= 90 ? { intent: { type: "goto", target, name }, confidence } : { intent: { type: "unknown" }, confidence: Math.min(0.49, confidence) };
}

/** Compatibility helper for callers that only need the intent. */
export function intent(v: Venue, text: string, ctx?: IntentContext): Intent {
  return matchIntent(v, text, ctx).intent;
}
