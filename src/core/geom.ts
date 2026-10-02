import type { Room } from "./schema";

/** Room geometry that works for rectangles and free-form polygons. Frame: x east, y south, metres; bearing 0 = north, clockwise. */
export interface P2 {
  x: number;
  y: number;
}
type RoomShape = Pick<Room, "x" | "y" | "w" | "h" | "polygon">;

const EPS = 1e-9;

/** The room outline: its polygon when it has one, else the rectangle (NW, NE, SE, SW). */
export function roomPolygon(r: RoomShape): P2[] {
  if (r.polygon && r.polygon.length >= 3) return r.polygon.map(([x, y]) => ({ x, y }));
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

export function polygonBounds(poly: readonly P2[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Signed area (positive = clockwise on screen, y down). */
export function polygonArea(poly: readonly P2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** Strictly inside the polygon (points on the boundary count as outside). Ray casting. */
export function pointInPolygon(x: number, y: number, poly: readonly P2[]): boolean {
  if (onBoundary(x, y, poly)) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function onBoundary(x: number, y: number, poly: readonly P2[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    if (distToSegment(x, y, poly[i]!, poly[(i + 1) % poly.length]!) <= EPS) return true;
  }
  return false;
}

function distToSegment(x: number, y: number, a: P2, b: P2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

/** Strictly inside the room (same semantics for rectangles as the old `x > r.x && x < r.x + r.w && ...` tests). */
export function pointInRoom(r: RoomShape, x: number, y: number): boolean {
  if (!r.polygon || r.polygon.length < 3) return x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
  return pointInPolygon(x, y, roomPolygon(r));
}

/** 0 inside or on the outline, else the distance to the outline. */
export function distToRoom(r: RoomShape, x: number, y: number): number {
  if (!r.polygon || r.polygon.length < 3) return Math.hypot(Math.max(r.x - x, 0, x - (r.x + r.w)), Math.max(r.y - y, 0, y - (r.y + r.h)));
  const poly = roomPolygon(r);
  if (pointInPolygon(x, y, poly)) return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, distToSegment(x, y, poly[i]!, poly[(i + 1) % poly.length]!));
  return d;
}

export function polygonCentroid(poly: readonly P2[]): P2 {
  const a = polygonArea(poly);
  if (Math.abs(a) < EPS) {
    const b = polygonBounds(poly);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Where to put the label / icon / room node: the centre of a rectangle; for a polygon its centroid, or (if that falls outside, e.g. an L shape) the inside point farthest from the outline. */
export function roomLabelPoint(r: RoomShape): P2 {
  if (!r.polygon || r.polygon.length < 3) return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  const poly = roomPolygon(r);
  const c = polygonCentroid(poly);
  if (pointInPolygon(c.x, c.y, poly)) return c;
  const b = polygonBounds(poly);
  let best = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  let bestD = -1;
  const N = 24;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const x = b.x + (b.w * i) / N;
      const y = b.y + (b.h * j) / N;
      if (!pointInPolygon(x, y, poly)) continue;
      let d = Infinity;
      for (let k = 0; k < poly.length; k++) d = Math.min(d, distToSegment(x, y, poly[k]!, poly[(k + 1) % poly.length]!));
      if (d > bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

/** The width available for a label at the label point (horizontal run inside the shape, through that point). */
export function roomLabelWidth(r: RoomShape): number {
  if (!r.polygon || r.polygon.length < 3) return r.w;
  const poly = roomPolygon(r);
  const p = roomLabelPoint(r);
  const b = polygonBounds(poly);
  const step = Math.max(0.1, b.w / 80);
  let left = 0;
  while (left < b.w && pointInPolygon(p.x - left - step, p.y, poly)) left += step;
  let right = 0;
  while (right < b.w && pointInPolygon(p.x + right + step, p.y, poly)) right += step;
  return left + right;
}

export function polygonEdges(poly: readonly P2[]): { a: P2; b: P2; index: number }[] {
  return poly.map((a, index) => ({ a, b: poly[(index + 1) % poly.length]!, index }));
}

const bearingOf = (dx: number, dy: number): number => ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;

/** Bearing pointing out of the polygon, perpendicular to edge `i` (tested against the interior, so it works for concave shapes). */
export function edgeOutwardNormal(poly: readonly P2[], i: number): number {
  const a = poly[i]!;
  const b = poly[(i + 1) % poly.length]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = dy / len;
  let ny = -dx / len;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  if (pointInPolygon(mx + nx * 0.05, my + ny * 0.05, poly)) {
    nx = -nx;
    ny = -ny;
  }
  return Math.round(bearingOf(nx, ny) * 100) / 100;
}

export interface EdgeProjection {
  point: P2;
  edgeIndex: number;
  dist: number;
  /** 0..1 along the edge. */
  t: number;
}

/** Nearest point of the outline to p. */
export function nearestOnPolygon(poly: readonly P2[], p: P2): EdgeProjection {
  let best: EdgeProjection = { point: poly[0]!, edgeIndex: 0, dist: Infinity, t: 0 };
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.dist) best = { point: q, edgeIndex: i, dist: d, t };
  });
  return best;
}

/** Rotate points about a centre, clockwise on screen by `deg`. */
export function rotatePoints(pts: readonly P2[], c: P2, deg: number): P2[] {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return pts.map((p) => ({ x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos }));
}

/** Do any two non-neighbouring edges cross? (A self-intersecting outline is allowed but flagged.) */
export function selfIntersects(poly: readonly P2[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(poly[i]!, poly[(i + 1) % n]!, poly[j]!, poly[(j + 1) % n]!)) return true;
    }
  }
  return false;
}

function segmentsCross(a: P2, b: P2, c: P2, d: P2): boolean {
  const o = (p: P2, q: P2, r: P2) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
