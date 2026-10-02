import { describe, expect, it } from "vitest";
import { distToRoom, edgeOutwardNormal, nearestOnPolygon, pointInPolygon, pointInRoom, polygonArea, polygonBounds, polygonCentroid, rotatePoints, roomLabelPoint, roomLabelWidth, roomPolygon, selfIntersects } from "@/core/geom";

const rect = { x: 2, y: 3, w: 10, h: 6 };
// An L shape: a 10 x 10 square with the top-right 5 x 5 corner missing.
const L = { x: 0, y: 0, w: 10, h: 10, polygon: [[0, 0], [5, 0], [5, 5], [10, 5], [10, 10], [0, 10]] as [number, number][] };

describe("rectangles behave exactly like the old rect tests", () => {
  it("roomPolygon is NW, NE, SE, SW", () => {
    expect(roomPolygon(rect)).toEqual([{ x: 2, y: 3 }, { x: 12, y: 3 }, { x: 12, y: 9 }, { x: 2, y: 9 }]);
  });
  it("pointInRoom is strict; distToRoom is the rectangle distance", () => {
    expect(pointInRoom(rect, 5, 5)).toBe(true);
    expect(pointInRoom(rect, 2, 5)).toBe(false); // on the wall
    expect(pointInRoom(rect, 1.9, 5)).toBe(false);
    expect(distToRoom(rect, 5, 5)).toBe(0);
    expect(distToRoom(rect, 14, 5)).toBe(2);
    expect(distToRoom(rect, 14, 12)).toBeCloseTo(Math.hypot(2, 3));
  });
  it("label point is the centre, label width the width", () => {
    expect(roomLabelPoint(rect)).toEqual({ x: 7, y: 6 });
    expect(roomLabelWidth(rect)).toBe(10);
  });
});

describe("polygons", () => {
  it("bounds, area (clockwise on screen is positive), centroid", () => {
    expect(polygonBounds(roomPolygon(L))).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(polygonArea(roomPolygon(L))).toBe(75);
    const c = polygonCentroid(roomPolygon(L));
    expect(c.x).toBeCloseTo(4.1667, 3);
    expect(c.y).toBeCloseTo(5.8333, 3);
  });
  it("an L shape: inside the arms, outside the notch, boundary is outside", () => {
    expect(pointInRoom(L, 2, 2)).toBe(true);
    expect(pointInRoom(L, 8, 8)).toBe(true);
    expect(pointInRoom(L, 8, 2)).toBe(false); // the notch (inside the bounding box)
    expect(pointInRoom(L, 5, 2)).toBe(false); // on an edge
    expect(pointInPolygon(2, 7, roomPolygon(L))).toBe(true);
  });
  it("distToRoom: 0 inside, distance to the outline outside (including the notch)", () => {
    expect(distToRoom(L, 2, 2)).toBe(0);
    expect(distToRoom(L, 8, 2)).toBe(3); // 3 m from the notch's vertical edge at x = 5
    expect(distToRoom(L, 12, 8)).toBe(2);
  });
  it("label point stays inside a concave shape and the label width is the run through it", () => {
    const p = roomLabelPoint(L);
    expect(pointInRoom(L, p.x, p.y)).toBe(true);
    const crescent = { x: 0, y: 0, w: 10, h: 10, polygon: [[0, 0], [10, 0], [10, 2], [2, 2], [2, 8], [10, 8], [10, 10], [0, 10]] as [number, number][] };
    const q = roomLabelPoint(crescent);
    expect(pointInRoom(crescent, q.x, q.y)).toBe(true); // the centroid (4.x, 5) is in the notch: must have been moved
    expect(roomLabelWidth(L)).toBeGreaterThan(3);
  });
  it("outward normals are tested against the interior (concave notch edges point INTO the notch)", () => {
    const poly = roomPolygon(L);
    expect(edgeOutwardNormal(poly, 0)).toBe(0); // top edge of the left arm: north
    expect(edgeOutwardNormal(poly, 1)).toBe(90); // the notch's vertical edge x=5 faces east (into the notch)
    expect(edgeOutwardNormal(poly, 2)).toBe(0); // the notch's floor y=5 faces north
    expect(edgeOutwardNormal(poly, 4)).toBe(180); // bottom edge: south
    expect(edgeOutwardNormal(poly, 5)).toBe(270); // left edge: west
    // a rectangle drawn the other way round gives the same answers
    const rev = [...roomPolygon(rect)].reverse();
    expect(edgeOutwardNormal(rev, 0)).toBe(180);
  });
  it("nearest point on the outline", () => {
    const n = nearestOnPolygon(roomPolygon(L), { x: 8, y: 2 });
    expect(n.point).toEqual({ x: 5, y: 2 });
    expect(n.dist).toBe(3);
    expect(n.edgeIndex).toBe(1);
    expect(n.t).toBeCloseTo(0.4);
  });
  it("rotation about a centre keeps the shape (area) and moves the points", () => {
    const rot = rotatePoints(roomPolygon(rect), { x: 7, y: 6 }, 90);
    expect(Math.abs(polygonArea(rot))).toBeCloseTo(60);
    const b = polygonBounds(rot);
    expect(b.w).toBeCloseTo(6);
    expect(b.h).toBeCloseTo(10);
    expect(rotatePoints([{ x: 8, y: 6 }], { x: 7, y: 6 }, 90)[0]!.y).toBeCloseTo(7); // clockwise on screen: east -> south
  });
  it("self-intersection is detected (a bow tie) and not for simple shapes", () => {
    expect(selfIntersects(roomPolygon(L))).toBe(false);
    expect(selfIntersects([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(true);
  });
});
