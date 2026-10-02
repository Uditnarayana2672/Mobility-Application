import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loadMock } from "./loadMock";
import { convertMockVenue } from "../../scripts/convert-mock-venue";
import {
  alternatives,
  arrivedText,
  fmtTime,
  intent,
  nearestMarker,
  nextStep,
  parseVenue,
  pointAt,
  poseFromMarker,
  remainingSec,
  remainingWalk,
  route,
  routeRuns,
  search,
  stepAction,
  stepSpeech,
  thenText,
  validate,
  walkText,
  type RouteDest,
  type RouteFrom,
  type RoutePrefs,
  type Venue,
} from "@/core";

/**
 * Golden tests: the mock's engine.js (loaded in a vm context) and the strict-TS port must produce identical output on the same venue.
 */
const IS = loadMock();
const fixtureText = fs.readFileSync(path.join(process.cwd(), "public", "venues", "office-hq", "venue.json"), "utf8");
const parsed = parseVenue(JSON.parse(fixtureText));
if (!parsed.ok) throw new Error("fixture invalid: " + JSON.stringify(parsed.issues));
const V: Venue = parsed.data;

describe("fixture", () => {
  it("is valid schema v2 and equals a fresh conversion of the mock venue", () => {
    const { venue } = convertMockVenue(IS);
    expect(JSON.parse(fixtureText)).toEqual(JSON.parse(JSON.stringify(venue)));
  });
});

interface Case {
  name: string;
  from: RouteFrom;
  dest: RouteDest;
  prefs?: Partial<RoutePrefs>;
}
const at = (floor: string, x: number, y: number, heading?: number): RouteFrom => ({ floor, x, y, heading });

const CASES: Case[] = [
  { name: "same floor: reception door area -> workspace A", from: at("F1", 3, 17, 90), dest: { room: "F1-wsa" } },
  { name: "same floor: -> training room", from: at("F1", 3, 17, 90), dest: { room: "F1-training" } },
  { name: "cross floor: reception -> cafeteria", from: at("F1", 3, 17, 90), dest: { room: "F2-cafeteria" } },
  { name: "cross floor avoidStairs", from: at("F1", 3, 17, 90), dest: { room: "F2-cafeteria" }, prefs: { avoidStairs: true } },
  { name: "cross floor avoidLifts", from: at("F1", 3, 17, 90), dest: { room: "F2-cafeteria" }, prefs: { avoidLifts: true } },
  { name: "from inside a room -> other floor washroom", from: at("F1", 45, 5), dest: { room: "F2-wash" } },
  { name: "downwards F2 -> F1", from: at("F2", 58, 17, 270), dest: { room: "F1-reception" } },
  { name: "downwards avoidLifts", from: at("F2", 58, 17, 270), dest: { room: "F1-reception" }, prefs: { avoidLifts: true } },
  { name: "to POI on other floor (coffee)", from: at("F1", 3, 17, 90), dest: { poi: "P05" } },
  { name: "F2 -> entrance POI on F1", from: at("F2", 30, 17), dest: { poi: "P01" } },
  { name: "restricted room", from: at("F1", 3, 17), dest: { room: "F1-server" } },
  { name: "start at a node", from: { node: "F2:c11", heading: 0 }, dest: { room: "F2-cafeteria" } },
  { name: "room to room same floor", from: at("F1", 30, 5), dest: { room: "F1-pantry" } },
  { name: "off-corridor start point", from: at("F1", 30, 17.6), dest: { room: "F2-quiet" } },
  { name: "both avoid -> unreachable across floors", from: at("F1", 3, 17), dest: { room: "F2-cafeteria" }, prefs: { avoidStairs: true, avoidLifts: true } },
  { name: "unknown room", from: at("F1", 3, 17), dest: { room: "nope" } },
  { name: "unknown poi", from: at("F1", 3, 17), dest: { poi: "nope" } },
  { name: "already there", from: { node: "F1-wsa" }, dest: { room: "F1-wsa" } },
  { name: "POI same floor with heading", from: at("F1", 20, 17, 270), dest: { poi: "P03" } },
];

