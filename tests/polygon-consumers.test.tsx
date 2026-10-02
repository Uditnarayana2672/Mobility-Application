import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { doorNodeId } from "@/core/doors";
import { parseVenue, validate, type Venue } from "@/core";
import * as ops from "@/editor/ops";
import { initialState, reducer, type Action } from "@/editor/store";
import { createTool, selectionHandles, type Host, type PointerEventLike } from "@/editor/tools";
import { walkableFromVenue } from "@/positioning/particleFilter";
import { MapCanvas } from "@/ui/map";

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

describe("free-form rooms: everything that reads a room understands the outline", () => {
  it("schema: a polygon room round-trips through parseVenue", () => {
    const { v } = lVenue();
    const parsed = parseVenue(JSON.parse(JSON.stringify(v)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.rooms[0]!.polygon).toHaveLength(6);
  });

  it("the map draws a polygon as a path (hit-testable), a rectangle as a rect", () => {
    const { v } = lVenue();
    const html = renderToStaticMarkup(<MapCanvas venue={v} floorId="F1" />);
    expect(html).toMatch(/<path[^>]*data-type="room"[^>]*data-id="F1-r1"/);
    const rectVenue = must(ops.addRoom(ops.blankVenue(), "F1", { x: 5, y: 5 }, { x: 15, y: 12 })).venue;
    expect(renderToStaticMarkup(<MapCanvas venue={rectVenue} floorId="F1" />)).toMatch(/<rect[^>]*data-type="room"/);
  });

  it("step counting: the notch is void, the arms are free, and the room can only be entered through its door", () => {
    const { v, id } = lVenue();
    const w = walkableFromVenue(v);
    expect(w.contains("F1", 7, 15)).toBe(true);
    expect(w.contains("F1", 12, 10)).toBe(false); // the notch
    const door = v.rooms.find((r) => r.id === id)!.door;
    expect(w.canMove("F1", door.x, door.y + 0.8, door.x, door.y - 0.8)).toBe(true); // through the door
    // a spot on the same wall well away from the door is still a wall
    const farX = Math.abs(door.x - 6) > 3 ? 6 : 14;
    expect(w.canMove("F1", farX, 18.8, farX, 17.2)).toBe(false);
  });

  it("the validator flags an outline that crosses itself (warning, not blocking)", () => {
    const { v } = lVenue();
    const bow: Venue = { ...v, rooms: v.rooms.map((r) => ({ ...r, polygon: [[5, 8], [15, 18], [15, 8], [5, 18]] as [number, number][] })) };
    expect(validate(bow).find((r) => r.title.startsWith("Room outline crosses itself"))?.level).toBe("warn");
    expect(validate(v).some((r) => r.title.startsWith("Room outline crosses itself"))).toBe(false);
  });
});

describe("free-form room tools", () => {
  const harness = (venue: Venue, shape: "rect" | "polygon" = "polygon") => {
    let s = initialState(venue);
    s = reducer(s, { type: "setRoomShape", shape });
    const toasts: string[] = [];
    let overlay: unknown = null;
    const dispatch = (a: Action) => {
      s = reducer(s, a);
    };
    const host: Host = {
      venue: () => s.venue,
      floorId: () => s.floorId,
      selected: () => s.selected,
      poiKind: () => s.poiKind,
      objectKind: () => s.objectKind,
      roomShape: () => s.roomShape,
      verticalKind: () => s.verticalKind,
      commit: (v) => dispatch({ type: "commit", venue: v }),
      preview: (v) => dispatch({ type: "preview", venue: v }),
      commitPending: () => dispatch({ type: "commitPending" }),
      select: (selection) => dispatch({ type: "select", selection }),
      setOverlay: (o) => (overlay = o),
      status: () => undefined,
      toast: (m) => toasts.push(m),
      scale: () => 10,
      requestScale: () => undefined,
    };
    return { host, get: () => s, toasts, overlay: () => overlay, dispatch };
  };
  const bare: PointerEventLike = { target: { closest: () => null } as unknown as EventTarget };

  it("polygon mode: click the corners, Enter closes; ONE undo step; the room is selected", () => {
    withGrid(0.5, () => {
      const h = harness(ops.blankVenue());
      const t = createTool("room");
      expect(t.onPointer("down", { x: 5, y: 5 }, bare, h.host)).toBe(false); // clicks are taps, not rubber-band drags
      for (const p of [{ x: 5, y: 5 }, { x: 12, y: 5 }, { x: 12, y: 9 }, { x: 8.2, y: 9.1 }, { x: 5, y: 12 }]) t.onSelect(null, p, h.host);
      expect(h.overlay()).toMatchObject({ kind: "poly" });
      expect(h.get().venue.rooms).toHaveLength(0);
      t.finish!(h.host);
      expect(h.get().venue.rooms).toHaveLength(1);
      expect(h.get().venue.rooms[0]!.polygon).toHaveLength(5);
      expect(h.get().past).toHaveLength(1);
      expect(h.get().selected).toEqual({ type: "room", id: "F1-r1" });
      expect(h.overlay()).toBeNull();
    });
  });

  it("clicking the first corner closes the shape; fewer than 3 corners is refused; Esc cancels", () => {
    withGrid(0.5, () => {
      const h = harness(ops.blankVenue());
      const t = createTool("room");
      for (const p of [{ x: 5, y: 5 }, { x: 12, y: 5 }, { x: 9, y: 11 }]) t.onSelect(null, p, h.host);
      t.onSelect(null, { x: 5.05, y: 5.04 }, h.host); // within 12 px of the first corner at 10 px/m
      expect(h.get().venue.rooms).toHaveLength(1);
      const t2 = createTool("room");
      t2.onSelect(null, { x: 1, y: 1 }, h.host);
      t2.finish!(h.host);
      expect(h.toasts.at(-1)).toMatch(/at least 3 corners/);
      t2.onSelect(null, { x: 1, y: 1 }, h.host);
      t2.cancel(h.host);
      t2.finish!(h.host);
      expect(h.get().venue.rooms).toHaveLength(1);
    });
  });

  it("rectangle mode still drags a rectangle", () => {
    withGrid(0.5, () => {
      const h = harness(ops.blankVenue(), "rect");
      const t = createTool("room");
      t.onPointer("down", { x: 5, y: 5 }, bare, h.host);
      t.onPointer("up", { x: 12, y: 9 }, bare, h.host);
      expect(h.get().venue.rooms[0]!.polygon).toBeUndefined();
    });
  });

  it("select tool: drag a corner, drag a midpoint to add a corner, Shift+click a corner to remove it, drag the orange dot to rotate", () => {
    withGrid(0, () => {
      const { v, id } = lVenue();
      const h = harness(v, "rect");
      h.dispatch({ type: "select", selection: { type: "room", id } });
      const t = createTool("select");
      const drag = (ev: PointerEventLike, path: ops.Pt[]) => {
        const captured = t.onPointer("down", path[0]!, ev, h.host);
        if (captured) {
          for (const p of path.slice(1)) t.onPointer("move", p, ev, h.host);
          t.onPointer("up", path[path.length - 1]!, ev, h.host);
        }
        return captured;
      };
      const room = () => h.get().venue.rooms.find((r) => r.id === id)!;
      let hs = selectionHandles(h.get().venue, h.get().selected, "F1");
      expect(hs.filter((x) => x.kind === "vertex")).toHaveLength(6);
      expect(hs.filter((x) => x.kind === "midpoint")).toHaveLength(6);
      expect(hs.filter((x) => x.kind === "rrotate")).toHaveLength(1);
      // corner 0 (5, 8) -> (4, 7)
      expect(drag(bare, [{ x: 5, y: 8 }, { x: 4.5, y: 7.5 }, { x: 4, y: 7 }])).toBe(true);
      expect(room().polygon![0]).toEqual([4, 7]);
      expect(h.get().past).toHaveLength(1);
      // midpoint of edge 4 ((15,18) -> (5,18)) at (10, 18): drag it down to add a corner
      hs = selectionHandles(h.get().venue, h.get().selected, "F1");
      const mid = hs.find((x) => x.kind === "midpoint" && x.index === 4)!.at;
      expect(drag(bare, [mid, { x: mid.x, y: mid.y + 0.4 }, { x: 10, y: 19.5 }])).toBe(true);
      expect(room().polygon).toHaveLength(7);
      expect(room().polygon![5]).toEqual([10, 19.5]);
      expect(h.get().past).toHaveLength(2);
      // Shift+click removes a corner
      expect(drag({ ...bare, shiftKey: true }, [{ x: 10, y: 19.5 }])).toBe(true);
      expect(room().polygon).toHaveLength(6);
      expect(h.get().past).toHaveLength(3);
      // rotate by dragging the orange dot a quarter turn round the centre
      hs = selectionHandles(h.get().venue, h.get().selected, "F1");
      const rot = hs.find((x) => x.kind === "rrotate")!.at;
      const before = room();
      const c = { x: before.x + before.w / 2, y: before.y + before.h / 2 };
      const r0 = Math.hypot(rot.x - c.x, rot.y - c.y);
      expect(drag(bare, [rot, { x: c.x + r0 * 0.7, y: c.y - r0 * 0.7 }, { x: c.x + r0, y: c.y }])).toBe(true);
      expect(room().polygon).toHaveLength(6);
      expect(room().polygon).not.toEqual(before.polygon); // the outline turned
      expect(h.get().past).toHaveLength(4);
    });
  });

  it("the Door tool adds a door on a wall of a free-form room and links it", () => {
    withGrid(0, () => {
      const { v, id } = lVenue();
      const h = harness(v, "rect");
      createTool("door").onSelect({ type: "room", id }, { x: 5, y: 12 }, h.host); // the left wall
      const room = h.get().venue.rooms.find((r) => r.id === id)!;
      expect(room.extraDoors).toHaveLength(1);
      expect(room.extraDoors[0]!.normal).toBe(270);
      expect(h.get().venue.nodes.some((n) => n.id === doorNodeId(id, 1))).toBe(true);
    });
  });
});
