import { describe, expect, it } from "vitest";
import { isRouteError, parseVenue, route, validate, type Venue } from "@/core";
import * as ops from "@/editor/ops";

const must = <T,>(r: T | { error: string }): T => {
  if (r && typeof r === "object" && "error" in r) throw new Error((r as { error: string }).error);
  return r as T;
};
const fails = (v: Venue) => validate(v).filter((r) => r.level === "fail").map((r) => r.title);

/** Trace a corridor on a floor with the walk tool; returns the venue. */
function corridor(v: Venue, floor: string, pts: [number, number][]): Venue {
  let chain: string | null = null;
  for (const [x, y] of pts) {
    const r = ops.walkClick(v, floor, chain, { x, y });
    v = r.venue;
    chain = r.nodeId;
  }
  return v;
}

describe("snap", () => {
  it("snaps to 0.5 m", () => {
    expect(ops.snap(1.26)).toBe(1.5);
    expect(ops.snap(1.24)).toBe(1);
    expect(ops.snap(-0.3)).toBe(-0.5);
  });
});

describe("walk tool", () => {
  it("chains nodes, snapping to the grid, joining existing nodes and splitting edges", () => {
    let v = ops.blankVenue();
    v = corridor(v, "F1", [[2.1, 10.2], [40, 10]]);
    expect(v.nodes.map((n) => [n.x, n.y])).toEqual([[2, 10], [40, 10]]);
    expect(v.edges).toHaveLength(1);
    // clicking on the middle of the edge splits it instead of floating beside it
    const r = ops.walkClick(v, "F1", null, { x: 20, y: 10.3 });
    expect(r.venue.nodes).toHaveLength(3);
    expect(r.venue.edges).toHaveLength(2);
    expect(r.venue.edges.every((e) => e.a === r.nodeId || e.b === r.nodeId)).toBe(true);
    // clicking within 1 m of an existing node joins it
    const again = ops.walkClick(r.venue, "F1", r.nodeId, { x: 40.6, y: 10 });
    expect(again.venue.nodes).toHaveLength(3);
    expect(again.venue.edges).toHaveLength(2); // the link already existed: no duplicate
  });
  it("does not mutate its input", () => {
    const v = ops.blankVenue();
    const snapshot = JSON.stringify(v);
    ops.walkClick(v, "F1", null, { x: 5, y: 5 });
    expect(JSON.stringify(v)).toBe(snapshot);
  });
});

describe("rooms and doors", () => {
  const base = () => corridor(ops.blankVenue(), "F1", [[2, 10], [40, 10]]);

  it("room drawn next to a corridor gets a door facing it and is connected", () => {
    const north = must(ops.addRoom(base(), "F1", { x: 5, y: 2 }, { x: 15, y: 9 }));
    const room = north.venue.rooms[0]!;
    expect(room.door.side).toBe("S");
    expect(room.door.y).toBe(9);
    const south = must(ops.addRoom(north.venue, "F1", { x: 20, y: 11 }, { x: 30, y: 18 }));
    const r2 = south.venue.rooms[1]!;
    expect(r2.door.side).toBe("N");
    expect(fails(south.venue).some((t) => t.includes("not reachable"))).toBe(false);
    // door nodes link into the network by splitting the corridor
    const doorEdge = south.venue.edges.filter((e) => e.a === "F1-r2:door" || e.b === "F1-r2:door");
    expect(doorEdge.length).toBe(2); // to the room centre and to the corridor
  });
  it("too small rooms are refused", () => {
    expect(ops.addRoom(base(), "F1", { x: 5, y: 2 }, { x: 5.5, y: 2.5 })).toHaveProperty("error");
  });
  it("a room far from any corridor starts unreachable; walking a path next to the door auto-links it", () => {
    let v = must(ops.addRoom(ops.blankVenue(), "F1", { x: 5, y: 2 }, { x: 15, y: 9 })).venue;
    expect(fails(v).some((t) => t.includes("not reachable"))).toBe(true);
    v = corridor(v, "F1", [[2, 10], [30, 10]]);
    // door is at (10, 9): the walk node at (10,10) is within 1.5 m, so the click linked it
    const room = v.rooms[0]!;
    expect(room.door).toMatchObject({ x: 10, y: 9 });
    const linked = ops.connectRoom(v, room.id);
    expect(linked).not.toHaveProperty("error");
  });
  it("connectRoom reports when no walk path is nearby", () => {
    const v = must(ops.addRoom(ops.blankVenue(), "F1", { x: 5, y: 2 }, { x: 15, y: 9 })).venue;
    expect(ops.connectRoom(v, v.rooms[0]!.id)).toHaveProperty("error");
  });
  it("setDoor moves the door onto another edge and re-links it", () => {
    const v0 = must(ops.addRoom(base(), "F1", { x: 5, y: 2 }, { x: 15, y: 9 })).venue;
    const v1 = must(ops.setDoor(v0, "F1-r1", { x: 4, y: 5 })); // left side
    const room = v1.rooms[0]!;
    expect(room.door.side).toBe("W");
    expect(room.door.x).toBe(5);
    const doorNode = v1.nodes.find((n) => n.id === "F1-r1:door")!;
    expect([doorNode.x, doorNode.y]).toEqual([room.door.x, room.door.y]);
  });
  it("moveRoom carries the door and nodes with it", () => {
    const v0 = must(ops.addRoom(base(), "F1", { x: 5, y: 2 }, { x: 15, y: 9 })).venue;
    const v1 = ops.moveRoom(v0, "F1-r1", 3, 1);
    expect(v1.rooms[0]).toMatchObject({ x: 8, y: 3 });
    expect(v1.rooms[0]!.door.x).toBe(v0.rooms[0]!.door.x + 3);
    expect(v1.nodes.find((n) => n.id === "F1-r1")).toMatchObject({ x: 13, y: 6.5 });
  });
  it("deleting a room removes its nodes and every edge to them", () => {
    const v0 = must(ops.addRoom(base(), "F1", { x: 5, y: 2 }, { x: 15, y: 9 })).venue;
    const v1 = ops.deleteItem(v0, { type: "room", id: "F1-r1" });
    expect(v1.rooms).toHaveLength(0);
    expect(v1.nodes.some((n) => n.room === "F1-r1" || n.id === "F1-r1")).toBe(false);
    const ids = new Set(v1.nodes.map((n) => n.id));
    expect(v1.edges.every((e) => ids.has(e.a) && ids.has(e.b))).toBe(true);
  });
});

