import type { Bus, PosePayload, RoutePayload } from "@/bus";
import { arrivedText, fmtTime, stepAction, stepSpeech, thenText, walkText, type Lang } from "@/core/instructions";
import type { Intent, Target } from "@/core/intent";
import { doorOutward } from "@/core/doors";
import { nearestMarker } from "@/core/poseFromMarker";
import { pointAt, nextStep } from "@/core/playback";
import { alternatives, isRouteError, route as computeRoute, type Route, type RouteFrom, type RoutePrefs } from "@/core/route";
import type { Venue } from "@/core/schema";
import { EXAMPLES, MSG } from "./messages";
import { floorName, nearName, placeOf, type Place } from "./places";
import type { ControllerPoseSource, Pose, PoseDebug, PoseKind } from "./poseSource";
import { RuleIntentResolver, type IntentResolver } from "./intentResolver";
import { advance, createSession, snapshot, type SessionEvent, type SessionSnapshot, type SessionState } from "./session";
import type { SimStatus } from "./simPose";
import type { Caption, SpeechOut } from "./speech";

export type Screen = "city" | "locate" | "map" | "arrived" | "ar";
export type Mode = "explore" | "place" | "preview" | "nav";
export type Overlay = "none" | "search" | "voice";

/** Ask the map to move: the map view applies it when `nonce` changes. */
export interface MapFocus {
  nonce: number;
  floor: string;
  x: number;
  y: number;
  /** Fixed scale (px/m) or a box (m) to fit. */
  scale?: number;
  fitW?: number;
  fitH?: number;
}

export interface ArrivedInfo {
  name: string;
  floorName: string;
  sub: string;
  tookSec: number;
  walkedM: number;
  routeSec: number;
  routeWalkM: number;
  scans: number;
}

export interface NavState {
  venue: Venue;
  venueSource: "api" | "bundled";
  screen: Screen;
  mode: Mode;
  lang: Lang;
  muted: boolean;
  autoConfirm: boolean;
  prefs: { avoidStairs: boolean };
  located: boolean;
  user: Pose | null;
  /** The floor the map is showing (floor switcher). */
  viewFloor: string;
  follow: boolean;
  focus: MapFocus | null;
  place: Place | null;
  options: Route[];
  optIdx: number;
  route: Route | null;
  snap: SessionSnapshot | null;
  sim: SimStatus;
  /** Which pose source drives the dot: simulator, WebXR or step counting. */
  poseKind: PoseKind;
  /** The camera scan sheet is open (PDR re-anchoring mid-walk). */
  scanning: boolean;
  floorPrompt: { floor: string; autoInSec: number | null } | null;
  overlay: Overlay;
  searchSeed: string;
  pickLoc: boolean;
  chat: { me: boolean; text: string }[];
  caption: { id: number; text: string; spoken: boolean } | null;
  toast: { id: number; text: string } | null;
  arrived: ArrivedInfo | null;
  scans: number;
  impressions: number;
  walked: number;
}

export interface NavDeps {
  venue: Venue;
  venueSource?: "api" | "bundled";
  sim: ControllerPoseSource;
  speech: SpeechOut;
  bus: Bus;
  resolver?: IntentResolver;
}

const CAPTION_MS = 5200;
const TOAST_MS = 2600;
const FLOOR_AUTO_SEC = 3.4;
const BUS_POSE_MS = 200;

const prefsFor = (via: "stairs" | "lift" | null, base: { avoidStairs: boolean }): Partial<RoutePrefs> => (via === "lift" ? { avoidStairs: true } : via === "stairs" ? { avoidLifts: true } : base.avoidStairs ? { avoidStairs: true } : {});

/**
 * Everything the visitor app does, without React: screens, the pose -> session -> speech/bus pipeline, route planning,
 * voice intents. Time only moves through tick(dtSec) (and the pose stream), so a test can run a whole walk deterministically.
 */
export class NavController {
  private st: NavState;
  private readonly listeners = new Set<() => void>();
  private v: Venue;
  private readonly sim: ControllerPoseSource;
  private readonly speech: SpeechOut;
  private readonly bus: Bus;
  private readonly resolver: IntentResolver;
  private session: SessionState | null = null;
  private routeFrom: RouteFrom | null = null;
  private routeId = 0;
  private now = 0;
  private lastBus = -1e9;
  private uid = 0;
  private lastPose: Pose | null = null;
  private timers: { at: number; fn: () => void }[] = [];
  private navStartedAt = 0;
  private unsubs: (() => void)[] = [];
  private readonly arOpenListeners = new Set<() => void>();

