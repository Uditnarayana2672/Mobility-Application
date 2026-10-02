import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MapCanvas, fitView, panFrom, screenToWorld, worldToScreen, zoomAt, type MapView } from "@/ui/map";
import { isRouteError, parseVenue, route, type Venue } from "@/core";

const V: Venue = (() => {
  const r = parseVenue(JSON.parse(fs.readFileSync("public/venues/office-hq/venue.json", "utf8")));
  if (!r.ok) throw new Error("bad fixture");
  return r.data;
})();

const view = (o: Partial<MapView> = {}): MapView => ({ cx: 30, cy: 18, scale: 8, rot: 0, W: 400, H: 300, anchorY: 0.5, ...o });
const lim = { minScale: 2, maxScale: 60 };

describe("viewMath", () => {
  it("screenToWorld inverts worldToScreen, with rotation and a low anchor", () => {
    for (const v of [view(), view({ rot: 37 }), view({ rot: -140, anchorY: 0.65, scale: 13 })]) {
      for (const [x, y] of [[0, 0], [12.5, 3], [59, 35]] as const) {
        const s = worldToScreen(v, x, y);
        const w = screenToWorld(v, s.x, s.y);
        expect(w.x).toBeCloseTo(x, 9);
        expect(w.y).toBeCloseTo(y, 9);
      }
    }
  });
  it("centre maps to the anchor", () => {
    const v = view({ rot: 90, anchorY: 0.6 });
    const s = worldToScreen(v, v.cx, v.cy);
    expect(s.x).toBeCloseTo(200);
    expect(s.y).toBeCloseTo(180);
  });
  it("zoomAt keeps the point under the cursor fixed", () => {
    const v = view({ rot: 25 });
    const before = screenToWorld(v, 120, 80);
    const z = zoomAt(v, 120, 80, 1.7, lim);
    expect(z.scale).toBeCloseTo(8 * 1.7);
    const after = screenToWorld(z, 120, 80);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
  it("zoom is clamped", () => {
    expect(zoomAt(view(), 0, 0, 100, lim).scale).toBe(60);
    expect(zoomAt(view(), 0, 0, 0.001, lim).scale).toBe(2);
  });
  it("panFrom moves the world with the pointer, also when rotated", () => {
    const v = view({ rot: 30 });
    const grabbed = screenToWorld(v, 100, 100);
    const moved = panFrom(v, 100 - 160, 100 - 130); // pointer moved from (100,100) to (160,130)
    const under = screenToWorld(moved, 160, 130);
    expect(under.x).toBeCloseTo(grabbed.x, 9);
    expect(under.y).toBeCloseTo(grabbed.y, 9);
  });
  it("fitView centres the plate and respects limits", () => {
    const f = fitView(view({ rot: 50 }), 60, 36, lim);
    expect(f).toMatchObject({ cx: 30, cy: 18, rot: 0 });
    expect(f.scale).toBeLessThanOrEqual(60);
    expect(60 * f.scale).toBeLessThanOrEqual(400);
  });
});

describe("MapCanvas (server render)", () => {
  const html = (props: Partial<Parameters<typeof MapCanvas>[0]> = {}) => renderToStaticMarkup(<MapCanvas venue={V} floorId="F1" {...props} />);

  it("draws rooms of the selected floor only, with data attributes for hit-testing", () => {
    const h = html();
    expect(h).toContain('data-id="F1-reception"');
    expect(h).not.toContain('data-id="F2-cafeteria"');
    expect(h.match(/data-type="room"/g)?.length).toBe(V.rooms.filter((r) => r.floor === "F1").length);
  });
  it("layers toggle markers, walls and the walk network", () => {
    expect(html()).not.toContain('data-type="marker"');
    const h = html({ layers: { markers: true, walls: true, walknet: true } });
    expect(h.match(/data-type="marker"/g)?.length).toBe(V.markers.filter((m) => m.floor === "F1").length);
    expect(h.match(/data-type="wall"/g)?.length).toBeGreaterThanOrEqual(V.walls.filter((w) => w.floor === "F1").length);
    expect(h).toContain('data-type="node"');
  });
  it("renders the background photo underlay with its transform", () => {
    const v: Venue = structuredClone(V);
    v.floors[0]!.background = { imageUrl: "/uploads/abc.png", widthPx: 2000, heightPx: 1000, opacity: 0.4, transform: { x: 1, y: 2, scale: 0.03, rotationDeg: 5 }, calibrated: true };
    const h = renderToStaticMarkup(<MapCanvas venue={v} floorId="F1" layers={{ underlay: true }} />);
    expect(h).toContain('href="/uploads/abc.png"');
    expect(h).toContain("translate(1,2) rotate(5) scale(0.03)");
    expect(renderToStaticMarkup(<MapCanvas venue={v} floorId="F1" />)).not.toContain("/uploads/abc.png");
  });
  it("draws the route and user dot, only on the right floor", () => {
    const r = route(V, { floor: "F1", x: 3, y: 17, heading: 90 }, { room: "F2-cafeteria" });
    if (isRouteError(r)) throw new Error("no route");
    const user = { floor: "F1", x: 3, y: 17, heading: 90, acc: 2 };
    const f1 = html({ route: r, user });
    expect(f1).toContain("#2f5bea"); // remaining route
    expect(f1).toContain("Stairs");
    const f2 = renderToStaticMarkup(<MapCanvas venue={V} floorId="F2" route={r} user={user} />);
    expect(f2).not.toContain('fill="url(#cone)"');
    expect(f2).toContain("Stairs"); // arrival pill on floor 2 too
  });
  it("highlights the selected room", () => {
    expect(html({ selected: { type: "room", id: "F1-wsa" } })).toContain('stroke-width="3.5"');
  });
});
