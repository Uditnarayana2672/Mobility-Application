import { describe, expect, it } from "vitest";
import type { Venue } from "@/core";
import * as ops from "@/editor/ops";
import { MAX_HISTORY, initialState, reducer, selectionExists, type Action, type EditorState } from "@/editor/store";
import { bgHandles, createTool, itemFromEvent, type Host, type Overlay, type PointerEventLike, type Tool } from "@/editor/tools";

/* ---------- store ---------- */

const run = (s: EditorState, ...actions: Action[]) => actions.reduce(reducer, s);
const named = (v: Venue, name: string): Venue => ({ ...v, name });

describe("editor store history", () => {
  const v0 = ops.blankVenue();
  it("every committed action is one undo step; undo/redo walk the stack", () => {
    let s = initialState(v0);
    s = run(s, { type: "commit", venue: named(s.venue, "A") }, { type: "commit", venue: named(s.venue, "B") });
    expect(s.past).toHaveLength(2);
    s = run(s, { type: "undo" });
    expect(s.venue.name).toBe("A");
    s = run(s, { type: "undo" });
    expect(s.venue.name).toBe(v0.name);
    expect(run(s, { type: "undo" })).toBe(s); // nothing left
    s = run(s, { type: "redo" }, { type: "redo" });
    expect(s.venue.name).toBe("B");
    expect(s.future).toHaveLength(0);
  });
  it("a new commit clears the redo stack", () => {
    let s = initialState(v0);
    s = run(s, { type: "commit", venue: named(s.venue, "A") }, { type: "undo" }, { type: "commit", venue: named(s.venue, "C") });
    expect(s.future).toHaveLength(0);
    expect(s.venue.name).toBe("C");
  });
  it("many previews + one commitPending = ONE undo step (drags)", () => {
    let s = initialState(v0);
    for (let i = 0; i < 40; i++) s = run(s, { type: "preview", venue: named(v0, `drag ${i}`) });
    expect(s.past).toHaveLength(0);
    expect(s.rev).toBe(0);
    s = run(s, { type: "commitPending" });
    expect(s.past).toEqual([v0]);
    expect(s.rev).toBe(1);
    expect(s.venue.name).toBe("drag 39");
    s = run(s, { type: "undo" });
    expect(s.venue).toBe(v0);
  });
  it("cancelPending restores the pre-drag venue; commitPending without a drag does nothing", () => {
    let s = initialState(v0);
    s = run(s, { type: "preview", venue: named(v0, "x") }, { type: "cancelPending" });
    expect(s.venue).toBe(v0);
    expect(run(s, { type: "commitPending" })).toBe(s);
  });
  it("committing the same venue object is a no-op", () => {
    const s = initialState(v0);
    expect(run(s, { type: "commit", venue: s.venue })).toBe(s);
  });
  it("history is capped", () => {
    let s = initialState(v0);
    for (let i = 0; i < MAX_HISTORY + 20; i++) s = run(s, { type: "commit", venue: named(s.venue, `v${i}`) });
    expect(s.past).toHaveLength(MAX_HISTORY);
  });
  it("undo drops a selection that no longer exists", () => {
    const withMarker = (ops.addMarker(v0, "F1", { x: 3, y: 3 }) as { venue: Venue }).venue;
    let s = initialState(v0);
    s = run(s, { type: "commit", venue: withMarker }, { type: "select", selection: { type: "marker", id: "0" } });
    expect(selectionExists(s.venue, s.selected)).toBe(true);
    s = run(s, { type: "undo" });
    expect(s.selected).toBeNull();
  });
  it("tools switch on the layers they need", () => {
    const s = run({ ...initialState(v0), layers: { ...initialState(v0).layers, walknet: false } }, { type: "setTool", tool: "walk" });
    expect(s.layers.walknet).toBe(true);
  });
});

/* ---------- tools, driven through a fake host backed by the real reducer ---------- */

interface Harness {
  host: Host;
  get: () => EditorState;
  toasts: string[];
  statuses: string[];
  overlay: () => Overlay;
  scaleRequests: { floorId: string; a: ops.Pt; b: ops.Pt }[];
  dispatch: (a: Action) => void;
}

function harness(venue: Venue, scale = 10): Harness {
  let s = initialState(venue);
  let overlay: Overlay = null;
  const toasts: string[] = [];
  const statuses: string[] = [];
  const scaleRequests: Harness["scaleRequests"] = [];
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
    setOverlay: (o) => (overlay = o),
    status: (m) => statuses.push(m),
    toast: (m) => toasts.push(m),
    scale: () => scale,
    requestScale: (r) => scaleRequests.push(r),
  };
  return { host, get: () => s, toasts, statuses, overlay: () => overlay, scaleRequests, dispatch };
}