  constructor(deps: NavDeps) {
    this.v = deps.venue;
    this.sim = deps.sim;
    this.speech = deps.speech;
    this.bus = deps.bus;
    this.resolver = deps.resolver ?? new RuleIntentResolver();
    this.st = {
      venue: deps.venue,
      venueSource: deps.venueSource ?? "bundled",
      screen: "city",
      mode: "explore",
      lang: "en",
      muted: false,
      autoConfirm: true,
      prefs: { avoidStairs: false },
      located: false,
      user: null,
      viewFloor: deps.venue.floors[0]?.id ?? "",
      follow: false,
      focus: null,
      place: null,
      options: [],
      optIdx: 0,
      route: null,
      snap: null,
      sim: deps.sim.getStatus(),
      poseKind: deps.sim.kind,
      scanning: false,
      floorPrompt: null,
      overlay: "none",
      searchSeed: "",
      pickLoc: false,
      chat: [],
      caption: null,
      toast: null,
      arrived: null,
      scans: 0,
      impressions: 0,
      walked: 0,
    };
    this.unsubs.push(this.sim.subscribe((p) => this.onPose(p)));
    this.unsubs.push(this.sim.onStatus(() => this.patch({ sim: this.sim.getStatus() })));
    this.unsubs.push(this.speech.onCaption((c) => this.onCaption(c)));
  }

