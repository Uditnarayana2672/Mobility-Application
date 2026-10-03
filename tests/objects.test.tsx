import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import { OBJECT_KINDS, OBJECT_KIND_IDS } from "@/core/cats";
import { parseVenue, route, isRouteError, validate, type Venue } from "@/core";
import * as ops from "@/editor/ops";
import { initialState, reducer, selectionExists, type Action } from "@/editor/store";
import { createTool, selectionHandles, type Host, type PointerEventLike } from "@/editor/tools";
import { MapCanvas } from "@/ui/map";

const seed = (): Venue => {
  const r = parseVenue(JSON.parse(fs.readFileSync("public/venues/office-hq/venue.json", "utf8")));
  if (!r.ok) throw new Error("fixture invalid");
  return r.data;
};

const harness = (venue: Venue) => {
  let s = initialState(venue);
  const dispatch = (a: Action) => {
    s = reducer(s, a);
  };
  const host: Host = {
    venue: () => s.venue,
    floorId: () => s.floorId,
    selected: () => s.selected,
    poiKind: () => s.poiKind,
    objectKind: () => s.objectKind,
    verticalKind: () => s.verticalKind,
    commit: (v) => dispatch({ type: "commit", venue: v }),
    preview: (v) => dispatch({ type: "preview", venue: v }),
    commitPending: () => dispatch({ type: "commitPending" }),
    select: (selection) => dispatch({ type: "select", selection }),
    setOverlay: () => undefined,
    status: () => undefined,
    toast: () => undefined,
    scale: () => 10,
    requestScale: () => undefined,
  };
  return { host, get: () => s, dispatch };
};
const bare: PointerEventLike = { target: { closest: () => null } as unknown as EventTarget };
const on = (type: string, id: string): PointerEventLike => ({ target: { closest: () => ({ getAttribute: (k: string) => (k === "data-type" ? type : id) }) } as unknown as EventTarget });

describe("furniture schema", () => {
  it("older venues without `objects` still parse (empty list); objects round-trip", () => {
    const raw = JSON.parse(fs.readFileSync("public/venues/office-hq/venue.json", "utf8"));
    expect(raw.objects).toBeUndefined();
    const parsed = parseVenue(raw);
    expect(parsed.ok && parsed.data.objects).toEqual([]);
    const v = ops.addObject(seed(), "F1", { x: 5, y: 5 }, "bed", "Bed A").venue;
    const again = parseVenue(JSON.parse(JSON.stringify(v)));
    expect(again.ok && again.data.objects[0]).toMatchObject({ kind: "bed", label: "Bed A", w: 2, h: 1, rotation: 0 });
  });
  it("every kind has an icon and a positive default size", () => {
    for (const k of OBJECT_KIND_IDS) {
      expect(OBJECT_KINDS[k].icon.length).toBeGreaterThan(0);
      expect(OBJECT_KINDS[k].w).toBeGreaterThan(0);
      expect(OBJECT_KINDS[k].h).toBeGreaterThan(0);
    }
    const bad = JSON.parse(JSON.stringify(seed()));
    bad.objects = [{ id: "O01", floor: "F1", kind: "spaceship", x: 1, y: 1, w: 1, h: 1 }];
    expect(parseVenue(bad).ok).toBe(false);
  });
});

describe("furniture ops", () => {
  it("add / update / move / delete, ids O01, O02", () => {
    const old = ops.getGrid();
    ops.setGrid(0.5);
    try {
      let v = ops.addObject(seed(), "F1", { x: 5.2, y: 5.2 }, "table").venue;
      const second = ops.addObject(v, "F1", { x: 8, y: 8 }, "chair");
      v = second.venue;
      expect(v.objects.map((o) => o.id)).toEqual(["O01", second.id]);
      expect(second.id).toBe("O02");
      expect(v.objects[0]).toMatchObject({ x: 5, y: 5, w: 1.6, h: 0.9 });
      v = ops.updateObject(v, "O01", { label: "Meeting table", rotation: 90 });
      expect(v.objects[0]).toMatchObject({ label: "Meeting table", rotation: 90 });
      v = ops.moveObjectBy(v, "O01", 2.1, -1);
      expect(v.objects[0]).toMatchObject({ x: 7, y: 4 });
      v = ops.deleteItem(v, { type: "object", id: "O01" });
      expect(v.objects.map((o) => o.id)).toEqual(["O02"]);
    } finally {
      ops.setGrid(old);
    }
  });

  it("resize works in the object's own (rotated) axes; rotate points the top edge at the pointer", () => {
    const old = ops.getGrid();
    ops.setGrid(0);
    try {
      let v = ops.addObject(seed(), "F1", { x: 10, y: 10 }, "bed").venue;
      v = ops.updateObject(v, "O01", { rotation: 90 }); // its local x axis now points south
      // drag the corner to local (2, 0.5): world = centre + rot90(2, 0.5) = (10 - 0.5, 10 + 2)
      const r = ops.resizeObject(v, "O01", { x: 9.5, y: 12 });
      expect(r.objects[0]).toMatchObject({ w: 4, h: 1 });
      // pointer straight "up" (north) of the centre: top edge points north => rotation 0
      expect(ops.rotateObject(v, "O01", { x: 10, y: 5 }).objects[0]!.rotation).toBe(0);
      expect(ops.rotateObject(v, "O01", { x: 15, y: 10 }).objects[0]!.rotation).toBe(90);
      ops.setGrid(0.5);
      expect(ops.rotateObject(v, "O01", { x: 14, y: 6.3 }).objects[0]!.rotation % 15).toBe(0);
    } finally {
      ops.setGrid(old);
    }
  });

  it("furniture never changes routing or validation", () => {
    const v = seed();
    const withStuff = [0, 1, 2, 3, 4].reduce((acc, i) => ops.addObject(acc, "F1", { x: 10 + i, y: 17 }, "chair").venue, v);
    const a = route(v, { floor: "F1", x: 3, y: 17 }, { room: "F2-cafeteria" });
    const b = route(withStuff, { floor: "F1", x: 3, y: 17 }, { room: "F2-cafeteria" });
    expect(isRouteError(a) || isRouteError(b)).toBe(false);
    if (!isRouteError(a) && !isRouteError(b)) expect(b.total).toBe(a.total);
    expect(validate(withStuff).map((r) => r.level + r.title)).toEqual(validate(v).map((r) => r.level + r.title));
  });
});

