import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BroadcastChannelBus, type EventPayload, type PosePayload, type RoutePayload } from "@/bus";
import { fmtTime, stepAction } from "@/core/instructions";
import { nextStep, pointAt, remainingSec } from "@/core/playback";
import { poseFromMarker } from "@/core/poseFromMarker";
import { isRouteError, route as computeRoute, type Route, type RoutePrefs } from "@/core/route";
import type { Venue } from "@/core/schema";
import { useVenue } from "@/shared/useVenue";
import { MapCanvas, type UserPose } from "@/ui/map";
import "./dashboard.css";

const LIVE_MS = 2500;
const MAX_EVENTS = 60;
const MAX_TRAIL = 400;
const LANG_NAME: Record<string, string> = { en: "EN", hi: "Hinglish", te: "తెలుగు" };

type TrailPt = { floor: string; x: number; y: number };
type LogEvent = EventPayload & { id: number };

/** Same via -> preference mapping the phone used, so the dashboard re-computes the identical route. */
export const prefsForVia = (via: RoutePayload["via"]): Partial<RoutePrefs> => (via === "lift" ? { avoidStairs: true } : via === "stairs" ? { avoidLifts: true } : {});

export function routeFromPayload(v: Venue, msg: RoutePayload): Route | null {
  const r = computeRoute(v, msg.from, msg.target, prefsForVia(msg.via));
  return isRouteError(r) ? null : r;
}

