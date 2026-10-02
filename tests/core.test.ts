import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { MinHeap, isRouteError, parseVenue, route, validate, type Venue } from "@/core";

const raw = JSON.parse(fs.readFileSync("public/venues/office-hq/venue.json", "utf8"));
const base = (): Venue => {
  const r = parseVenue(structuredClone(raw));
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.data;
};
const titles = (v: Venue, level: string) => validate(v).filter((r) => r.level === level).map((r) => r.title);

describe("MinHeap", () => {
  it("pops in priority order, FIFO on ties", () => {
    const h = new MinHeap<string>();
    [[3, "c"], [1, "a1"], [2, "b"], [1, "a2"], [3, "c2"]].forEach(([p, v]) => h.push(p as number, v as string));
    const out: string[] = [];
    while (h.size) out.push(h.pop()!.value);
    expect(out).toEqual(["a1", "a2", "b", "c", "c2"]);
  });
  it("sorts random input", () => {
    const h = new MinHeap<number>();
    let s = 7;
    const xs = Array.from({ length: 500 }, () => ((s = (s * 48271) % 2147483647) % 1000));
    xs.forEach((x) => h.push(x, x));
    const out: number[] = [];
    while (h.size) out.push(h.pop()!.value);
    expect(out).toEqual([...xs].sort((a, b) => a - b));
  });
});

describe("route edge cases", () => {
  it("same room: zero-length route that arrives", () => {
    const r = route(base(), { node: "F1-wsa" }, { room: "F1-wsa" });
    if (isRouteError(r)) throw new Error("unexpected " + r.error);
    expect(r.total).toBe(0);
    expect(r.steps.map((s) => s.kind)).toEqual(["arrive"]);
  });
  it("standing inside the destination room still routes", () => {
    const r = route(base(), { floor: "F1", x: 45, y: 5 }, { room: "F1-wsa" });
    expect(isRouteError(r)).toBe(false);
  });
  it("unreachable: no vertical links between floors", () => {
    const v = base();
    v.edges = v.edges.filter((e) => e.type === "walk");
    expect(route(v, { floor: "F1", x: 3, y: 17 }, { room: "F2-cafeteria" })).toEqual({ error: "unreachable" });
  });
  it("unreachable: destination door not connected", () => {
    const v = base();
    v.edges = v.edges.filter((e) => !(e.a === "F1:c20" && e.b === "F1-everest:door") && !(e.b === "F1:c20" && e.a === "F1-everest:door"));
    expect(route(v, { floor: "F1", x: 3, y: 17 }, { room: "F1-everest" })).toEqual({ error: "unreachable" });
  });
  it("restricted room is refused, and never used as a shortcut", () => {
    const v = base();
    expect(route(v, { floor: "F1", x: 3, y: 17 }, { room: "F1-server" })).toEqual({ error: "restricted", name: "Server Room" });
  });
  it("missing vertical link on one preference: lift only", () => {
    const v = base();
    v.edges = v.edges.filter((e) => e.type !== "stairs");
    const r = route(v, { floor: "F1", x: 3, y: 17 }, { room: "F2-cafeteria" }, { avoidLifts: true });
    expect(r).toEqual({ error: "unreachable" });
    const ok = route(v, { floor: "F1", x: 3, y: 17 }, { room: "F2-cafeteria" });
    expect(isRouteError(ok) ? ok.error : ok.via).toBe("lift");
  });
});

describe("schema", () => {
  it("rejects bad data with readable issues", () => {
    const bad = structuredClone(raw);
    bad.schemaVersion = 1;
    bad.edges.push({ a: "x", b: "y", type: "lift" });
    bad.markers[0].normal = 400;
    const r = parseVenue(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const paths = r.issues.map((i) => i.path);
      expect(paths).toContain("schemaVersion");
      expect(paths.some((p) => p.startsWith("edges"))).toBe(true);
      expect(paths).toContain("markers.0.normal");
    }
  });
  it("fills defaults (marker size, aliases)", () => {
    const v = structuredClone(raw);
    delete v.markers[0].sizeM;
    delete v.rooms[0].aliases;
    const r = parseVenue(v);
    expect(r.ok && r.data.markers[0]?.sizeM).toBe(0.12);
    expect(r.ok && r.data.rooms[0]?.aliases).toEqual([]);
  });
});

describe("validate (new checks)", () => {
  it("fixture has no blocking issues", () => {
    expect(titles(base(), "fail")).toEqual([]);
  });
  it("duplicate marker ids and ids outside the dictionary", () => {
    const v = base();
    v.markers[1]!.id = v.markers[0]!.id;
    v.markers[2]!.id = 99;
    const f = titles(v, "fail");
    expect(f).toContain("Duplicate marker IDs");
    expect(f).toContain("Marker ID outside the printable dictionary");
  });
  it("floor without markers is blocking", () => {
    const v = base();
    v.markers = v.markers.filter((m) => m.floor !== "F2");
    expect(titles(v, "fail")).toContain("Floor 2: no markers");
  });
  it("lift/stairs without a marker nearby or a vertical link is blocking", () => {
    const v = base();
    v.markers = v.markers.filter((m) => !(m.floor === "F1" && Math.hypot(m.x - 9.5, m.y - 19) < 7));
    v.edges = v.edges.filter((e) => e.type !== "stairs");
    const f = titles(v, "fail");
    expect(f.some((t) => t.startsWith("No marker near"))).toBe(true);
    expect(f.some((t) => t.includes("has no vertical link"))).toBe(true);
  });
  it("stairs must join adjacent floors", () => {
    const v = base();
    v.floors.splice(1, 0, { id: "FM", name: "Mezzanine", short: "M", elevation: 2, height: 3, w: 60, h: 36 });
    expect(titles(v, "fail").some((t) => t.includes("skips a floor"))).toBe(true);
  });
  it("uncalibrated floor photo blocks publishing", () => {
    const v = base();
    v.floors[0]!.background = { imageUrl: "/uploads/x.png", widthPx: 100, heightPx: 80, opacity: 0.5, transform: { x: 0, y: 0, scale: 0.1, rotationDeg: 0 }, calibrated: false };
    expect(titles(v, "fail")).toContain("Floor photo not calibrated");
  });
  it("ad wall across a door, including a vertical wall on a side door", () => {
    const v = base();
    v.walls.push({ id: "W99", floor: "F1", label: "x", x1: 12, y1: 5, x2: 12, y2: 9, bottom: 1, height: 1.6, normal: 90, approved: false });
    v.rooms[0]!.door = { x: 12, y: 7, side: "E" };
    expect(titles(v, "fail").some((t) => t.startsWith("Ad slot W99 overlaps the door"))).toBe(true);
  });
  it("works for a corridor that is not at y=17 (no hard-coded geometry)", () => {
    const v = base();
    // shift every F1 y coordinate by +3 m; checks must not care
    for (const n of v.nodes.filter((n) => n.floor === "F1")) n.y += 3;
    for (const r of v.rooms.filter((r) => r.floor === "F1")) {
      r.y += 3;
      r.door.y += 3;
    }
    for (const m of v.markers.filter((m) => m.floor === "F1")) m.y += 3;
    for (const w of v.walls.filter((w) => w.floor === "F1")) (w.y1 += 3), (w.y2 += 3);
    for (const p of v.pois.filter((p) => p.floor === "F1")) p.y += 3;
    expect(titles(v, "fail")).toEqual([]);
    expect(isRouteError(route(v, { floor: "F1", x: 3, y: 20 }, { room: "F2-cafeteria" }))).toBe(false);
  });
});
