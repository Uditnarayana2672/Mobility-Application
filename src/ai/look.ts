import type { Target } from "@/core/intent";
import type { Venue } from "@/core/schema";
import { placeOf } from "@/navigator/places";

/** What the server's "Look around" (Claude reading the camera picture) answers. Every place in it exists in the venue. */
export interface LookResult {
  nearest: { target: Target; name: string } | null;
  confidence: "none" | "low" | "medium" | "high";
  saw: string;
  visible: { target: Target; name: string; direction: "ahead" | "left" | "right" | "behind" }[];
}

export type LookOutcome = { ok: true; result: LookResult } | { ok: false; error: "no-key" | "offline" | "failed"; detail?: string };

/** Send one camera picture to the server. Never throws. */
export async function postLook(venueId: string, floor: string | undefined, jpeg: Blob, fetcher: typeof fetch = fetch): Promise<LookOutcome> {
  try {
    const q = new URLSearchParams({ venue: venueId });
    if (floor) q.set("floor", floor);
    const res = await fetcher(`/api/ai/look?${q.toString()}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: jpeg });
    if (res.status === 503) return { ok: false, error: "no-key" };
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: "failed", detail: j.error };
    }
    return { ok: true, result: (await res.json()) as LookResult };
  } catch (e) {
    return { ok: false, error: "offline", detail: e instanceof Error ? e.message : String(e) };
  }
}

const OFFSET = { ahead: 0, left: 90, right: -90, behind: 180 } as const;

/**
 * Which way the camera faces on the map, from the places the AI saw and where they are: a place "on the left" lies 90 degrees to the left
 * of the viewing direction, and so on. Several places are averaged. null when nothing usable was seen.
 */
export function headingFromView(v: Venue, pos: { floor: string; x: number; y: number }, visible: LookResult["visible"]): number | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const o of visible) {
    const p = placeOf(v, o.target);
    if (!p || p.floor !== pos.floor) continue;
    const dx = p.x - pos.x;
    const dy = p.y - pos.y;
    if (Math.hypot(dx, dy) < 0.5) continue;
    const bearing = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const h = ((bearing + OFFSET[o.direction]) * Math.PI) / 180;
    sx += Math.sin(h);
    sy += Math.cos(h);
    n++;
  }
  if (!n || Math.hypot(sx, sy) < 1e-6) return null;
  return (((Math.atan2(sx, sy) * 180) / Math.PI) + 360) % 360;
}