describe("markers, ad walls, POIs", () => {
  const v0 = () => must(ops.addRoom(corridor(ops.blankVenue(), "F1", [[2, 10], [40, 10]]), "F1", { x: 5, y: 2 }, { x: 25, y: 9 })).venue;
  it("markers snap onto the nearest wall facing out, ids are the lowest free 0..49", () => {
    const a = must(ops.addMarker(v0(), "F1", { x: 12, y: 9.6 }));
    expect(a.id).toBe(0);
    const m = a.venue.markers[0]!;
    expect(m).toMatchObject({ x: 12, y: 9, normal: 180, z: 1.4, sizeM: 0.12 });
    const b = must(ops.addMarker(a.venue, "F1", { x: 20, y: 9.6 }));
    expect(b.id).toBe(1);
    const gap = ops.deleteItem(b.venue, { type: "marker", id: "0" });
    expect(must(ops.addMarker(gap, "F1", { x: 8, y: 9 })).id).toBe(0);
  });
  it("runs out of marker ids at the dictionary size", () => {
    let v = v0();
    for (let i = 0; i < 50; i++) v = must(ops.addMarker(v, "F1", { x: 12, y: 9 })).venue;
    expect(ops.addMarker(v, "F1", { x: 12, y: 9 })).toHaveProperty("error");
  });
  it("ad wall: 3 m slot on the wall, facing out; works on vertical edges too", () => {
    const h = ops.addWall(v0(), "F1", { x: 12, y: 9.4 });
    expect(h.venue.walls[0]).toMatchObject({ x1: 10.5, x2: 13.5, y1: 9, y2: 9, normal: 180, approved: false });
    const vert = ops.addWall(v0(), "F1", { x: 25.4, y: 5 });
    expect(vert.venue.walls[0]).toMatchObject({ x1: 25, x2: 25, normal: 90 });
  });
  it("POI keeps the chosen kind", () => {
    const r = ops.addPoi(v0(), "F1", { x: 3.1, y: 10 }, "entrance", "Main Entrance");
    expect(r.venue.pois[0]).toMatchObject({ kind: "entrance", name: "Main Entrance", x: 3, y: 10 });
  });
  it("moveItem snaps markers and shifts walls as a unit", () => {
    const m = must(ops.addMarker(v0(), "F1", { x: 12, y: 9 }));
    expect(ops.moveItem(m.venue, "marker", "0", { x: 14.2, y: 9.1 }).markers[0]).toMatchObject({ x: 14, y: 9 });
    const w = ops.addWall(v0(), "F1", { x: 12, y: 9 });
    const moved = ops.moveItem(w.venue, "wall", w.id, { x: 15, y: 9 }).walls[0]!;
    expect((moved.x1 + moved.x2) / 2).toBe(15);
    expect(moved.x2 - moved.x1).toBe(3);
  });
});