/** Fake pointer event whose target is an SVG-ish element carrying data-type / data-id. */
const on = (type: string, id: string): PointerEventLike => ({
  target: { closest: () => ({ getAttribute: (k: string) => (k === "data-type" ? type : id) }) } as unknown as EventTarget,
});
const bare: PointerEventLike = { target: { closest: () => null } as unknown as EventTarget };

function drag(tool: Tool, h: Harness, ev: PointerEventLike, path: ops.Pt[]) {
  const [first, ...rest] = path as [ops.Pt, ...ops.Pt[]];
  const captured = tool.onPointer("down", first, ev, h.host);
  if (captured) for (const p of rest) tool.onPointer("move", p, ev, h.host);
  const last = path[path.length - 1]!;
  if (captured) tool.onPointer("up", last, ev, h.host);
  return captured;
}

const must = <T,>(r: T | { error: string }): T => {
  if (r && typeof r === "object" && "error" in r) throw new Error((r as { error: string }).error);
  return r as T;
};

describe("itemFromEvent", () => {
  it("reads data attributes and ignores unknown types", () => {
    expect(itemFromEvent(on("marker", "3"))).toEqual({ type: "marker", id: "3" });
    expect(itemFromEvent(on("corridor", "x"))).toBeNull();
    expect(itemFromEvent(bare)).toBeNull();
  });
});

describe("select tool", () => {
  const base = () => must(ops.addMarker(ops.blankVenue(), "F1", { x: 10, y: 10 })).venue;
  it("dragging a marker previews many times but commits ONE undo step, snapped", () => {
    const h = harness(base());
    const t = createTool("select");
    const path = Array.from({ length: 30 }, (_, i) => ({ x: 10 + i * 0.17, y: 10 + i * 0.05 }));
    expect(drag(t, h, on("marker", "0"), path)).toBe(true);
    const s = h.get();
    expect(s.past).toHaveLength(1);
    expect(s.venue.markers[0]).toMatchObject({ x: 15, y: 11.5 });
    expect(s.selected).toEqual({ type: "marker", id: "0" });
  });
  it("a tap or sub-3px jitter commits nothing", () => {
    const h = harness(base());
    const t = createTool("select");
    drag(t, h, on("marker", "0"), [{ x: 10, y: 10 }, { x: 10.1, y: 10.1 }]);
    expect(h.get().past).toHaveLength(0);
    t.onSelect({ type: "marker", id: "0" }, { x: 10, y: 10 }, h.host);
    expect(h.get().selected).toEqual({ type: "marker", id: "0" });
    t.onSelect(null, { x: 1, y: 1 }, h.host);
    expect(h.get().selected).toBeNull();
  });
  it("rooms drag straight away (no need to select first); Shift+drag pans instead", () => {
    const v = must(ops.addRoom(ops.blankVenue(), "F1", { x: 5, y: 5 }, { x: 15, y: 12 })).venue;
    const h = harness(v);
    const t = createTool("select");
    expect(t.onPointer("down", { x: 8, y: 8 }, { ...on("room", "F1-r1"), shiftKey: true }, h.host)).toBe(false);
    expect(drag(t, h, on("room", "F1-r1"), [{ x: 8, y: 8 }, { x: 10, y: 9 }, { x: 11, y: 10 }])).toBe(true);
    expect(h.get().venue.rooms[0]).toMatchObject({ x: 8, y: 7 });
    expect(h.get().selected).toEqual({ type: "room", id: "F1-r1" });
    expect(h.get().past).toHaveLength(1);
  });
});

