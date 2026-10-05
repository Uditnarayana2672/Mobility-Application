import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { BroadcastChannelBus } from "@/bus";
import { parseVenue, type Venue } from "@/core";
import { NavController } from "@/navigator/controller";
import type { Pose, PoseKind } from "@/navigator/poseSource";
import { FakeSpeech } from "@/navigator/speech";
import { suggestPlaces } from "@/positioning/locator";
import { LivePoseBase } from "@/positioning/liveBase";
import { LAST_FIX_TTL_MS, loadLastFix, saveLastFix, type KvLike, type LastFix } from "@/shared/lastFix";
import { FakeHub } from "./helpers/channel";

const parsed = parseVenue(JSON.parse(fs.readFileSync("public/venues/office-hq/venue.json", "utf8")));
if (!parsed.ok) throw new Error("fixture");
const V: Venue = parsed.data;

const mem = (): KvLike & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};
const fix = (over: Partial<LastFix> = {}): LastFix => ({ venueId: "office-hq", floor: "F1", x: 20, y: 15, heading: 90, acc: 1, at: 1_000_000, ...over });

describe("last position storage", () => {
  it("round-trips, and is only returned for the same venue while fresh", () => {
    const kv = mem();
    saveLastFix(fix(), kv);
    expect(loadLastFix("office-hq", 1_000_000 + 60_000, kv)).toMatchObject({ floor: "F1", x: 20 });
    expect(loadLastFix("my-pg", 1_000_000 + 60_000, kv)).toBeNull();
    expect(loadLastFix("office-hq", 1_000_000 + LAST_FIX_TTL_MS + 1, kv)).toBeNull();
    expect(loadLastFix("office-hq", 1_000_000 - 600_000, kv)).toBeNull(); // from the future: clock moved
  });
  it("garbage and a missing store never throw", () => {
    const kv = mem();
    kv.setItem("indore.lastFix", "{not json");
    expect(loadLastFix("office-hq", 1, kv)).toBeNull();
    kv.setItem("indore.lastFix", JSON.stringify({ venueId: "office-hq", floor: "F1", x: "a" }));
    expect(loadLastFix("office-hq", 1, kv)).toBeNull();
    expect(loadLastFix("office-hq", 1, null)).toBeNull();
    expect(() => saveLastFix(fix(), null)).not.toThrow();
  });
});

describe("suggestPlaces: the likely 'I am near…' answers", () => {
  it("returns up to three distinct, visitor-visible rooms", () => {
    const g = suggestPlaces(V);
    expect(g.length).toBe(3);
    expect(new Set(g.map((x) => x.roomId)).size).toBe(3);
    for (const x of g) {
      const r = V.rooms.find((y) => y.id === x.roomId)!;
      expect(r.access).not.toBe("staff");
      expect(r.cat).not.toBe("vertical");
    }
  });
  it("starts with where the phone was last time, then the entrance marker's room", () => {
    const r1 = V.rooms.find((r) => r.floor === "F1" && r.cat === "meeting")!;
    const g = suggestPlaces(V, { last: fix({ x: r1.x + r1.w / 2, y: r1.y + r1.h / 2 }) });
    expect(g[0]).toMatchObject({ roomId: r1.id, reason: "resume" });
    const m = V.markers[0]!;
    const g2 = suggestPlaces(V, { entranceMarker: m.id });
    expect(g2[0]!.reason).toBe("entrance");
    expect(g2[0]!.floor).toBe(m.floor);
  });
  it("ignores a last position on a floor that no longer exists", () => {
    expect(suggestPlaces(V, { last: fix({ floor: "F9" }) }).every((x) => x.reason !== "resume")).toBe(true);
  });
});

class FakeLive extends LivePoseBase {
  readonly kind: PoseKind = "pdr";
  fixes: { floor: string; x: number; y: number; heading: number; acc: number }[] = [];
  tick(): void {}
  put(p: Pose): void {
    this.emit(p);
  }
  applyFix(p: { floor: string; x: number; y: number; heading: number; acc: number; markerId: number | null }): void {
    this.fixes.push(p);
    this.emit({ ...p, stale: false, source: "manual" } as Pose);
  }
}
const setup = () => {
  const src = new FakeLive(V);
  const ctl = new NavController({ venue: V, sim: src, speech: new FakeSpeech(), bus: new BroadcastChannelBus({ channel: new FakeHub().create(), storage: null }) });
  ctl.setAutoConfirm(false);
  ctl.start();
  return { ctl, src };
};

describe("continue where you left off", () => {
  it("locates the visitor at the saved position (approximate) and opens the map", () => {
    const { ctl, src } = setup();
    ctl.openLocate();
    ctl.resumeFrom(fix({ x: 20, y: 15, heading: 90, acc: 0.5 }));
    expect(src.fixes.at(-1)).toMatchObject({ floor: "F1", x: 20, y: 15, heading: 90, acc: 4 });
    expect(ctl.getState().located).toBe(true);
    expect(ctl.getState().screen).toBe("map");
    expect(ctl.getState().user).toMatchObject({ x: 20, y: 15 });
  });
  it("refuses a position from another venue or a floor that is gone", () => {
    const { ctl, src } = setup();
    ctl.resumeFrom(fix({ venueId: "other" }));
    ctl.resumeFrom(fix({ floor: "F9" }));
    expect(src.fixes).toHaveLength(0);
    expect(ctl.getState().located).toBe(false);
  });
});
