import { useEffect, useMemo, useRef, useState } from "react";
import { fmtTime, LANGS, type Lang } from "@/core/instructions";
import { isRouteError, route as computeRoute } from "@/core/route";
import { search } from "@/core/search";
import type { Target } from "@/core/intent";
import type { NavController, NavState } from "./controller";
import { EXAMPLES } from "./messages";
import { floorName, placeOf } from "./places";
import { listenOnce, recognitionSupported } from "./recognizer";
import { NO_CAPS, speechCaps, type SpeechCaps } from "@/speech/client";
import { recordLocal, type Listener } from "@/speech/recorder";

type P = { ctl: NavController; s: NavState };

/* ------------------------------------------------------------------ search */
export function SearchOverlay({ ctl, s }: P) {
  const [q, setQ] = useState(s.searchSeed);
  const inp = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => inp.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);
  const rows = useMemo<Target[]>(() => {
    const v = s.venue;
    const text = q.trim();
    if (!text && s.pickLoc) {
      // Choosing where you start: the entrances ("gates") first, then every place.
      const gates: Target[] = v.pois.filter((p) => p.kind === "entrance" || p.kind === "exit").map((p) => ({ poi: p.id }));
      return [...gates, ...v.rooms.filter((r) => r.access !== "staff").map((r): Target => ({ room: r.id }))].slice(0, 40);
    }
    if (!text) {
      return v.rooms
        .filter((r) => r.access !== "staff")
        .slice()
        .sort((a, b) => (a.cat === "food" ? -1 : 0) - (b.cat === "food" ? -1 : 0))
        .slice(0, 8)
        .map((r) => ({ room: r.id }));
    }
    return search(v, text)
      .slice(0, 12)
      .map((h): Target => (h.type === "room" ? { room: h.id } : { poi: h.id }));
  }, [q, s.venue]);
  const u = s.user;
  const ests = useMemo(
    () =>
      rows.map((t) => {
        if (!u || s.pickLoc) return null;
        const r = computeRoute(s.venue, { floor: u.floor, x: u.x, y: u.y, heading: u.heading }, t, s.prefs);
        return isRouteError(r) ? null : r.time;
      }),
    [rows, u, s.pickLoc, s.venue, s.prefs],
  );
  const text = q.trim();
  return (
    <div className="ov on" id="searchOv" data-testid="search-overlay">
      <div className="sbar">
        <button className="pbtn sm" data-testid="search-back" onClick={() => ctl.closeOverlay()}>←</button>
        <input
          ref={inp}
          value={q}
          data-testid="search-input"
          onChange={(e) => setQ(e.target.value)}
          placeholder={s.pickLoc ? "Where are you right now?" : "Search — try ‘canteen’, ‘khana’, ‘టాయిలెట్’"}
          autoComplete="off"
        />
        <button className="mic" style={{ width: 40, height: 40, borderRadius: "50%", border: 0, background: "#eef1f6", fontSize: 18, cursor: "pointer" }} aria-label="voice" onClick={() => ctl.openVoice()}>🎤</button>
      </div>
      <div className="results" data-testid="search-results">
        {!text && <div className="muted small" style={{ padding: "10px 4px" }}>{s.pickLoc ? "Entrances first, then places" : "Suggestions"}</div>}
        {text && rows.length === 0 && <div className="muted" style={{ padding: "24px 8px", textAlign: "center" }}>No match. Try “canteen”, “toilet”, “Everest”…</div>}
        {rows.map((t, i) => {
          const p = placeOf(s.venue, t);
          if (!p) return null;
          return (
            <div
              key={`${p.kind}:${p.id}`}
              className="qrow"
              data-testid="search-row"
              data-id={p.id}
              onClick={() => (s.pickLoc ? ctl.setLocationManually(p) : (ctl.closeOverlay(), ctl.showPlace(t)))}
            >
              <div className="ic">{p.icon}</div>
              <div className="t">
                {p.name}
                <small>
                  {p.sub}
                  {p.staffOnly ? " · 🔒 staff only" : ""}
                </small>
              </div>
              <div className="r">{ests[i] != null ? fmtTime(ests[i] as number) : ""}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ voice */
const LANG_BTNS: [Lang, string][] = [["en", "EN"], ["hi", "Hinglish"], ["te", "తెలుగు"]];

export function VoiceOverlay({ ctl, s }: P) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const [status, setStatus] = useState("Tap to speak");
  const stopRef = useRef<() => void>(() => undefined);
  const busy = useRef(false);
  const chat = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (chat.current) chat.current.scrollTop = 1e6;
  }, [s.chat]);
  useEffect(() => () => stopRef.current(), []);
  const [caps, setCaps] = useState<SpeechCaps>(NO_CAPS);
  useEffect(() => {
    let live = true;
    void speechCaps().then((c) => live && setCaps(c));
    return () => {
      live = false;
    };
  }, []);
  // The local Whisper server first (nothing leaves the building); the browser's own recogniser only if the server has none.
  const supported = caps.stt || recognitionSupported();
  const send = (t: string) => {
    if (t.trim()) void ctl.askText(t);
  };
  const startMic = () => {
    if (!supported) {
      setStatus("Speech recognition isn’t available here — type or tap an example.");
      return;
    }
    if (listening || busy.current) return;
    busy.current = true;
    ctl.cancelSpeech();
    setPartial("");
    const onStart = () => {
      setListening(true);
      setStatus("Listening… release to send");
    };
    const l: Listener = caps.stt
      ? recordLocal(s.lang, {
          onStart,
          onPhase: (p) => {
            if (p === "transcribing") {
              setListening(false);
              setStatus(caps.sttState === "ready" ? "Understanding…" : "Loading the local speech model (first time only)…");
            }
          },
        })
      : listenOnce(s.lang, onStart, setPartial);
    stopRef.current = l.stop;
    void l.result.then((r) => {
      busy.current = false;
      setListening(false);
      if (r.ok) {
        setPartial(r.text);
        setStatus("Tap to speak");
        send(r.text);
      } else
        setStatus(
          r.reason === "denied" ? "Microphone permission denied — type instead."
          : r.reason === "no-speech" ? "Couldn’t hear that — try again or type."
          : caps.stt ? "The local speech server didn’t answer — type instead."
          : "Couldn’t hear that — try typing.",
        );
    });
  };
  const stopMic = () => {
    stopRef.current();
  };
  return (
    <div className="ov on" id="voiceOv" data-testid="voice-overlay">
      <div className="dim" onClick={() => ctl.closeOverlay()} />
      <div className="sheet" style={{ paddingBottom: 22 }}>
        <div className="handle" />
        <div className="row" style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Ask Dora.AI</div>
          <span className="spacer" />
          <div className="seg2">
            {LANG_BTNS.map(([l, label]) => (
              <button key={l} data-l={l} className={s.lang === l ? "on" : ""} onClick={() => ctl.setLang(l)}>{label}</button>
            ))}
          </div>
        </div>
        <div ref={chat} style={{ maxHeight: 200, overflow: "auto" }} data-testid="voice-chat">
          {s.chat.map((c, i) => (
            <div key={i} className={`bubble ${c.me ? "me" : "bot"}`}>{c.text}</div>
          ))}
        </div>
        <div style={{ textAlign: "center", margin: "12px 0 6px" }}>
          <button
            className={`mic-big ${listening ? "listening" : ""}`}
            data-testid="voice-mic"
            aria-label="Hold to talk"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); startMic(); }}
            onPointerUp={stopMic}
            onPointerCancel={stopMic}
            onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) startMic(); }}
            onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") stopMic(); }}
          >🎤</button>
          <div className="muted small" style={{ marginTop: 8 }} data-testid="voice-state">{status}</div>
          {partial && <div className="voice-partial" data-testid="voice-partial">{partial}</div>}
        </div>
        <div className="row voice-in" style={{ marginBottom: 8 }}>
          <input
            type="text"
            data-testid="voice-input"
            value={text}
            placeholder="…or type here"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                send(text);
                setText("");
              }
            }}
          />
          <button className="pbtn primary sm" data-testid="voice-send" onClick={() => { send(text); setText(""); }}>Send</button>
        </div>
        <div className="chipscroll">
          {EXAMPLES[s.lang].map((e) => (
            <button key={e} className="mchip" style={{ background: "#eef2fd", borderColor: "#d5def8", color: "#2f5bea" }} onClick={() => send(e)}>{e}</button>
          ))}
        </div>
        <div className="small muted" style={{ marginTop: 4 }}>Hold the mic to talk. {caps.stt ? "Speech is understood on this machine (nothing is sent to a cloud service)." : "Using the browser’s speech recognition."} {LANGS[s.lang].speech}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ floor change */
