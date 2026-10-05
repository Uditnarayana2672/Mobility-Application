import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { detectNeeds, matchIntent, needCandidates, NEEDS, parseVenue, resolveNeed, type Venue } from "@/core";

const load = (p: string): Venue => {
  const r = parseVenue(JSON.parse(fs.readFileSync(p, "utf8")));
  if (!r.ok) throw new Error(`bad fixture ${p}`);
  return r.data;
};
const OFFICE = load("public/venues/office-hq/venue.json");
const PG = load("tests/fixtures/my-pg.venue.json");
const from = { floor: "F1", x: 3, y: 17, heading: 0 } as const;
const goto = (v: Venue, text: string) => {
  const m = matchIntent(v, text, { from });
  expect(m.intent.type, text).toBe("goto");
  if (m.intent.type !== "goto") throw new Error("unreachable");
  return { name: m.intent.name, target: m.intent.target, confidence: m.confidence };
};

describe("needs: 'I want a coffee' finds a place without naming it", () => {
  it("coffee, tea and snacks go to a food place of the venue", () => {
    for (const t of ["I want a coffee", "can I get some tea", "chai peena hai", "मुझे चाय चाहिए", "నాకు కాఫీ కావాలి", "I want a snack"]) {
      const r = goto(OFFICE, t);
      expect(["Cafeteria", "Pantry"].some((n) => r.name.includes(n)), `${t} -> ${r.name}`).toBe(true);
      expect(r.confidence).toBeGreaterThanOrEqual(0.65);
    }
  });

  it("hungry (all three languages) and thirsty", () => {
    for (const t of ["I'm hungry", "bahut bhookh lagi hai", "मुझे भूख लगी है", "నాకు ఆకలి వేస్తోంది"]) expect(detectNeeds(t).map((n) => n.id)).toContain("food");
    expect(goto(OFFICE, "I am hungry").name).toMatch(/Cafeteria|Pantry/);
    expect(detectNeeds("pani chahiye").map((n) => n.id)).toContain("water");
  });

  it("washroom needs resolve to a washroom", () => {
    for (const t of ["I need to pee", "I want to freshen up", "toilet jana hai", "मुझे टॉयलेट जाना है"]) {
      const r = goto(OFFICE, t);
      const room = OFFICE.rooms.find((x) => x.id === (r.target as { room: string }).room);
      expect(room?.cat, `${t} -> ${r.name}`).toBe("washroom");
    }
  });

  it("with several equally good places the nearest one by walking time wins", () => {
    const floorOf = (r: ReturnType<typeof resolveNeed>) => {
      if (!r || r.intent.type !== "goto" || !("room" in r.intent.target)) return undefined;
      const id = r.intent.target.room;
      return OFFICE.rooms.find((x) => x.id === id)?.floor;
    };
    expect(floorOf(resolveNeed(OFFICE, "I want a coffee", { from: { floor: "F1", x: 3, y: 17, heading: 0 } }))).toBe("F1");
    expect(floorOf(resolveNeed(OFFICE, "I want a coffee", { from: { floor: "F2", x: 3, y: 17, heading: 0 } }))).toBe("F2");
  });

  it("a place that is named still wins over a need word", () => {
    expect(goto(OFFICE, "take me to the cafeteria").name).toMatch(/Cafeteria/);
    expect(goto(OFFICE, "go to Everest").name).toMatch(/Everest/);
  });

  it("an unrelated sentence stays 'unknown'", () => {
    expect(matchIntent(OFFICE, "the weather is nice today", { from }).intent.type).toBe("unknown");
    expect(matchIntent(OFFICE, "blue sky purple banana", { from }).intent.type).toBe("unknown");
  });

  it("never invents a place: a need the venue cannot satisfy is not answered", () => {
    const noBalcony = { ...PG, rooms: PG.rooms.filter((r) => !/balcony/i.test(r.name) && !r.tags?.includes("balcony")) };
    expect(needCandidates(noBalcony, NEEDS.find((n) => n.id === "balcony")!)).toEqual([]);
    expect(resolveNeed(noBalcony, "I want some fresh air", { from })).toBeNull();
  });
});

describe("needs in a PG", () => {
  it("sleep, bath and washroom find My Room and the Bathroom", () => {
    expect(goto(PG, "I want to sleep").name).toBe("My Room");
    expect(goto(PG, "I want to take a shower").name).toBe("Bathroom");
    expect(goto(PG, "I need the toilet").name).toBe("Bathroom");
  });

  it("a room tag decides, even when its name says nothing", () => {
    const withBalcony: Venue = {
      ...PG,
      rooms: [...PG.rooms, { ...PG.rooms[0]!, id: "F1-sitout", name: "Sit-out", aliases: [], tags: ["balcony"], cat: "workspace" }],
    };
    const r = goto(withBalcony, "I want some fresh air");
    expect(r.name).toBe("Sit-out");
    expect(r.confidence).toBeGreaterThan(0.85);
  });

  it("staff-only and restricted rooms are never suggested", () => {
    const v: Venue = { ...PG, rooms: PG.rooms.map((r) => (r.id === "F1-bath" ? { ...r, access: "staff" as const } : r)) };
    expect(resolveNeed(v, "I need the toilet", { from })).toBeNull();
  });
});
