import { describe, expect, it } from "vitest";
import { BroadcastChannelBus, type EventPayload, type PosePayload, type RoutePayload } from "@/bus";
import { FakeHub, MemStorage } from "./helpers/channel";

const pose = (over: Partial<PosePayload> = {}): PosePayload => ({
  t: 1, screen: "map", mode: "nav", ar: false, user: { floor: "F1", x: 1, y: 2, heading: 90, acc: 0.3, stale: false, markerId: 1 },
  s: 3, total: 50, next: "Turn left", nextDist: 12, eta: 40, dest: "Cafeteria", lang: "en", scans: 1, impressions: 0, walked: 3, playing: true, trans: null, venue: "V", ...over,
});

describe("BroadcastChannelBus", () => {
  it("delivers each message type to subscribers on the other side only", () => {
    const hub = new FakeHub();
    const a = new BroadcastChannelBus({ channel: hub.create(), storage: null });
    const b = new BroadcastChannelBus({ channel: hub.create(), storage: null });
    const got: string[] = [];
    const selfGot: string[] = [];
    b.on("pose", (p) => got.push(`pose:${p.s}`));
    b.on("route", (r) => got.push(`route:${r ? r.destName : "null"}`));
    b.on("event", (e) => got.push(`event:${e.kind}`));
    a.on("pose", () => selfGot.push("self"));
    const route: RoutePayload = { id: 1, from: { floor: "F1", x: 1, y: 2, heading: 0 }, target: { room: "F2-cafeteria" }, via: "stairs", destName: "Cafeteria" };
    a.send("pose", pose());
    a.send("route", route);
    a.send("route", null);
    a.send("event", { kind: "scan", text: "x", at: 1 } satisfies EventPayload);
    expect(got).toEqual(["pose:3", "route:Cafeteria", "route:null", "event:scan"]);
    expect(selfGot).toEqual([]);
  });

  it("unsubscribe stops delivery; close clears listeners; a throwing listener does not break others", () => {
    const hub = new FakeHub();
    const a = new BroadcastChannelBus({ channel: hub.create(), storage: null });
    const b = new BroadcastChannelBus({ channel: hub.create(), storage: null });
    let n = 0;
    const off = b.on("pose", () => n++);
    b.on("pose", () => {
      throw new Error("boom");
    });
    let m = 0;
    b.on("pose", () => m++);
    const err = console.error;
    console.error = () => undefined;
    a.send("pose", pose());
    off();
    a.send("pose", pose());
    console.error = err;
    expect(n).toBe(1);
    expect(m).toBe(2);
    b.close();
    a.send("pose", pose());
    expect(m).toBe(2);
  });

  it("ignores duplicate message ids and garbage", () => {
    const hub = new FakeHub();
    const raw = hub.create();
    const b = new BroadcastChannelBus({ channel: hub.create(), storage: null });
    let n = 0;
    b.on("pose", () => n++);
    const wire = { id: "same", t: 1, msg: { type: "pose", payload: pose() } };
    raw.postMessage(wire);
    raw.postMessage(wire);
    raw.postMessage(null);
    raw.postMessage({ nope: true });
    raw.postMessage({ id: "x", t: 1, msg: { type: "alien", payload: 1 } });
    expect(n).toBe(1);
  });

  it("mirrors the last pose and route to storage so a late dashboard can hydrate; events are not stored", () => {
    const hub = new FakeHub();
    const storage = new MemStorage();
    const a = new BroadcastChannelBus({ channel: hub.create(), storage });
    expect(a.snapshot()).toEqual({ pose: null, route: null });
    a.send("pose", pose({ s: 7 }));
    a.send("event", { kind: "scan", text: "x", at: 1 });
    const route: RoutePayload = { id: 2, from: { floor: "F1", x: 1, y: 2 }, target: { poi: "P01" }, via: null, destName: "Entrance" };
    a.send("route", route);
    const late = new BroadcastChannelBus({ channel: hub.create(), storage });
    expect(late.snapshot().pose?.s).toBe(7);
    expect(late.snapshot().route?.destName).toBe("Entrance");
    a.send("route", null);
    expect(late.snapshot().route).toBeNull();
    late.clearSnapshot();
    expect(late.snapshot()).toEqual({ pose: null, route: null });
  });

  it("works with no channel and no storage (private mode / old browser)", () => {
    const a = new BroadcastChannelBus({ channel: null, storage: null });
    expect(() => a.send("pose", pose())).not.toThrow();
    expect(a.snapshot()).toEqual({ pose: null, route: null });
    a.close();
  });
});
