import { useMemo } from "react";
import { fmtTime, stepAction, type Lang } from "@/core/instructions";
import { intent, type Target } from "@/core/intent";
import { isRouteError, route as computeRoute } from "@/core/route";
import type { Step } from "@/core/route";
import type { NavController, NavState } from "./controller";
import { LANG_SHORT, NEXT_LANG } from "./messages";
import { quickChips } from "./chips";
import NavMap from "./NavMap";
import { confOf, floorName, nearName, placeOf } from "./places";

type P = { ctl: NavController; s: NavState };

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const low = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);

function stepIcon(step: Step): string {
  return step.kind === "turn" ? (step.dir === "left" ? "↰" : "↱") : step.kind === "vertical" ? (step.via === "lift" ? "🛗" : "🪜") : "📍";
}

function clock(sec: number): string {
  return new Date(Date.now() + sec * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** ETA per quick-list row, recomputed only when the position (to ~1 m), floor or preference changes. */
function useEstimates(s: NavState, targets: Target[]): (number | null)[] {
  const u = s.user;
  const key = u ? `${u.floor}|${Math.round(u.x)}|${Math.round(u.y)}|${s.prefs.avoidStairs}` : "none";
  return useMemo(() => {
    if (!u) return targets.map(() => null);
    return targets.map((t) => {
      const r = computeRoute(s.venue, { floor: u.floor, x: u.x, y: u.y, heading: u.heading }, t, s.prefs);
      return isRouteError(r) ? null : r.time;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, s.venue, targets]);
}

function FloorSwitcher({ ctl, s }: P) {
  const u = s.user;
  return (
    <div className="floors" data-testid="floors">
      {[...s.venue.floors].reverse().map((f) => (
        <button key={f.id} data-f={f.id} className={s.viewFloor === f.id ? "on" : ""} onClick={() => ctl.setViewFloor(f.id)}>
          {f.short || f.name}
          <small>{u && u.floor === f.id ? "YOU" : "FLOOR"}</small>
        </button>
      ))}
      <button data-testid="lang-btn" style={{ borderTop: "1px solid #edf0f5" }} onClick={() => ctl.setLang(NEXT_LANG[s.lang])}>
        🌐<small>{LANG_SHORT[s.lang]}</small>
      </button>
    </div>
  );
}

function ExploreSheet({ ctl, s }: P) {
  const u = s.user;
  const conf = confOf(u);
  const quick = useMemo<{ label?: string; icon?: string; target: Target }[]>(() => {
    const out: { label?: string; icon?: string; target: Target }[] = [];
    const add = (t: Target, label?: string, icon?: string) => {
      if (placeOf(s.venue, t)) out.push({ target: t, label, icon });
    };
    add({ room: "F2-cafeteria" });
    if (u) {
      const res = intent(s.venue, "nearest washroom", { from: { floor: u.floor, x: u.x, y: u.y, heading: u.heading }, prefs: s.prefs });
      if (res.type === "goto") add(res.target, "Nearest washroom", "🚻");
    }
    add({ room: "F1-everest" });
    add({ room: "F1-pantry" });
    add({ room: "F2-wellness" });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.venue, u ? u.floor : "", u ? Math.round(u.x) : 0, u ? Math.round(u.y) : 0]);
  const est = useEstimates(s, useMemo(() => quick.map((q) => q.target), [quick]));
  if (!u) return null;
  return (
    <div className="sheet explore" data-testid="sheet-explore">
      <div className="handle" />
      <div className="row" style={{ marginBottom: 4 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>You are on {floorName(s.venue, u.floor)}</div>
        <span className="spacer" />
        <span className={`conf ${conf.cls}`} data-testid="conf-chip">{conf.txt}</span>
      </div>
      <div className="muted small" style={{ marginBottom: 6 }}>
        Near {nearName(s.venue, u)} · {u.markerId !== null ? `anchored by ${u.markerId}` : "approximate position"}
      </div>
      {s.poseKind !== "sim" && (
        <button className="pbtn primary block" style={{ margin: "2px 0 8px" }} data-testid="btn-camera-guide" onClick={() => ctl.showAr()}>
          📷 Camera guide — say where to go
        </button>
      )}
      <div className="qlist">
        {quick.map((q, i) => {
          const p = placeOf(s.venue, q.target)!;
          return (
            <div key={i} className="qrow" data-testid="quick-row" onClick={() => ctl.showPlace(q.target)}>
              <div className="ic">{q.icon ?? p.icon}</div>
              <div className="t">
                {q.label ?? p.name}
                <small>{q.label ? `${p.name} · ${floorName(s.venue, p.floor)}` : p.sub}</small>
              </div>
              <div className="r">{est[i] != null ? fmtTime(est[i] as number) : "—"}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlaceSheet({ ctl, s }: P) {
  const p = s.place;
  const u = s.user;
  const r = useMemo(() => {
    if (!p || !u) return null;
    const x = computeRoute(s.venue, { floor: u.floor, x: u.x, y: u.y, heading: u.heading }, p.target, s.prefs);
    return isRouteError(x) ? null : x;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, u ? u.floor : "", u ? Math.round(u.x) : 0, u ? Math.round(u.y) : 0, s.prefs.avoidStairs, s.venue]);
  if (!p) return null;
  return (
    <div className="sheet" data-testid="sheet-place">
      <div className="handle" />
      <div className="row">
        <div style={{ fontSize: 30 }}>{p.icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 18 }} data-testid="place-name">{p.name}</div>
          <div className="muted small">{p.sub}</div>
        </div>
        <button className="fab" style={{ position: "static", width: 36, height: 36, fontSize: 16, boxShadow: "none", background: "#eef1f6" }} onClick={() => ctl.closePlace()}>✕</button>
      </div>
      <div className="row wrap" style={{ margin: "10px 0" }}>
        {p.staffOnly ? <span className="badge fail">🔒 Staff only</span> : r ? <span className="badge info">⏱ {fmtTime(r.time)} away{r.via ? ` · via ${r.via}` : ""}</span> : null}
        {p.hours ? <span className="badge gray">🕘 {p.hours}</span> : null}
        {p.capacity ? <span className="badge gray">👥 up to {p.capacity}</span> : null}
        {r && r.floors.length > 1 ? <span className="badge ok">♿ lift route available</span> : null}
      </div>
      <div className="row">
        <button className="pbtn primary" style={{ flex: 1 }} disabled={p.staffOnly} data-testid="btn-directions" onClick={() => ctl.preview()}>➜ Directions</button>
        <button className="pbtn" onClick={() => ctl.toast("Saved to your places")}>☆ Save</button>
      </div>
    </div>
  );
}

function PreviewSheet({ ctl, s }: P) {
  const lang = s.lang;
  return (
    <div className="sheet preview" data-testid="sheet-preview">
      <div className="handle" />
      <div className="row" style={{ marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <div className="muted small">Route to</div>
          <div style={{ fontWeight: 800, fontSize: 17 }}>{s.place?.name}</div>
        </div>
        <button className="pbtn sm" onClick={() => ctl.closePreview()}>✕</button>
      </div>
      <div data-testid="route-options">
        {s.options.map((o, i) => {
          const lbl = o.via === "stairs" ? "🪜 Via stairs" : o.via === "lift" ? "🛗 Via lift" : "🚶 Same floor";
          const badge = i === 0 && s.options.length > 1 ? <span className="badge ok">Fastest</span> : o.via === "lift" ? <span className="badge info">♿ Accessible</span> : null;
          return (
            <div key={i} className={`opt ${i === s.optIdx ? "on" : ""}`} data-via={o.via ?? "none"} onClick={() => ctl.applyOption(i)}>
              <div className="big">{fmtTime(o.time)}</div>
              <div style={{ flex: 1 }}>
                <b>{lbl}</b> {badge}
                <small>
                  {Math.round(o.walkDist)} m walking{o.via ? " · 1 floor change" : ""}
                </small>
              </div>
            </div>
          );
        })}
      </div>
      <div className="row small" style={{ margin: "2px 0 6px" }}>
        <label className="switch">
          <input type="checkbox" data-testid="avoid-stairs" checked={s.prefs.avoidStairs} onChange={(e) => ctl.setAvoidStairs(e.target.checked)} />
          <i />
        </label>
        <span>Avoid stairs (wheelchair / stroller)</span>
      </div>
      <details style={{ marginBottom: 8 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Step-by-step</summary>
        <div className="steps">
          {s.route?.steps.map((st, i) => (
            <div key={i}>
              <b>{i + 1}</b>
              {stepAction(st, lang)}
              <span>{st.kind === "arrive" || st.dist > 0.5 ? `${Math.round(st.dist)} m` : ""}</span>
            </div>
          ))}
        </div>
      </details>
      <button className="pbtn green block" data-testid="btn-start" onClick={() => ctl.startNav()}>▶ Start navigation</button>
    </div>
  );
}

function thenLine(s: NavState, lang: Lang): string {
  const sn = s.snap;
  const R = s.route;
  if (!sn || !R) return "";
  const nn = R.steps[sn.next.index + 1];
  return nn ? `Then ${low(stepAction(nn, lang))}` : "";
}

function NavHud({ ctl, s }: P) {
  const sn = s.snap;
  const R = s.route;
  const u = s.user;
  if (!sn || !R || !u) return null;
  const step = sn.next.step;
  const init = step.kind === "turn" && step.initial && sn.s < 0.3;
  const dist = init || sn.next.remaining < 1.5 ? "Now" : `${Math.round(sn.next.remaining)} m`;
  let act = stepAction(step, s.lang);
  if (step.kind === "arrive" && sn.next.remaining > 1.5) act = `${R.destName} ahead`;
  const then = init && R.steps[1] ? cap(stepAction(R.steps[1], s.lang)) : thenLine(s, s.lang);
  const conf = confOf(u);
  return (
    <>
      <div className="banner" data-testid="banner">
        <div className="row1">
          <div className="ico">{stepIcon(step)}</div>
          <div style={{ flex: 1 }}>
            <div className="dist" data-testid="banner-dist">{dist}</div>
            <div className="act" data-testid="banner-act">{act}</div>
          </div>
        </div>
        {then ? <div className="then">{then}</div> : null}
      </div>
      <div className="sideb navside">
        <button className="fab primary" aria-label="AR" data-testid="btn-ar" onClick={() => ctl.showAr()}>📷</button>
        <button className="fab" aria-label="voice" data-testid="btn-mic-nav" onClick={() => ctl.openVoice()}>🎤</button>
        <button className="fab" aria-label="mute" data-testid="btn-mute" onClick={() => ctl.toggleMute()}>{s.muted ? "🔇" : "🔊"}</button>
        <button className="fab" aria-label="recentre" data-testid="btn-recenter" onClick={() => ctl.recenter()}>◎</button>
      </div>
      <div className="navbar" data-testid="navbar">
        <div style={{ flex: 1 }}>
          <div className="eta" data-testid="nav-eta">{fmtTime(sn.etaSec)}</div>
          <div className="meta">
            {Math.round(sn.remainingM)} m · arrive {clock(sn.etaSec)}
          </div>
        </div>
        <span className={`conf ${conf.cls}`}>{conf.txt}</span>
        <button className="pbtn red" data-testid="btn-end" onClick={() => ctl.endNav()}>End</button>
      </div>
      {u.acc > 1.8 && s.screen === "map" ? (
        <button className="fab wide" style={{ left: 12, bottom: 96 }} data-testid="btn-fix" onClick={() => ctl.fixPosition()}>📍 Fix position</button>
      ) : null}
    </>
  );
}

export default function MapScreen({ ctl, s }: P) {
  const showTop = s.mode === "explore" || s.mode === "place" || s.mode === "preview";
  return (
    <section className={`scr ${s.screen === "map" ? "on" : ""}`} id="s-map" data-testid="screen-map" data-mode={s.mode}>
      {s.screen === "map" || s.screen === "ar" || s.screen === "arrived" ? <NavMap ctl={ctl} s={s} /> : null}
      {showTop && (
        <div className="map-top">
          <div className="searchpill" data-testid="search-pill" onClick={(e) => { if (!(e.target as HTMLElement).closest(".mic")) ctl.openSearch(""); }}>
            <b>Search rooms, food, washrooms…</b>
            <button className="mic" aria-label="voice" data-testid="btn-mic" onClick={(e) => { e.stopPropagation(); ctl.openVoice(); }}>🎤</button>
          </div>
          {s.mode !== "preview" && (
            <div className="chips">
              {quickChips(s.venue).map(([ic, label, q]) => (
                <button key={label} className="qchip" onClick={() => ctl.openSearch(q)}>{ic} {label}</button>
              ))}
            </div>
          )}
        </div>
      )}
      <FloorSwitcher ctl={ctl} s={s} />
      {s.mode === "explore" && <ExploreSheet ctl={ctl} s={s} />}
      {s.mode === "place" && <PlaceSheet ctl={ctl} s={s} />}
      {s.mode === "preview" && <PreviewSheet ctl={ctl} s={s} />}
      {s.mode === "nav" && <NavHud ctl={ctl} s={s} />}
      {(s.mode === "explore" || s.mode === "place") && (
        <div className="sideb" style={{ bottom: 300 }}>
          <button className="fab primary" aria-label="AR" onClick={() => ctl.showAr()}>📷</button>
          <button className="fab" aria-label="locate" data-testid="btn-locate" onClick={() => ctl.locateOnMap()}>◎</button>
        </div>
      )}
    </section>
  );
}
