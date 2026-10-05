import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { importBlueprint, readBlueprint } from "@/editor/blueprintImport";
import { isRouteError, matchIntent, parseVenue, route, validate, type Venue } from "@/core";

const venue = (): Venue => {
  const r = parseVenue(JSON.parse(fs.readFileSync("public/venues/airport/venue.json", "utf8")));
  if (!r.ok) throw new Error("airport venue is invalid");
  return r.data;
};
const AIRPORT = venue();
const entrance = AIRPORT.pois.find((p) => p.name === "Departure Entry Gate 3")!;
const from = { floor: entrance.floor, x: entrance.x, y: entrance.y, heading: 0 } as const;
const answer = (text: string) => {
  const m = matchIntent(AIRPORT, text, { from });
  if (m.intent.type !== "goto" && m.intent.type !== "show") throw new Error(`"${text}" -> ${m.intent.type}`);
  return m.intent;
};
const toTarget = (t: { room?: string; poi?: string }) => (t.room ? { room: t.room } : { poi: t.poi! });

describe("the airport venue (converted from the Blueprint drawing)", () => {
  it("has three floors, no duplicate names per floor and passes every publish check", () => {
    expect(AIRPORT.floors.map((f) => f.name)).toEqual(["Level 0 - Arrivals", "Level 1 - Departures", "Level 2 - Lounges"]);
    const seen = new Set<string>();
    for (const r of AIRPORT.rooms) {
      const k = `${r.floor}|${r.name}`;
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
    }
    expect(validate(AIRPORT).filter((r) => r.level === "fail")).toEqual([]);
  });

  it("keeps the passenger places, not every counter and lane", () => {
    const by = (cat: string) => AIRPORT.rooms.filter((r) => r.cat === cat).length;
    expect(by("gate")).toBe(24);
    expect(by("checkin")).toBe(10);
    expect(by("baggage")).toBe(2);
    expect(by("lounge")).toBe(5);
    expect(by("security")).toBeGreaterThanOrEqual(5);
    expect(AIRPORT.rooms.some((r) => /counter 0?1$/i.test(r.name))).toBe(false);
    expect(AIRPORT.rooms.every((r) => r.access === "public")).toBe(true);
  });

  it("routes between floors and areas: entrance to a domestic gate, an international gate and a lounge upstairs", () => {
    for (const name of ["Gate 5", "Gate 12", "080 Domestic Lounge"]) {
      const room = AIRPORT.rooms.find((r) => r.name === name)!;
      const rt = route(AIRPORT, from, { room: room.id });
      expect(isRouteError(rt), name).toBe(false);
    }
    const lounge = AIRPORT.rooms.find((r) => r.name === "080 Domestic Lounge")!;
    const rt = route(AIRPORT, from, { room: lounge.id });
    if (isRouteError(rt)) throw new Error("no route");
    expect(rt.hops.some((h) => h.type === "lift" || h.type === "stairs")).toBe(true);
  });

  it("every place can be reached from the departure entrance", () => {
    const bad = AIRPORT.rooms.filter((r) => isRouteError(route(AIRPORT, from, { room: r.id })));
    expect(bad.map((r) => r.name)).toEqual([]);
  });

  it("answers what a traveller says", () => {
    const names: [string, RegExp][] = [
      ["take me to Gate 5", /^Gate 5$/],
      ["I want a coffee", /cafe|coffee/i],
      ["I need the toilet", /^Toilet/],
      ["I want to shop", /./],
      ["I need a taxi", /Taxi/],
      ["take me to baggage claim", /Baggage Reclaim/],
      ["ATM", /^ATM$/],
      ["prayer room", /Prayer/],
      ["take me to the international security", /International Security/],
    ];
    for (const [text, re] of names) expect(answer(text).name, text).toMatch(re);
  });

  it("every answer for a need exists in the venue and is routable", () => {
    for (const text of ["I'm hungry", "I need the toilet", "I want to shop", "I need a charger", "where is the information desk", "I need to exchange currency"]) {
      const i = answer(text);
      if (!("target" in i)) continue;
      expect(isRouteError(route(AIRPORT, from, toTarget(i.target as { room?: string; poi?: string }))), text).toBe(false);
    }
  });
});

describe("the airport importer rules", () => {
  const el = (id: string, type: string, x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}) => ({ id, type, name: id, floor: "Ground", x, y, width: w, height: h, ...extra });
  const file = (elements: unknown[], connections: unknown[] = []) => {
    const r = readBlueprint({ floors: ["Ground"], elements, connections, trueNorth: 0 });
    if (!r.ok) throw new Error(r.error);
    return r.file;
  };

  it("counters and lanes inside an island or a zone are not rooms; the island keeps their airline as a search word", () => {
    const f = file([
      el("hall", "hallway", 0, 0, 400, 40),
      el("island", "checkin", 100, 60, 80, 60, { name: "Check-in Island A", role: "island", airlines: ["Air India"], counterRange: "01-04" }),
      el("c1", "checkin", 104, 64, 20, 20, { name: "Counter 01", role: "counter" }),
      el("c2", "checkin", 130, 64, 20, 20, { name: "Counter 02", role: "counter" }),
    ], [{ source: "hall", target: "island" }]);
    const { venue: v, issues } = importBlueprint(f, { id: "t", name: "T", pxPerMetre: 2 });
    expect(v.rooms.map((r) => r.name)).toEqual(["Check-in Island A"]);
    expect(v.rooms[0]!.cat).toBe("checkin");
    expect(v.rooms[0]!.aliases).toContain("air india check-in");
    expect(issues.some((i) => /small parts not imported/.test(i.title))).toBe(true);
  });

  it("two hallways that the drawing says are connected through an entry are joined where the entry stands", () => {
    const f = file([
      el("kerb", "hallway", 0, 0, 400, 20),
      el("hall", "hallway", 0, 100, 400, 60),
      el("gate", "entry", 190, 40, 20, 20, { name: "Entry 1" }),
      el("shop", "shop", 40, 110, 40, 30, { name: "Shop" }),
    ], [{ source: "kerb", target: "gate" }, { source: "gate", target: "hall" }, { source: "hall", target: "shop" }]);
    const { venue: v } = importBlueprint(f, { id: "t", name: "T", pxPerMetre: 2 });
    expect(validate(v).find((r) => /not reachable/.test(r.title))).toBeUndefined();
    const shop = v.rooms.find((r) => r.name === "Shop")!;
    expect(shop.tags).toContain("shopping");
    expect(v.pois.some((p) => p.kind === "entrance" && p.name === "Entry 1")).toBe(true);
  });

  it("a security zone between two hallways can be walked through", () => {
    const f = file([
      el("a", "hallway", 0, 0, 400, 30),
      el("zone", "security", 0, 60, 400, 60, { name: "Security Check", role: "zone" }),
      el("b", "hallway", 0, 150, 400, 30),
      el("lane", "security", 10, 70, 20, 40, { name: "Lane 1", role: "lane" }),
      el("gate", "gate", 50, 190, 40, 40, { name: "Gate 1" }),
    ], [{ source: "a", target: "zone" }, { source: "zone", target: "lane" }, { source: "lane", target: "b" }, { source: "b", target: "gate" }]);
    const { venue: v } = importBlueprint(f, { id: "t", name: "T", pxPerMetre: 2 });
    expect(v.rooms.find((r) => r.name === "Security Check")!.passThrough).toBe(true);
    const start = { floor: v.floors[0]!.id, x: 5, y: 8, heading: 0 } as const;
    expect(isRouteError(route(v, start, { room: v.rooms.find((r) => r.name === "Gate 1")!.id }))).toBe(false);
  });
});
