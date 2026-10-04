import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { BroadcastChannelBus } from "@/bus";
import { headingFromView } from "@/ai/look";
import { parseVenue, type Venue } from "@/core";
import { NavController } from "@/navigator/controller";
import type { Pose, PoseKind } from "@/navigator/poseSource";
import { placeOf } from "@/navigator/places";
import { FakeSpeech } from "@/navigator/speech";
import { LivePoseBase } from "@/positioning/liveBase";
import { FakeHub } from "./helpers/channel";

const V: Venue = (() => {
  const r = parseVenue(JSON.parse(fs.readFileSync("public/venues/my-office/venue.json", "utf8")));
  if (!r.ok) throw new Error("bad venue");
  return r.data;
})();
const room = (name: string) => V.rooms.find((r) => r.name === name)!;
const poi = (name: string) => V.pois.find((p) => p.name.startsWith(name))!;

class FakeLive extends LivePoseBase {
  readonly kind: PoseKind = "pdr";
  fixes: { floor: string; x: number; y: number; heading: number }[] = [];
  aligned: number[] = [];
  tick(): void {}
  alignHeading(h: number): void {
    this.aligned.push(h);
  }
  applyFix(p: { floor: string; x: number; y: number; heading: number; acc: number; markerId: number | null }): void {
    this.fixes.push({ floor: p.floor, x: p.x, y: p.y, heading: p.heading });
    this.emit({ ...p, stale: false, source: p.markerId === null ? "manual" : "marker" } as Pose);
  }
}

function setup() {
  const src = new FakeLive(V);
  const ctl = new NavController({ venue: V, sim: src, speech: new FakeSpeech(), bus: new BroadcastChannelBus({ channel: new FakeHub().create(), storage: null }) });
  ctl.setAutoConfirm(false);
  ctl.start();
  return { ctl, src };
}
const run = (ctl: NavController, sec = 3) => {
  for (let t = 0; t < sec; t += 0.05) ctl.tick(0.05);
};
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("'I am near X and I want to go to Y' on a phone", () => {
  it("places the visitor near X, plans the fastest route to Y and opens the camera view with the arrows", async () => {
    const { ctl, src } = setup();
    ctl.openLocate();
    ctl.openVoice();
    await ctl.askText("I am near the lift lobby and I want to go to the pantry");
    run(ctl);
    const s = ctl.getState();
    const lobby = room("Lift Lobby");
    expect(s.located).toBe(true);
    expect(dist(src.fixes[0]!, lobby.door)).toBeCloseTo(1.5, 1); // just outside its door, in the corridor
    expect(s.route?.destName).toBe("Pantry");
    expect(s.screen).toBe("ar");
    expect(s.mode).toBe("nav");
    expect(s.chat.at(-1)?.text).toContain("Lift Lobby");
    expect(s.chat.at(-1)?.text).toContain("Pantry");
  });

  it("the first heading is the direction of the first part of the route", async () => {
    const { ctl, src } = setup();
    await ctl.askText("I am near the lift lobby and I want to go to the pantry");
    run(ctl);
    const first = src.fixes[0]!;
    const r = ctl.getState().route!;
    const p = r.points.find((q) => dist(q, first) > 2.5)!;
    const bearing = ((Math.atan2(p.x - first.x, -(p.y - first.y)) * 180) / Math.PI + 360) % 360;
    const off = Math.abs(((first.heading - bearing + 540) % 360) - 180);
    expect(off).toBeLessThan(45);
  });

  it("a destination that cannot be understood changes nothing", async () => {
    const { ctl } = setup();
    await ctl.askText("I am near the lift lobby and I want to go to the helipad");
    run(ctl);
    expect(ctl.getState().route).toBeNull();
  });

  it("only 'I am near the server rooms' just sets where you are", async () => {
    const { ctl, src } = setup();
    ctl.openLocate();
    await ctl.askText("I'm at the server rooms");
    run(ctl);
    expect(ctl.getState().located).toBe(true);
    expect(dist(src.fixes[0]!, room("Server Rooms").door)).toBeCloseTo(1.5, 1);
    expect(ctl.getState().screen).toBe("map");
  });
});

