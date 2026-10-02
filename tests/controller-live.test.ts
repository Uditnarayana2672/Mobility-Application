import { describe, expect, it } from "vitest";
import { BroadcastChannelBus, type EventPayload, type PosePayload } from "@/bus";
import { pointAt } from "@/core/playback";
import { NavController } from "@/navigator/controller";
import type { Pose, PoseKind } from "@/navigator/poseSource";
import { FakeSpeech } from "@/navigator/speech";
import { LivePoseBase } from "@/positioning/liveBase";
import { FakeHub } from "./helpers/channel";
import { loadVenue } from "./helpers/synth";

const V = loadVenue();

/** A live source we drive by hand: stands in for the XR / step-counting sources. */
class FakeLive extends LivePoseBase {
  readonly kind: PoseKind = "pdr";
  connectors: { floor: string; x: number; y: number }[] = [];
  forced: string[] = [];
  venues: number[] = [];
  tick(): void {}
  applyFix(p: { floor: string; x: number; y: number; heading: number; acc: number; markerId: number | null }): void {
    this.put({ ...p, stale: false, source: p.markerId === null ? "manual" : "marker" });
  }
  put(p: Omit<Pose, "markerId"> & { markerId?: number | null }): void {
    this.emit({ markerId: null, ...p } as Pose);
  }
  onConnector(floor: string, x: number, y: number): void {
    this.connectors.push({ floor, x, y });
  }
  forceFloor(floor: string): void {
    this.forced.push(floor);
  }
  protected override venueChanged(v: { version: number }): void {
    this.venues.push(v.version);
  }
}

function setup() {
  const hub = new FakeHub();
  const phoneBus = new BroadcastChannelBus({ channel: hub.create(), storage: null });
  const dashBus = new BroadcastChannelBus({ channel: hub.create(), storage: null });
  const src = new FakeLive(V);
  const ctl = new NavController({ venue: V, sim: src, speech: new FakeSpeech(), bus: phoneBus });
  ctl.setAutoConfirm(false);
  const poses: PosePayload[] = [];
  const events: EventPayload[] = [];
  dashBus.on("pose", (p) => poses.push(p));
  dashBus.on("event", (e) => events.push(e));
  ctl.start();
  const tick = (sec: number) => {
    for (let t = 0; t < sec; t += 0.05) ctl.tick(0.05);
  };
  return { ctl, src, poses, events, tick };
}

const marker1 = { floor: "F1", x: 3, y: 16.5, heading: 0, acc: 0.4, stale: false, markerId: 1, source: "marker" as const };

