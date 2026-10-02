import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { matchIntent, parseVenue, type Intent, type Venue } from "@/core";

const parsed = parseVenue(JSON.parse(fs.readFileSync("public/venues/office-hq/venue.json", "utf8")));
if (!parsed.ok) throw new Error("bad fixture");
const V: Venue = parsed.data;
const ctx = { from: { floor: "F1", x: 3, y: 17, heading: 0 } as const, prefs: {} };

type Kind = Intent["type"];
const corpus: Array<[string, Kind]> = [
  // English (24)
  ["take me to the cafeteria", "goto"], ["go to Everest", "goto"], ["directions to reception", "goto"], ["navigate to the lift", "goto"],
  ["bring me to the pantry", "goto"], ["nearest washroom", "goto"], ["closest elevator", "goto"], ["nearest water cooler", "goto"],
  ["where is the cafeteria", "show"], ["where's the printer", "show"], ["where is HR", "show"], ["where is the fire exit", "show"],
  ["where am I", "whereami"], ["where are we", "whereami"], ["repeat", "repeat"], ["once more", "repeat"],
  ["stop navigation", "stop"], ["cancel", "stop"], ["avoid stairs", "pref"], ["without stairs please", "pref"],
  ["switch to AR", "switch"], ["show the map", "switch"], ["how long", "howlong"], ["how much time left", "howlong"],

  // Romanised Hinglish (24)
  ["mujhe canteen le chalo", "goto"], ["Everest le jao", "goto"], ["reception jana hai", "goto"], ["lift tak leke chalo", "goto"],
  ["pantry navigate karo", "goto"], ["sabse paas ka washroom", "goto"], ["closest seedhi", "goto"], ["paas wala water cooler", "goto"],
  ["cafeteria kahan hai", "show"], ["printer kidhar hai", "show"], ["HR kahan hai", "show"], ["fire exit kidhar hai", "show"],
  ["main kahan hoon", "whereami"], ["mai kahan", "whereami"], ["dobara", "repeat"], ["phir se", "repeat"],
  ["band karo", "stop"], ["navigation stop", "stop"], ["seedhi nahi", "pref"], ["lift se jaana", "pref"],
  ["AR mode dikhao", "switch"], ["map pe jao", "switch"], ["kitna time baaki hai", "howlong"], ["aur kitni der", "howlong"],

  // Telugu script + romanised Telugu (24)
  ["నన్ను క్యాంటీన్ కి తీసుకెళ్ళు", "goto"], ["ఎవరెస్ట్ కి తీసుకెళ్లండి", "goto"], ["reception ki teesukellu", "goto"], ["lift ki vellali", "goto"],
  ["nannu pantry ki teesukellu", "goto"], ["దగ్గర టాయిలెట్", "goto"], ["athi daggara lift", "goto"], ["deggara water cooler", "goto"],
  ["క్యాంటీన్ ఎక్కడ ఉంది", "show"], ["printer ekkada undi", "show"], ["హెచ్ఆర్ ఎక్కడ", "show"], ["fire exit ekkada", "show"],
  ["నేను ఎక్కడ ఉన్నాను", "whereami"], ["nenu ekkada unnanu", "whereami"], ["మళ్లీ", "repeat"], ["malli cheppu", "repeat"],
  ["ఆపు", "stop"], ["navigation aapu", "stop"], ["మెట్లు వద్దు", "pref"], ["metlu vaddu", "pref"],
  ["AR ki maaru", "switch"], ["మ్యాప్ కి మారు", "switch"], ["ఎంత సేపు", "howlong"], ["inka entha sepu", "howlong"],
];

describe("deterministic multilingual intent corpus", () => {
  it("contains at least 60 utterances", () => expect(corpus.length).toBeGreaterThanOrEqual(60));
  it.each(corpus)("%s → %s", (text, type) => {
    const got = matchIntent(V, text, ctx);
    expect(got.intent.type).toBe(type);
    expect(got.confidence).toBeGreaterThanOrEqual(0.65);
  });
});