describe("vertical links", () => {
  const twoFloors = () => {
    let v = ops.blankVenue();
    v = ops.addFloor(v).venue;
    for (const f of ["F1", "F2"]) {
      v = corridor(v, f, [[2, 10], [40, 10]]);
      v = must(ops.addRoom(v, f, { x: 10, y: 11 }, { x: 14, y: 17 })).venue; // lift lobby
      v = must(ops.addRoom(v, f, { x: 20, y: 11 }, { x: 24, y: 17 })).venue; // stairs
    }
    return v;
  };
  it("lift links floors with time 30 s + 14 s per floor, both ways", () => {
    const r = must(ops.addVerticalLinks(twoFloors(), "lift", ["F1-r1", "F2-r1"]));
    expect(r.added).toBe(1);
    expect(r.venue.edges.find((e) => e.type === "lift")).toMatchObject({ a: "F1-r1", b: "F2-r1", upSec: 44, downSec: 44 });
    expect(r.venue.rooms.find((x) => x.id === "F1-r1")).toMatchObject({ kind: "lift", cat: "vertical" });
  });
  it("lift across three floors links every pair", () => {
    let v = twoFloors();
    v = ops.addFloor(v).venue;
    v = corridor(v, "F3", [[2, 10], [40, 10]]);
    v = must(ops.addRoom(v, "F3", { x: 10, y: 11 }, { x: 14, y: 17 })).venue;
    const r = must(ops.addVerticalLinks(v, "lift", ["F1-r1", "F2-r1", "F3-r1"]));
    expect(r.added).toBe(3);
    const far = r.venue.edges.find((e) => e.a === "F1-r1" && e.b === "F3-r1")!;
    expect(far.upSec).toBe(30 + 28);
  });
  it("stairs: adjacent floors only, mock timings", () => {
    const r = must(ops.addVerticalLinks(twoFloors(), "stairs", ["F1-r2", "F2-r2"]));
    expect(r.venue.edges.find((e) => e.type === "stairs")).toMatchObject({ upSec: 18, downSec: 12 });
    let v = ops.addFloor(twoFloors()).venue;
    v = corridor(v, "F3", [[2, 10], [40, 10]]);
    v = must(ops.addRoom(v, "F3", { x: 20, y: 11 }, { x: 24, y: 17 })).venue;
    expect(ops.addVerticalLinks(v, "stairs", ["F1-r2", "F3-r1"])).toHaveProperty("error");
  });
  it("refuses same-floor picks and does not duplicate links", () => {
    expect(ops.addVerticalLinks(twoFloors(), "lift", ["F1-r1", "F1-r2"])).toHaveProperty("error");
    const once = must(ops.addVerticalLinks(twoFloors(), "lift", ["F1-r1", "F2-r1"]));
    expect(must(ops.addVerticalLinks(once.venue, "lift", ["F1-r1", "F2-r1"])).added).toBe(0);
  });
});

describe("floor photo + calibration", () => {
  const withPhoto = () => ops.setBackground(ops.blankVenue(), "F1", { imageUrl: "/uploads/a.png", widthPx: 2000, heightPx: 1000 });
  it("a new photo is fitted to the plate but NOT calibrated, which blocks publishing", () => {
    const v = withPhoto();
    const bg = v.floors[0]!.background!;
    expect(bg.transform.scale).toBeCloseTo(0.03, 4); // min(60/2000, 36/1000)
    expect(bg.calibrated).toBe(false);
    expect(v.scale.calibrated).toBe(false);
    expect(fails(v)).toContain("Scale not calibrated");
  });
  it("calibrating scales the image about the first point so the drawn line becomes the real length", () => {
    const v0 = withPhoto();
    // drew a 20 m (under the guessed scale) line from (10,5) to (30,5); it is really 30 m
    const v1 = must(ops.calibrateBackground(v0, "F1", { x: 10, y: 5 }, { x: 30, y: 5 }, 30));
    const bg = v1.floors[0]!.background!;
    expect(bg.calibrated).toBe(true);
    expect(bg.transform.scale).toBeCloseTo(0.045, 4);
    // the anchor point stays put: image origin (0,0) moves from (0,0) to 10 + 1.5*(0-10) = -5
    expect(bg.transform.x).toBeCloseTo(-5, 3);
    expect(bg.transform.y).toBeCloseTo(5 + 1.5 * (0 - 5), 3);
    expect(v1.scale.calibrated).toBe(true);
    // A pixel that was 20 m apart horizontally is now 30 m apart.
    const px = (x: number, y: number, v: Venue) => {
      const t = v.floors[0]!.background!.transform;
      return { x: t.x + x * t.scale, y: t.y + y * t.scale };
    };
    // pixels (333.33, 166.67) and (1000, 166.67) are the 10..30 m endpoints under the old scale
    const a0 = px(333.3333, 166.6667, v0);
    const b0 = px(1000, 166.6667, v0);
    expect(b0.x - a0.x).toBeCloseTo(20, 2);
    const a1 = px(333.3333, 166.6667, v1);
    const b1 = px(1000, 166.6667, v1);
    expect(b1.x - a1.x).toBeCloseTo(30, 2);
    expect(a1.x).toBeCloseTo(a0.x, 2); // first point fixed
    expect(fails(v1)).not.toContain("Scale not calibrated");
  });
  it("hand-editing the scale after calibrating drops the calibrated flag", () => {
    const v1 = must(ops.calibrateBackground(withPhoto(), "F1", { x: 0, y: 0 }, { x: 10, y: 0 }, 20));
    const v2 = ops.updateBackground(v1, "F1", { transform: { scale: 0.1 } });
    expect(v2.floors[0]!.background!.calibrated).toBe(false);
    expect(v2.scale.calibrated).toBe(false);
    // moving or rotating alone keeps it
    expect(ops.updateBackground(v1, "F1", { transform: { x: 3, rotationDeg: 2 } }).floors[0]!.background!.calibrated).toBe(true);
  });
  it("rejects bad calibration input and removing the photo restores metric scale", () => {
    expect(ops.calibrateBackground(withPhoto(), "F1", { x: 0, y: 0 }, { x: 0, y: 0 }, 5)).toHaveProperty("error");
    expect(ops.calibrateBackground(withPhoto(), "F1", { x: 0, y: 0 }, { x: 3, y: 0 }, 0)).toHaveProperty("error");
    expect(ops.calibrateBackground(ops.blankVenue(), "F1", { x: 0, y: 0 }, { x: 3, y: 0 }, 5)).toHaveProperty("error");
    expect(ops.removeBackground(withPhoto(), "F1").scale.calibrated).toBe(true);
  });
});

