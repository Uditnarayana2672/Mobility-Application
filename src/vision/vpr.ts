/**
 * Visual place recognition (VPR): "which spot of the building does this camera picture look like?"
 *
 * Offline, once per venue: a survey walk records pictures with their map position (floor, x, y, heading). A small image-embedding model
 * turns each picture into a vector. At run time the live camera picture is embedded the same way and compared with the surveyed
 * vectors; the closest ones vote for a position. This file is the model-free part: the index, the voting, the temporal check and the
 * leave-one-out accuracy report. It is pure maths so it can be tested without any model or camera.
 */

/** The embedding model. The same one must be used when building the index and when asking (the index records it). */
export const VPR_MODEL = "Xenova/dinov2-small";
export const VPR_INPUT = 224;

export interface SurveyItem {
  id: string;
  floor: string;
  x: number;
  y: number;
  /** Camera heading when the picture was taken (map bearing, degrees). */
  heading: number;
  /** Unit-length embedding. */
  vec: number[];
}

export interface VprEval {
  items: number;
  /** Share of leave-one-out queries answered within `hitM` of the truth. */
  hitRate: number;
  medianErrM: number;
  /** Share of CONFIDENT answers that were more than `wrongM` away (the dangerous kind). */
  wrongLockRate: number;
  /** Share of queries the matcher was confident enough to answer. */
  answerRate: number;
  hitM: number;
  wrongM: number;
  passed: boolean;
}

export interface VprIndexFile {
  version: 1;
  model: string;
  dim: number;
  builtAt: string;
  items: SurveyItem[];
  eval: VprEval | null;
}

export interface VprFix {
  floor: string;
  x: number;
  y: number;
  /** Mean camera heading of the agreeing neighbours, or null when they disagree (a heading is only trusted when consistent). */
  heading: number | null;
  /** 0..1: how sure (similarity and a clear winner). */
  confidence: number;
  /** Accuracy radius to report, metres. */
  acc: number;
  /** Cosine similarity of the best match. */
  similarity: number;
}

export const TARGETS = { hitRate: 0.9, medianErrM: 2, wrongLockRate: 0.03, hitM: 2.5, wrongM: 5 };

export const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};

