import type { GpsFix, RegistryEntry } from "@/core/geofence";

/** The published venues and where they are (GET /api/registry). Empty when the server cannot be reached. */
export async function fetchRegistry(fetcher: typeof fetch = fetch): Promise<RegistryEntry[]> {
  try {
    const res = await fetcher("/api/registry", { cache: "no-store" });
    if (!res.ok) return [];
    const j = (await res.json()) as { venues?: RegistryEntry[] };
    return Array.isArray(j.venues) ? j.venues : [];
  } catch {
    return [];
  }
}

export type PositionFail = "denied" | "unavailable" | "timeout";
export type PositionResult = { ok: true; fix: GpsFix } | { ok: false; reason: PositionFail };

export interface GeoLike {
  getCurrentPosition(ok: (p: { coords: { latitude: number; longitude: number; accuracy: number } }) => void, err: (e: { code: number }) => void, opts?: object): void;
}

/** One GPS fix. Never throws. */
export function currentPosition(geo: GeoLike | null = typeof navigator === "undefined" ? null : (navigator.geolocation ?? null), timeoutMs = 10_000): Promise<PositionResult> {
  return new Promise((resolve) => {
    if (!geo) return resolve({ ok: false, reason: "unavailable" });
    const timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), timeoutMs + 500);
    geo.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        resolve({ ok: true, fix: { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy } });
      },
      (e) => {
        clearTimeout(timer);
        resolve({ ok: false, reason: e.code === 1 ? "denied" : e.code === 3 ? "timeout" : "unavailable" });
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

const KEY = "indore.lastVenue";
export function lastVenue(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function rememberVenue(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode */
  }
}
