import { useEffect, useState } from "react";
import { parseVenue, type Venue } from "@/core/schema";
import bundledRaw from "../../public/venues/office-hq/venue.json?raw";

export const DEFAULT_VENUE_ID = "office-hq";

export type VenueSource = "api" | "bundled";
export interface LoadedVenue {
  venue: Venue;
  source: VenueSource;
}

export function bundledVenue(): Venue | null {
  try {
    const r = parseVenue(JSON.parse(bundledRaw));
    return r.ok ? r.data : null;
  } catch {
    return null;
  }
}

/**
 * Published venue from /api/venues/:id; if the server is unreachable, slow (> timeoutMs), or returns something invalid,
 * the venue bundled into the app (office-hq) is used so the demo still runs.
 */
export async function loadVenue(id: string = DEFAULT_VENUE_ID, opts: { fetchFn?: typeof fetch; timeoutMs?: number } = {}): Promise<LoadedVenue | null> {
  const fetchFn = opts.fetchFn ?? (typeof fetch === "undefined" ? null : fetch.bind(globalThis));
  if (fetchFn) {
    const ctl = typeof AbortController === "undefined" ? null : new AbortController();
    const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeoutMs ?? 2000) : null;
    try {
      const res = await fetchFn(`/api/venues/${encodeURIComponent(id)}`, { cache: "no-store", signal: ctl?.signal });
      if (res.ok) {
        const parsed = parseVenue(await res.json());
        if (parsed.ok) return { venue: parsed.data, source: "api" };
      }
    } catch {
      /* fall through to the bundled copy */
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  if (id === DEFAULT_VENUE_ID) {
    const v = bundledVenue();
    if (v) return { venue: v, source: "bundled" };
  }
  return null;
}

export type VenueState = { status: "loading" } | { status: "ready"; venue: Venue; source: VenueSource } | { status: "missing"; id: string };

/** Venue id: the argument, else ?venue=, else office-hq. */
export function useVenue(idOverride?: string): VenueState {
  const id = idOverride ?? (typeof location === "undefined" ? DEFAULT_VENUE_ID : (new URLSearchParams(location.search).get("venue") ?? DEFAULT_VENUE_ID));
  const [state, setState] = useState<VenueState>({ status: "loading" });
  useEffect(() => {
    let live = true;
    void loadVenue(id).then((r) => {
      if (live) setState(r ? { status: "ready", venue: r.venue, source: r.source } : { status: "missing", id });
    });
    return () => {
      live = false;
    };
  }, [id]);
  return state;
}
