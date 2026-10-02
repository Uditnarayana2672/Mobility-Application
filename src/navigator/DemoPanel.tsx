import { useEffect, useState } from "react";
import { fmtTime, type Lang } from "@/core/instructions";
import type { NavController, NavState } from "./controller";
import { confOf, floorName } from "./places";
import type { NavRuntime } from "./useNav";

const KEYS: Record<string, Partial<{ fwd: number; strafe: number; turn: number }>> = {
  w: { fwd: 1 }, arrowup: { fwd: 1 }, s: { fwd: -1 }, arrowdown: { fwd: -1 },
  a: { strafe: -1 }, arrowleft: { strafe: -1 }, d: { strafe: 1 }, arrowright: { strafe: 1 },
  q: { turn: -1 }, e: { turn: 1 },
};

/** WASD (move) + Q/E (turn) for the simulator's manual mode; only active while manual mode is on. */
function useManualKeys(rt: NavRuntime, manual: boolean): void {
  useEffect(() => {
    if (!manual) return;
    const held = new Set<string>();
    const apply = () => {
      let fwd = 0;
      let strafe = 0;
      let turn = 0;
      for (const k of held) {
        const m = KEYS[k];
        if (m?.fwd) fwd += m.fwd;
        if (m?.strafe) strafe += m.strafe;
        if (m?.turn) turn += m.turn;
      }
      rt.sim.setManualInput({ fwd: Math.sign(fwd), strafe: Math.sign(strafe), turn: Math.sign(turn) });
    };
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable);
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!KEYS[k] || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      held.add(k);
      apply();
    };
    const up = (e: KeyboardEvent) => {
      if (held.delete(e.key.toLowerCase())) apply();
    };
    const blur = () => {
      held.clear();
      apply();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      rt.sim.setManualInput({ fwd: 0, strafe: 0, turn: 0 });
    };
  }, [rt, manual]);
}

export default function DemoPanel({ rt, s, open, onClose }: { rt: NavRuntime; s: NavState; open: boolean; onClose: () => void }) {
  const { ctl, sim } = rt;
  const [marker, setMarker] = useState<number>(s.venue.markers[0]?.id ?? 0);
  const manual = s.sim.mode === "manual";
  useManualKeys(rt, manual);
  const u = s.user;
  const R = s.route;
  const conf = confOf(u);
  const rows: [string, string][] = [
    ["Screen", `${s.screen} · ${s.mode}`],
    ["Floor", u ? floorName(s.venue, u.floor) : "—"],
    ["Position", u ? `${u.x.toFixed(1)}, ${u.y.toFixed(1)} m` : "—"],
    ["Heading", u ? `${Math.round(u.heading)}°` : "—"],
    ["Accuracy", u ? conf.txt : "—"],
    ["Anchored by", u && u.markerId !== null ? `marker ${u.markerId}` : "none"],
    ["Progress", s.snap && R ? `${s.snap.s.toFixed(1)} / ${R.total.toFixed(1)}` : "—"],
    ["Route", R ? `${R.via ?? "same floor"} · ${fmtTime(R.time)}` : "—"],
    ["Venue", `${s.venue.name} v${s.venue.version} (${s.venueSource === "api" ? "server" : "bundled copy"})`],
  ];
  const lang = (l: Lang, label: string) => (
    <button key={l} data-l={l} className={s.lang === l ? "on" : ""} onClick={() => ctl.setLang(l)}>{label}</button>
  );
  const dashboard = () => window.open("/dashboard", "is-dashboard", "width=1280,height=820");
  const reset = () => {
    ctl.resetDemo();
    rt.bc?.clearSnapshot();
    window.location.href = window.location.pathname + window.location.search;
  };
  return (
    <aside className={`demo-panel ${open ? "open" : ""}`} data-testid="demo-panel">
      <button className="btn demo-close" onClick={onClose}>✕ Close</button>
      <h3>🎬 Demo controls</h3>
      <p className="muted small">The walker below is a simulation. On a real phone the same app fills the screen and position will come from marker scans and AR tracking (Phase 3).</p>
      <div className="row wrap">
        <button className="btn primary" data-testid="d-play" onClick={() => sim.togglePlay()}>{s.sim.playing ? "⏸ Pause" : "▶ Play"}</button>
        <div className="seg" data-testid="d-speed">
          {([1, 3] as const).map((m) => (
            <button key={m} data-m={m} className={s.sim.speed === m ? "on" : ""} onClick={() => sim.setSpeed(m)}>{m}×</button>
          ))}
        </div>
      </div>
      <div className="row wrap" style={{ marginTop: 8 }}>
        <button className="btn" data-testid="d-next" onClick={() => ctl.nextTurn()}>⏭ Next turn</button>
        <button className="btn" data-testid="d-wrong" onClick={() => ctl.wrongTurn()}>↩ Take wrong turn</button>
        <button className="btn" data-testid="d-lose" onClick={() => ctl.loseTracking()}>📡 Lose tracking</button>
      </div>
      <h3>🚶 Walker</h3>
      <div className="seg" data-testid="d-mode">
        <button className={!manual ? "on" : ""} onClick={() => sim.setMode("auto")}>Walk the route</button>
        <button className={manual ? "on" : ""} onClick={() => sim.setMode("manual")}>Manual</button>
      </div>
      <p className="muted small" style={{ marginTop: 6 }}>
        Manual: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move, <kbd>Q</kbd>/<kbd>E</kbd> turn. Moving off the route triggers the off-route reroute after 3 s.
      </p>
      <label className="muted small" style={{ display: "block", margin: "10px 0 4px", fontWeight: 600 }}>Language (spoken + shown)</label>
      <div className="seg" data-testid="d-lang">{lang("en", "English")}{lang("hi", "Hinglish")}{lang("te", "తెలుగు")}</div>
      <div className="row" style={{ marginTop: 10 }}>
        <label className="switch"><input type="checkbox" data-testid="d-auto" checked={s.autoConfirm} onChange={(e) => ctl.setAutoConfirm(e.target.checked)} /><i /></label>
        <span>Auto-confirm floor via lobby marker</span>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <label className="switch"><input type="checkbox" data-testid="d-mute" checked={s.muted} onChange={(e) => ctl.setMuted(e.target.checked)} /><i /></label>
        <span>Mute spoken voice (captions stay)</span>
      </div>
      <h3>📍 Simulate a marker scan</h3>
      <div className="row">
        <select data-testid="d-marker" value={marker} onChange={(e) => setMarker(Number(e.target.value))}>
          {s.venue.markers.map((m) => (
            <option key={m.id} value={m.id}>{m.id} · {floorName(s.venue, m.floor)} · {m.name}</option>
          ))}
        </select>
        <button className="btn" data-testid="d-scan" onClick={() => ctl.scanMarker(marker, s.screen === "locate" || s.screen === "city")}>Scan</button>
      </div>
      <h3>📊 What the phone knows</h3>
      <div className="kv" data-testid="d-kv">
        {rows.map(([k, v]) => (
          <span key={k} style={{ display: "contents" }}><b>{k}</b><span>{v}</span></span>
        ))}
      </div>
      <h3>🔗 Linked views</h3>
      <button className="btn" data-testid="d-dashboard" onClick={dashboard}>Open live dashboard ↗</button>
      <a className="btn" href="/editor">Map editor</a>
      <button className="btn danger" data-testid="d-reset" onClick={reset}>Reset demo</button>
    </aside>
  );
}

export type { NavController };
