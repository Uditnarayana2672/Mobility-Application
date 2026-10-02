import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { BroadcastChannelBus, type EventPayload, type PosePayload, type RoutePayload } from "@/bus";
import { parseVenue, type Venue } from "@/core";
import { NavController } from "@/navigator/controller";
import { FakeSpeech } from "@/navigator/speech";
import { SimPoseSource } from "@/navigator/simPose";
import { FakeHub, MemStorage } from "./helpers/channel";

const V: Venue = (() => {
  const r = parseVenue(JSON.parse(fs.readFileSync("public/venues/office-hq/venue.json", "utf8")));
  if (!r.ok) throw new Error("bad fixture");
  return r.data;
})();

function setup() {
  const hub = new FakeHub();
  const storage = new MemStorage();
  const phoneBus = new BroadcastChannelBus({ channel: hub.create(), storage });
  const dashBus = new BroadcastChannelBus({ channel: hub.create(), storage: null });
  const sim = new SimPoseSource(V);
  const speech = new FakeSpeech();
  const ctl = new NavController({ venue: V, sim, speech, bus: phoneBus });
  const poses: PosePayload[] = [];
  const routes: (RoutePayload | null)[] = [];
  const events: EventPayload[] = [];
  dashBus.on("pose", (p) => poses.push(p));
  dashBus.on("route", (r) => routes.push(r));
  dashBus.on("event", (e) => events.push(e));
  ctl.start();
  const run = (sec: number, dt = 0.05) => {
    for (let t = 0; t < sec; t += dt) ctl.tick(dt);
  };
  const until = (cond: () => boolean, maxSec = 300) => {
    for (let t = 0; t < maxSec && !cond(); t += 0.05) ctl.tick(0.05);
    return cond();
  };
  return { ctl, sim, speech, poses, routes, events, run, until };
}

