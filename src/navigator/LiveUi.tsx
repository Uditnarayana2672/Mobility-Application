import { useEffect, useMemo, useRef, useState } from "react";
import { roomPolygon } from "@/core/geom";
import type { Venue } from "@/core/schema";
import { XrPoseSource } from "@/positioning/xrPoseSource";
import { suggestPlaces } from "@/positioning/locator";
import { loadLastFix } from "@/shared/lastFix";
import { placeOf } from "./places";
import type { NavController, NavState } from "./controller";
import type { PoseDebug } from "./poseSource";
import type { NavRuntime } from "./useNav";

type Props = { rt: NavRuntime; ctl: NavController; s: NavState };

/** What the venue detection already knows about the visitor (e.g. which entrance GPS says they came through). */
export interface LocateHints {
  entranceMarker?: number | null;
}

/** Seconds the camera must look without finding a marker before the app asks "are you near…?". */
export const ASK_AFTER_SEC = 5;

/** What the first screen shows when the phone positions itself (instead of the demo marker chips). */
export function LiveLocate({ rt, ctl, s, hints }: Props & { hints?: LocateHints }) {
  const video = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [supported, setSupported] = useState<boolean | null>(rt.kind === "xr" ? null : true);

  useEffect(() => {
    if (rt.kind !== "xr") return;
    let live = true;
    void XrPoseSource.supported().then((ok) => {
      if (!live) return;
      setSupported(ok);
      // The browser has WebXR but the phone cannot do AR (no ARCore): go straight to the plain camera + step counting,
      // unless ?pose=xr was asked for on purpose.
      if (!ok && !new URLSearchParams(window.location.search).has("pose")) rt.switchKind("pdr");
    });
    return () => {
      live = false;
    };
  }, [rt]);

  useEffect(() => () => rt.pdr?.stopCamera(), [rt]);

  // Phones without ARCore: open the camera by itself (no button) so a marker in view locks on at once.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (rt.kind !== "pdr" || autoStarted.current || !video.current) return;
    autoStarted.current = true;
    void rt.pdr?.startCamera(video.current).then(() => setActive(true)).catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [rt]);

  // Nothing found yet after a few seconds: offer the likely places for one tap, and "continue where you left off".
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setWaited((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const last = useMemo(() => loadLastFix(s.venue.id), [s.venue.id]);
  const guesses = useMemo(() => suggestPlaces(s.venue, { last, entranceMarker: hints?.entranceMarker }), [s.venue, last, hints?.entranceMarker]);
  const askNow = waited >= ASK_AFTER_SEC || !!err;

  const startXr = async () => {
    if (!rt.xr) return;
    setBusy(true);
    setErr(null);
    try {
      await rt.xr.startAr(() => setActive(false));
      setActive(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const startCam = async () => {
    if (!rt.pdr || !video.current) return;
    setBusy(true);
    setErr(null);
    try {
      await rt.pdr.startCamera(video.current);
      setActive(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {rt.kind === "pdr" && <video ref={video} className="live-video" playsInline muted data-testid="live-video" />}
      <div className="live-locate" data-testid="live-locate">
        {rt.kind === "xr" && !active && (
          <>
            <div className="small" style={{ marginBottom: 8 }}>
              {supported === false ? "AR tracking is not available in this browser." : "AR tracking uses the camera and the phone's motion sensors."}
            </div>
            <button className="pbtn primary block" data-testid="start-ar" disabled={busy || supported === false} onClick={() => void startXr()}>
              📷 Start AR tracking
            </button>
          </>
        )}
        {rt.kind === "xr" && active && <div className="live-hint" data-testid="live-hint">Point the camera at a marker sticker, about 1–2 m away.</div>}
        {rt.kind === "pdr" && !active && (
          <button className="pbtn primary block" data-testid="start-cam" disabled={busy} onClick={() => void startCam()}>
            📷 Open camera to scan a marker
          </button>
        )}
        {rt.kind === "pdr" && active && <div className="live-hint" data-testid="live-hint">Point the camera at a marker sticker, about 1–2 m away.</div>}
        {err && <div className="live-err" data-testid="live-err">{err}</div>}
        {(last || askNow) && (
          <div className="live-suggest" data-testid="live-suggest">
            {last && (
              <button className="pbtn block" data-testid="resume-fix" onClick={() => ctl.resumeFrom(last)}>
                ↩ Continue where I left off{guesses.find((g) => g.reason === "resume") ? ` (near ${guesses.find((g) => g.reason === "resume")!.name})` : ""}
              </button>
            )}
            {askNow && guesses.length > 0 && (
              <>
                <div className="small" style={{ margin: "8px 0 4px" }}>No marker in sight. Are you near…</div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                  {guesses.map((g) => (
                    <button key={g.roomId} className="pbtn sm" data-testid="guess" data-room={g.roomId} onClick={() => { const pl = placeOf(s.venue, { room: g.roomId }); if (pl) ctl.setLocationManually(pl); }}>
                      {g.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {rt.kind === "xr" && (supported === false || err) && (
          <button className="pbtn block" style={{ marginTop: 8, background: "rgba(255,255,255,.14)", color: "#fff" }} onClick={() => rt.switchKind("pdr")}>
            Use step counting instead
          </button>
        )}
      </div>
    </>
  );
}

const SOURCE_LABEL: Record<string, string> = { sim: "SIM", marker: "MARKER", manual: "MANUAL", ar: "AR", steps: "STEPS", vision: "SIGHT" };

/** Small chip on the map: where the dot comes from and how sure it is; re-scan / restart buttons for the live sources. */
export function LiveHud({ rt, ctl, s }: Props) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (rt.kind === "sim" || !s.located || s.screen !== "map" || !s.user) return null;
  const u = s.user;
  return (
    <div className="live-hud" data-testid="live-hud">
      <span className={`live-chip ${u.stale ? "stale" : ""}`} data-testid="live-chip" data-source={u.source}>
        {rt.kind === "xr" ? "AR" : "STEPS"} · {SOURCE_LABEL[u.source] ?? u.source} · {u.stale ? "lost" : `±${u.acc.toFixed(1)} m`}
      </span>
      {rt.kind === "pdr" && (
        <button className="pbtn sm" data-testid="rescan" onClick={() => ctl.setScanning(true)}>
          📷 Scan marker
        </button>
      )}
      {rt.kind === "xr" && !rt.xr?.active && (
        <button className="pbtn sm primary" data-testid="restart-ar" onClick={() => void rt.xr?.startAr().catch(() => undefined)}>
          Restart AR
        </button>
      )}
      {u.stale && <span className="live-chip stale">Scan a marker to fix your position</span>}
    </div>
  );
}

/** Camera sheet for re-anchoring while walking (step counting only; with AR just look at a marker). */
export function ScanSheet({ rt, ctl, s }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const open = s.scanning && rt.kind === "pdr";
  useEffect(() => {
    if (!open || !rt.pdr || !video.current) return;
    setErr(null);
    rt.pdr.startCamera(video.current).catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
    return () => rt.pdr?.stopCamera();
  }, [open, rt]);
  if (!open) return null;
  return (
    <div className="scan-sheet" data-testid="scan-sheet">
      <video ref={video} playsInline muted />
      <div className="live-hint">Point at a marker sticker</div>
      {err && <div className="live-err">{err}</div>}
      <button className="pbtn block" style={{ margin: 12 }} onClick={() => ctl.setScanning(false)}>
        Cancel
      </button>
    </div>
  );
}

/** ?debug=1: fps, tracking state, last reprojection error, rejected-detection reason, particle cloud on a mini map. */
export function DebugOverlay({ rt, ctl, s }: Props) {
  const [d, setD] = useState<PoseDebug | null>(null);
  const [fps, setFps] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      frames++;
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const id = window.setInterval(() => setD(ctl.getDebug()), 250);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(id);
    };
  }, [ctl]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    drawMini(c, s.venue, s.user ? s.user.floor : s.viewFloor, s.user, d?.cloud ?? []);
  }, [d, s.user, s.venue, s.viewFloor]);

  const n = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? "–" : v.toFixed(digits));
  return (
    <div className="debug-overlay" data-testid="debug-overlay">
      <div>
        {rt.kind.toUpperCase()} · UI {fps} fps{d ? ` · loop ${n(d.fps, 0)} Hz` : ""}
      </div>
      <div>tracking: {d?.tracking ?? s.sim.mode}</div>
      <div>reproj: {n(d?.reprojPx)} px · oblique: {n(d?.obliqueDeg, 0)}° · det: {d?.detections ?? 0}</div>
      <div>reject: {d?.reject ?? "–"}</div>
      {d?.vision && <div>vision: {d.vision}</div>}
      <div>last anchor: {d?.anchorAgeSec === null || d === null ? "–" : `${n(d?.anchorAgeSec, 0)} s ago`} · marker {s.user?.markerId ?? "–"}</div>
      <div>
        pose: {s.user ? `${s.user.floor} ${s.user.x.toFixed(1)}, ${s.user.y.toFixed(1)} · ${Math.round(s.user.heading)}° · ±${s.user.acc.toFixed(1)}` : "–"}
      </div>
      <canvas ref={canvas} width={180} height={100} />
    </div>
  );
}

function drawMini(c: HTMLCanvasElement, v: Venue, floorId: string, user: NavState["user"], cloud: PoseDebug["cloud"]): void {
  const g = c.getContext("2d");
  if (!g) return;
  const floor = v.floors.find((f) => f.id === floorId) ?? v.floors[0];
  g.clearRect(0, 0, c.width, c.height);
  if (!floor) return;
  const k = Math.min(c.width / floor.w, c.height / floor.h);
  g.fillStyle = "rgba(255,255,255,.08)";
  g.fillRect(0, 0, floor.w * k, floor.h * k);
  g.fillStyle = "rgba(120,180,255,.30)";
  for (const r of v.corridors) if (r.floor === floor.id) g.fillRect(r.x * k, r.y * k, r.w * k, r.h * k);
  g.strokeStyle = "rgba(255,255,255,.35)";
  for (const r of v.rooms) {
    if (r.floor !== floor.id) continue;
    g.beginPath();
    roomPolygon(r).forEach((p, i) => (i ? g.lineTo(p.x * k, p.y * k) : g.moveTo(p.x * k, p.y * k)));
    g.closePath();
    g.stroke();
  }
  g.fillStyle = "rgba(255,210,60,.9)";
  for (const p of cloud) if (p.floor === floor.id) g.fillRect(p.x * k - 1, p.y * k - 1, 2, 2);
  if (user && user.floor === floor.id) {
    g.fillStyle = "#4da3ff";
    g.beginPath();
    g.arc(user.x * k, user.y * k, 3, 0, Math.PI * 2);
    g.fill();
  }
}
