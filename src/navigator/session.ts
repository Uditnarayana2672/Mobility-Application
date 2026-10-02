import { distToSegment } from "@/core/geo";
import { nextStep, remainingSec, remainingWalk } from "@/core/playback";
import type { Route, Step } from "@/core/route";
import type { Pose } from "./poseSource";

/**
 * Navigation session: a pure, deterministic state machine. Input = poses (+ a few user actions), output = events.
 * No clock, no DOM, no language: callers pass the pose time, and turn events into text with core's stepSpeech.
 */
export interface SessionOptions {
  /** Pre-announce the next manoeuvre this far ahead ("In 15 metres, turn left"). */
  preAnnounceM: number;
  /** "Turn now" distance. */
  turnNowM: number;
  /** Arrived when this close (along the route) to the destination, on its floor. */
  arriveM: number;
  /** Off route when farther than this from every segment of the route on the current floor... */
  offRouteM: number;
  /** ...for this long (pose time). */
  offRouteSec: number;
  /** How far behind / ahead of the current progress to look when snapping a pose onto the route. */
  backM: number;
  lookAheadM: number;
}

export const DEFAULT_SESSION_OPTIONS: SessionOptions = { preAnnounceM: 15, turnNowM: 3, arriveM: 3, offRouteM: 5, offRouteSec: 3, backM: 2, lookAheadM: 15 };

export type Phase = "walking" | "vertical" | "arrived";

export interface SessionState {
  readonly route: Route;
  readonly opts: SessionOptions;
  /** Progress along the route (m). */
  readonly s: number;
  readonly phase: Phase;
  /** Index of the vertical hop being taken while phase = "vertical". */
  readonly vHop: number | null;
  /** Set between arriving on the new floor and the user (or a lobby marker) confirming it. */
  readonly floorPrompt: { floor: string } | null;
  /** Announcements already made: "<stepIndex>:far" / "<stepIndex>:near". */
  readonly spoken: Readonly<Record<string, true>>;
  /** Pose time when the pose first left the route (null while on route). */
  readonly offSince: number | null;
  /** True once offRoute has fired for the current excursion. */
  readonly offFired: boolean;
}

export type SessionEvent =
  | { type: "start"; first: Step; second: Step | null }
  | { type: "preannounce"; stepIndex: number; step: Step; remaining: number }
  | { type: "turnNow"; stepIndex: number; step: Step }
  | { type: "connector"; hop: number; via: "stairs" | "lift"; fromFloor: string; toFloor: string }
  | { type: "floorPrompt"; floor: string }
  | { type: "floorConfirmed"; floor: string; how: "tap" | "marker"; stepIndex: number; step: Step; remaining: number }
  | { type: "arrive" }
  | { type: "offRoute"; distance: number };

export type SessionInput = { type: "pose"; pose: Pose; tMs: number } | { type: "confirmFloor" } | { type: "rebase"; route: Route };

export interface SessionResult {
  state: SessionState;
  events: SessionEvent[];
}

export interface SessionSnapshot {
  s: number;
  total: number;
  phase: Phase;
  next: { step: Step; index: number; remaining: number };
  /** Remaining walking distance (m) and time (s). */
  remainingM: number;
  etaSec: number;
  floorPrompt: { floor: string } | null;
}

/** Selectors for the HUD (banner, ETA bar, dashboard). */
export function snapshot(st: SessionState): SessionSnapshot {
  const { route, s } = st;
  return { s, total: route.total, phase: st.phase, next: nextStep(route, s), remainingM: remainingWalk(route, s), etaSec: remainingSec(route, s), floorPrompt: st.floorPrompt };
}

function fresh(route: Route, opts: SessionOptions): SessionResult {
  const first = route.steps[0] as Step;
  const state: SessionState = { route, opts, s: 0, phase: "walking", vHop: null, floorPrompt: null, spoken: { "0:far": true }, offSince: null, offFired: false };
  return { state, events: [{ type: "start", first, second: route.steps[1] ?? null }] };
}

