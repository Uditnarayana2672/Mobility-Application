import { isRouteError, route, type RouteFrom, type RoutePrefs } from "./route";
import type { Intent, Target } from "./intent";
import type { Room, Venue } from "./schema";

/**
 * "I want a coffee" -> Pantry, without a cloud model: a small lexicon of everyday NEEDS (English, romanised Hinglish / Telugu, Hindi and
 * Telugu script) is matched against the places of THIS venue. A place answers a need when its tags say so, its name/aliases contain a
 * typical word for it, or its category fits. The result is always an id that exists in the venue, never an invented place.
 */
export interface Need {
  id: string;
  label: string;
  /** Does the sentence express this need? */
  re: RegExp;
  /** Words that appear in the name / aliases of places that satisfy it. */
  names: string[];
  /** Room categories (core/cats) that satisfy it. */
  cats?: string[];
  /** Point-of-interest kinds that satisfy it. */
  poiKinds?: string[];
}

export const NEEDS: Need[] = [
  {
    id: "coffee",
    label: "coffee or tea",
    re: /\b(coffee|tea|chai|cappuccino|espresso|latte|kaapi|kahwa)\b|कॉफी|कॉफ़ी|चाय|కాఫీ|టీ(?:\s|$)|చాయ్/i,
    names: ["pantry", "cafeteria", "canteen", "cafe", "café", "kitchen", "coffee", "tea"],
    cats: ["food"],
    poiKinds: ["coffee"],
  },
  {
    id: "food",
    label: "food",
    re: /\b(hungry|hunger|food|eat|eating|lunch|dinner|breakfast|snack|snacks|khana|khaana|bhookh|bhook|tiffin|meal)\b|भूख|खाना|नाश्ता|ఆకలి|భోజనం|తిండి|టిఫిన్/i,
    names: ["cafeteria", "canteen", "pantry", "kitchen", "dining", "mess", "food"],
    cats: ["food"],
  },
  {
    id: "water",
    label: "drinking water",
    re: /\b(water|thirsty|thirst|paani|pani|neellu|neeru)\b|पानी|प्यास|నీళ్ళు|నీళ్లు|నీరు|దాహం/i,
    names: ["water", "pantry", "kitchen", "cafeteria"],
    poiKinds: ["water"],
  },
  {
    id: "washroom",
    label: "a washroom",
    re: /\b(toilet|toilets|washroom|restroom|bathroom|loo|lavatory|pee|poop|freshen\s*up|wash\s*(?:my\s*)?hands?|shauchalay|bathroom\s*jaana)\b|शौचालय|टॉयलेट|वॉशरूम|बाथरूम|టాయిలెట్|వాష్‌రూమ్|బాత్రూమ్/i,
    names: ["washroom", "toilet", "restroom", "bathroom", "lavatory", "loo", "gents", "ladies"],
    cats: ["washroom"],
  },
  {
    id: "bath",
    label: "a bath or shower",
    re: /\b(shower|have\s+a\s+bath|take\s+a\s+bath|nahana|nahaana|nahane|snanam)\b|नहाना|नहाने|స్నానం/i,
    names: ["bathroom", "bath", "shower"],
    cats: ["washroom"],
  },
  {
    id: "rest",
    label: "a place to rest",
    re: /\b(sleep|sleepy|rest|nap|lie\s*down|bedroom|sona|so\s*jaa|nidra|padukon\w*)\b|सोना|नींद|आराम|నిద్ర|పడుకో/i,
    names: ["bedroom", "my room", "lounge", "wellness"],
    cats: ["wellness"],
  },
  {
    id: "meeting",
    label: "a meeting room",
    re: /\b(meeting|meet|discuss|discussion|conference|interview|brainstorm|video\s*call|team\s*call)\b|मीटिंग|बैठक|సమావేశం|మీటింగ్/i,
    names: ["meeting", "conference", "boardroom", "discussion"],
    cats: ["meeting"],
  },
  {
    id: "work",
    label: "a place to work",
    re: /\b(work|working|study|studying|laptop|desk|workspace|focus)\b|काम|पढ़ाई|పని|చదువు/i,
    names: ["workspace", "work", "desk", "study", "library"],
    cats: ["workspace"],
  },
  {
    id: "print",
    label: "a printer",
    re: /\b(print|printer|printout|photocopy|xerox|scanner)\b|प्रिंट|ప్రింట్|జిరాక్స్/i,
    names: ["print", "admin", "copy"],
    cats: ["admin"],
    poiKinds: ["printer"],
  },
  {
    id: "balcony",
    label: "fresh air",
    re: /\b(balcony|fresh\s*air|sit\s*outside|go\s*outside|terrace|sunlight|sunshine|dry\s*(?:my\s*)?clothes|hawa|baalcony)\b|बालकनी|बाल्कनी|छत|హవా|బాల్కనీ/i,
    names: ["balcony", "terrace", "garden", "outside"],
  },
  {
    id: "exit",
    label: "an exit",
    re: /\b(exit|leave|leaving|go\s*home|way\s*out|get\s*out|emergency|fire|bahar|baahar)\b|बाहर|निकास|నిష్క్రమణ|బయటకు/i,
    names: ["exit", "entrance", "main door", "door"],
    poiKinds: ["exit", "entrance"],
  },
  {
    id: "reception",
    label: "the reception",
    re: /\b(reception|receptionist|visitor|check\s*in|front\s*desk|help\s*desk|helpdesk|enquiry|inquiry)\b|रिसेप्शन|రిసెప్షన్/i,
    names: ["reception", "front desk", "lobby"],
    cats: ["reception"],
  },
  {
    id: "firstaid",
    label: "first aid",
    re: /\b(first\s*aid|doctor|medicine|medical|hurt|injured|injury|bandage|headache|unwell|sick)\b|दवा|डॉक्टर|చికిత్స|డాక్టర్/i,
    names: ["first aid", "medical", "clinic", "sick"],
    poiKinds: ["firstaid"],
  },
  {
    id: "it",
    label: "the IT / server room",
    re: /\b(server|servers|network|wifi|wi-fi|router|internet|it\s*support|it\s*help)\b|सर्वर|సర్వర్|వైఫై/i,
    names: ["server", "it", "network"],
  },
  {
    id: "stairs",
    label: "the stairs",
    re: /\b(upstairs|downstairs|go\s+up|go\s+down|next\s+floor|other\s+floor|ground\s+floor)\b|ऊपर|नीचे|పైకి|కిందకు/i,
    names: ["stairs", "staircase", "lift", "elevator"],
    cats: ["vertical"],
  },
  // Airports and other transport buildings (answered only when the venue has such places)
  {
    id: "checkin",
    label: "check-in",
    re: /\b(check[\s-]*in|checkin|bag\s*drop|drop\s*(?:off\s*)?(?:my\s*)?(?:bag|bags|luggage|baggage)|boarding\s*pass|ticketing)\b/i,
    names: ["check-in", "check in", "bag drop", "ticketing"],
    cats: ["checkin"],
  },
  {
    id: "security",
    label: "security or immigration",
    re: /\b(security|screening|immigration|emigration|customs|passport\s*control)\b/i,
    names: ["security", "immigration", "emigration", "customs"],
    cats: ["security"],
  },
  {
    id: "baggage",
    label: "baggage reclaim",
    re: /\b(baggage|luggage|suitcase|suitcases|reclaim|carousel|bags?)\b/i,
    names: ["baggage", "reclaim"],
    cats: ["baggage"],
  },
  {
    id: "shopping",
    label: "a shop",
    re: /\b(shop|shops|shopping|buy|souvenir|souvenirs|gift|gifts|duty\s*free|store)\b/i,
    names: ["shop", "store", "duty free"],
    cats: ["retail"],
  },
  {
    id: "lounge",
    label: "a lounge",
    re: /\b(lounge|spa|sleeping\s*pods?|business\s*lounge)\b/i,
    names: ["lounge", "pods", "spa"],
    cats: ["lounge"],
  },
  {
    id: "taxi",
    label: "a taxi or cab",
    re: /\b(taxi|cab|cabs|uber|ola|car\s*rental|prepaid)\b/i,
    names: ["taxi", "cab"],
    poiKinds: ["taxi"],
  },
  {
    id: "atm",
    label: "an ATM",
    re: /\b(atm|cash\s*machine|cash|money)\b/i,
    names: ["atm"],
    poiKinds: ["atm"],
  },
  {
    id: "currency",
    label: "currency exchange",
    re: /\b(currency|forex|foreign\s*exchange|exchange\s*(?:my\s*)?(?:money|dollars|rupees))\b/i,
    names: ["currency", "forex"],
    poiKinds: ["currency"],
  },
  {
    id: "info",
    label: "an information desk",
    re: /\b(information|info\s*desk|lost\s*(?:and|&)\s*found|enquiries)\b/i,
    names: ["information", "lost"],
    poiKinds: ["info"],
  },
  {
    id: "prayer",
    label: "a prayer room",
    re: /\b(pray|prayer|namaz|puja)\b/i,
    names: ["prayer"],
    poiKinds: ["prayer"],
  },
  {
    id: "babycare",
    label: "a baby care room",
    re: /\b(baby|diaper|nappy|nursing)\b/i,
    names: ["baby"],
    poiKinds: ["babycare"],
  },
  {
    id: "charging",
    label: "a charging point",
    re: /\b(charge|charging|charger|power\s*socket)\b/i,
    names: ["charging"],
    poiKinds: ["charging"],
  },
];

