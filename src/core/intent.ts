import { isRouteError, route, type RouteFrom, type RoutePrefs } from "./route";
import { search } from "./search";
import type { Venue } from "./schema";

const RE = {
  where: /(where am i|main kahan|mai kahan|mein kahan|నేను ఎక్కడ|मैं कहाँ)/i,
  repeat: /(repeat|dobara|phir se|once more|again|మళ్ళీ|మళ్లీ|फिर से)/i,
  stop: /(stop|cancel|band karo|end nav|ఆపు|रुको)/i,
  avoidStairs: /(avoid stairs|no stairs|without stairs|seedhi nahi|lift se|మెట్లు వద్దు|లిఫ్ట్ లో)/i,
  nearest: /(nearest|nearby|closest|paas|pass wala|దగ్గర|नज़दीक|नजदीक)/i,
  where_is: /(where|kahan|kidhar|ekkada|ఎక్కడ|कहाँ)/i,
  go: /(take me|le chalo|le jao|leke chalo|navigate|go to|directions|jana hai|jaana|తీసుకెళ్|వెళ్ళాలి|వెళ్లాలి|चलो|ले चलो)/i,
};

export type Target = { room: string } | { poi: string };

export type Intent =
  | { type: "unknown" }
  | { type: "stop" }
  | { type: "repeat" }
  | { type: "whereami" }
  | { type: "pref"; avoidStairs: true }
  | { type: "goto"; nearest?: true; target: Target; name: string }
  | { type: "show"; target: Target; name: string };

export interface IntentContext {
  from?: RouteFrom;
  prefs?: Partial<RoutePrefs>;
}

/** Deterministic intent matcher (en / Hinglish / Telugu). No AI. */
export function intent(v: Venue, text: string, ctx?: IntentContext): Intent {
  const t = (text || "").trim();
  if (!t) return { type: "unknown" };
  if (RE.stop.test(t)) return { type: "stop" };
  if (RE.repeat.test(t)) return { type: "repeat" };
  if (RE.where.test(t)) return { type: "whereami" };
  if (RE.avoidStairs.test(t)) return { type: "pref", avoidStairs: true };
  const res = search(v, t.replace(RE.nearest, " ").replace(RE.go, " ").replace(RE.where_is, " "));
  const best = res.find((r) => r.score >= 55) ?? res[0];
  if (!best || best.score < 35) return { type: "unknown" };
  if (RE.nearest.test(t) && best.type === "room" && ctx && ctx.from) {
    const same = v.rooms.filter((r) => r.access !== "staff" && r.cat === best.room.cat && (best.room.kind ? r.kind === best.room.kind : true));
    let pick: { room: Venue["rooms"][number]; time: number } | null = null;
    for (const r of same) {
      const rt = route(v, ctx.from, { room: r.id }, ctx.prefs);
      if (!isRouteError(rt) && (!pick || rt.time < pick.time)) pick = { room: r, time: rt.time };
    }
    if (pick) return { type: "goto", nearest: true, target: { room: pick.room.id }, name: pick.room.name };
  }
  const target: Target = best.type === "room" ? { room: best.id } : { poi: best.id };
  const name = best.type === "room" ? best.room.name : best.poi.name;
  if (RE.go.test(t) || !RE.where_is.test(t)) return { type: "goto", target, name };
  return { type: "show", target, name };
}
