/** The last position this phone had in a venue, so the next app open can offer "continue where you left off". */
export interface LastFix {
  venueId: string;
  floor: string;
  x: number;
  y: number;
  heading: number;
  acc: number;
  /** Epoch ms. */
  at: number;
}

const KEY = "indore.lastFix";
/** After this long the old position is not trusted (people walk away and come back). */
export const LAST_FIX_TTL_MS = 3 * 60 * 60 * 1000;

export interface KvLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}
const store = (): KvLike | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export function saveLastFix(f: LastFix, kv: KvLike | null = store()): void {
  try {
    kv?.setItem(KEY, JSON.stringify(f));
  } catch {
    /* private mode / full */
  }
}

export function loadLastFix(venueId: string, now = Date.now(), kv: KvLike | null = store()): LastFix | null {
  try {
    const raw = kv?.getItem(KEY);
    if (!raw) return null;
    const f = JSON.parse(raw) as Partial<LastFix>;
    if (f.venueId !== venueId || typeof f.floor !== "string" || ![f.x, f.y, f.heading, f.acc, f.at].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    if (now - (f.at as number) > LAST_FIX_TTL_MS || (f.at as number) > now + 60_000) return null;
    return f as LastFix;
  } catch {
    return null;
  }
}
