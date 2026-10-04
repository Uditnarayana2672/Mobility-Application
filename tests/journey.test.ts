import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { matchIntent, parseHere, parseJourney, parseVenue, type Venue } from "@/core";

const load = (id: string): Venue => {
  const r = parseVenue(JSON.parse(fs.readFileSync(`public/venues/${id}/venue.json`, "utf8")));
  if (!r.ok) throw new Error(id);
  return r.data;
};
const OFFICE = load("my-office");
const MALL = load("phoenix-citadel");
const nameOf = (v: Venue, t: { room: string } | { poi: string }) => ("room" in t ? v.rooms.find((r) => r.id === t.room)!.name : v.pois.find((p) => p.id === t.poi)!.name);

describe("one sentence: where I am and where I want to go", () => {
  it.each([
    ["I am near the lift lobby and I want to go to the pantry", "Lift Lobby", "Pantry"],
    ["I'm near lift lobby and I want to go to pantry", "Lift Lobby", "Pantry"],
    ["I am at the server rooms, take me to meeting room 3", "Server Rooms", "Meeting Room 3"],
    ["I am in meeting room 1 and need to reach the pantry", "Meeting Room 1", "Pantry"],
    ["from the lift lobby to meeting room 2", "Lift Lobby", "Meeting Room 2"],
    ["I'm standing near the pantry, I want to go to the lift lobby", "Pantry", "Lift Lobby"],
    ["main lift lobby ke paas hoon aur pantry jaana hai", "Lift Lobby", "Pantry"],
    ["I am at entrance K and I want to go to the pantry", "Entrance K (Lift Lobby)", "Pantry"],
    ["I am near the server rooms and I want to go to the lift lobby", "Server Rooms", "Lift Lobby"],
  ])("%s", (text, from, to) => {
    const j = parseJourney(OFFICE, text);
    expect(j, text).not.toBeNull();
    expect(nameOf(OFFICE, j!.from)).toBe(from);
    expect(nameOf(OFFICE, j!.to)).toBe(to);
    const m = matchIntent(OFFICE, text);
    expect(m.intent.type).toBe("journey");
    expect(m.confidence).toBeGreaterThan(0.65);
  });

  it("works in another venue too", () => {
    const j = parseJourney(MALL, "I am near H&M and I want to go to the food court")!;
    expect([nameOf(MALL, j.from), nameOf(MALL, j.to)]).toEqual(["H&M", "Food Court"]);
  });

  it("never invents a place: an unknown start or destination gives nothing", () => {
    expect(parseJourney(OFFICE, "I am near the swimming pool and I want to go to the pantry")).toBeNull();
    expect(parseJourney(OFFICE, "I am near the pantry and I want to go to the helipad")).toBeNull();
    expect(parseJourney(OFFICE, "I am near the pantry and I want to go to the pantry")).toBeNull();
  });

  it("only where I am", () => {
    const h = parseHere(OFFICE, "I am near the lift lobby")!;
    expect(nameOf(OFFICE, h.at)).toBe("Lift Lobby");
    expect(matchIntent(OFFICE, "I'm at the server rooms").intent.type).toBe("locate");
  });

  it("plain requests keep their old meaning", () => {
    expect(matchIntent(OFFICE, "take me to the pantry").intent.type).toBe("goto");
    expect(matchIntent(OFFICE, "where is meeting room 1").intent.type).toBe("show");
    expect(matchIntent(OFFICE, "I want a coffee").intent.type).toBe("goto");
    expect(parseJourney(OFFICE, "I want to go to the pantry")).toBeNull();
  });
});
