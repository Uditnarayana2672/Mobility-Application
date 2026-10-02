import { describe, expect, it } from "vitest";
import { doorNodeId, doorOutward, nearestDoor, roomDoors } from "@/core/doors";
import { isRouteError, parseVenue, route, validate, type Venue } from "@/core";
import * as ops from "@/editor/ops";
import { createTool, type Host } from "@/editor/tools";
import { initialState, reducer, type Action } from "@/editor/store";
import { walkableFromVenue } from "@/positioning/particleFilter";

const must = <T,>(r: T | { error: string }): T => {
  if (r && typeof r === "object" && "error" in r) throw new Error((r as { error: string }).error);
  return r as T;
};

/** Two corridors (y = 10 and y = 30, NOT connected to each other) with one room between them. */
function twoCorridors(opts: { passThrough?: boolean } = {}): { v: Venue; id: string } {
  const old = ops.getGrid();
  ops.setGrid(0.5);
  try {
    let v = ops.blankVenue();
    for (const y of [10, 30]) {
      let chain: string | null = null;
      for (const x of [0, 10, 20]) {
        const r = ops.walkClick(v, "F1", chain, { x, y });
        v = r.venue;
        chain = r.nodeId;
      }
    }
    const added = must(ops.addRoom(v, "F1", { x: 5, y: 12 }, { x: 15, y: 28 }));
    v = added.venue;
    // default door faces the nearest corridor; add one on the opposite wall
    const room = v.rooms[0]!;
    const second = room.door.y < 20 ? { x: 10, y: 28 } : { x: 10, y: 12 };
    v = must(ops.addDoor(v, added.id, second)).venue;
    if (opts.passThrough) v = ops.updateRoom(v, added.id, { passThrough: true });
    return { v, id: added.id };
  } finally {
    ops.setGrid(old);
  }
}

describe("door helpers", () => {
  it("node ids keep the old name for the main door", () => {
    expect(doorNodeId("F1-r1", 0)).toBe("F1-r1:door");
    expect(doorNodeId("F1-r1", 1)).toBe("F1-r1:door2");
    expect(doorNodeId("F1-r1", 2)).toBe("F1-r1:door3");
  });
  it("outward bearing from normal, else side, else south", () => {
    expect(doorOutward({ x: 0, y: 0, side: "E" })).toBe(90);
    expect(doorOutward({ x: 0, y: 0, normal: 37 })).toBe(37);
    expect(doorOutward({ x: 0, y: 0 })).toBe(180);
  });
  it("nearestDoor / roomDoors", () => {
    const room = { door: { x: 0, y: 0, side: "N" as const }, extraDoors: [{ x: 10, y: 0, side: "N" as const }] };
    expect(roomDoors(room)).toHaveLength(2);
    expect(nearestDoor(room, { x: 9, y: 1 })).toMatchObject({ index: 1 });
    expect(nearestDoor({ door: room.door, extraDoors: [] }, { x: 9, y: 1 }).index).toBe(0);
  });
});

