import { catOf, poiKindOf } from "./cats";
import type { Poi, Room, Venue } from "./schema";

export type SearchHit = { type: "room"; id: string; room: Room; score: number } | { type: "poi"; id: string; poi: Poi; score: number };

/** Levenshtein distance. */
export function lev(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n] as number;
}

/** Fuzzy, offline room/POI search with alias support (Hinglish / Telugu aliases). Same scoring as the mock. */
export function search(v: Venue, qRaw: string): SearchHit[] {
  const q = (qRaw || "").toLowerCase().trim();
  if (!q) return [];
  const out: SearchHit[] = [];
  const words = q.split(/\s+/).filter(Boolean);
  for (const r of v.rooms) {
    const name = r.name.toLowerCase();
    let sc = 0;
    if (name.startsWith(q)) sc = 95;
    else if (name.includes(q)) sc = 70;
    for (const al of r.aliases || []) {
      const a = al.toLowerCase();
      if (a === q) sc = Math.max(sc, 92);
      else if (q.length >= 2 && a.includes(q)) sc = Math.max(sc, 72);
      else if (a.length >= 3 && q.includes(a)) sc = Math.max(sc, 66);
      else {
        for (const w of words) if (w.length >= 5 && a.length >= 5 && lev(w, a) <= 1) sc = Math.max(sc, 58);
      }
    }
    const cat = catOf(r.cat);
    if (cat && cat.label.toLowerCase().includes(q)) sc = Math.max(sc, 35);
    if (sc) out.push({ type: "room", id: r.id, room: r, score: sc });
  }
  for (const p of v.pois) {
    const kind = poiKindOf(p.kind)?.label ?? "";
    let sc = 0;
    if (p.name.toLowerCase().includes(q) || kind.toLowerCase().includes(q)) sc = 50;
    if (sc) out.push({ type: "poi", id: p.id, poi: p, score: sc });
  }
  // Array.prototype.sort is stable, matching the mock for equal scores.
  return out.sort((a, b) => b.score - a.score);
}