describe("NavController: Reception -> Cafeteria (F2) end to end", () => {
  it("scan -> place -> stairs vs lift preview -> navigate with voice -> floor change -> arrived; dashboard bus mirrors it", () => {
    const { ctl, sim, speech, poses, routes, events, run, until } = setup();
    expect(ctl.getState().screen).toBe("city");
    ctl.openLocate();
    ctl.scanMarker(1, true);
    expect(ctl.getState()).toMatchObject({ screen: "map", mode: "explore", located: true });
    expect(ctl.getState().user).toMatchObject({ floor: "F1", markerId: 1, acc: 0.3 });

    ctl.showPlace({ room: "F2-cafeteria" });
    expect(ctl.getState().mode).toBe("place");
    ctl.preview();
    let s = ctl.getState();
    expect(s.mode).toBe("preview");
    expect(s.options.map((o) => o.via).sort()).toEqual(["lift", "stairs"]);
    expect(s.route).toBe(s.options[0]);
    expect(routes.at(-1)).toMatchObject({ target: { room: "F2-cafeteria" }, destName: "Cafeteria" });

    // Avoid stairs: one accessible option.
    ctl.setAvoidStairs(true);
    s = ctl.getState();
    expect(s.options).toHaveLength(1);
    expect(s.options[0]!.via).toBe("lift");
    ctl.setAvoidStairs(false);
    expect(ctl.getState().options).toHaveLength(2);

    sim.setSpeed(3);
    ctl.startNav();
    expect(ctl.getState().mode).toBe("nav");
    expect(speech.lines[0]!.priority).toBe("urgent"); // the opening instruction
    expect(ctl.getState().follow).toBe(true);

    expect(until(() => ctl.getState().floorPrompt !== null)).toBe(true);
    const fp = ctl.getState().floorPrompt!;
    expect(fp.floor).toBe("F2");
    expect(ctl.getState().sim.held).toBe(true);
    expect(speech.texts.some((t) => /Are you on Floor 2 now\?/.test(t))).toBe(true);
    run(0.5);
    const frozen = ctl.getState().snap!.s;
    run(0.5);
    expect(ctl.getState().snap!.s).toBe(frozen); // held while the prompt shows

    // auto-confirm (lobby marker) after ~3.4 s
    expect(until(() => ctl.getState().floorPrompt === null, 10)).toBe(true);
    expect(events.some((e) => e.kind === "floor" && /confirmed \(lobby marker\)/.test(e.text))).toBe(true);

    expect(until(() => ctl.getState().screen === "arrived")).toBe(true);
    s = ctl.getState();
    expect(s.arrived).toMatchObject({ name: "Cafeteria", floorName: "Floor 2" });
    expect(speech.texts.at(-1)).toBe("You have arrived at Cafeteria.");
    expect(speech.lines.some((l) => l.priority === "urgent" && /^Now, /.test(l.text))).toBe(true);
    expect(speech.lines.some((l) => /^In \d+ metres, /.test(l.text))).toBe(true);

    // Dashboard side saw it all
    const kinds = new Set(events.map((e) => e.kind));
    for (const k of ["scan", "route", "nav", "floor", "arrive"]) expect(kinds.has(k)).toBe(true);
    expect(events.filter((e) => e.kind === "arrive")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "offroute")).toHaveLength(0);
    const last = poses.at(-1)!;
    expect(last.s).toBeCloseTo(last.total, 6);
    expect(last.dest).toBe("Cafeteria");
    expect(poses.some((p) => p.trans === "stairs" || p.trans === "lift")).toBe(true);
    expect(poses.some((p) => p.user?.floor === "F2")).toBe(true);
    expect(routes.at(-1)).toBeNull();
    expect(poses.filter((p) => p.mode === "nav").every((p) => p.total > 0)).toBe(true);
  });

  it("poses before the first scan are ignored (the simulator warms up silently)", () => {
    const { ctl, run, poses } = setup();
    run(1);
    expect(ctl.getState().user).toBeNull();
    expect(poses).toHaveLength(0);
  });

  it("captions come with every line, even when muted or a language has no voice", () => {
    const hub = new FakeHub();
    const bus = new BroadcastChannelBus({ channel: hub.create(), storage: null });
    const sim = new SimPoseSource(V);
    const speech = new FakeSpeech(["en"]); // no Hindi / Telugu voice
    const ctl = new NavController({ venue: V, sim, speech, bus });
    ctl.start();
    ctl.scanMarker(1, true);
    ctl.setLang("te");
    ctl.showPlace({ room: "F2-cafeteria" });
    ctl.preview();
    ctl.startNav();
    const c = ctl.getState().caption!;
    expect(c.text.length).toBeGreaterThan(5);
    expect(c.spoken).toBe(false);
    expect(speech.lines.every((l) => !l.spoken)).toBe(true);
  });

  it("wrong turn -> off route after 3 s -> reroute -> still arrives", () => {
    const { ctl, sim, speech, events, until, run } = setup();
    ctl.scanMarker(1, true);
    ctl.showPlace({ room: "F2-cafeteria" });
    ctl.preview();
    sim.setSpeed(3);
    ctl.startNav();
    run(2);
    ctl.wrongTurn();
    expect(events.some((e) => e.kind === "offroute")).toBe(false);
    run(2.5);
    expect(events.some((e) => e.kind === "offroute")).toBe(false); // < 3 s
    run(1);
    expect(events.filter((e) => e.kind === "offroute")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "reroute")).toHaveLength(1);
    expect(speech.texts.some((t) => /off the route/.test(t))).toBe(true);
    expect(until(() => ctl.getState().screen === "arrived")).toBe(true);
    expect(events.filter((e) => e.kind === "arrive")).toHaveLength(1);
  });

  it("losing tracking never reroutes; a scan recovers", () => {
    const { ctl, sim, events, run } = setup();
    ctl.scanMarker(1, true);
    ctl.showPlace({ room: "F2-cafeteria" });
    ctl.preview();
    sim.setSpeed(1);
    ctl.startNav();
    run(1);
    ctl.loseTracking();
    run(5.5);
    expect(events.some((e) => e.kind === "offroute")).toBe(false);
    expect(ctl.getState().user!.stale).toBe(false);
    ctl.fixPosition();
    expect(ctl.getState().user!.acc).toBe(0.3);
  });

  it("deep links: #map #place #preview #nav #navf2", () => {
    const states: Record<string, { screen: string; mode: string; floor?: string }> = {
      "#map": { screen: "map", mode: "explore" },
      "#place": { screen: "map", mode: "place" },
      "#preview": { screen: "map", mode: "preview" },
      "#nav": { screen: "map", mode: "nav", floor: "F1" },
      "#navf2": { screen: "map", mode: "nav", floor: "F2" },
    };
    for (const [h, want] of Object.entries(states)) {
      const { ctl, run } = setup();
      ctl.applyHash(h);
      run(0.2);
      const s = ctl.getState();
      expect(s.screen).toBe(want.screen);
      expect(s.mode).toBe(want.mode);
      if (want.floor) expect(s.user!.floor).toBe(want.floor);
    }
  });

  it("#navf2 then keeps walking to the cafeteria without a spurious off-route", () => {
    const { ctl, events, until } = setup();
    ctl.applyHash("#navf2");
    expect(until(() => ctl.getState().screen === "arrived")).toBe(true);
    expect(events.some((e) => e.kind === "offroute")).toBe(false);
  });

  it("#arturn / #arad / #arf2 land in AR guidance", () => {
    for (const h of ["#arturn", "#arad", "#arf2"]) {
      const { ctl } = setup();
      ctl.applyHash(h);
      expect(ctl.getState().screen).toBe("ar");
    }
  });

  it("#search and #voice open their overlays; #voice resolves 'Cafeteria kahan hai?' to the place card (Directions comes next)", async () => {
    const a = setup();
    a.ctl.applyHash("#search");
    expect(a.ctl.getState().overlay).toBe("search");
    expect(a.ctl.getState().searchSeed).toBe("can");
    const b = setup();
    b.ctl.setLang("hi");
    b.ctl.applyHash("#voice");
    expect(b.ctl.getState().overlay).toBe("voice");
    b.run(0.2);
    await Promise.resolve();
    await Promise.resolve();
    b.run(3);
    const s = b.ctl.getState();
    expect(s.chat.some((c) => c.me && /kahan/.test(c.text))).toBe(true);
    expect(s.chat.some((c) => !c.me && /Cafeteria/.test(c.text))).toBe(true);
    expect(s.mode).toBe("place");
    expect(s.place?.id).toBe("F2-cafeteria");
    expect(s.overlay).toBe("none");
    b.ctl.preview();
    expect(b.ctl.getState().options).toHaveLength(2);
  });
});