export interface NeedCandidate {
  target: Target;
  name: string;
  /** 100 tagged for the need, 90 name / alias, 70 category or point-of-interest kind. */
  score: number;
}

/** Which needs does this sentence express (in lexicon order)? */
export function detectNeeds(text: string): Need[] {
  const t = text.normalize("NFKC");
  return NEEDS.filter((n) => n.re.test(t));
}

const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word match (so "rest" does not hit "Restroom" and "room" does not hit "Bathroom"); a plural "s" is tolerated. */
export function hasWord(hay: string, word: string): boolean {
  return new RegExp(`(^|[^\\p{L}])${escapeRe(word.toLowerCase())}(s|es)?($|[^\\p{L}])`, "u").test(hay.toLowerCase());
}

function roomScore(r: Room, n: Need): number {
  if (r.access === "staff" || r.cat === "restricted") return 0;
  if (r.tags?.some((t) => t.toLowerCase() === n.id)) return 100;
  const hay = [r.name, ...(r.aliases ?? [])];
  if (n.names.some((w) => hay.some((h) => hasWord(h, w)))) return 90;
  if (n.cats?.includes(r.cat)) return 70;
  return 0;
}

/** Every place in the venue that answers a need, best first. */
export function needCandidates(v: Venue, n: Need): NeedCandidate[] {
  const out: NeedCandidate[] = [];
  for (const r of v.rooms) {
    const score = roomScore(r, n);
    if (score) out.push({ target: { room: r.id }, name: r.name, score });
  }
  for (const p of v.pois) if (n.poiKinds?.includes(p.kind)) out.push({ target: { poi: p.id }, name: p.name, score: 70 });
  return out.sort((a, b) => b.score - a.score);
}

/**
 * A "goto" for the first need in the sentence that this venue can satisfy. With several equally good places the nearest by walking time
 * wins (when the position is known), so "I want a coffee" picks the closer of the cafeteria and the pantry.
 */
export function resolveNeed(v: Venue, text: string, ctx?: { from?: RouteFrom; prefs?: Partial<RoutePrefs> }): { intent: Intent; confidence: number; need: Need } | null {
  for (const need of detectNeeds(text)) {
    const all = needCandidates(v, need);
    if (!all.length) continue;
    const top = all[0]!.score;
    const best = all.filter((c) => c.score >= top - 5);
    let pick = best[0]!;
    if (best.length > 1 && ctx?.from) {
      let bestTime = Infinity;
      for (const c of best) {
        const r = route(v, ctx.from, c.target, ctx.prefs);
        if (!isRouteError(r) && r.time < bestTime) {
          bestTime = r.time;
          pick = c;
        }
      }
    }
    const confidence = best.length === 1 ? (top >= 90 ? 0.88 : 0.78) : 0.8;
    return { intent: { type: "goto", target: pick.target, name: pick.name, ...(best.length > 1 ? { nearest: true as const } : {}) }, confidence, need };
  }
  return null;
}
