import type { Venue } from "@/core/schema";
import { roomDoors } from "@/core/doors";
import { CORRIDOR_W, distToSegment } from "@/core/geo";
import { bearingDelta, bearingToVector, normaliseBearing } from "@/shared/frame";

/**
 * Free space on one floor: corridors, plus room interiors that can only be entered/left through the room's door
 * (rooms share walls with the corridor, so without this a particle would walk straight through them).
 */
export interface Walkable {
  contains(floor: string, x: number, y: number): boolean;
  /** Distance (m) to the nearest walkable rectangle (0 inside). */
  distance(floor: string, x: number, y: number): number;
  /** Can a walker go from (x0,y0) to (x1,y1) on this floor without crossing a wall? */
  canMove(floor: string, x0: number, y0: number, x1: number, y1: number): boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface RoomRect extends Rect {
  id: string;
  doors: { x: number; y: number }[];
}

const DOOR_REACH_M = 1.6;

export function walkableFromVenue(v: Venue): Walkable {
  const corr = new Map<string, Rect[]>();
  const rooms = new Map<string, RoomRect[]>();
  for (const c of v.corridors) corr.set(c.floor, [...(corr.get(c.floor) ?? []), c]);
  for (const r of v.rooms) rooms.set(r.floor, [...(rooms.get(r.floor) ?? []), { x: r.x, y: r.y, w: r.w, h: r.h, id: r.id, doors: roomDoors(r) }]);
  // Venues drawn in the editor have corridors as walk-path edges (no corridor rectangles): walkable = within CORRIDOR_HALF_M of a walk edge.
  const segs = new Map<string, { a: { x: number; y: number }; b: { x: number; y: number }; half: number }[]>();
  const nodeById = new Map(v.nodes.map((n) => [n.id, n]));
  for (const e of v.edges) {
    if (e.type !== "walk") continue;
    const a = nodeById.get(e.a);
    const b = nodeById.get(e.b);
    if (!a || !b || a.floor !== b.floor || a.kind === "room" || b.kind === "room") continue;
    segs.set(a.floor, [...(segs.get(a.floor) ?? []), { a, b, half: Math.max(0.6, (e.width ?? CORRIDOR_W) / 2) }]);
  }
  /** Distance beyond the corridor's own half-width (<= 0 inside a corridor strip). */
  const segDist = (floor: string, x: number, y: number): number => {
    let d = Infinity;
    for (const s of segs.get(floor) ?? []) d = Math.min(d, distToSegment({ x, y }, s.a, s.b) - s.half);
    return d;
  };
  const dist = (r: Rect, x: number, y: number): number => Math.hypot(Math.max(r.x - x, 0, x - (r.x + r.w)), Math.max(r.y - y, 0, y - (r.y + r.h)));
  const EPS = 1e-9;
  /** "c" = in a corridor, room id = inside that room (boundary points belong to the corridor), null = outside everything. */
  const region = (floor: string, x: number, y: number): string | null => {
    if ((corr.get(floor) ?? []).some((r) => dist(r, x, y) <= EPS) || segDist(floor, x, y) <= 0) return "c";
    const room = (rooms.get(floor) ?? []).find((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h);
    return room ? room.id : null;
  };
  const doorsOf = (floor: string, id: string): { x: number; y: number }[] => rooms.get(floor)?.find((r) => r.id === id)?.doors ?? [];
  return {
    contains: (floor, x, y) => region(floor, x, y) !== null,
    distance: (floor, x, y) => {
      let d = Infinity;
      for (const r of corr.get(floor) ?? []) d = Math.min(d, dist(r, x, y));
      d = Math.min(d, Math.max(0, segDist(floor, x, y)));
      for (const r of rooms.get(floor) ?? []) d = Math.min(d, dist(r, x, y));
      return d;
    },
    canMove: (floor, x0, y0, x1, y1) => {
      const pts: [number, number][] = [[x0, y0], [(x0 + x1) / 2, (y0 + y1) / 2], [x1, y1]];
      let prev = region(floor, x0, y0);
      if (prev === null) return false;
      for (let i = 1; i < pts.length; i++) {
        const [x, y] = pts[i]!;
        const [px, py] = pts[i - 1]!;
        const cur = region(floor, x, y);
        if (cur === null) return false;
        if (cur !== prev) {
          if (cur !== "c" && prev !== "c") return false; // room to room: through a wall
          const ds = doorsOf(floor, cur === "c" ? prev : cur);
          if (!ds.some((d) => Math.min(Math.hypot(d.x - x, d.y - y), Math.hypot(d.x - px, d.y - py)) <= DOOR_REACH_M)) return false;
        }
        prev = cur;
      }
      return true;
    },
  };
}

/** Deterministic PRNG (mulberry32) so tests are reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ParticleOptions {
  count: number;
  /** Relative stride noise (1 sigma). */
  strideSigma: number;
  /** Per-step heading noise (deg, 1 sigma). */
  headingSigmaDeg: number;
  /** Per-step random walk of each particle's gyro bias (deg, 1 sigma). */
  biasWalkDeg: number;
  /** Weight multiplier for a particle that stepped outside the walkable area. */
  outsidePenalty: number;
}
export const DEFAULT_PARTICLES: ParticleOptions = { count: 300, strideSigma: 0.1, headingSigmaDeg: 4, biasWalkDeg: 0.8, outsidePenalty: 0.02 };

export interface PfEstimate {
  floor: string;
  x: number;
  y: number;
  heading: number;
  /** Spread-based accuracy radius (m). */
  acc: number;
}

/**
 * Particle filter for step-and-heading dead reckoning on a map: ~300 particles each carry a position and a gyro-heading bias.
 * Particles that walk through walls lose weight, so the corridor shape corrects both position and heading drift.
 */
export class ParticleFilter {
  private x: Float64Array;
  private y: Float64Array;
  private bias: Float64Array;
  private w: Float64Array;
  private floor: string;
  private heading = 0;
  readonly opts: ParticleOptions;

