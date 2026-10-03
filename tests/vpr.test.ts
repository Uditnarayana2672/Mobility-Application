import { describe, expect, it } from "vitest";
import { buildIndexFile, evaluateLeaveOneOut, FixVoter, normalise, TARGETS, VprIndex, type SurveyItem } from "@/vision/vpr";

/** Deterministic random numbers. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

const DIM = 48;
/**
 * A stand-in for "the picture taken at (x, y)": nearby places look alike, far places do not (a sum of smooth bumps around random
 * landmarks). `twin` makes two landmarks identical, like two identical corridors.
 */
function world(seed: number, opts: { twin?: boolean } = {}) {
  const r = rng(seed);
  const width = opts.twin ? 18 : 36;
  const half = Array.from({ length: opts.twin ? 35 : 70 }, () => ({ x: r() * width, y: r() * 12, v: Array.from({ length: DIM }, () => gauss(r)) }));
  // two identical halves: the right half is a copy of the left one, 18 m along
  const landmarks = opts.twin ? [...half, ...half.map((l) => ({ ...l, x: l.x + 18 }))] : half;
  const picture = (x: number, y: number, noise: number, rn: () => number) => {
    const v = new Array<number>(DIM).fill(0);
    for (const l of landmarks) {
      const w = Math.exp(-((x - l.x) ** 2 + (y - l.y) ** 2) / (2 * 2 * 2));
      for (let k = 0; k < DIM; k++) v[k]! += w * l.v[k]!;
    }
    return normalise(v.map((e) => e + gauss(rn) * noise));
  };
  return { picture };
}

function survey(w: ReturnType<typeof world>, seed: number): SurveyItem[] {
  const r = rng(seed);
  const items: SurveyItem[] = [];
  let n = 0;
  for (let x = 0.5; x < 36; x += 1) {
    for (const y of [2, 5, 8]) items.push({ id: `s${n++}`, floor: "F1", x, y, heading: 90, vec: w.picture(x, y, 0.01, r) });
  }
  return items;
}

describe("VprIndex.locate", () => {
  const w = world(7);
  const items = survey(w, 1);
  const index = new VprIndex(items);
  const r = rng(99);

  it("finds where a new picture was taken, within a couple of metres, and the heading when the neighbours agree", () => {
    let ok = 0;
    const N = 60;
    for (let i = 0; i < N; i++) {
      const x = 1 + r() * 34;
      const y = 1 + r() * 8;
      const fix = index.locate(w.picture(x, y, 0.03, r));
      if (fix && Math.hypot(fix.x - x, fix.y - y) < 2.5) ok++;
      if (fix) expect(fix.heading).toBeCloseTo(90, 3);
    }
    expect(ok / N).toBeGreaterThan(0.9);
  });

  it("says nothing for a picture that looks like nothing it has seen", () => {
    const rn = rng(5);
    const stranger = normalise(Array.from({ length: DIM }, () => gauss(rn)));
    expect(index.locate(stranger)).toBeNull();
  });

  it("an empty index never answers", () => {
    expect(new VprIndex([]).locate(items[0]!.vec)).toBeNull();
  });

  it("an exact repeat of a surveyed picture is a confident, tight answer", () => {
    const sure = index.locate(items[10]!.vec)!;
    expect(sure.confidence).toBeGreaterThan(0.5);
    expect(sure.acc).toBeLessThanOrEqual(4);
    expect(sure.acc).toBeGreaterThanOrEqual(1.2);
  });
});

describe("FixVoter: one lucky match never moves the dot", () => {
  const f = (x: number, y = 5, floor = "F1") => ({ floor, x, y, heading: 90, confidence: 0.8, acc: 2, similarity: 0.9 });
  it("releases an answer only after two agreeing ones", () => {
    const v = new FixVoter(2, 3);
    expect(v.push(f(10), 0)).toBeNull();
    const out = v.push(f(11), 1000)!;
    expect(out.x).toBeCloseTo(10.5, 5);
    expect(out.heading).toBe(90);
  });
  it("disagreeing answers (other place, other floor) reset the vote; a miss clears it", () => {
    const v = new FixVoter(2, 3);
    v.push(f(10), 0);
    expect(v.push(f(25), 500)).toBeNull();
    expect(v.push(f(26, 5, "F2"), 900)).toBeNull();
    v.push(f(10), 1000);
    v.push(null, 1100);
    expect(v.push(f(10), 1200)).toBeNull();
  });
  it("old answers expire", () => {
    const v = new FixVoter(2, 3, 5000);
    v.push(f(10), 0);
    expect(v.push(f(10.5), 9000)).toBeNull();
  });
});

describe("leave-one-out self test decides whether vision may switch itself on", () => {
  it("a distinctive building passes the targets", () => {
    const e = evaluateLeaveOneOut(survey(world(11), 2));
    expect(e.items).toBeGreaterThan(80);
    expect(e.hitRate).toBeGreaterThanOrEqual(TARGETS.hitRate);
    expect(e.medianErrM).toBeLessThanOrEqual(TARGETS.medianErrM);
    expect(e.wrongLockRate).toBeLessThanOrEqual(TARGETS.wrongLockRate);
    expect(e.passed).toBe(true);
  });
  it("a building with two identical halves fails it (wrong locks), so it stays off", () => {
    const e = evaluateLeaveOneOut(survey(world(11, { twin: true }), 2));
    expect(e.passed).toBe(false);
  });
  it("too few pictures never pass, whatever they look like", () => {
    const items = survey(world(11), 2).slice(0, 10);
    expect(evaluateLeaveOneOut(items).passed).toBe(false);
  });
  it("buildIndexFile records the model, the size and the evaluation", () => {
    const items = survey(world(11), 2);
    const f = buildIndexFile(items);
    expect(f).toMatchObject({ version: 1, dim: DIM });
    expect(f.eval?.passed).toBe(true);
    expect(JSON.parse(JSON.stringify(f)).items).toHaveLength(items.length);
  });
});
