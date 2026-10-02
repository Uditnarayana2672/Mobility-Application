import { bearingOf } from "./geo";
import type { Route, Step } from "./route";

export interface PointAt {
  floor: string;
  x: number;
  y: number;
  bearing: number;
  hop: number;
  vertical?: { via: "stairs" | "lift"; t: number; toFloor: string; up: boolean | undefined };
}

/** Position along a route after walking `s` metres of route length. */
export function pointAt(route: Route, s0: number): PointAt {
  const s = Math.max(0, Math.min(route.total, s0));
  let i = 0;
  while (i < route.hops.length - 1 && (route.cum[i + 1] as number) < s) i++;
  if (!route.hops.length) {
    const p = route.points[0]!;
    return { floor: p.floor, x: p.x, y: p.y, bearing: 0, hop: 0 };
  }
  const a = route.points[i]!;
  const b = route.points[i + 1]!;
  const h = route.hops[i]!;
  const t = h.len ? (s - (route.cum[i] as number)) / h.len : 1;
  if (h.type !== "walk") {
    let bg = 0;
    for (let k = i - 1; k >= 0; k--) {
      if (route.hops[k]!.type === "walk") {
        bg = bearingOf(route.points[k]!, route.points[k + 1]!);
        break;
      }
    }
    return { floor: a.floor, x: a.x, y: a.y, bearing: bg, hop: i, vertical: { via: h.type, t, toFloor: b.floor, up: h.up } };
  }
  return { floor: a.floor, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, bearing: bearingOf(a, b), hop: i };
}

export interface Run {
  floor: string;
  pts: { x: number; y: number }[];
  lastHop: number;
}

/** Drawable polyline runs per floor between route lengths s0..s1. */
export function routeRuns(route: Route, s0: number, s1: number): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < route.hops.length; i++) {
    const h = route.hops[i]!;
    if (h.type !== "walk") continue;
    const a = route.points[i]!;
    const b = route.points[i + 1]!;
    const c0 = route.cum[i] as number;
    const c1 = route.cum[i + 1] as number;
    if (c1 <= s0 || c0 >= s1) continue;
    const t0 = Math.max(0, (s0 - c0) / h.len);
    const t1 = Math.min(1, (s1 - c0) / h.len);
    const p0 = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 };
    const p1 = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 };
    let run = runs[runs.length - 1];
    if (!run || run.floor !== a.floor || run.lastHop !== i - 1) {
      run = { floor: a.floor, pts: [p0], lastHop: i };
      runs.push(run);
    }
    run.pts.push(p1);
    run.lastHop = i;
  }
  return runs;
}

export function remainingSec(route: Route, s: number): number {
  let sec = 0;
  route.hops.forEach((h, i) => {
    const c0 = route.cum[i] as number;
    const c1 = route.cum[i + 1] as number;
    if (c1 <= s) return;
    const frac = c0 >= s ? 1 : (c1 - s) / (c1 - c0 || 1);
    sec += h.sec * frac;
  });
  return sec;
}

export function remainingWalk(route: Route, s: number): number {
  let m = 0;
  route.hops.forEach((h, i) => {
    if (h.type !== "walk") return;
    const c0 = route.cum[i] as number;
    const c1 = route.cum[i + 1] as number;
    if (c1 <= s) return;
    m += c0 >= s ? h.len : c1 - s;
  });
  return m;
}

/** Next manoeuvre ahead of progress s (the initial turn counts while s is near 0). */
export function nextStep(route: Route, s: number): { step: Step; index: number; remaining: number } {
  for (let i = 0; i < route.steps.length; i++) {
    const st = route.steps[i]!;
    if (st.sAt > s + 0.05 || (st.kind === "turn" && st.initial && s < 0.3)) return { step: st, index: i, remaining: Math.max(0, st.sAt - s) };
  }
  const last = route.steps[route.steps.length - 1]!;
  return { step: last, index: route.steps.length - 1, remaining: Math.max(0, route.total - s) };
}
