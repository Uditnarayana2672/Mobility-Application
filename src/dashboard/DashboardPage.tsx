import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BroadcastChannelBus, LOCAL_DEVICE, WebSocketBus, type BusMeta, type ChangeNotice, type EventPayload, type PosePayload, type RoutePayload, type WsStatus } from "@/bus";
import { fmtTime, stepAction } from "@/core/instructions";
import { nextStep, pointAt, remainingSec } from "@/core/playback";
import { poseFromMarker } from "@/core/poseFromMarker";
import { isRouteError, route as computeRoute, type Route, type RoutePrefs } from "@/core/route";
import type { Venue } from "@/core/schema";
import { useVenue } from "@/shared/useVenue";
import { MapCanvas, type UserPose } from "@/ui/map";
import "./dashboard.css";

const LIVE_MS = 2500;
const SOURCE_BADGE: Record<string, string> = { sim: "SIM", marker: "MARKER", manual: "MANUAL", ar: "XR", steps: "PDR", vision: "SIGHT" };
const deviceName = (id: string) => (id === LOCAL_DEVICE ? "simulated phone" : id);
const MAX_EVENTS = 60;
const MAX_TRAIL = 400;
const LANG_NAME: Record<string, string> = { en: "EN", hi: "Hinglish", te: "తెలుగు" };

type TrailPt = { floor: string; x: number; y: number };
type LogEvent = EventPayload & { id: number; device: string };
interface RecordedLine {
  recvT: number;
  msg: { type: string; payload: unknown };
}
interface DeviceState {
  pose: PosePayload;
  route: RoutePayload | null;
  lastAt: number;
}

/** Same via -> preference mapping the phone used, so the dashboard re-computes the identical route. */
export const prefsForVia = (via: RoutePayload["via"]): Partial<RoutePrefs> => (via === "lift" ? { avoidStairs: true } : via === "stairs" ? { avoidLifts: true } : {});

export function routeFromPayload(v: Venue, msg: RoutePayload): Route | null {
  const r = computeRoute(v, msg.from, msg.target, prefsForVia(msg.via));
  return isRouteError(r) ? null : r;
}