describe("free layout (Stage 1)", () => {
  const withGrid = <T,>(step: number, fn: () => T): T => {
    const old = ops.getGrid();
    ops.setGrid(step);
    try {
      return fn();
    } finally {
      ops.setGrid(old);
    }
  };

  it("snap off: rooms and walk nodes keep their exact (1 cm) coordinates", () => {
    withGrid(0, () => {
      expect(ops.snap(1.237)).toBe(1.24);
      const r = must(ops.addRoom(ops.blankVenue(), "F1", { x: 5.13, y: 5.27 }, { x: 11.62, y: 9.04 }));
      expect(r.venue.rooms[0]).toMatchObject({ x: 5.13, y: 5.27, w: 6.49, h: 3.77 });
      const w = ops.walkClick(r.venue, "F1", null, { x: 20.33, y: 3.07 });
      expect(w.venue.nodes.find((n) => n.id === w.nodeId)).toMatchObject({ x: 20.33, y: 3.07 });
    });
  });
  it("snap off allows small rooms (a 1.2 x 1.5 m bathroom); snap on still refuses", () => {
    withGrid(0, () => {
      expect("venue" in ops.addRoom(ops.blankVenue(), "F1", { x: 2, y: 2 }, { x: 3.2, y: 3.5 })).toBe(true);
    });
    withGrid(0.5, () => {
      expect("error" in ops.addRoom(ops.blankVenue(), "F1", { x: 2, y: 2 }, { x: 3.2, y: 3.5 })).toBe(true);
    });
  });

  it("dragging a corner handle of the selected room resizes it, one undo step", () => {
    withGrid(0.5, () => {
      const v = must(ops.addRoom(ops.blankVenue(), "F1", { x: 5, y: 5 }, { x: 15, y: 12 })).venue;
      const h = harness(v);
      h.dispatch({ type: "select", selection: { type: "room", id: "F1-r1" } });
      const t = createTool("select");
      // se corner is at (15, 12): drag to (18, 14)
      expect(drag(t, h, bare, [{ x: 15, y: 12 }, { x: 16, y: 13 }, { x: 18, y: 14 }])).toBe(true);
      expect(h.get().venue.rooms[0]).toMatchObject({ x: 5, y: 5, w: 13, h: 9 });
      expect(h.get().past).toHaveLength(1);
      // the west edge handle moves only x
      drag(t, h, bare, [{ x: 5, y: 9.5 }, { x: 3, y: 9.5 }]);
      expect(h.get().venue.rooms[0]).toMatchObject({ x: 3, y: 5, w: 15, h: 9 });
    });
  });
  it("a room cannot be dragged smaller than the minimum", () => {
    withGrid(0.5, () => {
      const v = must(ops.addRoom(ops.blankVenue(), "F1", { x: 5, y: 5 }, { x: 15, y: 12 })).venue;
      const r = ops.resizeRoom(v, "F1-r1", "se", { x: 5.2, y: 5.1 });
      expect(r.rooms[0]!.w).toBeGreaterThanOrEqual(1.5);
      expect(r.rooms[0]!.h).toBeGreaterThanOrEqual(1.5);
    });
  });

  const lineVenue = () => {
    let v = ops.blankVenue();
    let chain: string | null = null;
    for (const p of [{ x: 5, y: 10 }, { x: 15, y: 10 }, { x: 25, y: 10 }]) {
      const r = ops.walkClick(v, "F1", chain, p);
      v = r.venue;
      chain = r.nodeId;
    }
    return v;
  };

  it("clicking a corridor line selects it; dragging its middle dot inserts a bend in ONE undo step", () => {
    withGrid(0, () => {
      const v = lineVenue();
      const key = ops.edgeKey(v.edges[0]!);
      const h = harness(v);
      const t = createTool("select");
      t.onSelect({ type: "edge", id: key }, { x: 10, y: 10 }, h.host);
      expect(h.get().selected).toEqual({ type: "edge", id: key });
      // the bend handle sits in the middle of the first line (10, 10)
      expect(drag(t, h, bare, [{ x: 10, y: 10 }, { x: 10, y: 11 }, { x: 10, y: 13.4 }])).toBe(true);
      const after = h.get();
      expect(after.past).toHaveLength(1);
      expect(after.venue.nodes.filter((n) => n.kind === "corridor")).toHaveLength(4);
      expect(after.venue.nodes.some((n) => n.x === 10 && n.y === 13.4)).toBe(true);
      expect(after.venue.edges.filter((e) => e.type === "walk")).toHaveLength(3);
      expect(after.selected?.type).toBe("node");
    });
  });
  it("Alt+drag on a corridor line moves the whole connected corridor", () => {
    withGrid(0, () => {
      const v = lineVenue();
      const key = ops.edgeKey(v.edges[1]!);
      const h = harness(v);
      const t = createTool("select");
      expect(drag(t, h, { ...on("edge", key), altKey: true }, [{ x: 20, y: 10 }, { x: 21, y: 11 }, { x: 20, y: 14 }])).toBe(true);
      const ys = h.get().venue.nodes.filter((n) => n.kind === "corridor").map((n) => n.y);
      expect(ys).toEqual([14, 14, 14]);
      expect(h.get().past).toHaveLength(1);
    });
  });
});

