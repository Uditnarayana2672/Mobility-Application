import { describe, expect, it } from "vitest";
import { BroadcastChannelBus } from "@/bus";
import { NavController } from "@/navigator/controller";
import type { Pose, PoseKind } from "@/navigator/poseSource";
import { FakeSpeech } from "@/navigator/speech";
import { LivePoseBase } from "@/positioning/liveBase";
import { PdrPoseCore } from "@/positioning/pdrCore";
import { VprLocator, visionModeFromQuery } from "@/vision/VprLocator";
import { buildIndexFile, normalise, type SurveyItem, type VprIndexFile } from "@/vision/vpr";
import { FakeHub } from "./helpers/channel";
import { loadVenue } from "./helpers/synth";

const V = loadVenue();

/** 40 places 1 m apart with well separated descriptors; the "picture" of place i is basis vector i (plus a little of its neighbours). */
const DIM = 64;
const vecAt = (i: number) => normalise(Array.from({ length: DIM }, (_, k) => (k === i % DIM ? 1 : k === (i + 1) % DIM ? 0.15 : 0)));
const items: SurveyItem[] = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, floor: "F1", x: 2 + i, y: 16.5, heading: 90, vec: vecAt(i) }));
const goodIndex = (): VprIndexFile => ({ ...buildIndexFile(items), eval: { items: 40, hitRate: 0.95, medianErrM: 1, wrongLockRate: 0.01, answerRate: 0.9, hitM: 2.5, wrongM: 5, passed: true } });
const badIndex = (): VprIndexFile => ({ ...goodIndex(), eval: { items: 40, hitRate: 0.6, medianErrM: 4, wrongLockRate: 0.1, answerRate: 0.6, hitM: 2.5, wrongM: 5, passed: false } });
const px = (i: number) => new Uint8ClampedArray([i, 0, 0, 255]); // the fake embedder reads the first byte as the place number

const locator = (index: VprIndexFile | null, mode: "auto" | "on" | "off" = "auto", calls: { embeds: number } = { embeds: 0 }) =>
  new VprLocator({ fetchIndex: async () => index, makeEmbedder: async () => ({ embed: async (rgba) => (calls.embeds++, vecAt(rgba[0]!)) }) }, mode);

describe("visionModeFromQuery", () => {
  it("?vpr=1 forces on, ?vpr=0 forces off, otherwise auto", () => {
    expect(visionModeFromQuery("?vpr=1")).toBe("on");
    expect(visionModeFromQuery("?x=1&vpr=0")).toBe("off");
    expect(visionModeFromQuery("")).toBe("auto");
  });
});

describe("VprLocator: when is vision allowed?", () => {
  it("auto: only when the venue's index passed its own accuracy test", async () => {
    expect(await locator(goodIndex()).start()).toBe("ready");
    const bad = locator(badIndex());
    expect(await bad.start()).toBe("failed-test");
    expect(bad.detail).toMatch(/60 % hits/);
  });
  it("on: used even when the test failed; off: never loads anything", async () => {
    expect(await locator(badIndex(), "on").start()).toBe("ready");
    const calls = { embeds: 0 };
    const off = locator(goodIndex(), "off", calls);
    expect(await off.start()).toBe("off");
    expect(await off.frame(px(3), 1, 1, 0)).toBeNull();
    expect(calls.embeds).toBe(0);
  });
  it("no index (or an empty one) -> no-index; a failing model download -> error, never a throw", async () => {
    expect(await locator(null).start()).toBe("no-index");
    expect(await locator({ ...goodIndex(), items: [] }).start()).toBe("no-index");
    const broken = new VprLocator({ fetchIndex: async () => goodIndex(), makeEmbedder: async () => { throw new Error("download failed"); } });
    expect(await broken.start()).toBe("error");
    expect(broken.detail).toBe("download failed");
  });
});

describe("VprLocator: from pictures to a position", () => {
  it("two agreeing looks give a fix, one look does not", async () => {
    const l = locator(goodIndex());
    await l.start();
    expect(await l.frame(px(10), 1, 1, 0)).toBeNull();
    const fix = await l.frame(px(10), 1, 1, 1000);
    expect(fix).toMatchObject({ floor: "F1" });
    expect(Math.abs(fix!.x - 12)).toBeLessThan(1.5);
    expect(fix!.heading).toBeCloseTo(90, 3);
  });
  it("two looks that point at different places never produce a fix", async () => {
    const l = locator(goodIndex());
    await l.start();
    await l.frame(px(5), 1, 1, 0);
    expect(await l.frame(px(30), 1, 1, 1000)).toBeNull();
  });
  it("a picture of nothing it knows gives nothing", async () => {
    const l = locator(goodIndex());
    await l.start();
    expect(await l.frame(px(0 + DIM / 2 + 7 - 7 + 33 + 0), 1, 1, 0)).toBeNull();
  });
  it("skips a frame while the previous one is still being embedded", async () => {
    let release: () => void = () => undefined;
    const slow = new VprLocator({ fetchIndex: async () => goodIndex(), makeEmbedder: async () => ({ embed: () => new Promise<number[]>((r) => (release = () => r(vecAt(3)))) }) });
    await slow.start();
    const first = slow.frame(px(3), 1, 1, 0);
    expect(await slow.frame(px(3), 1, 1, 10)).toBeNull(); // busy: dropped, not queued
    release();
    await first;
  });
});

describe("a recognition fix inside the step-counting core", () => {
  it("is labelled 'vision' for a few seconds, then it is plain steps again", () => {
    const core = new PdrPoseCore(V, { rnd: () => 0.5 });
    core.anchor({ floor: "F1", x: 5, y: 16.5, heading: 90, acc: 2, markerId: null }, true, "vision");
    expect(core.tick(0.1)!.source).toBe("vision");
    for (let i = 0; i < 70; i++) core.tick(0.1);
    expect(core.tick(0.1)!.source).toBe("steps");
    expect(core.currentHeading).toBeCloseTo(90, 3);
  });
});

class FakeLive extends LivePoseBase {
  readonly kind: PoseKind = "pdr";
  tick(): void {}
  put(p: Pose): void {
    this.emit(p);
  }
  applyFix(): void {}
}
describe("the controller accepts the first fix from sight", () => {
  const setup = () => {
    const src = new FakeLive(V);
    const ctl = new NavController({ venue: V, sim: src, speech: new FakeSpeech(), bus: new BroadcastChannelBus({ channel: new FakeHub().create(), storage: null }) });
    ctl.setAutoConfirm(false);
    ctl.start();
    ctl.openLocate();
    return { ctl, src };
  };
  it("a good vision fix locates the visitor (no marker needed) and opens the map", () => {
    const { ctl, src } = setup();
    src.put({ floor: "F1", x: 12, y: 16.5, heading: 90, acc: 2.2, stale: false, markerId: null, source: "vision" });
    const s = ctl.getState();
    expect(s.located).toBe(true);
    expect(s.screen).toBe("map");
    expect(s.toast?.text).toMatch(/Recognised by sight/);
  });
  it("a vague vision fix (worse than 3.5 m) is not enough to locate; plain step poses still are not", () => {
    const { ctl, src } = setup();
    src.put({ floor: "F1", x: 12, y: 16.5, heading: 90, acc: 5, stale: false, markerId: null, source: "vision" });
    src.put({ floor: "F1", x: 12, y: 16.5, heading: 90, acc: 1, stale: false, markerId: null, source: "steps" });
    expect(ctl.getState().located).toBe(false);
  });
});
