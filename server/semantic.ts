import os from "node:os";
import path from "node:path";
import { catOf, poiKindOf } from "../src/core/cats";
import type { Target } from "../src/core/intent";
import { NEEDS, needCandidates } from "../src/core/needs";
import { isRouteError, route, type RouteFrom, type RoutePrefs } from "../src/core/route";
import type { Venue } from "../src/core/schema";

export interface Ranked {
  target: Target;
  name: string;
  /** Cosine similarity, -1..1 (about 0.5+ is a real match for short phrases). */
  score: number;
}

export type Embedder = (texts: string[]) => Promise<number[][]>;

/** Decisive enough to act on without asking: a clear winner. */
export const MIN_SCORE = 0.45;
export const MIN_MARGIN = 0.04;

/** What the model compares an utterance with: everything the venue says about a place. */
export function placeDocs(v: Venue): { target: Target; name: string; text: string }[] {
  // What each place is good for, in plain words ("coffee or tea", "a washroom"): small models match these far better than bare names.
  const goodFor = new Map<string, string[]>();
  for (const n of NEEDS) {
    for (const c of needCandidates(v, n)) {
      const key = "room" in c.target ? `r:${c.target.room}` : `p:${c.target.poi}`;
      goodFor.set(key, [...(goodFor.get(key) ?? []), n.label]);
    }
  }
  const out: { target: Target; name: string; text: string }[] = [];
  for (const r of v.rooms) {
    if (r.access === "staff" || r.cat === "restricted") continue;
    const cat = catOf(r.cat)?.label ?? "";
    out.push({ target: { room: r.id }, name: r.name, text: [r.name, ...(r.aliases ?? []), cat, ...(goodFor.get(`r:${r.id}`) ?? [])].filter(Boolean).join(". ") });
  }
  for (const p of v.pois) out.push({ target: { poi: p.id }, name: p.name, text: [p.name, poiKindOf(p.kind)?.label ?? "", ...(goodFor.get(`p:${p.id}`) ?? [])].filter(Boolean).join(". ") });
  return out;
}

const dot = (a: number[], b: number[]): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};

/**
 * Free-form text -> the closest places OF THIS VENUE, using a small multilingual sentence-embedding model that runs on this machine.
 * It can only ever return places that exist in the venue (it ranks a closed list); it never writes an answer of its own.
 */
export class LocalSemanticRanker {
  private embed: Promise<Embedder> | null = null;
  private loaded = false;
  private failed: string | undefined;
  private docs = new Map<string, Promise<{ docs: ReturnType<typeof placeDocs>; vecs: number[][] }>>();

  constructor(
    private readonly root: string,
    private readonly model: string = process.env.EMBED_MODEL ?? "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    embedder?: Embedder,
  ) {
    if (embedder) {
      this.embed = Promise.resolve(embedder);
      this.loaded = true;
    }
  }

  /** True once the model is in memory (the first load downloads it). Callers do not wait for it. */
  ready(): boolean {
    return this.loaded;
  }
  get error(): string | undefined {
    return this.failed;
  }

  warm(): void {
    void this.load().catch(() => undefined);
  }

  private load(): Promise<Embedder> {
    if (this.embed) return this.embed;
    this.embed = (async () => {
      const { env, pipeline } = await import("@huggingface/transformers");
      env.cacheDir = path.join(this.root, "data", "models", "hf");
      const threads = Number(process.env.STT_THREADS) || Math.max(1, Math.min(4, os.cpus().length));
      const pipe = await pipeline("feature-extraction", this.model, { dtype: "q8", device: "cpu", session_options: { intraOpNumThreads: threads } });
      this.loaded = true;
      return async (texts: string[]) => {
        const t = await pipe(texts, { pooling: "mean", normalize: true });
        return t.tolist() as number[][];
      };
    })().catch((e: unknown) => {
      this.failed = e instanceof Error ? e.message : String(e);
      this.embed = null;
      throw e;
    });
    return this.embed;
  }

  private venueVectors(v: Venue, embed: Embedder) {
    const key = `${v.id}@${v.version}:${v.rooms.length}:${v.pois.length}`;
    let hit = this.docs.get(key);
    if (!hit) {
      const docs = placeDocs(v);
      hit = embed(docs.map((d) => d.text)).then((vecs) => ({ docs, vecs }));
      this.docs.set(key, hit);
      hit.catch(() => this.docs.delete(key));
    }
    return hit;
  }

  async rank(v: Venue, text: string, limit = 8): Promise<Ranked[]> {
    const embed = await this.load();
    const { docs, vecs } = await this.venueVectors(v, embed);
    const [q] = await embed([text]);
    if (!q) return [];
    return docs
      .map((d, i) => ({ target: d.target, name: d.name, score: dot(q, vecs[i]!) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

/**
 * The place to take the visitor to, or the names to ask about.
 *   - nothing scores well enough            -> { ask: [] }
 *   - one clear winner                       -> { pick }
 *   - several places score about the same    -> the nearest by walking time when the position is known (two water coolers,
 *                                               a pantry and a cafeteria); with no position and different names: { ask: names }
 */
export function chooseTarget(v: Venue, ranked: Ranked[], from: RouteFrom | null, prefs?: Partial<RoutePrefs>): { pick: Ranked } | { ask: string[] } {
  const top = ranked[0];
  if (!top || top.score < MIN_SCORE) return { ask: [] };
  const tie = ranked.filter((r) => r.score >= top.score - MIN_MARGIN);
  if (tie.length === 1) return { pick: top };
  if (from) {
    let best: { r: Ranked; t: number } | null = null;
    for (const r of tie) {
      const rt = route(v, from, r.target, prefs);
      if (!isRouteError(rt) && (!best || rt.time < best.t)) best = { r, t: rt.time };
    }
    if (best) return { pick: best.r };
  }
  const names = [...new Set(tie.map((r) => r.name))];
  return names.length === 1 ? { pick: top } : { ask: names.slice(0, 3) };
}