describe("end to end: two floors from scratch, then publish-ready and routable", () => {
  it("passes validation and routes between floors", () => {
    // Floor 1 over a calibrated photo
    let v = ops.blankVenue({ id: "office-hq", name: "My Office", type: "Office", city: "Indore", address: "", version: 1 });
    v = ops.setBackground(v, "F1", { imageUrl: "/uploads/plan1.png", widthPx: 3000, heightPx: 1800 });
    v = must(ops.calibrateBackground(v, "F1", { x: 0, y: 5 }, { x: 30, y: 5 }, 42));
    v = ops.addFloor(v).venue;
    v = ops.updateFloor(v, "F2", { name: "Floor 2" });
    for (const f of ["F1", "F2"]) {
      v = corridor(v, f, [[2, 10], [30, 10], [58, 10]]);
      v = must(ops.addRoom(v, f, { x: 10, y: 11 }, { x: 16, y: 18 })).venue; // r1 lift lobby (south of corridor)
      v = must(ops.addRoom(v, f, { x: 20, y: 11 }, { x: 26, y: 18 })).venue; // r2 stairs
      v = must(ops.addRoom(v, f, { x: 32, y: 2 }, { x: 46, y: 9 })).venue; // r3 big room (north)
      v = ops.updateRoom(v, `${f}-r3`, { name: f === "F1" ? "Workspace" : "Cafeteria", aliases: f === "F1" ? ["desk"] : ["canteen", "khana"] });
      v = ops.updateRoom(v, `${f}-r1`, { name: "Lift Lobby" });
      v = ops.updateRoom(v, `${f}-r2`, { name: "Stairs" });
      v = must(ops.addMarker(v, f, { x: 13, y: 11 })).venue; // at the lift lobby
      v = must(ops.addMarker(v, f, { x: 23, y: 11 })).venue; // at the stairs
      v = must(ops.addMarker(v, f, { x: 39, y: 9 })).venue;
    }
    v = must(ops.addVerticalLinks(v, "lift", ["F1-r1", "F2-r1"])).venue;
    v = must(ops.addVerticalLinks(v, "stairs", ["F1-r2", "F2-r2"])).venue;
    v = ops.addPoi(v, "F1", { x: 2, y: 10 }, "entrance", "Main Entrance").venue;
    v = ops.addWall(v, "F1", { x: 34, y: 9 }).venue; // blank stretch of wall, away from the door

    const parsed = parseVenue(v);
    expect(parsed.ok).toBe(true);
    expect(fails(v)).toEqual([]);
    expect(v.markers.map((m) => m.id)).toEqual([0, 1, 2, 3, 4, 5]);

    const r = route(v, { floor: "F1", x: 3, y: 10, heading: 90 }, { room: "F2-r3" });
    if (isRouteError(r)) throw new Error(r.error);
    expect(r.floors).toEqual(["F1", "F2"]);
    expect(r.via === "lift" || r.via === "stairs").toBe(true);
    expect(r.destName).toBe("Cafeteria");
  });
});