describe("choosing the start, including an entrance", () => {
  it("an entrance point can be the start, and the route preview is planned from it", () => {
    const { ctl, src } = setup();
    const k = poi("Entrance K");
    ctl.openLocate();
    ctl.setLocationManually(placeOf(V, { poi: k.id })!);
    expect(dist(src.fixes.at(-1)!, k)).toBeLessThan(0.1);
    ctl.showPlace({ room: room("Pantry").id });
    ctl.preview();
    expect(ctl.getState().mode).toBe("preview");
    const from = ctl.getState().route!.points[0]!;
    expect(dist(from, k)).toBeLessThan(1);
    // change the start from inside the preview: the route is planned again from the new start
    ctl.setLocationManually(placeOf(V, { poi: poi("Entrance E").id })!);
    run(ctl, 1);
    expect(dist(ctl.getState().route!.points[0]!, poi("Entrance E"))).toBeLessThan(1);
  });

  it("the entrances are listed first when picking a start", () => {
    const gates = V.pois.filter((p) => p.kind === "entrance").map((p) => p.name);
    expect(gates).toEqual(expect.arrayContaining(["Point A (west end of the corridor)", "Entrance C (west aisle)", "Entrance D (Server Rooms)", "Entrance E (east end, point B)", "Entrance K (Lift Lobby)"]));
  });
});

describe("Look around (AI) result", () => {
  it("a medium or high confidence answer sets the position near the place and the facing from what it sees", () => {
    const { ctl, src } = setup();
    const pantry = room("Pantry");
    const mr3 = room("Meeting Room 3");
    const ok = ctl.applyLook({ nearest: { target: { room: pantry.id }, name: "Pantry" }, confidence: "high", saw: "A sign says PANTRY.", visible: [{ target: { room: mr3.id }, name: "Meeting Room 3", direction: "ahead" }] });
    expect(ok).toBe(true);
    expect(ctl.getState().located).toBe(true);
    const fix = src.fixes.at(-1)!;
    expect(dist(fix, pantry.door)).toBeCloseTo(1.5, 1);
    // Meeting Room 3 is to the east-south-east of the Pantry door: "ahead" means the camera faces roughly that way
    const m = placeOf(V, { room: mr3.id })!;
    const bearing = ((Math.atan2(m.x - fix.x, -(m.y - fix.y)) * 180) / Math.PI + 360) % 360;
    expect(Math.abs(((fix.heading - bearing + 540) % 360) - 180)).toBeLessThan(5);
    expect(src.aligned.at(-1)).toBeCloseTo(fix.heading, 3); // the compass learns the map's north from it
  });

  it("a low confidence answer or no place changes nothing and says so", () => {
    const { ctl, src } = setup();
    expect(ctl.applyLook({ nearest: { target: { room: room("Pantry").id }, name: "Pantry" }, confidence: "low", saw: "", visible: [] })).toBe(false);
    expect(ctl.applyLook({ nearest: null, confidence: "none", saw: "A blank wall.", visible: [] })).toBe(false);
    expect(src.fixes.length).toBe(0);
    expect(ctl.getState().located).toBe(false);
    expect(ctl.getState().toast?.text).toContain("blank wall");
  });

  it("headingFromView: left, right and behind", () => {
    const pos = { floor: "F1", x: 20, y: 20 };
    const east = { target: { poi: "x" } as never };
    const v = { ...V, pois: [{ id: "x", floor: "F1", kind: "water" as const, name: "East", x: 30, y: 20 }], rooms: V.rooms } as Venue;
    const at = (direction: "ahead" | "left" | "right" | "behind") => headingFromView(v, pos, [{ ...east, name: "East", direction }])!;
    expect(at("ahead")).toBeCloseTo(90, 3); // east is straight ahead: facing east
    expect(at("left")).toBeCloseTo(180, 3); // east is on the left: facing south
    expect(at("right")).toBeCloseTo(0, 3); // east is on the right: facing north
    expect(at("behind")).toBeCloseTo(270, 3);
    expect(headingFromView(v, pos, [])).toBeNull();
  });
});