export function createSession(route: Route, opts: Partial<SessionOptions> = {}): SessionResult {
  const r = fresh(route, { ...DEFAULT_SESSION_OPTIONS, ...opts });
  // A zero-length route (already there) arrives straight away.
  if (route.hops.length === 0) return { state: { ...r.state, phase: "arrived" }, events: [...r.events, { type: "arrive" }] };
  return r;
}

interface Cand {
  /** Route progress of the projection. */
  s: number;
  d: number;
}

const floorOf = (route: Route, i: number): string => (route.points[i] as { floor: string }).floor;

function project(route: Route, hop: number, x: number, y: number): Cand | null {
  const h = route.hops[hop];
  const a = route.points[hop];
  const b = route.points[hop + 1];
  if (!h || !a || !b || h.type !== "walk" || h.len <= 1e-9) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
  return { s: (route.cum[hop] as number) + t * h.len, d: distToSegment({ x, y }, a, b) };
}

function candidates(route: Route, floor: string, x: number, y: number, lo: number, hi: number): Cand[] {
  const out: Cand[] = [];
  for (let i = 0; i < route.hops.length; i++) {
    if (floorOf(route, i) !== floor) continue;
    const c0 = route.cum[i] as number;
    const c1 = route.cum[i + 1] as number;
    if (c1 < lo || c0 > hi) continue;
    const c = project(route, i, x, y);
    if (c) out.push(c);
  }
  return out;
}

/** Among near-equal distances prefer the first hop at or after the current progress (out-and-back corridors). */
function pick(cands: Cand[], sPrev: number): Cand | null {
  if (!cands.length) return null;
  const dmin = Math.min(...cands.map((c) => c.d));
  const near = cands.filter((c) => c.d <= dmin + 0.75);
  const ahead = near.filter((c) => c.s >= sPrev - 1e-6).sort((a, b) => a.s - b.s);
  if (ahead.length) return ahead[0] as Cand;
  return near.sort((a, b) => b.s - a.s)[0] as Cand;
}

/** Index of the first vertical hop whose end lies ahead of s (the next floor change), or null. */
function nextVertical(route: Route, s: number): number | null {
  for (let i = 0; i < route.hops.length; i++) {
    if ((route.hops[i] as { type: string }).type !== "walk" && (route.cum[i + 1] as number) > s + 1e-6) return i;
  }
  return null;
}

/** The floor a walking pose should be on at progress s: the floor of the first walk hop that ends at or after s. */
function walkingFloor(route: Route, s: number): string {
  for (let i = 0; i < route.hops.length; i++) {
    if ((route.hops[i] as { type: string }).type === "walk" && (route.cum[i + 1] as number) >= s - 1e-6) return floorOf(route, i);
  }
  return route.destFloor;
}

