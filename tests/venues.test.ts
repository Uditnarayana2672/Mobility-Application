import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { isRouteError, matchIntent, parseVenue, route, validate, type Venue } from "@/core";
import { fetchVenueList, subtitleOf } from "@/shared/venueList";

const load = (id: string): Venue => {
  const r = parseVenue(JSON.parse(fs.readFileSync(`public/venues/${id}/venue.json`, "utf8")));
  if (!r.ok) throw new Error(`${id} is invalid`);
  return r.data;
};
const index = JSON.parse(fs.readFileSync("public/venues/index.json", "utf8")) as { id: string; name: string; type: string; floors: number; icon: string }[];

const startOf = (v: Venue) => {
  const e = v.pois.find((p) => p.kind === "entrance")!;
  return { floor: e.floor, x: e.x, y: e.y, heading: 0 } as const;
};
const ask = (v: Venue, text: string) => {
  const m = matchIntent(v, text, { from: startOf(v) });
  if (m.intent.type !== "goto" && m.intent.type !== "show") throw new Error(`"${text}" -> ${m.intent.type}`);
  return m.intent;
};

describe("the list of places on the first screen", () => {
  it("offers the airport, the mall, the bus stand and the demo office, each with a venue file that exists and matches", () => {
    expect(index.map((i) => i.id)).toEqual(["airport", "phoenix-citadel", "majestic-bus-stand", "my-office"]);
    for (const i of index) {
      const v = load(i.id);
      expect(v.name, i.id).toBe(i.name);
      expect(v.floors.length, i.id).toBe(i.floors);
    }
    expect(index[0]!.name).toBe("Kempegowda Airport");
  });

  it("fetchVenueList reads the shipped list, adds what the server has published, and never throws", async () => {
    const files: Record<string, unknown> = { "/venues/index.json": index, "/api/registry": { venues: [{ id: "my-pg", name: "My PG" }, { id: "airport", name: "dup" }] } };
    const f = (async (u: string) => (u in files ? new Response(JSON.stringify(files[u])) : new Response("no", { status: 503 }))) as unknown as typeof fetch;
    const list = await fetchVenueList(f);
    expect(list.map((x) => x.id)).toEqual(["airport", "phoenix-citadel", "majestic-bus-stand", "my-office", "my-pg"]);
    expect(list[0]!.name).toBe("Kempegowda Airport");
    expect(subtitleOf(list[1]!)).toBe("Shopping mall · 3 floors mapped");
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await fetchVenueList(down)).toEqual([]);
  });
});

describe.each([
  { id: "phoenix-citadel", floors: 3, places: ["Marks & Spencer", "H&M", "Food Court", "INOX Multiplex", "TimeZone", "Punjab Grill"] },
  { id: "my-office", floors: 1, places: ["Pantry", "Meeting Room 1", "Meeting Room 2", "Meeting Room 3", "Server Rooms", "Workspace 1"] },
  { id: "majestic-bus-stand", floors: 2, places: ["Platform 1", "Platform 24", "KSRTC Advance Reservation", "General Waiting Hall", "Cloak Room (Luggage Storage)"] },
])("$id", ({ id, floors, places }) => {
  const V = load(id);

  it("has the expected floors and places, and passes every publish check", () => {
    expect(V.floors.length).toBe(floors);
    for (const p of places) expect(V.rooms.some((r) => r.name === p), p).toBe(true);
    expect(validate(V).filter((r) => r.level === "fail")).toEqual([]);
    expect(V.rooms.every((r) => r.access === "public")).toBe(true);
  });

  it("every place can be reached from the entrance, over lifts and stairs where needed", () => {
    const from = startOf(V);
    const bad = V.rooms.filter((r) => isRouteError(route(V, from, { room: r.id })));
    expect(bad.map((r) => r.name)).toEqual([]);
  });

  it.skipIf(floors < 2)("routes to a place on another floor use a lift or stairs", () => {
    const from = startOf(V);
    const other = V.rooms.find((r) => r.floor !== from.floor && !["vertical"].includes(r.cat))!;
    const rt = route(V, from, { room: other.id });
    if (isRouteError(rt)) throw new Error("no route");
    expect(rt.hops.some((h) => h.type === "lift" || h.type === "stairs")).toBe(true);
  });
});

describe("what a visitor says", () => {
  const mall = load("phoenix-citadel");
  const bus = load("majestic-bus-stand");
  it("in the mall", () => {
    expect(ask(mall, "where is H&M").name).toBe("H&M");
    expect(ask(mall, "I want to watch a movie").name).toMatch(/INOX|Insignia/);
    expect(ask(mall, "I'm hungry").name).toMatch(/Food Court|Punjab|Molecule|GT Road|AM PM|Coffee/);
    expect(ask(mall, "I need the toilet").name).toMatch(/^Toilet/);
    expect(ask(mall, "I need an ATM").name).toBe("ATM");
    expect(ask(mall, "take me to Mango").name).toBe("Mango");
  });
  it("at the bus stand", () => {
    expect(ask(bus, "take me to Platform 14").name).toBe("Platform 14");
    expect(ask(bus, "where is the KSRTC reservation counter").name).toBe("KSRTC Advance Reservation");
    expect(ask(bus, "I need a ticket").name).toMatch(/KSRTC|BMTC/);
    expect(ask(bus, "where can I leave my luggage").name).toMatch(/Cloak Room/);
    expect(ask(bus, "I want to sit and wait").name).toMatch(/Waiting|Retiring/);
    expect(ask(bus, "I need the toilet").name).toMatch(/^Toilet/);
  });
  it("a bus platform answers to its bay and to the operator", () => {
    expect(bus.rooms.find((r) => r.name === "Platform 3")!.aliases).toContain("bay 3");
    expect(bus.rooms.find((r) => r.name === "Platform 12")!.aliases).toEqual(expect.arrayContaining(["ksrtc", "intercity"]));
    expect(bus.rooms.find((r) => r.name === "Platform 20")!.aliases).toContain("terminal 2");
  });
});
