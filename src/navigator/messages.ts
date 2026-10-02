import type { Lang } from "@/core/instructions";

/** Spoken / shown replies, en / Hinglish / Telugu. Ported from the mock (MSG, EXAMPLES) plus the lines the session adds. */
type L<A extends unknown[]> = Record<Lang, (...a: A) => string>;

export const MSG = {
  goto: { en: (n) => `Okay, finding the best route to ${n}.`, hi: (n) => `Theek hai, ${n} ka sabse accha raasta dhoondh raha hoon.`, te: (n) => `సరే, ${n} కి ఉత్తమ మార్గాన్ని వెతుకుతున్నాను.` } as L<[string]>,
  show: {
    en: (n, f, t) => `${n} is on ${f}, about ${t} away. Tap Directions to go.`,
    hi: (n, f, t) => `${n} ${f} par hai, lagbhag ${t} door. Raasta jaanne ke liye Directions dabaiye.`,
    te: (n, f, t) => `${n} ${f} లో ఉంది, సుమారు ${t} దూరంలో. దారి కోసం Directions నొక్కండి.`,
  } as L<[string, string, string]>,
  where: { en: (f, p) => `You are on ${f}, near ${p}.`, hi: (f, p) => `Aap ${f} par hain, ${p} ke paas.`, te: (f, p) => `మీరు ${f} లో ${p} దగ్గర ఉన్నారు.` } as L<[string, string]>,
  unknown: {
    en: () => "Sorry, I didn’t catch that. Try “Where is the cafeteria?”",
    hi: () => "Maaf kijiye, samajh nahi aaya. Try kijiye: “Cafeteria kahan hai?”",
    te: () => "క్షమించండి, అర్థం కాలేదు. “క్యాంటీన్ ఎక్కడ ఉంది?” అని ప్రయత్నించండి.",
  } as L<[]>,
  stop: { en: () => "Navigation ended.", hi: () => "Navigation band kar diya.", te: () => "నావిగేషన్ ఆపివేశాను." } as L<[]>,
  pref: { en: () => "Okay, I’ll avoid stairs.", hi: () => "Theek hai, seedhiyon se bachenge.", te: () => "సరే, మెట్లు నివారిస్తాను." } as L<[]>,
  restricted: {
    en: (n) => `${n} is staff-only, so I can’t route you there.`,
    hi: (n) => `${n} sirf staff ke liye hai, wahan raasta nahi de sakta.`,
    te: (n) => `${n} కేవలం సిబ్బందికి మాత్రమే, అక్కడికి మార్గం ఇవ్వలేను.`,
  } as L<[string]>,
  noRoute: { en: () => "Sorry, I can’t find a route there.", hi: () => "Maaf kijiye, wahan ka raasta nahi mila.", te: () => "క్షమించండి, అక్కడికి మార్గం దొరకలేదు." } as L<[]>,
  needLocation: { en: () => "Scan a marker first so I know where you are.", hi: () => "Pehle marker scan kijiye taaki pata chale aap kahan hain.", te: () => "మీరు ఎక్కడ ఉన్నారో తెలియడానికి ముందు మార్కర్ స్కాన్ చేయండి." } as L<[]>,
  offRoute: { en: () => "You are off the route. Recalculating.", hi: () => "Aap route se hat gaye hain. Naya raasta dhoondh raha hoon.", te: () => "మీరు మార్గం తప్పారు. కొత్త మార్గం వెతుకుతున్నాను." } as L<[]>,
  floorPrompt: { en: (f) => `Are you on ${f} now?`, hi: (f) => `Kya aap ab ${f} par hain?`, te: (f) => `మీరు ఇప్పుడు ${f} లో ఉన్నారా?` } as L<[string]>,
};

export const EXAMPLES: Record<Lang, string[]> = {
  en: ["Where is the cafeteria?", "Take me to Everest meeting room", "Nearest washroom", "Avoid stairs", "Where am I?"],
  hi: ["Cafeteria kahan hai?", "Mujhe canteen le chalo", "Sabse paas ka washroom", "Main kahan hoon?"],
  te: ["క్యాంటీన్ ఎక్కడ ఉంది?", "నన్ను టాయిలెట్ కి తీసుకెళ్ళు", "నేను ఎక్కడ ఉన్నాను?"],
};

export const LANG_SHORT: Record<Lang, string> = { en: "EN", hi: "HI", te: "తె" };
export const NEXT_LANG: Record<Lang, Lang> = { en: "hi", hi: "te", te: "en" };