  constructor(
    private walk: Walkable,
    floor: string,
    private readonly rnd: () => number = Math.random,
    opts: Partial<ParticleOptions> = {},
  ) {
    this.opts = { ...DEFAULT_PARTICLES, ...opts };
    const n = this.opts.count;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.bias = new Float64Array(n);
    this.w = new Float64Array(n).fill(1 / n);
    this.floor = floor;
  }

  private gauss(): number {
    let u = 0;
    while (u === 0) u = this.rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rnd());
  }

  setWalkable(w: Walkable): void {
    this.walk = w;
  }

  get count(): number {
    return this.x.length;
  }
  get currentFloor(): string {
    return this.floor;
  }

  /** Re-seed a tight cloud (marker fix, manual position). */
  seed(floor: string, x: number, y: number, heading: number, sigmaM: number): void {
    this.floor = floor;
    this.heading = normaliseBearing(heading);
    for (let i = 0; i < this.count; i++) {
      this.x[i] = x + this.gauss() * sigmaM;
      this.y[i] = y + this.gauss() * sigmaM;
      this.bias[i] = this.gauss() * 2;
      this.w[i] = 1 / this.count;
    }
  }

  /** Keep the cloud, change floor (confirmed floor change): the cloud is moved onto the connector point. */
  moveToFloor(floor: string, x: number, y: number, sigmaM: number): void {
    this.seed(floor, x, y, this.heading, sigmaM);
  }

  /** One detected step: `heading` is the gyro heading (deg), `stride` metres. */
  step(stride: number, heading: number): void {
    this.heading = normaliseBearing(heading);
    const n = this.count;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      this.bias[i]! += this.gauss() * this.opts.biasWalkDeg;
      const h = heading + this.bias[i]! + this.gauss() * this.opts.headingSigmaDeg;
      const d = stride * (1 + this.gauss() * this.opts.strideSigma);
      const v = bearingToVector(h);
      const nx = this.x[i]! + v.x * d;
      const ny = this.y[i]! + v.y * d;
      const ok = this.walk.canMove(this.floor, this.x[i]!, this.y[i]!, nx, ny);
      if (ok) {
        this.x[i] = nx;
        this.y[i] = ny;
      } else {
        this.w[i]! *= this.opts.outsidePenalty; // a wall stops the particle (it stays put) and makes it unlikely
      }
      sum += this.w[i]!;
    }
    if (sum <= 1e-300) {
      this.w.fill(1 / n);
    } else {
      for (let i = 0; i < n; i++) this.w[i]! /= sum;
    }
    if (this.nEff() < n / 2) this.resample();
  }

  nEff(): number {
    let s = 0;
    for (let i = 0; i < this.count; i++) s += this.w[i]! * this.w[i]!;
    return s > 0 ? 1 / s : 0;
  }

  /** Systematic resampling; survivors that sit outside the walkable area are pulled to the nearest point inside by jitter. */
  private resample(): void {
    const n = this.count;
    const nx = new Float64Array(n);
    const ny = new Float64Array(n);
    const nb = new Float64Array(n);
    const u0 = this.rnd() / n;
    let c = this.w[0]!;
    let j = 0;
    for (let i = 0; i < n; i++) {
      const u = u0 + i / n;
      while (u > c && j < n - 1) {
        j++;
        c += this.w[j]!;
      }
      // Jitter, but never across a wall (a particle on the boundary would otherwise leak into the next room).
      const jx = this.x[j]! + this.gauss() * 0.05;
      const jy = this.y[j]! + this.gauss() * 0.05;
      const free = this.walk.canMove(this.floor, this.x[j]!, this.y[j]!, jx, jy);
      nx[i] = free ? jx : this.x[j]!;
      ny[i] = free ? jy : this.y[j]!;
      nb[i] = this.bias[j]! + this.gauss() * 0.3;
    }
    this.x = nx;
    this.y = ny;
    this.bias = nb;
    this.w.fill(1 / n);
  }

  /** Heading-only update (the gyro turned but no step yet): the estimate's heading follows the gyro. */
  setHeading(heading: number): void {
    this.heading = normaliseBearing(heading);
  }

  estimate(): PfEstimate {
    const n = this.count;
    let mx = 0;
    let my = 0;
    let mb = 0;
    for (let i = 0; i < n; i++) {
      mx += this.x[i]! * this.w[i]!;
      my += this.y[i]! * this.w[i]!;
      mb += this.bias[i]! * this.w[i]!;
    }
    let vr = 0;
    for (let i = 0; i < n; i++) vr += ((this.x[i]! - mx) ** 2 + (this.y[i]! - my) ** 2) * this.w[i]!;
    const spread = Math.sqrt(vr);
    return { floor: this.floor, x: mx, y: my, heading: normaliseBearing(this.heading + mb), acc: Math.max(0.8, Math.min(8, 0.6 + 2 * spread)) };
  }

  /** Particle positions for the debug overlay (a copy, capped). */
  cloud(max = 300): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    const stepN = Math.max(1, Math.floor(this.count / max));
    for (let i = 0; i < this.count; i += stepN) out.push({ x: this.x[i]!, y: this.y[i]! });
    return out;
  }

  /** Signed heading difference helper for callers that compare estimate headings. */
  static headingError(a: number, b: number): number {
    return bearingDelta(a, b);
  }
}