describe("NavController: voice intents", () => {
  async function ask(text: string, lang: "en" | "hi" | "te" = "en") {
    const t = setup();
    t.ctl.scanMarker(1, true);
    t.ctl.setLang(lang);
    await t.ctl.askText(text);
    t.run(3);
    return t;
  }
  it("where am I", async () => {
    const t = await ask("Where am I?");
    expect(t.ctl.getState().chat.at(-1)!.text).toMatch(/You are on Floor 1/);
    const h = await ask("main kahan hoon", "hi");
    expect(h.ctl.getState().chat.at(-1)!.text).toMatch(/Aap Floor 1 par hain/);
  });
  it("avoid stairs sets the preference; during a preview it re-plans", async () => {
    const t = await ask("take me to the cafeteria");
    expect(t.ctl.getState().mode).toBe("preview");
    expect(t.ctl.getState().options).toHaveLength(2);
    await t.ctl.askText("avoid stairs");
    t.run(1);
    expect(t.ctl.getState().prefs.avoidStairs).toBe(true);
    expect(t.ctl.getState().options).toHaveLength(1);
  });
  it("staff-only rooms are refused", async () => {
    const staff = V.rooms.find((r) => r.access === "staff");
    if (!staff) return;
    const t = await ask(`take me to ${staff.name}`);
    expect(t.ctl.getState().chat.at(-1)!.text).toMatch(/staff-only/);
    expect(t.ctl.getState().mode).not.toBe("preview");
  });
  it("gibberish gets a polite miss, in English and Telugu", async () => {
    const t = await ask("asdkjh qwe");
    expect(t.ctl.getState().chat.at(-1)!.text).toMatch(/didn’t catch/);
    const te = await ask("asdkjh qwe", "te");
    expect(te.ctl.getState().chat.at(-1)!.text).toMatch(/అర్థం కాలేదు/);
  });
  it("asking before any scan asks for a marker instead of crashing", async () => {
    const t = setup();
    await t.ctl.askText("Cafeteria kahan hai?");
    t.run(3);
    expect(t.ctl.getState().chat.at(-1)!.text).toMatch(/Scan a marker/);
  });
  it("stop ends navigation; repeat re-speaks the next step", async () => {
    const t = setup();
    t.ctl.scanMarker(1, true);
    t.ctl.showPlace({ room: "F2-cafeteria" });
    t.ctl.preview();
    t.ctl.startNav();
    t.run(1);
    await t.ctl.askText("repeat");
    t.run(1);
    expect(t.ctl.getState().chat.at(-1)!.text).toMatch(/^(In \d+ metres|Now), /);
    await t.ctl.askText("stop");
    t.run(2);
    expect(t.ctl.getState().mode).toBe("explore");
  });
});

describe("NavController: demo reset", () => {
  it("returns phone state to launch and ignores poses until a fresh marker scan", () => {
    const t = setup();
    t.ctl.scanMarker(1, true);
    t.ctl.showPlace({ room: "F2-cafeteria" });
    t.ctl.preview();
    t.ctl.startNav();
    t.run(1);
    expect(t.ctl.getState().user).not.toBeNull();
    t.ctl.resetDemo();
    expect(t.ctl.getState()).toMatchObject({ screen: "city", mode: "explore", located: false, user: null, route: null, chat: [], scans: 0, impressions: 0 });
    expect(t.routes.at(-1)).toBeNull();
    t.run(1);
    expect(t.ctl.getState().user).toBeNull();
    t.ctl.scanMarker(1, true);
    expect(t.ctl.getState().user?.markerId).toBe(1);
  });
});