export function normalise(v: ArrayLike<number>): number[] {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!;
  n = Math.sqrt(n) || 1;
  return Array.from(v, (x) => x / n);
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const circMean = (hs: number[]): { mean: number; spread: number } => {
  let sx = 0;
  let sy = 0;
  for (const h of hs) {
    sx += Math.cos((h * Math.PI) / 180);
    sy += Math.sin((h * Math.PI) / 180);
  }
  const r = Math.hypot(sx, sy) / hs.length;
  return { mean: ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360, spread: (Math.sqrt(Math.max(0, -2 * Math.log(Math.max(r, 1e-6)))) * 180) / Math.PI };
};

export interface MatchOptions {
  /** How many nearest pictures vote. */
  k: number;
  /** The best picture must be at least this similar (cosine) to answer at all. */
  minSimilarity: number;
  /** Pictures within this distance of the best one, on the same floor, vote together for the position. */
  clusterM: number;
  /** Pictures farther than this from the best one are "somewhere else": the winner has to beat them. */
  farM: number;
  /** The best place must beat the best picture from somewhere else by this much (a corridor that looks like another one is refused). */
  minMargin: number;
}
export const DEFAULT_MATCH: MatchOptions = { k: 5, minSimilarity: 0.6, clusterM: 2.5, farM: 6, minMargin: 0.02 };

export class VprIndex {
  constructor(readonly items: readonly SurveyItem[], readonly model: string = VPR_MODEL) {}

  static from(file: VprIndexFile): VprIndex {
    return new VprIndex(file.items, file.model);
  }

  /** The `k` most similar surveyed pictures, best first. `skip` leaves some out (used by the leave-one-out check). */
  nearest(q: ArrayLike<number>, k: number, skip?: (i: SurveyItem) => boolean): { item: SurveyItem; sim: number }[] {
    const out: { item: SurveyItem; sim: number }[] = [];
    for (const item of this.items) {
      if (skip?.(item)) continue;
      out.push({ item, sim: dot(q, item.vec) });
    }
    return out.sort((a, b) => b.sim - a.sim).slice(0, k);
  }

  /**
   * One answer from one camera picture, or null when it is not sure. The best picture must be similar enough, and clearly better than
   * every picture from somewhere else; the position is the similarity-weighted mean of the best pictures taken close to each other.
   */
  locate(q: ArrayLike<number>, opts: Partial<MatchOptions> = {}, skip?: (i: SurveyItem) => boolean): VprFix | null {
    const o = { ...DEFAULT_MATCH, ...opts };
    const top = this.nearest(q, Math.max(o.k, 40), skip);
    const best = top[0];
    if (!best || best.sim < o.minSimilarity) return null;
    const near = top.filter((t) => t.item.floor === best.item.floor && dist(t.item, best.item) <= o.clusterM).slice(0, o.k);
    const far = top.find((t) => t.item.floor !== best.item.floor || dist(t.item, best.item) > o.farM);
    const margin = far ? best.sim - far.sim : 1;
    if (margin < o.minMargin) return null;
    let wx = 0;
    let wy = 0;
    let ws = 0;
    for (const t of near) {
      const w = Math.max(1e-3, t.sim - o.minSimilarity + 0.05);
      wx += t.item.x * w;
      wy += t.item.y * w;
      ws += w;
    }
    const x = wx / ws;
    const y = wy / ws;
    const hs = near.map((t) => t.item.heading);
    const hm = circMean(hs);
    const confidence = Math.max(0, Math.min(1, (best.sim - o.minSimilarity) / (1 - o.minSimilarity) * 0.6 + Math.min(1, margin / 0.15) * 0.4));
    const spreadM = Math.max(...near.map((t) => dist(t.item, { x, y })), 0);
    return { floor: best.item.floor, x, y, heading: near.length >= 2 && hm.spread < 25 ? hm.mean : null, confidence, acc: Math.max(1.2, Math.min(5, 1.2 + spreadM + (1 - confidence) * 2)), similarity: best.sim };
  }
}

/**
 * The voter that stops a single lucky match from moving the dot: an answer is released only when the last `need` answers all lie on the
 * same floor and within `withinM` of each other.
 */
export class FixVoter {
  private readonly recent: VprFix[] = [];
  constructor(private readonly need = 2, private readonly withinM = 3, private readonly maxAgeMs = 6000) {}
  private times: number[] = [];

  push(fix: VprFix | null, nowMs: number): VprFix | null {
    this.prune(nowMs);
    if (!fix) {
      this.recent.length = 0;
      this.times.length = 0;
      return null;
    }
    this.recent.push(fix);
    this.times.push(nowMs);
    while (this.recent.length > this.need) {
      this.recent.shift();
      this.times.shift();
    }
    if (this.recent.length < this.need) return null;
    const first = this.recent[0]!;
    if (!this.recent.every((f) => f.floor === first.floor && dist(f, first) <= this.withinM)) return null;
    const n = this.recent.length;
    const heads = this.recent.map((f) => f.heading).filter((h): h is number => h !== null);
    return {
      floor: first.floor,
      x: this.recent.reduce((s, f) => s + f.x, 0) / n,
      y: this.recent.reduce((s, f) => s + f.y, 0) / n,
      heading: heads.length === n ? circMean(heads).mean : null,
      confidence: Math.min(...this.recent.map((f) => f.confidence)),
      acc: Math.max(...this.recent.map((f) => f.acc)),
      similarity: Math.min(...this.recent.map((f) => f.similarity)),
    };
  }

  private prune(nowMs: number): void {
    while (this.times.length && nowMs - this.times[0]! > this.maxAgeMs) {
      this.times.shift();
      this.recent.shift();
    }
  }
}

/**
 * Honest self-test of an index: every surveyed picture is used as a query against all the OTHER pictures that were taken at least
 * `excludeM` away from it (the pictures right next to it would make the test trivial). The index may only be switched on automatically
 * when the result meets TARGETS.
 */
export function evaluateLeaveOneOut(items: readonly SurveyItem[], opts: { excludeM?: number; match?: Partial<MatchOptions> } = {}): VprEval {
  const excludeM = opts.excludeM ?? 1;
  const index = new VprIndex(items);
  const errs: number[] = [];
  let answered = 0;
  let hits = 0;
  let wrong = 0;
  for (const q of items) {
    const fix = index.locate(q.vec, opts.match, (i) => i.id === q.id || (i.floor === q.floor && dist(i, q) < excludeM));
    if (!fix) continue;
    answered++;
    const err = fix.floor === q.floor ? dist(fix, q) : Infinity;
    errs.push(err);
    if (err <= TARGETS.hitM) hits++;
    if (err > TARGETS.wrongM) wrong++;
  }
  const sorted = [...errs].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : Infinity;
  const n = items.length;
  const hitRate = n ? hits / n : 0;
  const wrongLockRate = answered ? wrong / answered : 0;
  return {
    items: n,
    hitRate,
    medianErrM: median,
    wrongLockRate,
    answerRate: n ? answered / n : 0,
    hitM: TARGETS.hitM,
    wrongM: TARGETS.wrongM,
    passed: n >= 20 && hitRate >= TARGETS.hitRate && median <= TARGETS.medianErrM && wrongLockRate <= TARGETS.wrongLockRate,
  };
}

export function buildIndexFile(items: SurveyItem[], model = VPR_MODEL): VprIndexFile {
  return { version: 1, model, dim: items[0]?.vec.length ?? 0, builtAt: new Date().toISOString(), items, eval: items.length >= 2 ? evaluateLeaveOneOut(items) : null };
}