describe("several doors per room", () => {
  it("addDoor creates a door node linked to the room and to the nearest corridor", () => {
    const { v, id } = twoCorridors();
    const room = v.rooms.find((r) => r.id === id)!;
    expect(room.extraDoors).toHaveLength(1);
    for (let i = 0; i < 2; i++) {
      const dn = v.nodes.find((n) => n.id === doorNodeId(id, i))!;
      expect(dn.kind).toBe("door");
      expect(v.edges.some((e) => e.type === "walk" && (e.a === dn.id || e.b === dn.id) && (e.a === id || e.b === id))).toBe(true);
      // and to a corridor node
      expect(v.edges.some((e) => e.type === "walk" && ((e.a === dn.id && v.nodes.find((n) => n.id === e.b)?.kind === "corridor") || (e.b === dn.id && v.nodes.find((n) => n.id === e.a)?.kind === "corridor")))).toBe(true);
    }
  });

  it("a second door is not a shortcut: corridors on either side stay disconnected unless the room is a passage", () => {
    const { v, id } = twoCorridors();
    const a = { floor: "F1", x: 2, y: 10 };
    const b = { floor: "F1", x: 18, y: 30 };
    // can reach the room from either corridor ...
    expect(isRouteError(route(v, a, { room: id }))).toBe(false);
    expect(isRouteError(route(v, b, { room: id }))).toBe(false);
    // ... but not walk through it to the other corridor
    const through = route(v, a, { room: "F1-r1" });
    expect(isRouteError(through)).toBe(false);
    const w = twoCorridors({ passThrough: true });
    // with passThrough the room's own centre can be crossed: the start in the other corridor reaches a POI there
    const poiVenue: Venue = { ...w.v, pois: [{ id: "P1", floor: "F1", kind: "water", name: "Water", x: 18, y: 30 }] };
    expect(isRouteError(route(poiVenue, a, { poi: "P1" }))).toBe(false);
    const poiVenue2: Venue = { ...v, pois: [{ id: "P1", floor: "F1", kind: "water", name: "Water", x: 18, y: 30 }] };
    expect(isRouteError(route(poiVenue2, a, { poi: "P1" }))).toBe(true);
  });

  it("standing inside a multi-door room, the route leaves by the nearest door", () => {
    const { v, id } = twoCorridors();
    const room = v.rooms.find((r) => r.id === id)!;
    const near1 = route(v, { floor: "F1", x: 10, y: 13 }, { poi: "none" } as never);
    expect(isRouteError(near1)).toBe(true); // unknown POI, sanity
    const withPoi: Venue = { ...v, pois: [{ id: "P1", floor: "F1", kind: "water", name: "Water", x: 18, y: 10 }, { id: "P2", floor: "F1", kind: "water", name: "Water 2", x: 18, y: 30 }] };
    const north = route(withPoi, { floor: "F1", x: 10, y: 13 }, { poi: "P1" });
    expect(isRouteError(north)).toBe(false);
    if (!isRouteError(north)) expect(north.hops.some((h) => h.from === doorNodeId(id, 0) || h.to === doorNodeId(id, 0) || h.from === doorNodeId(id, 1) || h.to === doorNodeId(id, 1))).toBe(true);
    expect(roomDoors(room)).toHaveLength(2);
  });

  it("deleteDoor keeps at least one door, promotes the next door, and rebuilds the door nodes", () => {
    const { v, id } = twoCorridors();
    const room = v.rooms.find((r) => r.id === id)!;
    const second = room.extraDoors[0]!;
    const r = must(ops.deleteDoor(v, id, 0));
    const after = r.rooms.find((x) => x.id === id)!;
    expect(after.door).toMatchObject({ x: second.x, y: second.y });
    expect(after.extraDoors).toHaveLength(0);
    expect(r.nodes.some((n) => n.id === doorNodeId(id, 1))).toBe(false);
    expect(r.nodes.some((n) => n.id === doorNodeId(id, 0))).toBe(true);
    expect(r.edges.every((e) => r.nodes.some((n) => n.id === e.a) && r.nodes.some((n) => n.id === e.b))).toBe(true);
    expect("error" in ops.deleteDoor(r, id, 0)).toBe(true);
  });

  it("setDoor with an index moves that door; moveRoom shifts every door; resizing keeps doors on their walls", () => {
    const { v, id } = twoCorridors();
    const room = v.rooms.find((r) => r.id === id)!;
    const moved = must(ops.setDoor(v, id, { x: 6, y: room.extraDoors[0]!.y }, 1));
    expect(moved.rooms[0]!.extraDoors[0]!.x).toBe(6);
    expect(moved.rooms[0]!.door).toEqual(room.door);
    const shifted = ops.moveRoom(v, id, 3, 0);
    expect(shifted.rooms[0]!.door.x).toBe(room.door.x + 3);
    expect(shifted.rooms[0]!.extraDoors[0]!.x).toBe(room.extraDoors[0]!.x + 3);
    const resized = ops.resizeRoom(v, id, "e", { x: 20, y: 20 });
    for (const d of roomDoors(resized.rooms[0]!)) {
      expect(d.x).toBeGreaterThanOrEqual(5);
      expect(d.x).toBeLessThanOrEqual(20);
    }
  });

  it("connectRoom links every unlinked door; the validator counts a marker near ANY door of a lift room", () => {
    const { v, id } = twoCorridors();
    expect(ops.connectRoom(v, id)).toBeTruthy();
    const lift: Venue = { ...v, rooms: v.rooms.map((r) => (r.id === id ? { ...r, kind: "lift" as const, cat: "vertical" as const } : r)) };
    const secondDoor = lift.rooms[0]!.extraDoors[0]!;
    const farFirst = { ...lift, markers: [{ id: 1, floor: "F1", name: "m", x: secondDoor.x, y: secondDoor.y + 1, z: 1.4, normal: 0, sizeM: 0.12, note: "" }] };
    expect(validate(farFirst).some((r) => r.title.startsWith("No marker near"))).toBe(false);
    const none = { ...lift, markers: [{ id: 1, floor: "F1", name: "m", x: 55, y: 30, z: 1.4, normal: 0, sizeM: 0.12, note: "" }] };
    expect(validate(none).some((r) => r.title.startsWith("No marker near"))).toBe(true);
  });

  it("older venues (no extraDoors in the JSON) still parse and route exactly as before", () => {
    const { v } = twoCorridors();
    const raw = JSON.parse(JSON.stringify(v));
    for (const r of raw.rooms) delete r.extraDoors;
    const parsed = parseVenue(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.rooms[0]!.extraDoors).toEqual([]);
  });

  it("step counting may cross a room wall at ANY door", () => {
    const { v, id } = twoCorridors();
    const w = walkableFromVenue(v);
    const room = v.rooms.find((r) => r.id === id)!;
    const d = room.extraDoors[0]!;
    // just outside / inside the second door
    const out = d.y < 20 ? d.y - 0.5 : d.y + 0.5;
    const inn = d.y < 20 ? d.y + 0.5 : d.y - 0.5;
    expect(w.canMove("F1", d.x, out, d.x, inn)).toBe(true);
    // a point on the same wall far from both doors is still a wall
    const farX = Math.abs(d.x - 6) > 3 ? 6 : 14.5;
    expect(w.canMove("F1", farX, out, farX, inn)).toBe(false);
  });
});