describe("furniture tool + handles", () => {
  it("click places the chosen kind (one undo step) and selects it; clicking an existing item selects instead of stacking", () => {
    const h = harness(ops.blankVenue());
    h.dispatch({ type: "setObjectKind", kind: "sofa" });
    const t = createTool("object");
    t.onSelect(null, { x: 5, y: 5 }, h.host);
    expect(h.get().venue.objects).toHaveLength(1);
    expect(h.get().venue.objects[0]!.kind).toBe("sofa");
    expect(h.get().selected).toEqual({ type: "object", id: "O01" });
    expect(h.get().past).toHaveLength(1);
    t.onSelect({ type: "object", id: "O01" }, { x: 5, y: 5 }, h.host);
    expect(h.get().venue.objects).toHaveLength(1);
  });

  it("the select tool drags an item by its grab offset, resizes by a corner, rotates by the orange dot; each is ONE undo step", () => {
    const old = ops.getGrid();
    ops.setGrid(0);
    try {
      const h = harness(ops.addObject(ops.blankVenue(), "F1", { x: 10, y: 10 }, "bed").venue);
      const t = createTool("select");
      const drag = (ev: PointerEventLike, path: ops.Pt[]) => {
        const captured = t.onPointer("down", path[0]!, ev, h.host);
        if (captured) {
          for (const p of path.slice(1)) t.onPointer("move", p, ev, h.host);
          t.onPointer("up", path[path.length - 1]!, ev, h.host);
        }
        return captured;
      };
      // move: grab at (10.3, 10.1), drop 3 m east
      expect(drag(on("object", "O01"), [{ x: 10.3, y: 10.1 }, { x: 11, y: 10.1 }, { x: 13.3, y: 10.1 }])).toBe(true);
      expect(h.get().venue.objects[0]).toMatchObject({ x: 13, y: 10 });
      expect(h.get().past).toHaveLength(1);
      expect(h.get().selected).toEqual({ type: "object", id: "O01" });
      // handles appear for the selection
      const hs = selectionHandles(h.get().venue, h.get().selected, "F1");
      expect(hs.filter((x) => x.kind === "oresize")).toHaveLength(4);
      expect(hs.filter((x) => x.kind === "orotate")).toHaveLength(1);
      // resize via the bottom-right corner (index 2) of a 2 x 1 bed centred at (13, 10)
      const corner = hs.filter((x) => x.kind === "oresize")[2]!.at;
      expect(drag(bare, [corner, { x: corner.x + 0.5, y: corner.y + 0.2 }, { x: 15, y: 11 }])).toBe(true);
      expect(h.get().venue.objects[0]).toMatchObject({ w: 4, h: 2 });
      expect(h.get().past).toHaveLength(2);
      // rotate: drag the handle to the east of the centre => 90 degrees
      const rot = selectionHandles(h.get().venue, h.get().selected, "F1").find((x) => x.kind === "orotate")!.at;
      expect(drag(bare, [rot, { x: 14, y: 9 }, { x: 18, y: 10 }])).toBe(true);
      expect(h.get().venue.objects[0]!.rotation).toBe(90);
      expect(h.get().past).toHaveLength(3);
      // Delete / undo keep the selection consistent
      expect(selectionExists(h.get().venue, h.get().selected)).toBe(true);
    } finally {
      ops.setGrid(old);
    }
  });
});

describe("furniture on the map", () => {
  const html = (v: Venue, layers?: { objects: boolean }) => renderToStaticMarkup(<MapCanvas venue={v} floorId="F1" layers={layers} theme="classic" />);
  it("draws items with their icon, rotation and data attributes; the layer can be switched off", () => {
    let v = ops.addObject(seed(), "F1", { x: 10, y: 10 }, "bed", "Bed A").venue;
    v = ops.updateObject(v, "O01", { rotation: 30 });
    const on = html(v);
    expect(on).toContain('data-type="object"');
    expect(on).toContain('data-id="O01"');
    expect(on).toContain("rotate(30)");
    expect(on).toContain("🛏️");
    expect(on).toContain("Bed A");
    expect(html(v, { objects: false })).not.toContain('data-type="object"');
  });
  it("items on another floor are not drawn", () => {
    const v = ops.addObject(seed(), "F2", { x: 10, y: 10 }, "bed").venue;
    expect(html(v)).not.toContain('data-type="object"');
  });
});
