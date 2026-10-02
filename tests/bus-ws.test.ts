import { describe, expect, it } from "vitest";
import { CompositeBus, WebSocketBus, getDeviceId, type SocketLike } from "@/bus";
import type { PosePayload } from "@/bus";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(readonly url: string) {}
  send(d: string): void {
    this.sent.push(d);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  drop(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  receive(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function harness(extra: Partial<ConstructorParameters<typeof WebSocketBus>[0]> = {}) {
  const sockets: FakeSocket[] = [];
  const timers: { fn: () => void; ms: number; id: number }[] = [];
  let id = 0;
  const bus = new WebSocketBus({
    room: "office-hq",
    deviceId: "ph-test",
    url: "wss://laptop:8080/ws",
    socketFactory: (u) => {
      const s = new FakeSocket(u);
      sockets.push(s);
      return s;
    },
    setTimer: (fn, ms) => {
      timers.push({ fn, ms, id: ++id });
      return id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    random: () => 1,
    ...extra,
  });
  return { bus, sockets, timers };
}

const pose = (x: number): PosePayload => ({
  t: 1, screen: "map", mode: "nav", ar: true, user: { floor: "F1", x, y: 17, heading: 90, acc: 0.5, stale: false, markerId: 1, source: "ar" },
  s: 0, total: 0, next: null, nextDist: null, eta: null, dest: null, lang: "en", scans: 0, impressions: 0, walked: 0, playing: false, trans: null, venue: "HQ",
});

describe("WebSocketBus", () => {
  it("connects to /ws with room, role and device id", () => {
    const { sockets } = harness();
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.url).toBe("wss://laptop:8080/ws?room=office-hq&role=device&device=ph-test");
  });

  it("sends JSON envelopes with the device id once open", () => {
    const { bus, sockets } = harness();
    sockets[0]!.open();
    expect(bus.status).toBe("open");
    bus.send("pose", pose(5));
    const w = JSON.parse(sockets[0]!.sent[0]!);
    expect(w.type).toBe("pose");
    expect(w.deviceId).toBe("ph-test");
    expect(w.payload.user.x).toBe(5);
  });

  it("delivers incoming messages with the sender's device id and the receive time", () => {
    const { bus, sockets } = harness({ role: "viewer" });
    sockets[0]!.open();
    const got: { x: number; dev: string; recvT: number }[] = [];
    bus.on("pose", (p, m) => got.push({ x: p.user!.x, dev: m.deviceId, recvT: m.recvT }));
    sockets[0]!.receive({ type: "pose", payload: pose(7), deviceId: "ph-a", t: 123 });
    sockets[0]!.receive({ type: "pose", payload: pose(8), deviceId: "ph-b", t: 456 });
    sockets[0]!.onmessage?.({ data: "not json" });
    expect(got.map((g) => [g.x, g.dev])).toEqual([[7, "ph-a"], [8, "ph-b"]]);
    expect(got[0]!.recvT).toBeGreaterThan(1e12); // local clock, not the sender's t
  });

  it("delivers venue / campaigns notifications", () => {
    const { bus, sockets } = harness();
    sockets[0]!.open();
    const seen: string[] = [];
    bus.on("venue", (n) => seen.push(`venue v${n.version}`));
    bus.on("campaigns", (n) => seen.push(`campaigns v${n.version}`));
    sockets[0]!.receive({ type: "venue", payload: { venue: "office-hq", version: 4, at: 1 }, deviceId: "server" });
    sockets[0]!.receive({ type: "campaigns", payload: { venue: "office-hq", version: 2, at: 1 }, deviceId: "server" });
    expect(seen).toEqual(["venue v4", "campaigns v2"]);
  });

  it("reconnects with exponential backoff (jittered, capped) and resets after an open", () => {
    const { bus, sockets, timers } = harness({ baseDelayMs: 500, maxDelayMs: 4000 });
    sockets[0]!.drop();
    expect(bus.status).toBe("closed");
    expect(timers.map((t) => t.ms)).toEqual([500]);
    timers.shift()!.fn(); // reconnect #1
    expect(sockets).toHaveLength(2);
    sockets[1]!.drop();
    expect(timers[0]!.ms).toBe(1000);
    timers.shift()!.fn();
    sockets[2]!.drop();
    expect(timers[0]!.ms).toBe(2000);
    timers.shift()!.fn();
    sockets[3]!.drop();
    expect(timers[0]!.ms).toBe(4000);
    timers.shift()!.fn();
    sockets[4]!.drop();
    expect(timers[0]!.ms).toBe(4000); // capped
    timers.shift()!.fn();
    sockets[5]!.open();
    expect(bus.attempts).toBe(0);
    sockets[5]!.drop();
    expect(timers[0]!.ms).toBe(500);
  });

  it("applies jitter between 50% and 100% of the delay", () => {
    const { sockets, timers } = harness({ baseDelayMs: 1000, random: () => 0 });
    sockets[0]!.drop();
    expect(timers[0]!.ms).toBe(500);
  });

  it("while offline keeps the latest pose + route and a few events, and flushes them on reconnect", () => {
    const { bus, sockets, timers } = harness({ maxQueuedEvents: 2 });
    sockets[0]!.open();
    sockets[0]!.drop();
    bus.send("pose", pose(1));
    bus.send("pose", pose(2));
    bus.send("route", { id: 1, from: { floor: "F1", x: 1, y: 1 }, target: { room: "F2-cafeteria" }, via: null, destName: "Cafeteria" });
    bus.send("event", { kind: "scan", text: "a", at: 1 });
    bus.send("event", { kind: "scan", text: "b", at: 2 });
    bus.send("event", { kind: "scan", text: "c", at: 3 });
    timers.shift()!.fn();
    sockets[1]!.open();
    const out = sockets[1]!.sent.map((s) => JSON.parse(s));
    expect(out.map((o) => o.type)).toEqual(["route", "event", "event", "pose"]);
    expect(out.filter((o) => o.type === "event").map((o) => o.payload.text)).toEqual(["b", "c"]);
    expect(out.at(-1).payload.user.x).toBe(2);
  });

  it("close() stops reconnecting and drops listeners", () => {
    const { bus, sockets, timers } = harness();
    let n = 0;
    bus.on("pose", () => n++);
    sockets[0]!.open();
    sockets[0]!.drop();
    bus.close();
    expect(timers).toHaveLength(0);
    expect(bus.status).toBe("closed");
    bus.send("pose", pose(1));
    expect(sockets).toHaveLength(1);
    expect(n).toBe(0);
  });

  it("ignores events from a socket that was already replaced", () => {
    const { bus, sockets, timers } = harness();
    sockets[0]!.drop();
    timers.shift()!.fn();
    sockets[1]!.open();
    sockets[0]!.onclose?.(); // a late close from the old socket
    expect(bus.status).toBe("open");
    expect(timers).toHaveLength(0);
  });
});

describe("getDeviceId / CompositeBus", () => {
  it("is stable per storage", () => {
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const a = getDeviceId(st);
    expect(a).toMatch(/^ph-/);
    expect(getDeviceId(st)).toBe(a);
  });

  it("fans out sends and merges listeners", () => {
    const sent: string[] = [];
    const mk = (name: string) => {
      const l = new Set<(p: unknown, m: { deviceId: string; recvT: number }) => void>();
      return {
        send: (_t: string, p: unknown) => void sent.push(`${name}:${(p as { v: number }).v}`),
        on: (_t: string, fn: (p: unknown, m: { deviceId: string; recvT: number }) => void) => (l.add(fn), () => l.delete(fn)),
        close: () => l.clear(),
        emit: (v: number) => l.forEach((f) => f({ v }, { deviceId: name, recvT: 0 })),
      };
    };
    const a = mk("a");
    const b = mk("b");
    const bus = new CompositeBus([a as never, b as never]);
    bus.send("event", { v: 1 } as never);
    expect(sent).toEqual(["a:1", "b:1"]);
    const got: string[] = [];
    const off = (bus as unknown as { on: (t: string, f: (p: unknown, m: { deviceId: string }) => void) => () => void }).on("pose", (p, m) => got.push(`${m.deviceId}${(p as { v: number }).v}`));
    a.emit(1);
    b.emit(2);
    off();
    a.emit(3);
    expect(got).toEqual(["a1", "b2"]);
  });
});

describe("WebSocketBus sendTypes", () => {
  it("a listen-only bus sends nothing but still receives", () => {
    const { bus, sockets } = harness({ sendTypes: [] });
    sockets[0]!.open();
    bus.send("pose", pose(1));
    bus.send("event", { kind: "x", text: "y", at: 1 });
    expect(sockets[0]!.sent).toEqual([]);
    let n = 0;
    bus.on("venue", () => n++);
    sockets[0]!.receive({ type: "venue", payload: { venue: "v", version: 2, at: 1 }, deviceId: "server" });
    expect(n).toBe(1);
  });
});