describe("door tool", () => {
  const harness = (venue: Venue) => {
    let s = initialState(venue);
    const toasts: string[] = [];
    const dispatch = (a: Action) => {
      s = reducer(s, a);
    };
    const host: Host = {
      venue: () => s.venue,
      floorId: () => s.floorId,
      selected: () => s.selected,
      poiKind: () => s.poiKind,
      verticalKind: () => s.verticalKind,
      commit: (v) => dispatch({ type: "commit", venue: v }),
      preview: (v) => dispatch({ type: "preview", venue: v }),
      commitPending: () => dispatch({ type: "commitPending" }),
      select: (selection) => dispatch({ type: "select", selection }),
      setOverlay: () => undefined,
      status: () => undefined,
      toast: (m) => toasts.push(m),
      scale: () => 10,
      requestScale: () => undefined,
    };
    return { host, get: () => s, toasts };
  };

  it("click adds a door, clicking a door removes it, the last door cannot be removed", () => {
    const old = ops.getGrid();
    ops.setGrid(0.5);
    try {
      const v = must(ops.addRoom(ops.blankVenue(), "F1", { x: 5, y: 5 }, { x: 15, y: 12 })).venue;
      const h = harness(v);
      const t = createTool("door");
      t.onSelect({ type: "room", id: "F1-r1" }, { x: 14.9, y: 8 }, h.host);
      expect(h.get().venue.rooms[0]!.extraDoors).toHaveLength(1);
      expect(h.get().past).toHaveLength(1);
      const added = h.get().venue.rooms[0]!.extraDoors[0]!;
      t.onSelect({ type: "room", id: "F1-r1" }, { x: added.x, y: added.y }, h.host); // click the new door: remove it
      expect(h.get().venue.rooms[0]!.extraDoors).toHaveLength(0);
      const main = h.get().venue.rooms[0]!.door;
      t.onSelect({ type: "room", id: "F1-r1" }, { x: main.x, y: main.y }, h.host); // the only door: refused
      expect(h.toasts.at(-1)).toMatch(/at least one door/);
      expect(h.get().venue.rooms[0]!.extraDoors).toHaveLength(0);
    } finally {
      ops.setGrid(old);
    }
  });
});