export function advance(st: SessionState, input: SessionInput): SessionResult {
  if (input.type === "rebase") return fresh(input.route, st.opts);
  if (st.phase === "arrived") return { state: st, events: [] };

  if (input.type === "confirmFloor") {
    if (!st.floorPrompt) return { state: st, events: [] };
    const nx = nextStep(st.route, st.s);
    return {
      state: { ...st, floorPrompt: null, spoken: { ...st.spoken, [`${nx.index}:far`]: true } },
      events: [{ type: "floorConfirmed", floor: st.floorPrompt.floor, how: "tap", stepIndex: nx.index, step: nx.step, remaining: nx.remaining }],
    };
  }

  const { pose, tMs } = input;
  const { route, opts } = st;
  const events: SessionEvent[] = [];
  // A stale pose carries no information: no progress, no announcements, and it must not extend an off-route timer.
  if (pose.stale) return { state: { ...st, offSince: null }, events };

  let s = st.s;
  let phase: Phase = st.phase;
  let vHop = st.vHop;
  let floorPrompt = st.floorPrompt;
  let spoken = st.spoken;
  let dist = 0;
  let offRoute = false;

  // A lobby marker on the new floor confirms the floor prompt.
  if (floorPrompt && pose.source === "marker" && pose.markerId !== null && pose.floor === floorPrompt.floor) {
    const nx = nextStep(route, s);
    spoken = { ...spoken, [`${nx.index}:far`]: true };
    events.push({ type: "floorConfirmed", floor: floorPrompt.floor, how: "marker", stepIndex: nx.index, step: nx.step, remaining: nx.remaining });
    floorPrompt = null;
  }

  if (phase === "vertical" && vHop !== null) {
    const fromFloor = floorOf(route, vHop);
    const toFloor = floorOf(route, vHop + 1);
    if (pose.floor === toFloor) {
      s = route.cum[vHop + 1] as number;
      phase = "walking";
      vHop = null;
      floorPrompt = { floor: toFloor };
      events.push({ type: "floorPrompt", floor: toFloor });
    } else if (pose.floor !== fromFloor) {
      offRoute = true;
      dist = Infinity;
    }
  } else if (pose.floor !== walkingFloor(route, s)) {
    offRoute = true;
    dist = Infinity;
  } else {
    const near = pick(candidates(route, pose.floor, pose.x, pose.y, s - opts.backM, s + opts.lookAheadM), s);
    if (near && near.d <= opts.offRouteM) {
      s = Math.max(s, near.s);
    } else {
      // Outside the window: judge against the whole route on this floor (a forward jump is accepted, a backward one is not).
      const all = pick(candidates(route, pose.floor, pose.x, pose.y, -Infinity, Infinity), s);
      if (all && all.d <= opts.offRouteM) {
        if (all.s > s) s = all.s;
      } else {
        offRoute = true;
        dist = all ? all.d : Infinity;
      }
    }
    // Reached the lift / stairs: wait for the floor to change.
    const v = nextVertical(route, s);
    if (!offRoute && v !== null && s >= (route.cum[v] as number) - 0.3 && floorOf(route, v) === pose.floor) {
      phase = "vertical";
      vHop = v;
      s = route.cum[v] as number;
      events.push({ type: "connector", hop: v, via: (route.hops[v] as { type: "stairs" | "lift" }).type, fromFloor: pose.floor, toFloor: floorOf(route, v + 1) });
    }
  }

  // Off-route timer (pose time).
  let offSince = st.offSince;
  let offFired = st.offFired;
  if (offRoute) {
    if (offSince === null) offSince = tMs;
    if (!offFired && tMs - offSince >= opts.offRouteSec * 1000) {
      offFired = true;
      events.push({ type: "offRoute", distance: dist });
    }
  } else {
    offSince = null;
    offFired = false;
  }

  // Announcements, once per step.
  if (!offRoute && phase === "walking") {
    const nx = nextStep(route, s);
    if (nx.step.kind !== "arrive") {
      const far = `${nx.index}:far`;
      const near = `${nx.index}:near`;
      const initial = nx.step.kind === "turn" && nx.step.initial && s < 0.3;
      if (nx.remaining <= opts.turnNowM && !spoken[near]) {
        spoken = { ...spoken, [near]: true, [far]: true };
        events.push({ type: "turnNow", stepIndex: nx.index, step: nx.step });
      } else if (nx.remaining <= opts.preAnnounceM && !spoken[far] && !initial) {
        spoken = { ...spoken, [far]: true };
        events.push({ type: "preannounce", stepIndex: nx.index, step: nx.step, remaining: nx.remaining });
      }
    }
  }

  // Arrival: close enough along the route, on the destination floor.
  if (!offRoute && phase === "walking" && pose.floor === route.destFloor && route.total - s <= opts.arriveM) {
    phase = "arrived";
    events.push({ type: "arrive" });
  }

  return { state: { ...st, s, phase, vHop, floorPrompt, spoken, offSince, offFired }, events };
}

/** Nearest point of the route's walk hops on `floor` (whole route), for re-syncing a walker to the route. */
export function snapToRoute(route: Route, floor: string, x: number, y: number): { s: number; d: number } | null {
  return pick(candidates(route, floor, x, y, -Infinity, Infinity), 0);
}