describe("room + door tools", () => {
  it("room: rubber band overlay while dragging, one commit on release, selects the room; tiny drags error", () => {
    const h = harness(ops.blankVenue());
    const t = createTool("room");
    t.onPointer("down", { x: 5, y: 5 }, bare, h.host);
    t.onPointer("move", { x: 12, y: 9 }, bare, h.host);
    expect(h.overlay()).toMatchObject({ kind: "rect" });
    t.onPointer("up", { x: 12, y: 9 }, bare, h.host);
    expect(h.overlay()).toBeNull();
    expect(h.get().venue.rooms).toHaveLength(1);
    expect(h.get().past).toHaveLength(1);
    expect(h.get().selected).toEqual({ type: "room", id: "F1-r1" });
    drag(t, h, bare, [{ x: 30, y: 30 }, { x: 30.3, y: 30.3 }]);
    expect(h.toasts.at(-1)).toMatch(/Too small/);
    expect(h.get().venue.rooms).toHaveLength(1);
  });
  it("door: Shift+click moves the nearest door to the clicked wall point", () => {
    const v = must(ops.addRoom(ops.blankVenue(), "F1", { x: 5, y: 5 }, { x: 15, y: 12 })).venue;
    const h = harness(v);
    createTool("door").onSelect({ type: "room", id: "F1-r1" }, { x: 14.9, y: 8 }, h.host, { target: null, shiftKey: true });
    expect(h.get().venue.rooms[0]!.door).toMatchObject({ side: "E", x: 15 });
    expect(h.get().past).toHaveLength(1);
  });
});

describe("walk tool", () => {
  it("each click is an undo step; same node again ends the chain; cancel clears the overlay", () => {
    const h = harness(ops.blankVenue());
    const t = createTool("walk");
    t.onSelect(null, { x: 2, y: 10 }, h.host);
    t.onSelect(null, { x: 20, y: 10 }, h.host);
    t.onSelect(null, { x: 40, y: 10 }, h.host);
    expect(h.get().venue.nodes).toHaveLength(3);
    expect(h.get().venue.edges).toHaveLength(2);
    expect(h.get().past).toHaveLength(3);
    t.onPointer("hover", { x: 45, y: 12 }, bare, h.host);
    expect(h.overlay()).toMatchObject({ kind: "line", color: "#0f9d8a" });
    t.onSelect(null, { x: 40.2, y: 10 }, h.host); // end node again
    expect(h.get().past).toHaveLength(3);
    // a fresh chain now starts unconnected
    t.onSelect(null, { x: 10, y: 20 }, h.host);
    t.onSelect(null, { x: 12, y: 20 }, h.host);
    expect(h.get().venue.edges).toHaveLength(3);
    t.cancel(h.host);
    expect(h.overlay()).toBeNull();
  });
});

describe("vertical tool", () => {
  const building = () => {
    let v = ops.addFloor(ops.blankVenue()).venue;
    for (const f of ["F1", "F2"]) {
      v = ops.walkClick(ops.walkClick(v, f, null, { x: 2, y: 10 }).venue, f, null, { x: 40, y: 10 }).venue;
      v = must(ops.addRoom(v, f, { x: 10, y: 11 }, { x: 14, y: 17 })).venue;
    }
    return v;
  };
  it("lift: pick on two floors, Finish links them", () => {
    const h = harness(building());
    const t = createTool("vertical");
    t.onSelect({ type: "room", id: "F1-r1" }, { x: 12, y: 14 }, h.host);
    h.dispatch({ type: "setFloor", id: "F2" });
    t.onSelect({ type: "room", id: "F2-r1" }, { x: 12, y: 14 }, h.host);
    expect(h.get().venue.edges.some((e) => e.type === "lift")).toBe(false); // waits for Finish
    t.finish!(h.host);
    expect(h.get().venue.edges.find((e) => e.type === "lift")).toMatchObject({ a: "F1-r1", b: "F2-r1" });
  });
  it("finish with fewer than two picks is an error; non-rooms are rejected", () => {
    const h = harness(building());
    const t = createTool("vertical");
    t.finish!(h.host);
    t.onSelect(null, { x: 1, y: 1 }, h.host);
    expect(h.toasts).toHaveLength(2);
  });
  it("stairs complete automatically on the second pick; skipping a floor is refused", () => {
    const h = harness(building());
    h.dispatch({ type: "setVerticalKind", kind: "stairs" });
    const t = createTool("vertical");
    t.onSelect({ type: "room", id: "F1-r1" }, { x: 0, y: 0 }, h.host);
    t.onSelect({ type: "room", id: "F2-r1" }, { x: 0, y: 0 }, h.host);
    expect(h.get().venue.edges.find((e) => e.type === "stairs")).toMatchObject({ upSec: 18, downSec: 12 });
  });
});

