import { describe, expect, it } from "vitest";
import { pointInRoom, polygonArea, roomPolygon } from "@/core/geom";
import { doorNodeId, roomDoors } from "@/core/doors";
import { isRouteError, route, validate, type Venue } from "@/core";
import { roomAt } from "@/core/graph";
import * as ops from "@/editor/ops";

const must = <T,>(r: T | { error: string }): T => {
  if (r && typeof r === "object" && "error" in r) throw new Error((r as { error: string }).error);
  return r as T;
};
const withGrid = <T,>(step: number, fn: () => T): T => {
  const old = ops.getGrid();
  ops.setGrid(step);
  try {
    return fn();
  } finally {
    ops.setGrid(old);
  }
};

/** A corridor along y = 20 and an L-shaped room north of it (the notch is the top-right corner). */
function lVenue(): { v: Venue; id: string } {
  return withGrid(0.5, () => {
    let v = ops.blankVenue();
    let chain: string | null = null;
    for (const x of [0, 10, 20, 30]) {
      const r = ops.walkClick(v, "F1", chain, { x, y: 20 });
      v = r.venue;
      chain = r.nodeId;
    }
    const r = must(ops.addPolygonRoom(v, "F1", [{ x: 5, y: 8 }, { x: 10, y: 8 }, { x: 10, y: 13 }, { x: 15, y: 13 }, { x: 15, y: 18 }, { x: 5, y: 18 }]));
    return { v: r.venue, id: r.id };
  });
}

