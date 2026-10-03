import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { drawingSizeM, guessPxPerMetre, importBlueprint, readBlueprint } from "@/editor/blueprintImport";
import { route, isRouteError, validate } from "@/core";

const raw = JSON.parse(fs.readFileSync("tests/fixtures/blueprint-office.json", "utf8"));
const read = () => {
  const r = readBlueprint(raw);
  if (!r.ok) throw new Error(r.error);
  return r.file;
};

describe("Blueprint reader", () => {
  it("reads the export and rejects things that are not one", () => {
    const f = read();
    expect(f.floors).toEqual(["Floor 1"]);
    expect(f.elements.length).toBe(raw.elements.length);
    expect(readBlueprint(null).ok).toBe(false);
    expect(readBlueprint({ floors: [], elements: [] }).ok).toBe(false);
    expect(readBlueprint({ floors: ["A"], elements: [{ type: "room" }, { type: "room", x: 1, y: 1, width: 5, height: 5 }] })).toMatchObject({ ok: true, dropped: 1 });
  });
  it("guesses the scale from the door boxes (a door is about 1 m)", () => {
    const g = guessPxPerMetre(read());
    expect(g).toBeGreaterThanOrEqual(60);
    expect(g).toBeLessThanOrEqual(100);
    const size = drawingSizeM(read(), g);
    expect(size.w).toBeGreaterThan(8);
  });
});

describe("importing the office Blueprint export", () => {
  const res = importBlueprint(read(), { id: "bp-office", name: "Blueprint office", pxPerMetre: 80 });
  const v = res.venue;

  it("produces a valid venue with the rooms by name, and a corridor with a width", () => {
    const names = v.rooms.map((r) => r.name);
    for (const n of ["Lobby", "Gents room", "Ladies room", "Pantry", "Meeting Room", "Meeting room 2", "Servers room"]) expect(names).toContain(n);
    expect(v.edges.some((e) => e.type === "walk" && e.width !== undefined)).toBe(true);
    expect(v.northOffsetDeg).toBeUndefined(); // trueNorth 0 -> not set
  });

  it("the big unnamed box is the outline, not a room; unnamed ones are renamed and reported", () => {
    expect(v.rooms.some((r) => r.w > 14 && r.h > 6.5)).toBe(false);
    expect(res.issues.some((i) => /building outline/.test(i.title))).toBe(true);
    expect(res.issues.some((i) => /unnamed/.test(i.title))).toBe(true);
  });

  it("entries became doors on room walls or building entrances", () => {
    expect(res.stats.doors + res.stats.entrances).toBe(raw.elements.filter((e: { type: string }) => e.type === "entry").length);
    expect(v.pois.filter((p) => p.kind === "entrance").length).toBe(res.stats.entrances);
  });

  it("room needs are tagged so 'I want a coffee' / 'toilet' work", () => {
    expect(v.rooms.find((r) => r.name === "Pantry")!.tags).toContain("coffee");
    expect(v.rooms.find((r) => r.name === "Gents room")!.cat).toBe("washroom");
    expect(v.rooms.find((r) => r.name === "Meeting Room")!.cat).toBe("meeting");
  });

  it("every imported room can be reached from the lobby by the normal router", () => {
    const lobby = v.rooms.find((r) => r.name === "Lobby")!;
    for (const r of v.rooms) {
      if (r.id === lobby.id) continue;
      const out = route(v, { floor: lobby.floor, x: lobby.door.x, y: lobby.door.y, heading: 0 }, { room: r.id });
      expect(isRouteError(out), `${r.name}`).toBe(false);
    }
  });

  it("the editor's own checklist has no blocking failure", () => {
    expect(validate(v).filter((r) => r.level === "fail").map((r) => r.title)).toEqual([]);
    expect(v.markers.length).toBeGreaterThan(2);
    expect(res.issues.filter((i) => i.level === "fail")).toEqual([]);
  });

  it("a different scale gives a proportionally different building", () => {
    const small = importBlueprint(read(), { id: "x", name: "x", pxPerMetre: 40 });
    expect(small.sizeM.w).toBeCloseTo(res.sizeM.w * 2, 0);
  });

  it("true north from the file is kept", () => {
    const f = { ...read(), trueNorth: 35 };
    expect(importBlueprint(f, { id: "x", name: "x", pxPerMetre: 80 }).venue.northOffsetDeg).toBe(35);
  });

  it("two floors with a lift in the same place are linked", () => {
    const f = read();
    const lift = { id: "L1", type: "elevator", x: 100, y: 100, width: 60, height: 60, name: "", floor: "Floor 1" };
    const two = { floors: ["Floor 1", "Floor 2"], trueNorth: 0, elements: [...f.elements.filter((e) => e.type !== "elevator"), lift, { ...lift, id: "L2", floor: "Floor 2" }, { id: "R2", type: "room", x: 200, y: 100, width: 200, height: 120, name: "Upstairs", floor: "Floor 2" }] };
    const r = importBlueprint(two, { id: "x", name: "x", pxPerMetre: 80 });
    expect(r.stats.lifts).toBe(1);
    expect(r.venue.edges.some((e) => e.type === "lift")).toBe(true);
  });
});