describe("NavController with a live pose source", () => {
  it("ignores everything until the first marker fix, which locates the visitor and opens the map", () => {
    const { ctl, src } = setup();
    ctl.openLocate();
    src.put({ floor: "F1", x: 5, y: 17, heading: 90, acc: 3, stale: false, source: "ar" });
    expect(ctl.getState().located).toBe(false);
    expect(ctl.getState().user).toBeNull();
    src.put(marker1);
    const s = ctl.getState();
    expect(s.located).toBe(true);
    expect(s.screen).toBe("map");
    expect(s.user).toMatchObject({ floor: "F1", markerId: 1, source: "marker" });
    expect(s.toast?.text).toContain("Marker 1 recognised");
    expect(s.scans).toBe(1);
    expect(s.poseKind).toBe("pdr");
  });

  it("publishes the source, the anchor age and the AR flag on the bus", () => {
    const { ctl, src, poses, tick } = setup();
    src.put(marker1);
    tick(0.5);
    src.put({ ...marker1, source: "steps", x: 6, acc: 1.2 });
    tick(0.5);
    const last = poses.at(-1)!;
    expect(last.user).toMatchObject({ source: "steps", x: 6 });
    expect(last.user!.anchorAgoSec).not.toBeNull();
    expect(last.ar).toBe(false);
    expect(ctl.getState().user!.source).toBe("steps");
  });

  it("tracking lost: a toast and an event, once; back again is logged", () => {
    const { ctl, src, events } = setup();
    src.put(marker1);
    ctl.showAr();
    expect(ctl.getState().screen).toBe("ar");
    src.put({ ...marker1, source: "ar", stale: true });
    src.put({ ...marker1, source: "ar", stale: true });
    expect(ctl.getState().toast?.text).toContain("scan a marker");
    expect(ctl.getState().screen).toBe("map");
    expect(events.filter((e) => e.kind === "tracking")).toHaveLength(1);
    src.put({ ...marker1, source: "ar", stale: false });
    expect(events.filter((e) => e.kind === "tracking")).toHaveLength(2);
  });

  it("walking the route: reaching the stairs hands the next floor to the source; tapping the prompt forces the floor", () => {
    const { ctl, src, tick } = setup();
    src.put(marker1);
    ctl.showPlace({ room: "F2-cafeteria" });
    ctl.preview();
    ctl.startNav();
    const R = ctl.getState().route!;
    expect(R.floors.length).toBeGreaterThan(1);
    let reached = false;
    for (let s = 0; s <= R.total && !reached; s += 0.5) {
      const pa = pointAt(R, s);
      if (pa.vertical) break;
      src.put({ floor: pa.floor, x: pa.x, y: pa.y, heading: pa.bearing, acc: 1.5, stale: false, source: "steps", markerId: 1 });
      tick(0.1);
      reached = src.connectors.length > 0;
    }
    expect(reached).toBe(true);
    const c = src.connectors[0]!;
    expect(c.floor).toBe("F2");
    // The source moves its estimate to the new floor; the session then asks "Are you on Floor 2 now?".
    src.put({ floor: c.floor, x: c.x, y: c.y, heading: 0, acc: 1.5, stale: false, source: "steps", markerId: 1 });
    expect(ctl.getState().floorPrompt?.floor).toBe("F2");
    expect(ctl.getState().autoConfirm).toBe(false); // live phones wait for the visitor
    ctl.confirmFloor("tap");
    expect(src.forced).toEqual(["F2"]);
    expect(ctl.getState().floorPrompt).toBeNull();
  });

  it("a lobby marker pose on the new floor confirms the prompt without a tap", () => {
    const { ctl, src } = setup();
    src.put(marker1);
    ctl.showPlace({ room: "F2-cafeteria" });
    ctl.preview();
    ctl.startNav();
    const R = ctl.getState().route!;
    const hop = R.hops.findIndex((h) => h.type === "stairs" || h.type === "lift");
    const a = R.points[hop]!;
    const b = R.points[hop + 1]!;
    src.put({ floor: a.floor, x: a.x, y: a.y, heading: 0, acc: 1, stale: false, source: "steps", markerId: 1 });
    src.put({ floor: b.floor, x: b.x, y: b.y, heading: 0, acc: 1, stale: false, source: "steps", markerId: 1 });
    expect(ctl.getState().floorPrompt).not.toBeNull();
    const lobby = V.markers.find((m) => m.floor === "F2")!;
    src.put({ floor: "F2", x: lobby.x, y: lobby.y + 1, heading: 0, acc: 0.4, stale: false, markerId: lobby.id, source: "marker" });
    expect(ctl.getState().floorPrompt).toBeNull();
  });

  it("a newer published venue is applied at once when idle, and deferred while navigating", () => {
    const { ctl, src } = setup();
    src.put(marker1);
    const v2 = { ...V, version: V.version + 1, publishedAt: "2030-01-01T00:00:00Z" };
    ctl.setVenue(v2);
    expect(ctl.getState().venue.version).toBe(V.version + 1);
    expect(src.venues).toEqual([V.version + 1]);

    ctl.showPlace({ room: "F2-cafeteria" });
    ctl.preview();
    ctl.startNav();
    const v3 = { ...v2, version: v2.version + 1, publishedAt: "2031-01-01T00:00:00Z" };
    ctl.setVenue(v3);
    expect(ctl.getState().venue.version).toBe(v2.version); // still navigating
    ctl.endNav();
    expect(ctl.getState().venue.version).toBe(v3.version);
  });

  it("exposes debug info only when the source has it", () => {
    const { ctl } = setup();
    expect(ctl.getDebug()).toBeNull();
  });

  it("publishes AR ad impressions and tap events for the dashboard", () => {
    const { ctl, src, poses, events } = setup();
    src.put(marker1);
    ctl.recordAdImpression("C1", "BrewBox Coffee");
    ctl.recordAdTap("C1", "BrewBox Coffee");
    expect(ctl.getState().impressions).toBe(1);
    expect(poses.at(-1)?.impressions).toBe(1);
    expect(events.some((e) => e.kind === "ad" && e.text.startsWith("Ad tapped:"))).toBe(true);
  });
});