  /* ------------------------------------------------------------------ store */
  getState = (): NavState => this.st;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private patch(p: Partial<NavState>): void {
    this.st = { ...this.st, ...p };
    for (const fn of [...this.listeners]) fn();
  }
  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.sim.stop();
    this.speech.cancel();
    this.arOpenListeners.clear();
    this.listeners.clear();
  }

  start(): void {
    this.sim.start();
  }

  /* ------------------------------------------------------------------ time */
  tick(dtSec: number): void {
    this.sim.tick(dtSec);
    this.now += dtSec * 1000;
    // scheduled actions
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.now);
      this.timers = this.timers.filter((t) => t.at > this.now);
      for (const t of due) t.fn();
    }
    // expire caption / toast
    const { caption, toast } = this.st;
    if (caption && this.now > this.captionUntil) this.patch({ caption: null });
    if (toast && this.now > this.toastUntil) this.patch({ toast: null });
    // floor prompt auto-confirm
    const fp = this.st.floorPrompt;
    if (fp && this.floorAutoAt !== null) {
      const left = Math.max(0, Math.ceil((this.floorAutoAt - this.now) / 1000));
      if (left !== fp.autoInSec) this.patch({ floorPrompt: { ...fp, autoInSec: left } });
      if (this.now >= this.floorAutoAt) this.confirmFloor("marker");
    }
    this.publishPose();
  }
  private captionUntil = 0;
  private toastUntil = 0;
  private floorAutoAt: number | null = null;
  private later(ms: number, fn: () => void): void {
    this.timers.push({ at: this.now + ms, fn });
  }

  /* ------------------------------------------------------------------ small helpers */
  private fl = (id: string): string => floorName(this.v, id);
  private ev(kind: string, text: string): void {
    this.bus.send("event", { kind, text, at: Date.now() });
  }
  toast(text: string): void {
    this.toastUntil = this.now + TOAST_MS;
    this.patch({ toast: { id: ++this.uid, text } });
  }
  private onCaption(c: Caption): void {
    this.captionUntil = this.now + CAPTION_MS;
    this.patch({ caption: { id: ++this.uid, text: c.text, spoken: c.spoken } });
  }
  private say(text: string, urgent = false): void {
    this.speech.say(text, this.st.lang, urgent ? "urgent" : "normal");
  }
  private fromPose(): RouteFrom | null {
    const u = this.st.user;
    return u ? { floor: u.floor, x: u.x, y: u.y, heading: u.heading } : null;
  }

  /* ------------------------------------------------------------------ language / sound */
  setLang(lang: Lang): void {
    this.patch({ lang });
  }
  toggleMute(): void {
    const muted = !this.st.muted;
    this.speech.setMuted(muted);
    this.patch({ muted });
    this.toast(muted ? "Voice muted (captions stay on)" : "Voice on");
  }
  setMuted(muted: boolean): void {
    this.speech.setMuted(muted);
    this.patch({ muted });
  }
  setAutoConfirm(on: boolean): void {
    this.patch({ autoConfirm: on });
  }

  /* ------------------------------------------------------------------ locating */
  openLocate(): void {
    this.patch({ screen: "locate" });
  }
  /** Marker scan (real or simulated). The first scan opens the map. */
  scanMarker(id: number, first = false): void {
    if (!this.v.markers.some((m) => m.id === id)) return;
    this.setLocated();
    this.sim.scan(id);
    const m = this.v.markers.find((x) => x.id === id)!;
    this.toast(`✅ Marker ${m.id} recognised · ${this.fl(m.floor)} · ±0.3 m`);
    if (first || this.st.screen === "locate" || this.st.screen === "city") this.goMap();
    else if (this.st.route && this.st.mode !== "nav") this.replanPreview();
  }
  /** "I can't find a marker": approximate position at a room door (±4 m). */
  setLocationManually(p: Place): void {
    const r = p.kind === "room" ? this.v.rooms.find((x) => x.id === p.id) : undefined;
    if (this.live && r) {
      // A phone has no simulator: put the visitor just inside the room, facing its door, so the camera arrows start pointing the right way.
      const out = doorOutward(r.door);
      const back = ((out + 180) * Math.PI) / 180;
      this.setLocated();
      this.sim.teleport({ floor: r.floor, x: r.door.x + Math.sin(back) * 1.2, y: r.door.y - Math.cos(back) * 1.2, heading: out, acc: 3, markerId: null });
      this.patch({ pickLoc: false });
      this.toast(`📍 Starting in ${r.name}. Stand just inside, facing its door.`);
      if (this.st.screen === "locate" || this.st.screen === "city") this.goMap();
      return;
    }
    const x = r ? r.door.x + (r.door.side ? 0 : Math.sin((doorOutward(r.door) * Math.PI) / 180) * 1.2) : p.x;
    const y = r ? r.door.y + (r.door.side === "N" ? 1.2 : r.door.side ? -1.2 : -Math.cos((doorOutward(r.door) * Math.PI) / 180) * 1.2) : p.y;
    this.setLocated();
    this.sim.teleport({ floor: p.floor, x, y, heading: 90, acc: 4, markerId: null });
    this.patch({ pickLoc: false });
    this.toast("Approximate position set (±4 m). Scan a marker for exact.");
    if (this.st.screen === "locate" || this.st.screen === "city") this.goMap();
  }
  private setLocated(): void {
    if (!this.st.located) this.patch({ located: true });
    this.located = true;
  }
  private located = false;
  private lastAnchorAt: number | null = null;
  private pendingVenue: Venue | null = null;
  /** True when poses come from the phone (XR / step counting) rather than the laptop simulator. */
  private get live(): boolean {
    return this.sim.kind !== "sim";
  }

  /* ------------------------------------------------------------------ pose pipeline */
  private onPose(p: Pose): void {
    if (!this.located) {
      // The simulator warms up before the first (tapped) scan; a live source has nothing until it has seen a marker: ignore all but that fix.
      if (!this.live || p.source !== "marker" || p.markerId === null) return;
      this.setLocated();
      this.patch({ user: p });
      const m = this.v.markers.find((x) => x.id === p.markerId);
      if (this.live && m) this.toast(`✅ Marker ${m.id} recognised · ${this.fl(m.floor)} · ±${p.acc.toFixed(1)} m`);
      if (this.st.screen === "locate" || this.st.screen === "city") this.goMap();
    } else if (this.live && p.source === "marker" && p.markerId !== null && this.st.scanning) {
      this.patch({ scanning: false });
    }
    const prev = this.lastPose;
    if (this.live && p.stale && !(prev?.stale ?? false)) {
      if (this.st.screen === "ar") this.patch({ screen: "map" });
      this.toast("📡 Tracking lost — scan a marker to fix your position");
      this.ev("tracking", "Tracking lost");
    } else if (this.live && !p.stale && prev?.stale) {
      this.ev("tracking", "Tracking back");
    }
    if (p.source === "marker") this.lastAnchorAt = Date.now();
    this.lastPose = p;
    const patch: Partial<NavState> = { user: p };
    if (p.source === "marker" && p.markerId !== null) {
      const m = this.v.markers.find((x) => x.id === p.markerId);
      this.ev("scan", `Marker ${p.markerId} scanned — ${m?.name ?? "?"} (${this.fl(p.floor)}) · ±${p.acc.toFixed(1)} m`);
      patch.scans = this.st.scans + 1;
    }
    if (this.st.mode === "nav" && prev && prev.floor === p.floor && !p.stale) {
      const d = Math.hypot(p.x - prev.x, p.y - prev.y);
      if (d < 3) patch.walked = this.st.walked + d;
    }
    if (this.session && this.st.mode === "nav") {
      const res = advance(this.session, { type: "pose", pose: p, tMs: this.now });
      this.session = res.state;
      patch.snap = snapshot(res.state);
      this.patch(patch);
      for (const e of res.events) this.handleEvent(e);
    } else {
      this.patch(patch);
    }
    if (this.st.follow && this.st.viewFloor !== p.floor && this.st.mode === "nav") this.patch({ viewFloor: p.floor });
    if (p.source === "marker") this.publishPose(true);
  }

  private handleEvent(e: SessionEvent): void {
    const R = this.session?.route;
    if (!R) return;
    const lang = this.st.lang;
    switch (e.type) {
      case "start": {
        const first = e.first;
        if (first.kind === "turn" && first.initial && e.second) this.say(`${stepAction(first, lang)}. ${thenText(e.second.dist, lang)}.`, true);
        else this.say(`${walkText(first.dist, lang)}, ${stepAction(first, lang).toLowerCase()}.`, true);
        break;
      }
      case "preannounce":
        this.say(stepSpeech(e.step, lang, e.remaining));
        break;
      case "turnNow":
        this.say(stepSpeech(e.step, lang, 0), true);
        break;
      case "connector": {
        this.ev("floor", `Leaving ${this.fl(e.fromFloor)} by ${e.via}`);
        const end = R.points[e.hop + 1];
        if (this.sim.onConnector && end) this.sim.onConnector(e.toFloor, end.x, end.y);
        break;
      }
      case "floorPrompt": {
        this.floorAutoAt = this.st.autoConfirm ? this.now + FLOOR_AUTO_SEC * 1000 : null;
        this.sim.hold(true);
        this.patch({ floorPrompt: { floor: e.floor, autoInSec: this.st.autoConfirm ? Math.ceil(FLOOR_AUTO_SEC) : null }, viewFloor: e.floor });
        this.say(MSG.floorPrompt[lang](this.fl(e.floor)), true);
        this.ev("floor", `${this.fl(e.floor)} reached — waiting for confirmation`);
        break;
      }
      case "floorConfirmed": {
        this.floorAutoAt = null;
        this.sim.hold(false);
        this.patch({ floorPrompt: null });
        this.toast(e.how === "marker" ? `📍 Lobby marker seen → ${this.fl(e.floor)} confirmed` : `${this.fl(e.floor)} confirmed`);
        this.ev("floor", `${this.fl(e.floor)} confirmed (${e.how === "marker" ? "lobby marker" : "user tap"})`);
        if (e.step.kind !== "arrive") this.say(stepSpeech(e.step, lang, e.remaining));
        break;
      }
      case "arrive":
        this.arrive();
        break;
      case "offRoute":
        this.offRoute(e.distance);
        break;
    }
  }

  /* ------------------------------------------------------------------ map / screens */
  goMap(): void {
    const u = this.st.user;
    this.patch({ screen: "map", mode: "explore", follow: false, overlay: "none", place: null, route: null, options: [], snap: null, viewFloor: u ? u.floor : this.st.viewFloor, arrived: null });
    if (u) this.focusOn({ floor: u.floor, x: u.x, y: u.y, scale: 9.5 });
  }
  private focusOn(f: Omit<MapFocus, "nonce">): void {
    this.patch({ focus: { ...f, nonce: ++this.uid } });
  }
  setViewFloor(id: string): void {
    this.patch({ viewFloor: id, follow: this.st.mode === "nav" ? false : this.st.follow });
  }
  recenter(): void {
    const u = this.st.user;
    if (!u) return;
    this.patch({ follow: true, viewFloor: u.floor });
  }
  /** The user panned/zoomed by hand. */
  onUserMovedMap(): void {
    if (this.st.follow) {
      this.patch({ follow: false });
      if (this.st.mode === "nav") this.toast("Tap ◎ to re-centre");
    }
  }
  locateOnMap(): void {
    const u = this.st.user;
    if (!u) return;
    this.patch({ viewFloor: u.floor });
    this.focusOn({ floor: u.floor, x: u.x, y: u.y, scale: 10 });
  }
  openSearch(seed = "", pickLoc = false): void {
    this.patch({ overlay: "search", searchSeed: seed, pickLoc });
  }
  closeOverlay(): void {
    this.patch({ overlay: "none", pickLoc: false });
  }
  openVoice(): void {
    this.patch({ overlay: "voice", chat: [] });
  }
  /** PDR: open / close the camera sheet to re-anchor on a marker while walking. */
  setScanning(on: boolean): void {
    this.patch({ scanning: on });
  }
  getDebug(): PoseDebug | null {
    return this.sim.getDebug ? this.sim.getDebug() : null;
  }

  /** A newer published venue arrived. Applied at once unless a navigation is running (then when it ends). */
  setVenue(v: Venue): void {
    if (v.version === this.v.version && v.publishedAt === this.v.publishedAt) return;
    if (this.st.mode === "nav" && this.session) {
      this.pendingVenue = v;
      this.toast("Map updated — it will refresh when you finish");
      return;
    }
    this.applyVenue(v);
  }
  private applyVenue(v: Venue): void {
    this.pendingVenue = null;
    this.v = v;
    this.sim.setVenue?.(v);
    this.patch({ venue: v, route: null, options: [], place: null, snap: null, mode: this.st.mode === "nav" ? "explore" : this.st.mode === "preview" ? "explore" : this.st.mode });
    this.ev("venue", `Map updated to version ${v.version}`);
    this.toast(`🗺 Map updated (v${v.version})`);
  }

  showAr(): void {
    for (const fn of this.arOpenListeners) fn();
    this.ev("ar", "AR guidance opened");
    this.patch({ screen: "ar" });
  }
  /** Called synchronously inside the AR-enter gesture (muted videos use this to satisfy autoplay policies). */
  onArOpen(fn: () => void): () => void {
    this.arOpenListeners.add(fn);
    return () => this.arOpenListeners.delete(fn);
  }
  leaveAr(): void {
    this.patch({ screen: this.st.arrived ? "arrived" : "map" });
  }

  recordAdImpression(campaignId: string, brand: string): void {
    this.patch({ impressions: this.st.impressions + 1 });
    this.ev("ad", `Ad impression: ${brand} (${campaignId})`);
    this.publishPose(true);
  }

  recordAdTap(campaignId: string, brand: string): void {
    this.ev("ad", `Ad tapped: ${brand} (${campaignId})`);
  }

  routeToRoom(room: string): void {
    this.leaveAr();
    this.showPlace({ room });
    this.preview();
  }

  /** Camera guidance in one step: route to `t`, start walking, stay in (or go to) the AR view. */
  guideTo(t: Target): void {
    if (!this.fromPose()) {
      this.toast(MSG.needLocation[this.st.lang]());
      return;
    }
    if (this.st.mode === "nav") this.endNav();
    this.showPlace(t);
    this.preview();
    if (this.st.mode === "preview") this.startNav();
    else this.closePlace();
    this.showAr();
  }

  /* ------------------------------------------------------------------ place + preview */
  showPlace(t: Target): void {
    const p = placeOf(this.v, t);
    if (!p) return;
    this.patch({ screen: "map", mode: "place", place: p, route: null, options: [], snap: null, overlay: "none", follow: false, viewFloor: p.floor });
    this.pubRoute(null);
    this.focusOn({ floor: p.floor, x: p.x, y: p.y, scale: 11 });
  }
  closePlace(): void {
    this.patch({ mode: "explore", place: null });
  }
  setAvoidStairs(on: boolean): void {
    this.patch({ prefs: { avoidStairs: on } });
    if (this.st.mode === "preview") this.preview();
  }
  /** Compute the route options for the selected place (stairs vs lift, or the accessible one only). */
  preview(): void {
    const place = this.st.place;
    const from = this.fromPose();
    if (!place || !from) {
      this.toast(MSG.needLocation[this.st.lang]());
      return;
    }
    let opts: Route[];
    if (this.st.prefs.avoidStairs) {
      const r = computeRoute(this.v, from, place.target, { avoidStairs: true });
      if (isRouteError(r)) return this.toast(r.error === "restricted" ? "That area is staff-only" : "No route found");
      opts = [r];
    } else {
      const res = alternatives(this.v, from, place.target, this.st.prefs);
      if (!res.options.length) return this.toast(res.error === "restricted" ? "That area is staff-only" : "No route found");
      opts = res.options;
    }
    this.routeFrom = from;
    this.patch({ mode: "preview", options: opts, optIdx: 0 });
    this.applyOption(0);
    this.ev("route", `Route requested to ${place.name}`);
  }
  applyOption(i: number): void {
    const r = this.st.options[i];
    const u = this.st.user;
    if (!r || !u) return;
    this.patch({ optIdx: i, route: r, follow: false, viewFloor: u.floor, snap: null });
    this.pubRoute(r);
    const pts = r.points.filter((p) => p.floor === u.floor);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    this.focusOn({ floor: u.floor, x: (minX + maxX) / 2, y: (minY + maxY) / 2, fitW: Math.max(8, maxX - minX) + 14, fitH: Math.max(8, maxY - minY) });
  }
  closePreview(): void {
    this.patch({ route: null, options: [], mode: "place" });
    this.pubRoute(null);
    if (this.st.place) this.showPlace(this.st.place.target);
  }
  /** After a manual position change during the preview, recompute from the new position (keeping the option kind). */
  private replanPreview(): void {
    if (this.st.mode === "preview") this.preview();
  }

  /* ------------------------------------------------------------------ navigation */
  startNav(): void {
    let r = this.st.route;
    const u = this.st.user;
    const place = this.st.place;
    if (!r || !u) return;
    // The walker moved since the preview (manual mode, a scan): plan again from where they stand, same kind of route.
    const rf = this.routeFrom;
    if (rf && rf.floor !== undefined && (rf.floor !== u.floor || Math.hypot(rf.x - u.x, rf.y - u.y) > 1) && place) {
      const nr = computeRoute(this.v, { floor: u.floor, x: u.x, y: u.y, heading: u.heading }, place.target, prefsFor(r.via, this.st.prefs));
      if (!isRouteError(nr)) {
        r = nr;
        this.routeFrom = { floor: u.floor, x: u.x, y: u.y, heading: u.heading };
      }
    }
    const created = createSession(r);
    this.session = created.state;
    this.navStartedAt = this.now;
    this.sim.hold(false);
    this.sim.setRoute(r);
    this.pubRoute(r);
    // A local (networked) voice needs a second to make a sentence: prepare the "now" lines of this route so they start at once.
    this.speech.prefetch?.([...r.steps.map((st) => stepSpeech(st, this.st.lang, 0)), arrivedText(r.destName, this.st.lang)], this.st.lang);
    this.patch({ screen: "map", mode: "nav", route: r, snap: snapshot(created.state), follow: true, viewFloor: u.floor, walked: 0, floorPrompt: null, arrived: null });
    this.focusOn({ floor: u.floor, x: u.x, y: u.y, scale: 15 });
    this.ev("nav", `Navigation started → ${r.destName} (${fmtTime(r.time)}, via ${r.via ?? "same floor"})`);
    for (const e of created.events) this.handleEvent(e);
  }

  endNav(): void {
    this.session = null;
    this.floorAutoAt = null;
    this.sim.hold(false);
    this.sim.setRoute(null);
    this.patch({ mode: "explore", route: null, options: [], snap: null, floorPrompt: null, follow: false, place: null, screen: "map" });
    this.pubRoute(null);
    this.ev("nav", "Navigation ended");
    if (this.pendingVenue) this.applyVenue(this.pendingVenue);
    const u = this.st.user;
    if (u) this.focusOn({ floor: u.floor, x: u.x, y: u.y, scale: 9.5 });
  }

  confirmFloor(how: "tap" | "marker"): void {
    const fp = this.st.floorPrompt;
    const u = this.st.user;
    if (!fp || !this.session) return;
    this.floorAutoAt = null;
    if (how === "marker" && u) {
      const nm = nearestMarker(this.v, fp.floor, u.x, u.y, 12);
      if (nm) {
        this.sim.anchor(nm.marker.id); // a marker pose on the new floor: the session confirms from it
        return;
      }
    }
    this.sim.forceFloor?.(fp.floor);
    const res = advance(this.session, { type: "confirmFloor" });
    this.session = res.state;
    this.patch({ snap: snapshot(res.state) });
    for (const e of res.events) this.handleEvent(e);
  }

  /** Demo "Fix position": any marker within 7 m re-anchors (acc 0.3). */
  fixPosition(): void {
    const u = this.st.user;
    if (!u) return;
    const nm = nearestMarker(this.v, u.floor, u.x, u.y, 7);
    if (!nm) return this.toast("No marker nearby — look for a sticker on a wall");
    this.sim.anchor(nm.marker.id);
    this.toast(`✅ ${nm.marker.id} scanned — position fixed (±0.3 m)`);
  }

  private arrive(): void {
    const R = this.session?.route;
    if (!R) return;
    const place = this.st.place;
    this.sim.setRoute(null);
    this.session = null;
    const info: ArrivedInfo = {
      name: R.destName,
      floorName: this.fl(R.destFloor),
      sub: place ? place.sub.split(" · ")[0] ?? "" : "",
      tookSec: (this.now - this.navStartedAt) / 1000,
      walkedM: this.st.walked,
      routeSec: R.time,
      routeWalkM: R.walkDist,
      scans: this.st.scans,
    };
    this.patch({ screen: "arrived", mode: "explore", arrived: info, route: null, floorPrompt: null, follow: false, snap: null });
    this.say(arrivedText(R.destName, this.st.lang), true);
    this.ev("arrive", `Arrived at ${R.destName}`);
    if (this.pendingVenue) this.applyVenue(this.pendingVenue);
    this.publishPose(true, { s: R.total, total: R.total, dest: R.destName });
    this.pubRoute(null);
  }

  private offRoute(distance: number): void {
    const R = this.session?.route;
    const u = this.st.user;
    if (!R || !u) return;
    this.say(MSG.offRoute[this.st.lang](), true);
    this.ev("offroute", Number.isFinite(distance) ? `Off route by ~${Math.round(distance)} m — rerouting to ${R.destName}` : `Off route (wrong floor) — rerouting to ${R.destName}`);
    const target: Target = R.destRoom ? { room: R.destRoom } : this.st.place?.target ?? { room: "" };
    const from: RouteFrom = { floor: u.floor, x: u.x, y: u.y, heading: u.heading };
    const nr = computeRoute(this.v, from, target, prefsFor(R.via, this.st.prefs));
    if (isRouteError(nr)) {
      this.toast("Could not reroute");
      return;
    }
    this.routeFrom = from;
    const res = createSession(nr);
    this.session = res.state;
    this.sim.hold(false);
    this.sim.setRoute(nr);
    this.pubRoute(nr);
    this.patch({ route: nr, snap: snapshot(res.state), floorPrompt: null });
    this.floorAutoAt = null;
    this.toast("✔ New route found");
    this.ev("reroute", `Rerouted — ${fmtTime(nr.time)} remaining`);
    for (const e of res.events) this.handleEvent(e);
  }

  /* ------------------------------------------------------------------ demo helpers */
  /** Jump the walker to route progress s (feeding the session the poses it would have seen, silently). */
  fastForward(s: number): void {
    const sess = this.session;
    const R = sess?.route;
    if (!sess || !R) return;
    let state = sess;
    const feed = (floor: string, x: number, y: number, heading: number) => {
      state = advance(state, { type: "pose", pose: { floor, x, y, heading, acc: 0.3, stale: false, markerId: null, source: "sim" }, tMs: this.now }).state;
    };
    let cur = Math.max(state.s, 0);
    const target = Math.min(s, R.total);
    while (cur < target) {
      cur = Math.min(target, cur + 0.5);
      const pa = pointAt(R, cur);
      if (pa.vertical) {
        const a = R.points[pa.hop]!;
        const b = R.points[pa.hop + 1]!;
        feed(a.floor, a.x, a.y, pa.bearing);
        feed(b.floor, b.x, b.y, pa.bearing);
        state = advance(state, { type: "confirmFloor" }).state;
        cur = Math.max(cur, (R.cum[pa.hop + 1] as number) + 0.01);
        continue;
      }
      feed(pa.floor, pa.x, pa.y, pa.bearing);
    }
    this.session = state;
    this.floorAutoAt = null;
    this.sim.hold(false);
    this.sim.setProgress(state.s);
    this.patch({ snap: snapshot(state), floorPrompt: null, viewFloor: this.st.user?.floor ?? this.st.viewFloor });
  }
  /** Demo "next turn": skip ahead to 5 m before the next manoeuvre. */
  nextTurn(): void {
    const sess = this.session;
    if (this.st.mode !== "nav" || !sess) return this.toast("Start navigation first");
    const nx = nextStep(sess.route, sess.s);
    if (nx.step.sAt - 5 > sess.s) this.fastForward(nx.step.sAt - 5);
  }
  wrongTurn(): void {
    if (this.st.mode !== "nav" || !this.session) return this.toast("Start navigation first");
    if (!this.sim.wrongTurn()) this.toast("Wrong-turn demo works while walking a corridor");
  }
  loseTracking(): void {
    this.sim.loseTracking(5);
    this.toast("📡 Tracking lost for 5 s — drift grows; scan a marker to fix");
    this.ev("tracking", "Tracking lost (simulated)");
  }

  /* ------------------------------------------------------------------ voice in */
  async askText(text: string): Promise<void> {
    const t = text.trim();
    if (!t) return;
    this.patch({ chat: [...this.st.chat, { me: true, text: t }] });
    const from = this.fromPose();
    const res = await this.resolver.resolve(t, { venue: this.v, from, prefs: this.st.prefs, lang: this.st.lang });
    this.ev("voice", `Voice: “${t}” → ${res.type}${"name" in res && res.name ? " · " + res.name : ""}`);
    const reply = this.applyIntent(res, !!from);
    this.later(350, () => {
      this.patch({ chat: [...this.st.chat, { me: false, text: reply }] });
      this.say(reply);
    });
  }

  /** Push-to-talk barge-in: voice input always wins over queued/current TTS. */
  cancelSpeech(): void {
    this.speech.cancel();
  }

  private applyIntent(res: Intent, located: boolean): string {
    const lang = this.st.lang;
    switch (res.type) {
      case "answer":
        return res.text;
      case "goto": {
        const from = this.fromPose();
        if (!from) return MSG.needLocation[lang]();
        const rr = computeRoute(this.v, from, res.target, this.st.prefs);
        if (isRouteError(rr)) return rr.error === "restricted" ? MSG.restricted[lang](rr.name ?? res.name) : MSG.noRoute[lang]();
        // Asked from the camera view: skip the map preview and start guiding right there.
        const inAr = this.st.screen === "ar";
        this.later(inAr ? 900 : 1500, () => {
          this.closeOverlay();
          if (inAr) return this.guideTo(res.target);
          if (this.st.mode === "nav") this.endNav();
          this.showPlace(res.target);
          this.preview();
        });
        return MSG.goto[lang](res.name);
      }
      case "show": {
        const p = placeOf(this.v, res.target);
        const from = this.fromPose();
        if (!from) return MSG.needLocation[lang]();
        const r = p ? computeRoute(this.v, from, res.target, this.st.prefs) : null;
        this.later(1800, () => {
          this.closeOverlay();
          this.showPlace(res.target);
        });
        return p ? MSG.show[lang](p.name, this.fl(p.floor), r && !isRouteError(r) ? fmtTime(r.time) : "—") : MSG.unknown[lang]();
      }
      case "whereami": {
        const u = this.st.user;
        return located && u ? MSG.where[lang](this.fl(u.floor), nearName(this.v, u)) : MSG.needLocation[lang]();
      }
      case "repeat": {
        const sess = this.session;
        if (!sess) return MSG.unknown[lang]();
        const nx = nextStep(sess.route, sess.s);
        return stepSpeech(nx.step, lang, nx.remaining);
      }
      case "stop":
        if (this.st.mode === "nav") {
          this.later(900, () => {
            this.closeOverlay();
            this.endNav();
          });
        }
        return MSG.stop[lang]();
      case "pref":
        this.patch({ prefs: { avoidStairs: true } });
        if (this.st.mode === "preview") this.preview();
        return MSG.pref[lang]();
      case "switch":
        if (res.view === "ar") {
          this.later(250, () => {
            this.closeOverlay();
            this.showAr();
          });
          return MSG.ar[lang]();
        }
        this.later(250, () => {
          this.closeOverlay();
          this.leaveAr();
        });
        return MSG.map[lang]();
      case "howlong": {
        const eta = this.st.snap?.etaSec;
        return eta == null ? MSG.noEta[lang]() : MSG.eta[lang](fmtTime(eta));
      }
      default:
        return MSG.unknown[lang]();
    }
  }

  examples(): string[] {
    return EXAMPLES[this.st.lang];
  }

  /* ------------------------------------------------------------------ deep links (mock autoState) */
  /** #map #search #voice #place #preview #nav #navf2 (#arturn #arad #arf2 -> AR stub). Starts from marker 1. */
  applyHash(hash: string): void {
    const h = hash.replace(/^#/, "");
    if (!h) return;
    this.scanMarker(1, true);
    if (h === "map") return;
    if (h === "search") return this.openSearch("can");
    if (h === "voice") {
      this.openVoice();
      this.later(100, () => void this.askText("Cafeteria kahan hai?"));
      return;
    }
    this.showPlace({ room: "F2-cafeteria" });
    if (h === "place") return;
    this.preview();
    if (h === "preview") return;
    this.startNav();
    if (h === "nav") return this.fastForward(6);
    if (h === "navf2") return this.fastForward(40);
    if (h.startsWith("ar")) {
      this.fastForward(h === "arturn" ? 6 : h === "arad" ? 4 : h === "arf2" ? 50 : 1);
      this.sim.pause();
      this.showAr();
    }
  }

  /* ------------------------------------------------------------------ bus */
  private pubRoute(r: Route | null): void {
    const payload: RoutePayload | null =
      r && this.routeFrom && this.st.place
        ? { id: ++this.routeId, from: this.routeFrom, target: this.st.place.target, via: r.via, destName: r.destName }
        : r && this.routeFrom
          ? { id: ++this.routeId, from: this.routeFrom, target: r.destRoom ? { room: r.destRoom } : { room: "" }, via: r.via, destName: r.destName }
          : null;
    this.bus.send("route", payload);
  }

  private publishPose(force = false, final?: { s: number; total: number; dest: string }): void {
    const u = this.st.user;
    if (!u) return;
    if (!force && this.now - this.lastBus < BUS_POSE_MS) return;
    this.lastBus = this.now;
    const snap = this.st.snap;
    const navigating = this.st.mode === "nav" && !!snap;
    const R = this.session?.route ?? null;
    const payload: PosePayload = {
      t: Date.now(),
      screen: this.st.screen,
      mode: this.st.mode,
      ar: this.st.screen === "ar",
      user: { floor: u.floor, x: u.x, y: u.y, heading: u.heading, acc: u.acc, stale: u.stale, markerId: u.markerId, source: u.source, anchorAgoSec: this.lastAnchorAt === null ? null : Math.max(0, (Date.now() - this.lastAnchorAt) / 1000) },
      s: final ? final.s : navigating ? snap.s : 0,
      total: final ? final.total : R ? R.total : 0,
      next: navigating ? stepAction(snap.next.step, this.st.lang) : null,
      nextDist: navigating ? Math.round(snap.next.remaining) : null,
      eta: navigating ? snap.etaSec : null,
      dest: final ? final.dest : R ? R.destName : null,
      lang: this.st.lang,
      scans: this.st.scans,
      impressions: this.st.impressions,
      walked: this.st.walked,
      playing: this.st.sim.playing,
      trans: this.st.sim.trans ? this.st.sim.trans.via : null,
      venue: this.v.name,
    };
    this.bus.send("pose", payload);
  }

  /** Demo reset: return the visitor state to a clean launch and tell the dashboard the route is gone. */
  resetDemo(): void {
    this.pubRoute(null);
    this.speech.cancel();
    this.sim.pause();
    this.session = null;
    this.routeFrom = null;
    this.timers = [];
    this.lastPose = null;
    this.located = false;
    this.lastAnchorAt = null;
    this.patch({
      screen: "city", mode: "explore", overlay: "none", located: false, user: null, follow: false, place: null,
      options: [], optIdx: 0, route: null, snap: null, scanning: false, floorPrompt: null, chat: [], caption: null,
      toast: { id: ++this.uid, text: "Demo reset" }, arrived: null, scans: 0, impressions: 0, walked: 0,
      prefs: { avoidStairs: false }, sim: this.sim.getStatus(),
    });
  }
}