export function TransitionOverlay({ s }: P) {
  const tr = s.sim.trans;
  if (!tr || s.mode !== "nav") return null;
  const lift = tr.via === "lift";
  const title = lift ? (tr.t > tr.dur * 0.45 ? "Riding the lift…" : "Waiting for the lift…") : "Taking the stairs…";
  return (
    <div className="ov on" id="transOv" data-testid="transition">
      <div className="stairs-anim"><span>{lift ? "🛗" : "🪜"}</span></div>
      <div style={{ fontSize: 22, fontWeight: 800 }}>{title}</div>
      <div style={{ opacity: 0.8, marginTop: 6 }}>{floorName(s.venue, tr.fromFloor)} → {floorName(s.venue, tr.toFloor)}</div>
      <div className="progbar"><i style={{ width: `${Math.min(100, (tr.t / tr.dur) * 100)}%` }} /></div>
      <div className="small" style={{ opacity: 0.7 }}>AR tracking pauses between floors. A marker in the lobby will confirm where you are.</div>
    </div>
  );
}

export function FloorPromptOverlay({ ctl, s }: P) {
  const fp = s.floorPrompt;
  if (!fp || s.mode !== "nav") return null;
  const name = floorName(s.venue, fp.floor);
  return (
    <div className="ov on" id="floorOv" data-testid="floor-prompt">
      <div className="dim" />
      <div className="fpr">
        <div style={{ fontSize: 34 }}>🏢</div>
        <div style={{ fontSize: 19, fontWeight: 800, margin: "4px 0" }}>Are you on {name} now?</div>
        <div className="muted small" style={{ marginBottom: 14 }}>Floors can’t be sensed by a web app — scan the lobby marker or tap Yes.</div>
        <div className="row" style={{ justifyContent: "center" }}>
          <button className="pbtn green" data-testid="floor-yes" onClick={() => ctl.confirmFloor("tap")}>Yes, {name}</button>
          <button className="pbtn" data-testid="floor-scan" onClick={() => ctl.confirmFloor("marker")}>📍 Scan marker</button>
        </div>
        <div className="small muted" style={{ marginTop: 10 }}>{fp.autoInSec !== null ? `Auto-confirming from lobby marker in ${fp.autoInSec} s…` : ""}</div>
      </div>
    </div>
  );
}

export function CaptionToast({ s }: { s: NavState }) {
  return (
    <>
      <div className={`caption ${s.caption ? "show" : ""} ${s.screen === "ar" || s.mode !== "nav" ? "top" : ""}`} data-testid="caption" aria-live="polite">
        {s.caption ? `${s.caption.spoken ? "🔊" : "💬"} ${s.caption.text}` : ""}
      </div>
      <div className={`ptoast ${s.toast ? "show" : ""}`} data-testid="toast" role="status">{s.toast?.text ?? ""}</div>
    </>
  );
}
