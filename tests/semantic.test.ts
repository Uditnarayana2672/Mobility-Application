import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseVenue, type Venue } from "../src/core";
import { AssistantService } from "../server/assistant";
import { chooseTarget, LocalSemanticRanker, placeDocs, type Embedder } from "../server/semantic";

const load = (p: string): Venue => {
  const r = parseVenue(JSON.parse(fs.readFileSync(p, "utf8")));
  if (!r.ok) throw new Error("bad fixture");
  return r.data;
};
const OFFICE = load("public/venues/office-hq/venue.json");

/** A tiny stand-in for the sentence model: words that mean the same thing share a dimension. */
const CONCEPTS: Record<string, string[]> = {
  drink: ["chai", "tea", "coffee", "pantry", "cafeteria", "food", "drink", "thirsty"],
  toilet: ["toilet", "washroom", "restroom", "pee", "loo"],
  meet: ["meeting", "discuss", "everest", "conference"],
};
const DIMS = Object.keys(CONCEPTS);
const fakeEmbed: Embedder = async (texts) =>
  texts.map((t) => {
    const w = t.toLowerCase().split(/[^a-z]+/);
    const v = DIMS.map((d) => w.filter((x) => CONCEPTS[d]!.includes(x)).length);
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  });

describe("local semantic ranker (closed list of this venue's places)", () => {
  it("builds one document per visible place, never staff-only or restricted ones", () => {
    const docs = placeDocs(OFFICE);
    expect(docs.length).toBeGreaterThan(5);
    const staff = OFFICE.rooms.filter((r) => r.access === "staff" || r.cat === "restricted").map((r) => r.name);
    for (const s of staff) expect(docs.some((d) => d.name === s)).toBe(false);
  });

  it("ranks by similarity and only ever returns places of the venue", async () => {
    const ranker = new LocalSemanticRanker(process.cwd(), "unused", fakeEmbed);
    expect(ranker.ready()).toBe(true);
    const r = await ranker.rank(OFFICE, "I am thirsty, any chai?");
    expect(r[0]!.name).toMatch(/Pantry|Cafeteria/);
    const ids = new Set([...OFFICE.rooms.map((x) => x.id), ...OFFICE.pois.map((p) => p.id)]);
    for (const x of r) expect(ids.has("room" in x.target ? x.target.room : x.target.poi)).toBe(true);
  });

  it("documents say what a place is good for", () => {
    const pantry = placeDocs(OFFICE).find((d) => d.name === "Pantry")!;
    expect(pantry.text.toLowerCase()).toContain("coffee or tea");
  });

  it("chooseTarget: a clear winner, a tie broken by distance, a tie with no position -> ask, a weak match -> ask nothing", () => {
    const hit = (name: string, id: string, score: number, floor?: string) => ({ target: { room: id }, name, score, floor });
    const rooms = OFFICE.rooms.filter((r) => /Cafeteria|Pantry/.test(r.name));
    expect(rooms.length).toBeGreaterThanOrEqual(2);
    const [a, b] = [rooms.find((r) => r.floor === "F1") ?? rooms[0]!, rooms.find((r) => r.floor === "F2") ?? rooms[1]!];
    const ranked = [hit(a.name, a.id, 0.7), hit(b.name, b.id, 0.69)];
    expect("pick" in chooseTarget(OFFICE, [hit("A", "x", 0.8), hit("B", "y", 0.3)], null)).toBe(true);
    const nearF1 = chooseTarget(OFFICE, ranked, { floor: a.floor, x: a.door.x, y: a.door.y, heading: 0 });
    expect("pick" in nearF1 && nearF1.pick.target).toEqual({ room: a.id });
    const nearF2 = chooseTarget(OFFICE, ranked, { floor: b.floor, x: b.door.x, y: b.door.y, heading: 0 });
    expect("pick" in nearF2 && nearF2.pick.target).toEqual({ room: b.id });
    const unknownPos = chooseTarget(OFFICE, ranked, null);
    expect("ask" in unknownPos && unknownPos.ask.length).toBe(a.name === b.name ? 0 : 2);
    expect(chooseTarget(OFFICE, [hit("A", "x", 0.3)], null)).toEqual({ ask: [] });
    expect(chooseTarget(OFFICE, [], null)).toEqual({ ask: [] });
  });
});

describe("assistant without a cloud model uses the local ranker", () => {
  const offline = { name: "off", available: () => false, answer: async () => "" };
  const req = { venueId: "office-hq", lang: "en" as const, from: null, prefs: {} };

  it("a clear match becomes a goto action with a spoken reply", async () => {
    const svc = new AssistantService(process.cwd(), offline, new LocalSemanticRanker(process.cwd(), "unused", fakeEmbed));
    const out = await svc.ask(OFFICE, { ...req, from: { floor: "F1", x: 3, y: 17, heading: 0 }, text: "chai please" });
    expect(out.fallback).toBe(false);
    expect(out.action?.type).toBe("goto");
    expect(out.reply).toMatch(/^Taking you to /);
  });

  it("no match -> the old 'Did you mean' fallback; model not loaded yet -> never waits", async () => {
    const svc = new AssistantService(process.cwd(), offline, new LocalSemanticRanker(process.cwd(), "unused", fakeEmbed));
    const out = await svc.ask(OFFICE, { ...req, text: "purple banana" });
    expect(out.action).toBeUndefined();
    expect(out.fallback).toBe(true);
    const notReady = new AssistantService(process.cwd(), offline, { ready: () => false, rank: async () => { throw new Error("must not be called"); } });
    expect((await notReady.ask(OFFICE, { ...req, text: "chai" })).fallback).toBe(true);
  });
});

const real = process.env.SPEECH_REAL === "1" ? describe : describe.skip;
real("real sentence model", () => {
  it("'I want to drink some chai' -> a food place; 'mujhe toilet jana hai' -> a washroom", { timeout: 300_000 }, async () => {
    const ranker = new LocalSemanticRanker(process.cwd());
    const a = await ranker.rank(OFFICE, "I want to drink some chai");
    console.log("chai ->", a.map((x) => `${x.name} ${x.score.toFixed(2)}`).join(" | "));
    const b = await ranker.rank(OFFICE, "mujhe toilet jana hai");
    console.log("toilet ->", b.map((x) => `${x.name} ${x.score.toFixed(2)}`).join(" | "));
    // The small model is the SECOND tier (the need lexicon already answers "chai"): it only has to put the right kind of place near the top.
    expect(a.slice(0, 4).some((x) => /Pantry|Cafeteria|Canteen|Coffee/i.test(x.name))).toBe(true);
    expect(b[0]!.name).toMatch(/wash|toilet|rest/i);
  });
});
