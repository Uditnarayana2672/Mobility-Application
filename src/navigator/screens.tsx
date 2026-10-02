import { useMemo } from "react";
import { arrivedText } from "@/core/instructions";
import type { NavController, NavState } from "./controller";
import { floorName } from "./places";

type P = { ctl: NavController; s: NavState };

/* ------------------------------------------------------------------ city */
export function CityScreen({ ctl, s }: P) {
  const v = s.venue;
  const items = [
    { icon: "🏢", name: v.name, sub: `${v.type || "Venue"} · ${v.floors.length} floors mapped · v${v.version}`, live: true },
    { icon: "🛍️", name: "Shopping mall (to be mapped)", sub: "Shops, food court, parking", live: false },
    { icon: "✈️", name: "Indore Airport", sub: "Check-in, security, gates", live: false },
    { icon: "🚆", name: "Indore Junction Railway Station", sub: "Platforms, foot-over-bridges", live: false },
    { icon: "🚌", name: "Sarwate Bus Stand", sub: "Bays, ticket counters", live: false },
  ];
  const open = () => ctl.openLocate();
  return (
    <section className={`scr ${s.screen === "city" ? "on" : ""}`} id="s-city" data-testid="screen-city">
      <svg viewBox="0 0 380 780" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0 }}>
        <rect width="380" height="780" fill="#eaefe3" />
        <path d="M-10,610 C70,560 120,520 170,500 S300,430 400,400 L400,430 C310,460 220,520 180,540 S60,640 -10,660Z" fill="#a9d3ee" />
        <ellipse cx="90" cy="300" rx="70" ry="48" fill="#cfe5c3" />
        <ellipse cx="320" cy="560" rx="60" ry="46" fill="#cfe5c3" />
        <ellipse cx="230" cy="170" rx="48" ry="34" fill="#cfe5c3" />
        <g stroke="#fff" strokeLinecap="round" fill="none">
          <path d="M-10,430 L400,400" strokeWidth="12" />
          <path d="M190,-10 L200,790" strokeWidth="12" />
          <path d="M-10,250 L400,210" strokeWidth="8" />
          <path d="M30,-10 L110,790" strokeWidth="7" />
          <path d="M290,-10 L330,790" strokeWidth="7" />
          <path d="M-10,610 L400,640" strokeWidth="7" />
          <path d="M110,330 L380,300" strokeWidth="5" />
          <path d="M130,470 L270,455" strokeWidth="5" />
        </g>
        <g fontFamily="Segoe UI,Roboto,sans-serif" fontSize="11" fill="#6b7686" fontWeight="600" textAnchor="middle">
          <text x="190" y="468">Rajwada</text>
          <text x="262" y="448">Palasia</text>
          <text x="318" y="190">Vijay Nagar</text>
          <text x="62" y="520">Airport side</text>
          <text x="150" y="470">Indore Jn</text>
          <text x="166" y="388">Sarwate</text>
        </g>
        <text x="190" y="760" textAnchor="middle" fontSize="10" fill="#8a94a6" fontFamily="Segoe UI,sans-serif">
          Illustrative city map — not to scale
        </text>
        <g id="pinOffice" data-testid="pin-office" style={{ cursor: "pointer" }} onClick={open}>
          <circle cx="300" cy="222" r="22" fill="rgba(47,91,234,.2)">
            <animate attributeName="r" values="14;28;14" dur="2s" repeatCount="indefinite" />
          </circle>
          <path d="M300,238 C288,222 288,206 300,206 C312,206 312,222 300,238Z" fill="#2f5bea" stroke="#fff" strokeWidth="2" />
          <circle cx="300" cy="219" r="4" fill="#fff" />
        </g>
        <g opacity=".8">
          <circle cx="240" cy="340" r="8" fill="#9aa3b2" stroke="#fff" strokeWidth="2" />
          <circle cx="62" cy="488" r="8" fill="#9aa3b2" stroke="#fff" strokeWidth="2" />
          <circle cx="150" cy="450" r="8" fill="#9aa3b2" stroke="#fff" strokeWidth="2" />
          <circle cx="168" cy="400" r="8" fill="#9aa3b2" stroke="#fff" strokeWidth="2" />
        </g>
      </svg>
      <div className="top">
        <div className="searchpill" onClick={() => ctl.toast("Demo: only the office is mapped. Tap the blue pin.")}>
          <span>🔍</span>
          <b>Search places in Indore</b>
          <button className="mic" aria-label="voice">🎤</button>
        </div>
      </div>
      <div className="sheet" id="citySheet">
        <div className="handle" />
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 2 }}>Indoor maps in Indore</div>
        <div className="muted small" style={{ marginBottom: 6 }}>Malls, airports, stations, bus stands and offices — navigate inside them.</div>
        <div>
          {items.map((it, i) => (
            <div key={it.name} className={`vcard ${it.live ? "" : "off"}`} data-testid={i === 0 ? "venue-card" : undefined} onClick={() => (i === 0 ? open() : ctl.toast("Not mapped yet — venue owners can add it from the Owner portal"))}>
              <div className="vi">{it.icon}</div>
              <div style={{ flex: 1 }}>
                <b>{it.name}</b>
                <small>{it.sub}</small>
              </div>
              <span className={`pill ${it.live ? "live" : "soon"}`}>{it.live ? "LIVE" : "SOON"}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ locate */
function ScanQR() {
  const cells = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    let seed = 7;
    for (let i = 0; i < 90; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const x = 36 + (seed % 7) * 4;
      const y = 6 + ((seed >> 4) % 22) * 4;
      if (x < 66) out.push({ x, y });
    }
    return out;
  }, []);
  const finder = (x: number, y: number) => (
    <g key={`${x}${y}`}>
      <rect x={x} y={y} width="26" height="26" fill="#111" />
      <rect x={x + 5} y={y + 5} width="16" height="16" fill="#fff" />
      <rect x={x + 9} y={y + 9} width="8" height="8" fill="#111" />
    </g>
  );
  return (
    <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 34, width: "calc(100% - 68px)", height: "calc(100% - 68px)", opacity: 0.9 }}>
      <rect x="0" y="0" width="100" height="100" rx="6" fill="#fff" />
      {finder(6, 6)}
      {finder(68, 6)}
      {finder(6, 68)}
      {cells.map((c, i) => <rect key={i} x={c.x} y={c.y} width="4" height="4" fill="#111" />)}
    </svg>
  );
}

