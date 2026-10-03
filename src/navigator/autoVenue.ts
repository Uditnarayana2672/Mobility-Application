import { useCallback, useEffect, useState } from "react";
import { pickVenue, type RegistryEntry, type VenueMatch } from "@/core/geofence";
import { DEFAULT_VENUE_ID } from "@/shared/useVenue";
import { currentPosition, fetchRegistry, lastVenue, type GeoLike, type PositionFail } from "@/shared/registry";

export type VenueChoice =
  | { status: "detecting" }
  | { status: "ready"; id: string; how: "url" | "gps" | "last" | "default"; match?: VenueMatch }
  | { status: "ask"; venues: RegistryEntry[]; reason: "far" | PositionFail | "empty" };

export interface DetectEnv {
  search: string;
  /** (pointer: coarse): a phone. */
  coarsePointer: boolean;
  geo: GeoLike | null;
}

/** Does this page load decide the building from the phone's GPS? Only a live phone with no ?venue= (and ?auto=1 forces it for testing). */
export function wantsAutoVenue(env: DetectEnv): boolean {
  const q = new URLSearchParams(env.search);
  if (q.get("venue")) return false;
  if (q.get("demo") === "1" || q.get("pose") === "sim") return false;
  if (q.get("auto") === "0") return false;
  return !!env.geo && (env.coarsePointer || q.get("auto") === "1");
}

/**
 * Pure decision: given the registry and the outcome of the GPS request, which venue (or which question for the visitor)?
 *  - registry has no venue with a location -> nothing to detect with: the last or the default venue, as before
 *  - GPS inside / near exactly one venue    -> that venue
 *  - GPS fix but not near any mapped place  -> ask ("you don't seem to be at a mapped place")
 *  - no GPS (denied / off / timeout)        -> the last venue used on this phone, else ask
 */
export function decideVenue(registry: RegistryEntry[], gps: { ok: true; fix: { lat: number; lng: number; acc: number } } | { ok: false; reason: PositionFail }, last: string | null): VenueChoice {
  const located = registry.filter((e) => e.geo);
  const known = (id: string | null) => (id && registry.some((e) => e.id === id) ? id : null);
  if (!located.length) return { status: "ready", id: known(last) ?? DEFAULT_VENUE_ID, how: known(last) ? "last" : "default" };
  if (gps.ok) {
    const m = pickVenue(located, gps.fix);
    if (m) return { status: "ready", id: m.id, how: "gps", match: m };
    return { status: "ask", venues: registry, reason: "far" };
  }
  const l = known(last);
  return l ? { status: "ready", id: l, how: "last" } : { status: "ask", venues: registry, reason: gps.reason };
}

const defaultEnv = (): DetectEnv => ({
  search: typeof location === "undefined" ? "" : location.search,
  coarsePointer: typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches,
  geo: typeof navigator === "undefined" ? null : (navigator.geolocation ?? null),
});

export function useVenueChoice(env: DetectEnv = defaultEnv()): { choice: VenueChoice; retry(): void } {
  const [n, setN] = useState(0);
  const [choice, setChoice] = useState<VenueChoice>(() => {
    const id = new URLSearchParams(env.search).get("venue");
    if (id) return { status: "ready", id, how: "url" };
    return wantsAutoVenue(env) ? { status: "detecting" } : { status: "ready", id: DEFAULT_VENUE_ID, how: "default" };
  });
  useEffect(() => {
    if (!wantsAutoVenue(env)) return;
    let live = true;
    setChoice({ status: "detecting" });
    void Promise.all([fetchRegistry(), currentPosition(env.geo)]).then(([registry, gps]) => {
      if (live) setChoice(decideVenue(registry, gps, lastVenue()));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);
  return { choice, retry: useCallback(() => setN((x) => x + 1), []) };
}
