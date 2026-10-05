import { useEffect, useState } from "react";
import type { Venue } from "@/core/schema";
import { fetchRegistry } from "./registry";

/** A place offered on the first screen of the visitor app. */
export interface VenueListItem {
  id: string;
  name: string;
  type: string;
  /** null when only the name is known (a venue published on this server that is not in the shipped list). */
  floors: number | null;
  icon: string;
}

export const iconForType = (type: string): string => (/airport/i.test(type) ? "✈️" : /mall|shop/i.test(type) ? "🛍️" : /bus/i.test(type) ? "🚌" : /rail|train|metro|station/i.test(type) ? "🚆" : /pg|residen|home/i.test(type) ? "🏠" : "🏢");

const sub = (it: VenueListItem): string => `${it.type || "Venue"}${it.floors ? ` · ${it.floors} floor${it.floors === 1 ? "" : "s"} mapped` : " · mapped"}`;
export const subtitleOf = sub;

/**
 * The venues to offer: the list shipped with the app (/venues/index.json) plus whatever this server has published (/api/registry),
 * in that order, without repeats. Never throws; empty when neither can be read.
 */
export async function fetchVenueList(fetcher: typeof fetch = fetch): Promise<VenueListItem[]> {
  const out = new Map<string, VenueListItem>();
  try {
    const res = await fetcher("/venues/index.json", { cache: "no-store" });
    if (res.ok) {
      const j: unknown = await res.json();
      if (Array.isArray(j)) {
        for (const raw of j) {
          const e = raw as Partial<VenueListItem>;
          if (e && typeof e.id === "string" && typeof e.name === "string") {
            out.set(e.id, { id: e.id, name: e.name, type: typeof e.type === "string" ? e.type : "Venue", floors: typeof e.floors === "number" ? e.floors : null, icon: typeof e.icon === "string" ? e.icon : iconForType(String(e.type ?? "")) });
          }
        }
      }
    }
  } catch {
    /* the app still works with the one venue it has loaded */
  }
  for (const r of await fetchRegistry(fetcher)) if (!out.has(r.id)) out.set(r.id, { id: r.id, name: r.name, type: "Venue", floors: null, icon: "🏢" });
  return [...out.values()];
}

/** The list for the first screen; the venue that is open is always in it (and its details win). */
export function useVenueList(current: Venue): VenueListItem[] {
  const own: VenueListItem = { id: current.id, name: current.name, type: current.type || "Venue", floors: current.floors.length, icon: iconForType(current.type || "") };
  const [list, setList] = useState<VenueListItem[]>([own]);
  useEffect(() => {
    let live = true;
    void fetchVenueList().then((l) => {
      if (!live) return;
      const withCurrent = l.some((x) => x.id === current.id) ? l.map((x) => (x.id === current.id ? { ...x, floors: current.floors.length } : x)) : [own, ...l];
      setList(withCurrent);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.id]);
  return list;
}

/** Address of the visitor app for another venue; keeps the other settings in the address (?demo=1 and so on). */
export function venueHref(id: string): string {
  const q = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
  q.set("venue", id);
  return `${import.meta.env.BASE_URL}nav?${q.toString()}`;
}