export function LocateScreen({ ctl, s }: P) {
  const v = s.venue;
  return (
    <section className={`scr ${s.screen === "locate" ? "on" : ""}`} id="s-locate" data-testid="screen-locate">
      <div className="viewfinder">
        <svg className="vf-corridor" viewBox="0 0 340 340" fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="2">
          <path d="M20,330 L120,120 L220,120 L320,330" />
          <path d="M120,120 L120,60 L220,60 L220,120" />
          <path d="M60,330 L140,150 M280,330 L200,150" />
        </svg>
        <div className="scanbox">
          <i /><i /><i /><i />
          <div className="scanline" />
          <ScanQR />
        </div>
      </div>
      <div className="locate-title">
        <div style={{ fontSize: 20, fontWeight: 800 }}>Where are you?</div>
        <div style={{ opacity: 0.8, fontSize: 13.5, marginTop: 4 }}>Point the camera at any marker sticker on a wall</div>
      </div>
      <div className="locate-bottom">
        <div className="small" style={{ opacity: 0.75, marginBottom: 4 }}>DEMO · tap a marker to simulate scanning it</div>
        <div className="chipscroll" data-testid="marker-chips">
          {v.markers.map((m) => (
            <button key={m.id} className="mchip" data-marker={m.id} onClick={() => ctl.scanMarker(m.id, true)}>
              {m.id}
              <small>
                {floorName(v, m.floor).replace("Floor ", "F")} · {m.name}
              </small>
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10, gap: 10 }}>
          <button className="pbtn block" style={{ background: "rgba(255,255,255,.14)", color: "#fff" }} onClick={() => ctl.openSearch("", true)}>
            📍 I can’t find a marker — choose manually
          </button>
        </div>
        <div className="small" style={{ opacity: 0.6, textAlign: "center", marginTop: 8 }}>The scan gives your exact spot, floor and direction — no GPS needed.</div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ arrived */
const mm = (sec: number) => (sec < 55 ? `${Math.max(5, Math.round(sec / 5) * 5)} sec` : `${Math.round(sec / 30) / 2} min`);

export function ArrivedScreen({ ctl, s }: P) {
  const a = s.arrived;
  return (
    <section className={`scr ${s.screen === "arrived" ? "on" : ""}`} id="s-arrived" data-testid="screen-arrived">
      <div className="check-big">✓</div>
      <div style={{ fontSize: 24, fontWeight: 800 }} data-testid="arrived-title">
        {a ? arrivedText(a.name, s.lang).replace(/\.$/, "") : "You have arrived"}
      </div>
      <div className="muted" style={{ margin: "4px 0 14px" }}>
        {a ? `${a.floorName} · ${a.sub}` : ""}
      </div>
      {a && (
        <div className="row" style={{ justifyContent: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <span className="chip">⏱ {mm(a.routeSec)}</span>
          <span className="chip">🚶 {Math.round(a.routeWalkM)} m</span>
          <span className="chip">📍 {a.scans} marker scan(s)</span>
        </div>
      )}
      <div className="adcard" style={{ background: "linear-gradient(135deg,#f7971e,#ffd200)", color: "#3a2a00", textAlign: "left" }}>
        <div className="small" style={{ fontWeight: 800, opacity: 0.8 }}>SPONSORED · PLACEHOLDER</div>
        <div style={{ fontSize: 18, fontWeight: 800, margin: "4px 0" }}>Lunch combo ₹99</div>
        <div className="small">SnackHub · Thali + chaas, 12–3 PM</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button className="pbtn primary block" onClick={() => { ctl.goMap(); ctl.openSearch(""); }}>Navigate somewhere else</button>
        <button className="pbtn block" data-testid="arrived-done" onClick={() => ctl.goMap()}>Done</button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ AR stub (Phase 4) */
export function ArStubScreen({ ctl, s }: P) {
  return (
    <section className={`scr ${s.screen === "ar" ? "on" : ""}`} id="s-ar" data-testid="screen-ar" style={{ background: "#000", color: "#fff", textAlign: "center" }}>
      <div style={{ position: "absolute", left: 24, right: 24, top: "34%" }}>
        <div style={{ fontSize: 48 }}>📷</div>
        <div style={{ fontSize: 20, fontWeight: 800, margin: "8px 0" }}>AR view arrives in Phase 4</div>
        <div style={{ opacity: 0.8, fontSize: 13.5 }}>Floor chevrons, turn arrows and wall ads will appear here. Navigation keeps running on the map meanwhile.</div>
        <button className="pbtn primary" style={{ marginTop: 18 }} onClick={() => ctl.leaveAr()}>🗺 Back to the map</button>
      </div>
    </section>
  );
}