function Dash({ venue }: { venue: Venue }) {
  const bus = useMemo(() => new BroadcastChannelBus(), []);
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
  const [, force] = useState(0);
  const routeKey = useRef<string | null>(null);
  const demoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const evId = useRef(0);
  const followRef = useRef(follow);
  followRef.current = follow;
  const lastPoseAt = useRef(0);

  const fl = (id: string) => venue.floors.find((f) => f.id === id)?.name ?? id;

  const onRoute = useCallback(
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

  const onPose = useCallback((p: PosePayload) => {
    lastPoseAt.current = Date.now();
    setPose(p);
    const u = p.user;
    if (!u) return;
    if (followRef.current) setViewFloor((f) => (f === u.floor ? f : u.floor));
    setTrail((tr) => {
      const t = tr[tr.length - 1];
      if (t && t.floor === u.floor && Math.hypot(t.x - u.x, t.y - u.y) <= 0.6) return tr;
      const next = [...tr, { floor: u.floor, x: u.x, y: u.y }];
      return next.length > MAX_TRAIL ? next.slice(next.length - MAX_TRAIL) : next;
    });
  }, []);

  const onEvent = useCallback((e: EventPayload) => {
    setEvents((list) => [{ ...e, id: ++evId.current }, ...list].slice(0, MAX_EVENTS));
  }, []);

  useEffect(() => {
    const offs = [bus.on("pose", onPose), bus.on("route", onRoute), bus.on("event", onEvent)];
    // Hydrate from whatever the phone view last wrote (a dashboard opened late still shows the walk so far).
    const snap = bus.snapshot();
    if (snap.route) onRoute(snap.route);
    if (snap.pose) onPose(snap.pose);
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => {
      offs.forEach((o) => o());
      clearInterval(t);
      bus.close();
      if (demoTimer.current) clearInterval(demoTimer.current);
    };
  }, [bus, onPose, onRoute, onEvent]);

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
    onRoute({ id: 0, from, target, via: r.via, destName: r.destName });
    onEvent({ kind: "scan", text: `Marker ${m.id} scanned — ${m.name}`, at: Date.now() });
    onEvent({ kind: "nav", text: `Navigation started → ${r.destName}`, at: Date.now() });
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
        onEvent({ kind: "floor", text: `${fl(pa.floor)} confirmed (lobby marker)`, at: Date.now() });
        prevFloor = pa.floor;
        scans++;
      }
      const nx = nextStep(r, s);
      onPose({
        t: Date.now(), screen: "map", mode: "nav", ar: false, user: { ...u }, s, total: r.total,
        next: stepAction(nx.step, "en"), nextDist: Math.round(nx.remaining), eta: remainingSec(r, s), dest: r.destName, lang: "en",
        scans, impressions: 0, walked: s, playing: true, trans: pa.vertical ? pa.vertical.via : null, venue: venue.name,
      });
      if (s >= r.total - 0.05) {
        onEvent({ kind: "arrive", text: `Arrived at ${r.destName}`, at: Date.now() });
        if (demoTimer.current) clearInterval(demoTimer.current);
        demoTimer.current = null;
        setTimeout(() => {
          setDemoMode(false);
          setDemoNote("Demo feed finished");
        }, 800);
      }
    }, 60);
  };

  const age = pose ? Date.now() - pose.t : Infinity;
  const live = demoMode || age < LIVE_MS;
  const connText = demoMode ? "Live — built-in demo feed" : live ? "Live — phone connected" : pose ? `Phone offline (last seen ${Math.round(age / 1000)} s ago)` : demoNote || "Waiting for a phone…";
  const u = pose?.user ?? null;
  const userPose: UserPose | null = u ? { floor: u.floor, x: u.x, y: u.y, heading: u.heading, acc: u.acc, stale: u.stale } : null;
  const trailPts = showTrail ? trail.filter((t) => t.floor === viewFloor) : [];
  const trailD = trailPts.length > 1 ? trailPts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ") : "";
  const pct = pose && pose.total ? Math.min(100, (pose.s / pose.total) * 100) : 0;
  const mode = !pose ? "—" : pose.ar ? "AR camera" : pose.mode === "nav" ? "2D map (nav)" : pose.screen;

  return (
    <div className="is-dash" data-testid="dash-root">
      <div className="topbar">
        <Link className="brand" to="/"><i />Indore Spaces</Link>
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
            <button className="btn primary" onClick={() => window.open("/nav?demo=1", "is-phone", "width=1000,height=900")}>📱 Open phone view ↗</button>
          </div>
          {!live && (
            <div className="card flat" data-testid="no-phone" style={{ marginBottom: 12, background: "#fff8e6", borderColor: "#f6d98a" }}>
              <b>No phone connected</b>
              <p className="small" style={{ margin: "4px 0 8px" }}>Open the visitor app in another tab/window of this browser and walk a route — this screen mirrors it live. In the real demo the phone streams over WebSocket to the laptop (Phase 3).</p>
              <button className="btn" data-testid="demo-feed" onClick={startDemoFeed}>▶ Start built-in demo feed</button>
            </div>
          )}
          <div className="grid2" style={{ marginBottom: 12 }}>
            <div className="stat"><b data-testid="s-floor">{u ? fl(u.floor) : "—"}</b><span>Floor</span></div>
            <div className="stat"><b>{u ? `${u.x.toFixed(1)}, ${u.y.toFixed(1)}` : "—"}</b><span>Position (m)</span></div>
            <div className="stat"><b>{u ? (u.stale ? "lost" : `±${u.acc.toFixed(1)} m`) : "—"}</b><span>Accuracy</span></div>
            <div className="stat"><b>{u ? `${Math.round(u.heading)}°` : "—"}</b><span>Heading</span></div>
            <div className="stat"><b>{mode}</b><span>Phone mode</span></div>
            <div className="stat"><b>{u && u.markerId !== null ? u.markerId : "—"}</b><span>Last anchor</span></div>
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
            <div className="stat"><b>{pose?.impressions ?? 0}</b><span>ad impressions</span></div>
            <div className="stat"><b>{pose ? (LANG_NAME[pose.lang] ?? pose.lang) : "—"}</b><span>voice language</span></div>
          </div>
          <h4>Event log</h4>
          <div data-testid="log">
            {events.map((e) => (
              <div className="ev" key={e.id}>
                <time>{new Date(e.at).toLocaleTimeString()}</time>
                <span className={`tag ${e.kind}`}>{e.kind}</span>
                <span>{e.text}</span>
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