describe("marker / wall / poi tools", () => {
  const room = () => must(ops.addRoom(ops.blankVenue(), "F1", { x: 5, y: 2 }, { x: 25, y: 9 })).venue;
  it("place, select and report", () => {
    const h = harness(room());
    createTool("marker").onSelect(null, { x: 12, y: 9.4 }, h.host);
    createTool("wall").onSelect(null, { x: 18, y: 9.4 }, h.host);
    h.dispatch({ type: "setPoiKind", kind: "printer" });
    createTool("poi").onSelect(null, { x: 3, y: 3 }, h.host);
    const v = h.get().venue;
    expect(v.markers).toHaveLength(1);
    expect(v.walls).toHaveLength(1);
    expect(v.pois[0]).toMatchObject({ kind: "printer", name: "Printer" });
    expect(h.get().past).toHaveLength(3); // one undo step per placement
  });
});

describe("scale tool", () => {
  it("refuses without a photo, otherwise asks for the real length after two clicks", () => {
    const h = harness(ops.blankVenue());
    const t = createTool("scale");
    t.onSelect(null, { x: 1, y: 1 }, h.host);
    expect(h.toasts.at(-1)).toMatch(/photo/);
    const withPhoto = ops.setBackground(ops.blankVenue(), "F1", { imageUrl: "/uploads/a.png", widthPx: 1000, heightPx: 500 });
    const h2 = harness(withPhoto);
    const t2 = createTool("scale");
    t2.onSelect(null, { x: 5, y: 5 }, h2.host);
    t2.onPointer("hover", { x: 20, y: 5 }, bare, h2.host);
    expect(h2.overlay()).toMatchObject({ kind: "line", color: "#d93a3a" });
    t2.onSelect(null, { x: 20, y: 5 }, h2.host);
    expect(h2.scaleRequests).toEqual([{ floorId: "F1", a: { x: 5, y: 5 }, b: { x: 20, y: 5 } }]);
    expect(h2.get().past).toHaveLength(0); // nothing changes until the user confirms the length
  });
});

describe("background tool", () => {
  const photo = () => ops.setBackground(ops.blankVenue(), "F1", { imageUrl: "/uploads/a.png", widthPx: 2000, heightPx: 1000 });
  it("dragging the photo moves it as one undo step", () => {
    const h = harness(photo());
    const t = createTool("background");
    expect(drag(t, h, bare, [{ x: 20, y: 10 }, { x: 22, y: 11 }, { x: 25, y: 12 }])).toBe(true);
    expect(h.get().venue.floors[0]!.background!.transform).toMatchObject({ x: 5, y: 2 });
    expect(h.get().past).toHaveLength(1);
  });
  it("dragging the bottom-right handle scales it and drops calibration; the top-right handle rotates", () => {
    const v = ops.calibrateBackground(photo(), "F1", { x: 0, y: 0 }, { x: 10, y: 0 }, 10) as Venue;
    const h = harness(v);
    const t = createTool("background");
    const hs = bgHandles(v, "F1")!;
    const s0 = v.floors[0]!.background!.transform.scale;
    drag(t, h, bare, [hs.scaleHandle, { x: hs.scaleHandle.x * 1.5, y: hs.scaleHandle.y * 1.5 }]);
    const after = h.get().venue.floors[0]!.background!;
    expect(after.transform.scale).toBeCloseTo(s0 * 1.5, 3);
    expect(after.calibrated).toBe(false);
    const h2 = harness(v);
    const o = hs.origin;
    const r = hs.rotateHandle;
    drag(createTool("background"), h2, bare, [r, { x: o.x + (r.y - o.y) * -1 + 0, y: o.y + (r.x - o.x) }]); // quarter turn about the origin
    expect(Math.abs(h2.get().venue.floors[0]!.background!.transform.rotationDeg)).toBeGreaterThan(80);
    expect(h2.get().venue.floors[0]!.background!.calibrated).toBe(true); // rotating keeps the calibration
  });
  it("no photo: gestures are left to the map (pan)", () => {
    const h = harness(ops.blankVenue());
    expect(createTool("background").onPointer("down", { x: 1, y: 1 }, bare, h.host)).toBe(false);
  });
});