function Dash({ venue }: { venue: Venue }) {
  const bc = useMemo(() => new BroadcastChannelBus(), []);
  const ws = useMemo(() => new WebSocketBus({ room: venue.id, role: "viewer" }), [venue.id]);
  const [pose, setPose] = useState<PosePayload | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [trail, setTrail] = useState<TrailPt[]>([]);
  const [viewFloor, setViewFloor] = useState(venue.floors[0]?.id ?? "");
  const [follow, setFollow] = useState(true);
  const [showTrail, setShowTrail] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [demoNote, setDemoNote] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [deviceIds, setDeviceIds] = useState<string[]>([]);
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  const [notice, setNotice] = useState<ChangeNotice | null>(null);
  const [replay, setReplay] = useState<{ note: string; playing: boolean } | null>(null);
  const [anchorAt, setAnchorAt] = useState<number | null>(null);
  const [, force] = useState(0);
  const routeKey = useRef<string | null>(null);
  const demoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const evId = useRef(0);
  const followRef = useRef(follow);
  followRef.current = follow;
  const lastPoseAt = useRef(0);
  const devices = useRef(new Map<string, DeviceState>());
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  const replayTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const replayingRef = useRef(false);

  const clearDashboard = useCallback(() => {
    if (demoTimer.current) clearInterval(demoTimer.current);
    demoTimer.current = null;
    replayTimers.current.forEach(clearTimeout);
    replayTimers.current = [];
    replayingRef.current = false;
    devices.current.clear();
    selectedRef.current = null;
    routeKey.current = null;
    bc.clearSnapshot();
    setPose(null); setRoute(null); setEvents([]); setTrail([]); setSelected(null); setDeviceIds([]);
    setReplay(null); setDemoMode(false); setDemoNote("Demo reset"); setAnchorAt(null);
  }, [bc]);

  const fl = (id: string) => venue.floors.find((f) => f.id === id)?.name ?? id;

  const applyRoute = useCallback(
    (msg: RoutePayload | null) => {
      if (!msg) {
        routeKey.current = null;
        setRoute(null);
        return;
      }
      const key = JSON.stringify([msg.from, msg.target, msg.via]);
      if (key === routeKey.current) return;
      routeKey.current = key;
      const r = routeFromPayload(venue, msg);
      if (r) {
        setRoute(r);
        setTrail([]);
      }
    },
    [venue],
  );

  const applyPose = useCallback((p: PosePayload, at: number) => {
    lastPoseAt.current = at;
    setPose(p);
    const u = p.user;
    if (!u) return;
    setAnchorAt(u.anchorAgoSec === null || u.anchorAgoSec === undefined ? null : at - u.anchorAgoSec * 1000);
    if (followRef.current) setViewFloor((f) => (f === u.floor ? f : u.floor));
    setTrail((tr) => {
      const t = tr[tr.length - 1];
      if (t && t.floor === u.floor && Math.hypot(t.x - u.x, t.y - u.y) <= 0.6) return tr;
      const next = [...tr, { floor: u.floor, x: u.x, y: u.y }];
      return next.length > MAX_TRAIL ? next.slice(next.length - MAX_TRAIL) : next;
    });
  }, []);

  const applyEvent = useCallback((e: EventPayload, device = "") => {
    setEvents((list) => [{ ...e, id: ++evId.current, device }, ...list].slice(0, MAX_EVENTS));
  }, []);

  /** Switch the view to another phone: reset the trail and show its last known pose + route. */
  const selectDevice = useCallback(
    (id: string) => {
      setSelected(id);
      selectedRef.current = id;
      setTrail([]);
      routeKey.current = null;
      const d = devices.current.get(id);
      applyRoute(d?.route ?? null);
      if (d) applyPose(d.pose, d.lastAt);
    },
    [applyPose, applyRoute],
  );

  // Messages from the bus: remember per phone (keyed by deviceId), show the selected one.
  const onBusPose = useCallback(
    (p: PosePayload, meta: BusMeta) => {
      if (replayingRef.current) return;
      const prev = devices.current.get(meta.deviceId);
      devices.current.set(meta.deviceId, { pose: p, route: prev?.route ?? null, lastAt: meta.recvT });
      setDeviceIds((ids) => (ids.includes(meta.deviceId) ? ids : [...ids, meta.deviceId]));
      if (selectedRef.current === null) {
        selectedRef.current = meta.deviceId;
        setSelected(meta.deviceId);
      }
      if (selectedRef.current === meta.deviceId) applyPose(p, meta.recvT);
    },
    [applyPose],
  );
  const onBusRoute = useCallback(
    (r: RoutePayload | null, meta: BusMeta) => {
      if (replayingRef.current) return;
      const prev = devices.current.get(meta.deviceId);
      if (prev) devices.current.set(meta.deviceId, { ...prev, route: r });
      else {
        const blank: PosePayload = { t: 0, screen: "map", mode: "explore", ar: false, user: null, s: 0, total: 0, next: null, nextDist: null, eta: null, dest: null, lang: "en", scans: 0, impressions: 0, walked: 0, playing: false, trans: null, venue: "" };
        devices.current.set(meta.deviceId, { pose: blank, route: r, lastAt: 0 });
        setDeviceIds((ids) => (ids.includes(meta.deviceId) ? ids : [...ids, meta.deviceId]));
      }
      if (selectedRef.current === null) {
        selectedRef.current = meta.deviceId;
        setSelected(meta.deviceId);
      }
      if (selectedRef.current === meta.deviceId) applyRoute(r);
    },
    [applyRoute],
  );
  const onBusEvent = useCallback(
    (e: EventPayload, meta: BusMeta) => {
      if (replayingRef.current) return;
      applyEvent(e, meta.deviceId);
    },
    [applyEvent],
  );

  useEffect(() => {
    const offs: (() => void)[] = [];
    for (const bus of [bc, ws]) offs.push(bus.on("pose", onBusPose), bus.on("route", onBusRoute), bus.on("event", onBusEvent), bus.on("venue", (n) => setNotice(n)), bus.on("reset", (n) => { if (n.venue === venue.id) clearDashboard(); }));
    offs.push(ws.onStatus(setWsStatus));
    setWsStatus(ws.status);
    // Hydrate from whatever the same-browser phone view last wrote (a dashboard opened late still shows the walk so far).
    const snap = bc.snapshot();
    const now = Date.now();
    if (snap.route) onBusRoute(snap.route, { deviceId: LOCAL_DEVICE, recvT: now });
    if (snap.pose) onBusPose(snap.pose, { deviceId: LOCAL_DEVICE, recvT: now - Math.max(0, now - snap.pose.t) });
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => {
      offs.forEach((o) => o());
      clearInterval(t);
      bc.close();
      ws.close();
      if (demoTimer.current) clearInterval(demoTimer.current);
      replayTimers.current.forEach(clearTimeout);
    };
  }, [bc, ws, onBusPose, onBusRoute, onBusEvent, clearDashboard, venue.id]);

  const resetAll = async () => {
    clearDashboard();
    try { await fetch(`/api/demo/reset/${encodeURIComponent(venue.id)}`, { method: "POST" }); } catch { /* local dashboard is still reset */ }
  };

  const stopReplay = useCallback(() => {
    replayTimers.current.forEach(clearTimeout);
    replayTimers.current = [];
    replayingRef.current = false;
    setReplay(null);
  }, []);

  /** "Replay last walk": the server's JSONL recording of the latest phone session, played back with its original timing. */
  const startReplay = async (speed = 1) => {
    stopReplay();
    setReplay({ note: "Loading the recording…", playing: false });
    let rec: { file: string; device: string; startedAt: string; lines: RecordedLine[] };
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(venue.id)}/last`, { cache: "no-store" });
      if (!res.ok) {
        setReplay({ note: "No recorded walk yet — walk with a phone first.", playing: false });
        return;
      }
      rec = (await res.json()) as typeof rec;
    } catch {
      setReplay({ note: "Could not load the recording.", playing: false });
      return;
    }
    const lines = rec.lines.filter((l) => l?.msg && (l.msg.type === "pose" || l.msg.type === "route" || l.msg.type === "event"));
    if (!lines.length) {
      setReplay({ note: "The recording is empty.", playing: false });
      return;
    }
    replayingRef.current = true;
    setTrail([]);
    routeKey.current = null;
    setEvents([]);
    const t0 = lines[0]!.recvT;
    const end = (lines[lines.length - 1]!.recvT - t0) / speed;
    setReplay({ note: `Replaying ${rec.device} · ${new Date(rec.startedAt).toLocaleTimeString()} · ${Math.round(end / 1000)} s`, playing: true });
    for (const l of lines) {
      const delay = (l.recvT - t0) / speed;
      replayTimers.current.push(
        setTimeout(() => {
          const now = Date.now();
          if (l.msg.type === "pose") applyPose(l.msg.payload as PosePayload, now);
          else if (l.msg.type === "route") applyRoute(l.msg.payload as RoutePayload | null);
          else applyEvent({ ...(l.msg.payload as EventPayload), at: now }, rec.device);
        }, delay),
      );
    }
    replayTimers.current.push(
      setTimeout(() => {
        replayingRef.current = false;
        replayTimers.current = [];
        setReplay({ note: "Replay finished", playing: false });
      }, end + 400),
    );
  };

  // Built-in demo feed: replays marker 1 -> cafeteria with the same engine, through the same handlers (no phone needed).
  const startDemoFeed = () => {
    if (demoTimer.current) return;
    const m = venue.markers[0];
    const r0 = m ? poseFromMarker(m) : null;
    if (!m || !r0) return;
    const from = { floor: r0.floor, x: r0.x, y: r0.y, heading: r0.heading };
    const target = { room: "F2-cafeteria" };
    const r = computeRoute(venue, from, target, { avoidLifts: true });
    if (isRouteError(r)) {
      setDemoNote("The demo feed needs the Cafeteria on Floor 2 (not in this venue).");
      return;
    }
    setDemoMode(true);
    setDemoNote("");
    applyRoute({ id: 0, from, target, via: r.via, destName: r.destName });
    applyEvent({ kind: "scan", text: `Marker ${m.id} scanned — ${m.name}`, at: Date.now() });
    applyEvent({ kind: "nav", text: `Navigation started → ${r.destName}`, at: Date.now() });
    let s = 0;
    let scans = 1;
    let hold = 0;
    let prevFloor = from.floor;
    let last = performance.now();
    const u = { ...from, acc: 0.3, stale: false, markerId: m.id as number | null };
    demoTimer.current = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(1, (now - last) / 1000);
      last = now;
      if (hold > 0) hold -= dt;
      else s = Math.min(r.total, s + 1.3 * 3 * dt);
      const pa = pointAt(r, s);
      if (pa.vertical) {
        hold = 0;
        s = Math.min(r.total, s + 0.4);
      }
      u.x = pa.x;
      u.y = pa.y;
      u.floor = pa.floor;
      u.heading = pa.bearing;
      u.acc = Math.min(2.8, 0.3 + 0.05 * (s % 20));
      if (pa.floor !== prevFloor) {
        applyEvent({ kind: "floor", text: `${fl(pa.floor)} confirmed (lobby marker)`, at: Date.now() });
        prevFloor = pa.floor;
        scans++;
      }
      const nx = nextStep(r, s);
      applyPose({
        t: Date.now(), screen: "map", mode: "nav", ar: false, user: { ...u }, s, total: r.total,
        next: stepAction(nx.step, "en"), nextDist: Math.round(nx.remaining), eta: remainingSec(r, s), dest: r.destName, lang: "en",
        scans, impressions: 0, walked: s, playing: true, trans: pa.vertical ? pa.vertical.via : null, venue: venue.name,
      }, Date.now());
      if (s >= r.total - 0.05) {
        applyEvent({ kind: "arrive", text: `Arrived at ${r.destName}`, at: Date.now() });
        if (demoTimer.current) clearInterval(demoTimer.current);
        demoTimer.current = null;
        setTimeout(() => {
          setDemoMode(false);
          setDemoNote("Demo feed finished");
        }, 800);
      }
    }, 60);
  };

  const age = pose ? Date.now() - lastPoseAt.current : Infinity;
  const replaying = replay?.playing ?? false;
  const live = demoMode || replaying || age < LIVE_MS;
  const connText = demoMode ? "Live — built-in demo feed" : replaying ? "Replaying a recorded walk" : live ? "Live — phone connected" : pose ? `Phone offline (last seen ${Math.round(age / 1000)} s ago)` : demoNote || "Waiting for a phone…";
  const u = pose?.user ?? null;
  const userPose: UserPose | null = u ? { floor: u.floor, x: u.x, y: u.y, heading: u.heading, acc: u.acc, stale: u.stale } : null;
  const trailPts = showTrail ? trail.filter((t) => t.floor === viewFloor) : [];
  const trailD = trailPts.length > 1 ? trailPts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ") : "";
  const pct = pose && pose.total ? Math.min(100, (pose.s / pose.total) * 100) : 0;
  const mode = !pose ? "—" : pose.ar ? "AR tracking" : pose.mode === "nav" ? "2D map (nav)" : pose.screen;
  const source = u?.source ?? null;
  const anchorAge = anchorAt === null ? null : Math.max(0, Math.round((Date.now() - anchorAt) / 1000));
  const adTaps = events.filter((e) => e.kind === "ad" && e.text.startsWith("Ad tapped:")).length;

  return (
    <div className="is-dash" data-testid="dash-root">
      <div className="topbar">
        <Link className="brand" to="/"><i />Dora.AI</Link>
        <Link className="nav" to="/nav">Visitor app</Link>
        <Link className="nav" to="/editor">Map editor</Link>
        <Link className="nav" to="/markers">Marker sheet</Link>
        <Link className="nav on" to="/dashboard">Live dashboard</Link>
        <div className="right">{venue.name} v{venue.version}</div>
      </div>
      <div className="dash">
        <div className="mapcol">
          <MapCanvas
            venue={venue}
            floorId={viewFloor}
            layers={{ markers: showMarkers, pois: true }}
            route={route}
            progress={pose?.s ?? 0}
            user={userPose}
            minScale={3}
            maxScale={30}
          >
            {trailD ? <path data-testid="trail" d={trailD} fill="none" stroke="#e8453c" strokeWidth={3} strokeDasharray="2 6" strokeLinecap="round" vectorEffect="non-scaling-stroke" /> : null}
          </MapCanvas>
          <div className="topleft">
            <span className={`status ${live ? "live" : pose ? "stale" : ""}`} data-testid="conn"><i /><span data-testid="conn-text">{connText}</span></span>
            <span className="status" data-testid="ws-status" data-status={wsStatus}>server link: {wsStatus}</span>
            {source && <span className="status" data-testid="source-badge" data-source={source}><b>{SOURCE_BADGE[source] ?? source}</b></span>}
            {deviceIds.length > 1 && (
              <select className="status" data-testid="device-select" value={selected ?? ""} onChange={(e) => selectDevice(e.target.value)}>
                {deviceIds.map((id) => <option key={id} value={id}>{deviceName(id)}</option>)}
              </select>
            )}
            <div className="seg" data-testid="floor-seg">
              {venue.floors.map((f) => (
                <button key={f.id} className={viewFloor === f.id ? "on" : ""} onClick={() => { setFollow(false); setViewFloor(f.id); }}>{f.name}</button>
              ))}
            </div>
            <label className="status"><input type="checkbox" data-testid="follow" checked={follow} onChange={(e) => { setFollow(e.target.checked); if (e.target.checked && u) setViewFloor(u.floor); }} /> Follow phone</label>
            <label className="status"><input type="checkbox" data-testid="trail-chk" checked={showTrail} onChange={(e) => setShowTrail(e.target.checked)} /> Trail</label>
            <label className="status"><input type="checkbox" data-testid="markers-chk" checked={showMarkers} onChange={(e) => setShowMarkers(e.target.checked)} /> Markers</label>
          </div>
        </div>
        <div className="panel">
          <div className="row" style={{ marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Live tracking</h3>
            <span className="spacer" />
            <button className="btn" data-testid="dashboard-reset" onClick={() => void resetAll()}>Reset demo</button>
            <button className="btn primary" onClick={() => window.open("/nav?demo=1", "is-phone", "width=1000,height=900")}>📱 Open phone view ↗</button>
          </div>
          {!live && (
            <div className="card flat" data-testid="no-phone" style={{ marginBottom: 12, background: "#fff8e6", borderColor: "#f6d98a" }}>
              <b>No phone connected</b>
              <p className="small" style={{ margin: "4px 0 8px" }}>Open the visitor app on a phone (same Wi-Fi, <code>npm run dev:lan</code>) and this screen mirrors it live over WebSocket. A simulated phone in another tab of this browser works too.</p>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn" data-testid="demo-feed" onClick={startDemoFeed}>▶ Start built-in demo feed</button>
                <button className="btn" data-testid="replay-btn" onClick={() => void startReplay(1)}>⏪ Replay last walk</button>
              </div>
            </div>
          )}
          {replay && (
            <div className="card flat" data-testid="replay-bar" style={{ marginBottom: 12 }}>
              <span className="small" data-testid="replay-note">{replay.note}</span>
              {replay.playing && <button className="btn" style={{ marginLeft: 8 }} data-testid="replay-stop" onClick={stopReplay}>Stop</button>}
            </div>
          )}
          {live && !replaying && !demoMode && (
            <div className="row" style={{ marginBottom: 10 }}>
              <button className="btn" data-testid="replay-btn-live" onClick={() => void startReplay(1)}>⏪ Replay last walk</button>
            </div>
          )}
          {notice && (
            <div className="card flat" data-testid="notice" style={{ marginBottom: 12, background: "#eaf6ff" }}>
              <span className="small">Map v{notice.version} was published.</span>
              <button className="btn" style={{ marginLeft: 8 }} onClick={() => window.location.reload()}>Reload</button>
            </div>
          )}
          <div className="grid2" style={{ marginBottom: 12 }}>
            <div className="stat"><b data-testid="s-floor">{u ? fl(u.floor) : "—"}</b><span>Floor</span></div>
            <div className="stat"><b>{u ? `${u.x.toFixed(1)}, ${u.y.toFixed(1)}` : "—"}</b><span>Position (m)</span></div>
            <div className="stat"><b>{u ? (u.stale ? "lost" : `±${u.acc.toFixed(1)} m`) : "—"}</b><span>Accuracy</span></div>
            <div className="stat"><b>{u ? `${Math.round(u.heading)}°` : "—"}</b><span>Heading</span></div>
            <div className="stat"><b>{mode}</b><span>Phone mode</span></div>
            <div className="stat"><b data-testid="s-anchor">{u && u.markerId !== null ? `#${u.markerId}` : "—"}{anchorAge !== null ? ` · ${anchorAge}s ago` : ""}</b><span>Last anchor</span></div>
            <div className="stat"><b data-testid="s-source">{source ? SOURCE_BADGE[source] ?? source : "—"}</b><span>Position source</span></div>
          </div>
          <div className="card flat" style={{ marginBottom: 12 }}>
            <h4>Route</h4>
            <div style={{ fontWeight: 800, fontSize: 16 }} data-testid="r-dest">{route ? `→ ${route.destName}  (${route.via ? `via ${route.via}` : "same floor"})` : "No active route"}</div>
            <div className="pbar"><i data-testid="r-bar" data-pct={pct.toFixed(0)} style={{ width: `${pct}%` }} /></div>
            <div className="row small">
              <span className="muted" data-testid="r-prog">{pose && pose.total ? `${Math.round(pose.s)} / ${Math.round(pose.total)} m${pose.trans ? ` · on ${pose.trans}` : ""}` : "—"}</span>
              <span className="spacer" />
              <span style={{ fontWeight: 700 }}>{pose && pose.total && pose.eta != null ? `ETA ${fmtTime(pose.eta)}` : ""}</span>
            </div>
            <div className="small" style={{ marginTop: 6 }} data-testid="r-next">{pose && pose.total && pose.next ? <>Next: <b>{pose.next}</b>{pose.nextDist != null ? ` in ${pose.nextDist} m` : ""}</> : null}</div>
          </div>
          <div className="grid2" style={{ marginBottom: 12 }}>
            <div className="stat"><b>{Math.round(pose?.walked ?? 0)} m</b><span>walked this session</span></div>
            <div className="stat"><b data-testid="k-scan">{pose?.scans ?? 0}</b><span>marker scans</span></div>
            <div className="stat"><b data-testid="k-ad-impressions">{pose?.impressions ?? 0}</b><span>ad impressions</span></div>
            <div className="stat"><b data-testid="k-ad-taps">{adTaps}</b><span>ad taps</span></div>
            <div className="stat"><b>{pose ? (LANG_NAME[pose.lang] ?? pose.lang) : "—"}</b><span>voice language</span></div>
          </div>
          <h4>Event log</h4>
          <div data-testid="log">
            {events.map((e) => (
              <div className="ev" key={e.id}>
                <time>{new Date(e.at).toLocaleTimeString()}</time>
                <span className={`tag ${e.kind}`}>{e.kind}</span>
                <span>{deviceIds.length > 1 && e.device ? `[${deviceName(e.device)}] ` : ""}{e.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const v = useVenue();
  if (v.status === "loading") return <div className="p-6 text-neutral-500">Loading the map…</div>;
  if (v.status === "missing") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-bold">Venue “{v.id}” not found</h1>
        <Link to="/" className="text-blue-600 underline">back to hub</Link>
      </div>
    );
  }
  return <Dash venue={v.venue} />;
}
