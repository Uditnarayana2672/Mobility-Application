import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildSceneModel } from "../src/ar/sceneModel";
import { isRouteError, route } from "../src/core/route";
import { CampaignsFileSchema, VenueSchema, type Campaign, type Venue } from "../src/core/schema";
const fixture = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", "venues", "office-hq", name), "utf8"));
const venue = VenueSchema.parse(fixture("venue.json"));
const campaigns = CampaignsFileSchema.parse(fixture("campaigns.json")).campaigns;

function demoRoute() {
  const r = route(venue, { floor: "F1", x: 3, y: 17, heading: 90 }, { room: "F2-cafeteria" });
  if (isRouteError(r)) throw new Error(r.error);
  return r;
}

describe("AR scene model", () => {
  it("spaces fading chevrons over only the next 20 m and keeps them away from vertical doors", () => {
    const r = demoRoute();
    const scene = buildSceneModel(r, venue, { floor: "F1", x: 3, y: 17, heading: 90, acc: 0.3, stale: false, markerId: 1, source: "sim", progressM: 0 }, campaigns);
    expect(scene.chevrons.length).toBeGreaterThan(4);
    expect(scene.chevrons.every((c) => c.distanceM <= 20)).toBe(true);
    expect(scene.chevrons.slice(1).every((c, i) => Math.abs(c.distanceM - scene.chevrons[i]!.distanceM - 1.5) < 1e-6)).toBe(true);
    expect(scene.chevrons.every((c) => venue.rooms.filter((room) => room.floor === "F1" && room.kind).every((room) => Math.hypot(c.at.x - room.door.x, c.at.y - room.door.y) >= 2))).toBe(true);
    expect(scene.chevrons[0]!.opacity).toBeGreaterThan(scene.chevrons.at(-1)!.opacity);
  });

  it("shows a turn arrow only inside 15 m", () => {
    const r = demoRoute();
    const turn = r.steps.find((s) => s.kind === "turn" && !s.initial);
    expect(turn?.kind).toBe("turn");
    if (!turn || turn.kind !== "turn") return;
    const far = buildSceneModel(r, venue, { floor: turn.at.floor, x: turn.at.x, y: turn.at.y, heading: 0, acc: 1, stale: false, markerId: null, source: "sim", progressM: Math.max(0, turn.sAt - 16) }, []);
    const near = buildSceneModel(r, venue, { floor: turn.at.floor, x: turn.at.x, y: turn.at.y, heading: 0, acc: 1, stale: false, markerId: null, source: "sim", progressM: Math.max(0, turn.sAt - 10) }, []);
    expect(far.turnArrows).toHaveLength(0);
    expect(near.turnArrows).toHaveLength(1);
  });

  it("uses floor elevations for the destination and floor-change cues", () => {
    const r = demoRoute();
    const vertical = r.steps.find((s) => s.kind === "vertical");
    expect(vertical?.kind).toBe("vertical");
    if (!vertical || vertical.kind !== "vertical") return;
    const floorCue = buildSceneModel(r, venue, { floor: vertical.at.floor, x: vertical.at.x, y: vertical.at.y, heading: 0, acc: 1, stale: false, markerId: null, source: "sim", progressM: vertical.sAt - 4 }, []);
    expect(floorCue.floorChangeArrow?.at.z).toBeCloseTo((venue.floors.find((f) => f.id === vertical.at.floor)?.elevation ?? 0) + 1.65);
    const destination = buildSceneModel(r, venue, { floor: r.destFloor, x: 30, y: 17, heading: 90, acc: 1, stale: false, markerId: null, source: "sim", progressM: r.total - 2 }, []);
    expect(destination.destinationPin?.at.z).toBeCloseTo((venue.floors.find((f) => f.id === r.destFloor)?.elevation ?? 0) + 2.2);
  });

  it("returns only active, nearby, front-facing, in-view and safe wall ads", () => {
    const active = campaigns.find((c) => c.id === "C1")!;
    const wall = venue.walls.find((w) => w.id === "W01")!;
    const mx = (wall.x1 + wall.x2) / 2;
    const scene = buildSceneModel(null, venue, { floor: "F1", x: mx, y: 18, heading: 0, acc: 1, stale: false, markerId: null, source: "sim", progressM: 0 }, [active]);
    expect(scene.adQuads.map((q) => q.id)).toEqual(["C1:W01"]);
    expect(scene.adQuads[0]!.corners[0].z - scene.adQuads[0]!.corners[3].z).toBeCloseTo(wall.height);

    const paused: Campaign = { ...active, status: "paused" };
    expect(buildSceneModel(null, venue, { floor: "F1", x: mx, y: 18, heading: 0, acc: 1, stale: false, markerId: null, source: "sim", progressM: 0 }, [paused]).adQuads).toHaveLength(0);
    expect(buildSceneModel(null, venue, { floor: "F1", x: mx, y: 18, heading: 180, acc: 1, stale: false, markerId: null, source: "sim", progressM: 0 }, [active]).adQuads).toHaveLength(0);
    expect(buildSceneModel(null, venue, { floor: "F1", x: mx, y: 30, heading: 0, acc: 1, stale: false, markerId: null, source: "sim", progressM: 0 }, [active]).adQuads).toHaveLength(0);

    const unsafeVenue: Venue = { ...venue, rooms: [...venue.rooms, { ...venue.rooms.find((room) => room.kind === "lift")!, id: "unsafe", door: { x: mx, y: wall.y1, side: "S" } }] };
    expect(buildSceneModel(null, unsafeVenue, { floor: "F1", x: mx, y: 18, heading: 0, acc: 1, stale: false, markerId: null, source: "sim", progressM: 0 }, [active]).adQuads).toHaveLength(0);
  });
});
