import { describe, expect, it } from "vitest";
import { guideFor } from "@/ar/ArScreen";
import { relativeTurn } from "@/ar/CanvasArRenderer";
import { isRouteError, route } from "@/core/route";
import type { Venue } from "@/core/schema";
import { BroadcastChannelBus } from "@/bus";
import { NavController } from "@/navigator/controller";
import type { Pose, PoseKind } from "@/navigator/poseSource";
import { placeOf } from "@/navigator/places";
import { FakeSpeech } from "@/navigator/speech";
import { LivePoseBase } from "@/positioning/liveBase";
import { FakeHub } from "./helpers/channel";
import { loadVenue } from "./helpers/synth";

const V: Venue = loadVenue();

class FakeLive extends LivePoseBase {
  readonly kind: PoseKind = "pdr";
  fixes: { x: number; y: number; heading: number }[] = [];
  tick(): void {}
  put(p: Pose): void {
    this.emit(p);
  }
  applyFix(p: { floor: string; x: number; y: number; heading: number; acc: number; markerId: number | null }): void {
    this.fixes.push({ x: p.x, y: p.y, heading: p.heading });
    this.emit({ ...p, stale: false, source: p.markerId === null ? "manual" : "marker" } as Pose);
  }
}

function setup() {
  const hub = new FakeHub();
  const src = new FakeLive(V);
  const ctl = new NavController({ venue: V, sim: src, speech: new FakeSpeech(), bus: new BroadcastChannelBus({ channel: hub.create(), storage: null }) });
  ctl.setAutoConfirm(false);
  ctl.start();
  return { ctl, src };
}

describe("relativeTurn", () => {
  it("is the signed shortest turn, positive to the right", () => {
    expect(relativeTurn(0, 90)).toBe(90);
    expect(relativeTurn(350, 10)).toBe(20);
    expect(relativeTurn(10, 350)).toBe(-20);
    expect(Math.abs(relativeTurn(0, 180))).toBe(180);
  });
});

describe("guideFor: the big arrow in the camera view", () => {
  const from = { floor: "F1", x: 3, y: 16.5, heading: 0 };
  const R = (() => {
    const r = route(V, from, { room: "F1-everest" });
    if (isRouteError(r)) throw new Error("no route");
    return r;
  })();
  const user = (heading: number): Pose => ({ ...from, heading, acc: 0.5, stale: false, markerId: 1, source: "marker" });

  it("has nothing without a route", () => {
    expect(guideFor(null, user(0), 0)).toBeNull();
  });

  it("points ahead when facing the way of the route, and says how far", () => {
    const first = R.points[1]!;
    const bearing = ((Math.atan2(first.x - from.x, -(first.y - from.y)) * 180) / Math.PI + 360) % 360;
    const g = guideFor(R, user(bearing), 0)!;
    expect(g.title).toBe("Straight ahead");
    expect(Math.abs(g.relDeg)).toBeLessThan(25);
    expect(g.sub).toContain(R.destName);
    expect(g.sub).toMatch(/\d+ m$/);
  });

  it("tells you to turn around when you face the other way", () => {
    const first = R.points[1]!;
    const bearing = ((Math.atan2(first.x - from.x, -(first.y - from.y)) * 180) / Math.PI + 360) % 360;
    expect(guideFor(R, user((bearing + 180) % 360), 0)!.title).toBe("Turn around");
    const right = guideFor(R, user((bearing + 270) % 360), 0)!; // the target is 90 degrees to the right of where you face
    expect(right.title).toBe("Turn right");
    expect(right.relDeg).toBeGreaterThan(0);
  });
});

describe("camera guide on the controller", () => {
  const marker = { floor: "F1", x: 3, y: 16.5, heading: 0, acc: 0.4, stale: false, markerId: 1, source: "marker" as const };

  it("guideTo: one call plans the route, starts navigating and lands on the camera view", () => {
    const { ctl, src } = setup();
    src.put({ ...marker });
    ctl.showAr();
    ctl.guideTo({ room: "F1-everest" });
    const s = ctl.getState();
    expect(s.screen).toBe("ar");
    expect(s.mode).toBe("nav");
    expect(s.route?.destName).toBeTruthy();
  });

  it("guideTo before the visitor has a position only asks for one", () => {
    const { ctl } = setup();
    ctl.guideTo({ room: "F1-everest" });
    expect(ctl.getState().mode).toBe("explore");
    expect(ctl.getState().toast).not.toBeNull();
  });

  it("asking by voice from the camera view starts guiding there, with no map preview in between", async () => {
    const { ctl, src } = setup();
    src.put({ ...marker });
    ctl.showAr();
    ctl.openVoice();
    await ctl.askText("take me to Everest");
    for (let t = 0; t < 3; t += 0.05) ctl.tick(0.05);
    const s = ctl.getState();
    expect(s.screen).toBe("ar");
    expect(s.mode).toBe("nav");
  });

  it("choosing a room as the start on a phone places the visitor inside it, facing its door", () => {
    const { ctl, src } = setup();
    const room = V.rooms.find((r) => r.id === "F1-everest")!;
    ctl.openLocate();
    ctl.setLocationManually(placeOf(V, { room: room.id })!);
    const fix = src.fixes.at(-1)!;
    expect(Math.hypot(fix.x - room.door.x, fix.y - room.door.y)).toBeCloseTo(1.2, 1);
    expect(ctl.getState().located).toBe(true);
    expect(ctl.getState().screen).toBe("map");
  });
});