describe("route: TS port == mock", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const mock = IS.route(V, c.from, c.dest, c.prefs);
      const ts = route(V, c.from, c.dest, c.prefs);
      expect(ts).toEqual(mock);
    });
  }

  it("alternatives()", () => {
    for (const c of CASES.slice(0, 10)) {
      expect(alternatives(V, c.from, c.dest, c.prefs)).toEqual(IS.alternatives(V, c.from, c.dest, c.prefs));
    }
  });

  it("A* time equals the mock's Dijkstra time for every room pair (heuristic is admissible)", () => {
    const open = V.rooms.filter((r) => r.access !== "staff");
    let n = 0;
    for (const a of V.rooms) {
      for (const b of open) {
        const from: RouteFrom = { node: a.id };
        for (const prefs of [{}, { avoidStairs: true }, { avoidLifts: true }]) {
          const m = IS.route(V, from, { room: b.id }, prefs);
          const t = route(V, from, { room: b.id }, prefs);
          if ("error" in m) expect(t).toEqual(m);
          else {
            expect("error" in t).toBe(false);
            if (!("error" in t)) expect(t.time).toBeCloseTo(m.time, 9);
          }
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(900);
  });

  it("playback helpers agree", () => {
    const routes = CASES.map((c) => ({ c, m: IS.route(V, c.from, c.dest, c.prefs), t: route(V, c.from, c.dest, c.prefs) })).filter((x) => !("error" in x.m));
    expect(routes.length).toBeGreaterThan(10);
    for (const { m, t } of routes) {
      if ("error" in t) throw new Error("unexpected error");
      for (const s of [0, 0.1, 3, m.total * 0.33, m.total * 0.5, m.total * 0.9, m.total, m.total + 5]) {
        expect(pointAt(t, s)).toEqual(IS.pointAt(m, s));
        expect(remainingSec(t, s)).toBeCloseTo(IS.remainingSec(m, s), 9);
        expect(remainingWalk(t, s)).toBeCloseTo(IS.remainingWalk(m, s), 9);
        expect(nextStep(t, s)).toEqual(IS.nextStep(m, s));
      }
      expect(routeRuns(t, 0, t.total)).toEqual(IS.routeRuns(m, 0, m.total));
      expect(routeRuns(t, t.total * 0.3, t.total * 0.6)).toEqual(IS.routeRuns(m, m.total * 0.3, m.total * 0.6));
    }
  });
});

describe("instructions: strings identical in en / hi / te", () => {
  it("every step of every route", () => {
    for (const c of CASES) {
      const m = IS.route(V, c.from, c.dest, c.prefs);
      if ("error" in m) continue;
      for (const lang of ["en", "hi", "te", "xx"]) {
        for (const step of m.steps) {
          expect(stepAction(step, lang)).toBe(IS.stepAction(step, lang));
          for (const rem of [0, 2.9, 3, 12, 27, 63]) expect(stepSpeech(step, lang, rem)).toBe(IS.stepSpeech(step, lang, rem));
        }
        expect(walkText(12.4, lang)).toBe(IS.walkText(12.4, lang));
        expect(thenText(7.5, lang)).toBe(IS.thenText(7.5, lang));
        expect(arrivedText("Cafeteria", lang)).toBe(IS.arrivedText("Cafeteria", lang));
      }
    }
    for (const s of [3, 20, 54, 55, 90, 400]) expect(fmtTime(s)).toBe(IS.fmtTime(s));
  });
});

const QUERIES = [
  "cafeteria", "canteen", "khana", "washroom", "toilet", "shauchalay", "seedhi", "stairs", "lift", "kaifeteria",
  "కేఫ్‌టేరియా", "టాయిలెట్", "meeting", "coffee", "printer", "exit", "xyzzy", "", "reception", "water", "chai", "भोजन", "restricted",
];
describe("search: TS port == mock", () => {
  for (const q of QUERIES) {
    it(`"${q}"`, () => {
      expect(search(V, q)).toEqual(IS.search(V, q));
    });
  }
  it("finds expected top hits", () => {
    expect(search(V, "khana")[0]?.id).toBe("F2-cafeteria");
    expect(search(V, "కేఫ్‌టేరియా")[0]?.id).toBe("F2-cafeteria");
    expect(search(V, "seedhi")[0]?.id.endsWith("stairs")).toBe(true);
  });
});

const TEXTS = [
  "take me to the cafeteria", "cafeteria kahan hai", "washroom ekkada undi", "where am I", "main kahan hoon", "repeat", "dobara", "stop",
  "avoid stairs", "nearest washroom", "nearest toilet", "le chalo canteen", "తీసుకెళ్ళు కేఫ్‌టేరియా", "నేను ఎక్కడ", "go to server room",
  "blah blah", "", "where is lift", "nearest lift", "chai paas wala", "directions to reception",
];
describe("intent: TS port == mock", () => {
  const ctx = { from: at("F1", 3, 17, 90) as RouteFrom, prefs: {} };
  for (const t of TEXTS) {
    it(`"${t}"`, () => {
      expect(intent(V, t, ctx)).toEqual(IS.intent(V, t, ctx));
      expect(intent(V, t)).toEqual(IS.intent(V, t));
    });
  }
});

describe("markers", () => {
  it("nearestMarker and poseFromMarker agree", () => {
    for (const [floor, x, y, d] of [["F1", 3, 16, 5], ["F1", 20, 20, 3], ["F2", 29, 14, 4], ["F2", 0, 0, 2]] as const) {
      const a = nearestMarker(V, floor, x, y, d);
      const b = IS.nearestMarker(V, floor, x, y, d);
      expect(a).toEqual(b);
    }
    for (const m of V.markers) expect(poseFromMarker(m)).toEqual(IS.poseFromMarker(m));
  });
});

describe("validate: every mock check is reproduced on mock-shaped data", () => {
  it("fixture", () => {
    const mock = IS.validate(V) as { level: string; title: string; detail: string }[];
    const ts = validate(V);
    for (const r of mock) expect(ts).toContainEqual(r);
    expect(ts.filter((r) => r.level === "fail")).toEqual([]);
  });
  it("broken variants produce the same failures", () => {
    const broken: Venue = JSON.parse(JSON.stringify(V));
    broken.edges = broken.edges.filter((e) => e.type === "walk" || e.type === "lift");
    broken.markers = broken.markers.filter((m) => m.floor !== "F2");
    broken.scale.calibrated = false;
    const mock = IS.validate(broken) as { level: string; title: string }[];
    const ts = validate(broken);
    for (const r of mock.filter((x) => x.level === "fail")) expect(ts.map((x) => `${x.level}|${x.title}`)).toContain(`${r.level}|${r.title}`);
  });
});
