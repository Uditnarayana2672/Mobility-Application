import type { RouteDest, RouteFrom } from "@/core/route";

/** Pose as broadcast to the dashboard. Same shape as the mock's `pose` message (user + progress + HUD fields). */
export interface BusUser {
  floor: string;
  x: number;
  y: number;
  heading: number;
  acc: number;
  stale: boolean;
  markerId: number | null;
}

export interface PosePayload {
  t: number;
  screen: string;
  mode: string;
  ar: boolean;
  user: BusUser | null;
  /** Route progress (m) and route length (m). */
  s: number;
  total: number;
  next: string | null;
  nextDist: number | null;
  eta: number | null;
  dest: string | null;
  lang: string;
  scans: number;
  impressions: number;
  walked: number;
  playing: boolean;
  /** "lift" | "stairs" while the simulated walker is between floors. */
  trans: string | null;
  venue: string;
}

/** The dashboard re-computes the route from these three fields with the same engine (never ships geometry). */
export interface RoutePayload {
  id: number;
  from: RouteFrom;
  target: RouteDest;
  via: "stairs" | "lift" | null;
  destName: string;
}

export interface EventPayload {
  kind: string;
  text: string;
  at: number;
}

export type BusMessage =
  | { type: "pose"; payload: PosePayload }
  | { type: "route"; payload: RoutePayload | null }
  | { type: "event"; payload: EventPayload };

export type BusType = BusMessage["type"];
export type BusPayload<T extends BusType> = Extract<BusMessage, { type: T }>["payload"];

export interface Bus {
  send<T extends BusType>(type: T, payload: BusPayload<T>): void;
  /** Subscribe to one message type; returns an unsubscribe function. */
  on<T extends BusType>(type: T, fn: (payload: BusPayload<T>) => void): () => void;
  close(): void;
}

/** Last pose / route a bus has seen, so a dashboard opened late can hydrate. */
export interface BusSnapshot {
  pose: PosePayload | null;
  route: RoutePayload | null;
}