describe("free-form room ops", () => {
  it("creates an L-shaped room: outline, bounding box, a door on the wall nearest the corridor, nodes linked", () => {
    const { v, id } = lVenue();
    const room = v.rooms.find((r) => r.id === id)!;
    expect(room.polygon).toHaveLength(6);
    expect(room).toMatchObject({ x: 5, y: 8, w: 10, h: 10 });
    expect(Math.abs(polygonArea(roomPolygon(room)))).toBe(75);
    // the corridor is south of the room: the door is on the bottom wall (y = 18), facing south, with a normal and no side
    expect(room.door.y).toBe(18);
    expect(room.door.normal).toBe(180);
    expect(room.door.side).toBeUndefined();
    const dn = v.nodes.find((n) => n.id === doorNodeId(id, 0))!;
    expect(v.edges.some((e) => e.type === "walk" && (e.a === dn.id || e.b === dn.id) && v.nodes.find((n) => n.id === (e.a === dn.id ? e.b : e.a))?.kind === "corridor")).toBe(true);
    // the room node sits INSIDE the L, not in its notch
    const centre = v.nodes.find((n) => n.id === id)!;
    expect(pointInRoom(room, centre.x, centre.y)).toBe(true);
    expect(validate(v).some((r) => r.level === "fail" && /not reachable|Unreachable/i.test(r.title))).toBe(false);
  });

  it("rejects too few corners and a degenerate outline", () => {
    expect("error" in ops.addPolygonRoom(ops.blankVenue(), "F1", [{ x: 1, y: 1 }, { x: 5, y: 1 }])).toBe(true);
    expect("error" in ops.addPolygonRoom(ops.blankVenue(), "F1", [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 9, y: 1 }])).toBe(true);
  });

  it("roomAt / routing use the outline: the notch is not inside, a route reaches the L room and starts from inside its arm", () => {
    const { v, id } = lVenue();
    expect(roomAt(v, "F1", 7, 15)?.id).toBe(id); // the wide lower arm
    expect(roomAt(v, "F1", 12, 10)).toBeUndefined(); // in the notch (inside the bounding box)
    const to = route(v, { floor: "F1", x: 0, y: 20 }, { room: id });
    expect(isRouteError(to)).toBe(false);
    const withPoi: Venue = { ...v, pois: [{ id: "P1", floor: "F1", kind: "water", name: "Water", x: 30, y: 20 }] };
    const out = route(withPoi, { floor: "F1", x: 8, y: 10 }, { poi: "P1" }); // standing in the upper arm
    expect(isRouteError(out)).toBe(false);
    if (!isRouteError(out)) expect(out.hops.some((h) => h.from === doorNodeId(id, 0) || h.to === doorNodeId(id, 0))).toBe(true);
  });

  it("moveVertex reshapes: bounding box and door follow, door stays on the outline", () => {
    const { v, id } = lVenue();
    const r = withGrid(0, () => ops.moveVertex(v, id, 5, { x: 3, y: 18.6 })); // pull the bottom-left corner out
    const room = r.rooms.find((x) => x.id === id)!;
    expect(room.polygon![5]).toEqual([3, 18.6]);
    expect(room.x).toBe(3);
    expect(room.h).toBeCloseTo(10.6);
    // the door is on the outline (distance 0 to some edge)
    const edge = ops.nearestRoomEdge(r, "F1", { x: room.door.x, y: room.door.y }, 0.05, id);
    expect(edge).not.toBeNull();
  });

  it("insertVertex adds a corner on the chosen edge; deleteVertex removes it but keeps at least 3", () => {
    const { v, id } = lVenue();
    const a = ops.insertVertex(v, id, 0);
    const room = a.rooms.find((r) => r.id === id)!;
    expect(room.polygon).toHaveLength(7);
    expect(room.polygon![1]).toEqual([7.5, 8]);
    const b = must(ops.deleteVertex(a, id, 1));
    expect(b.rooms.find((r) => r.id === id)!.polygon).toHaveLength(6);
    const tri = must(ops.addPolygonRoom(ops.blankVenue(), "F1", [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 5, y: 7 }])).venue;
    expect("error" in ops.deleteVertex(tri, "F1-r1", 0)).toBe(true);
    expect("error" in ops.deleteVertex(ops.blankVenue(), "none", 0)).toBe(true);
  });

  it("makePolygon turns a rectangle into 4 corners without changing its shape", () => {
    const v = must(ops.addRoom(ops.blankVenue(), "F1", { x: 5, y: 5 }, { x: 15, y: 12 })).venue;
    const p = ops.makePolygon(v, "F1-r1");
    expect(p.rooms[0]!.polygon).toEqual([[5, 5], [15, 5], [15, 12], [5, 12]]);
    expect(p.rooms[0]).toMatchObject({ x: 5, y: 5, w: 10, h: 7 });
    expect(ops.makePolygon(p, "F1-r1")).toEqual(p); // idempotent
  });

  it("rotateRoom by 90 degrees: a 10x4 rectangle becomes 4x10 about its centre, the door moves with it and faces the new direction", () => {
    const v = must(ops.addRoom(ops.blankVenue(), "F1", { x: 10, y: 10 }, { x: 20, y: 14 })).venue;
    const door0 = v.rooms[0]!.door;
    expect(door0.side).toBe("S"); // no network: default south wall
    const r = withGrid(0, () => ops.rotateRoom(v, "F1-r1", 90));
    const room = r.rooms[0]!;
    expect(room.polygon).toHaveLength(4);
    expect(room.w).toBeCloseTo(4);
    expect(room.h).toBeCloseTo(10);
    expect(room.x).toBeCloseTo(13);
    expect(room.y).toBeCloseTo(7);
    // clockwise on screen: south becomes west
    expect(room.door.normal).toBe(270);
    expect(room.door.x).toBeCloseTo(13);
    expect(room.door.side).toBeUndefined();
    // 360 degrees round trip returns to (about) the same outline
    const full = withGrid(0, () => ops.rotateRoom(ops.rotateRoom(ops.rotateRoom(ops.rotateRoom(v, "F1-r1", 90), "F1-r1", 90), "F1-r1", 90), "F1-r1", 90));
    expect(full.rooms[0]!.w).toBeCloseTo(10);
  });

  it("moveRoom shifts the outline; typing a new bounding box stretches it", () => {
    const { v, id } = lVenue();
    const moved = withGrid(0.5, () => ops.moveRoom(v, id, 3, -2));
    expect(moved.rooms.find((r) => r.id === id)!.polygon![0]).toEqual([8, 6]);
    const stretched = ops.updateRoom(v, id, { w: 20 });
    const room = stretched.rooms.find((r) => r.id === id)!;
    expect(room.w).toBe(20);
    expect(Math.max(...room.polygon!.map((p) => p[0]))).toBe(25);
    expect(room.polygon![1]![0]).toBe(15); // x = 10 on a 10 wide room scales to 15 on a 20 wide one
  });

  it("doors, markers and ad walls work on slanted walls (normal from the outline)", () => {
    const tri = must(ops.addPolygonRoom(ops.blankVenue(), "F1", [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 10, y: 20 }])).venue;
    const id = "F1-r1";
    const r = must(ops.addDoor(tri, id, { x: 15.5, y: 15.5 }));
    const d = roomDoors(r.venue.rooms[0]!)[r.index]!;
    expect(d.side).toBeUndefined();
    expect(d.normal).toBe(135); // the slanted wall faces away from the triangle: south-east
  });
});
