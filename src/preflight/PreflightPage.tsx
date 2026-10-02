import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { detectMarkers } from "@/spikes/aruco/detect";
import { useVenue } from "@/shared/useVenue";
import "./preflight.css";

type Status = "checking" | "pass" | "fail";
interface Check { label: string; status: Status; detail: string }

const initial: Record<string, Check> = {
  certificate: { label: "Certificate / secure context", status: "checking", detail: "Checking…" },
  sensor: { label: "Motion sensor permission", status: "checking", detail: "Tap Run phone checks" },
  xr: { label: "WebXR immersive AR", status: "checking", detail: "Checking…" },
  voices: { label: "English, Hindi and Telugu voices", status: "checking", detail: "Loading voices…" },
  server: { label: "Demo server reachable", status: "checking", detail: "Checking…" },
  venue: { label: "Published venue version", status: "checking", detail: "Loading…" },
  marker: { label: "Live marker detection", status: "checking", detail: "Tap Run phone checks, then show a marker" },
};

type MotionCtor = typeof DeviceMotionEvent & { requestPermission?: () => Promise<"granted" | "denied"> };

export default function PreflightPage() {
  const venue = useVenue();
  const [checks, setChecks] = useState(initial);
  const [running, setRunning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<() => void>(() => undefined);
  const set = (key: string, status: Status, detail: string) => setChecks((old) => ({ ...old, [key]: { ...old[key]!, status, detail } }));

  useEffect(() => {
    set("certificate", window.isSecureContext && location.protocol === "https:" ? "pass" : "fail", window.isSecureContext ? `${location.protocol}// is trusted` : "This origin is not trusted; install/accept the LAN certificate");
    void fetch("/api/health", { cache: "no-store" }).then((r) => set("server", r.ok ? "pass" : "fail", r.ok ? "Health endpoint replied" : `HTTP ${r.status}`)).catch(() => set("server", "fail", "Server unreachable"));
    const nav = navigator as Navigator & { xr?: { isSessionSupported(mode: "immersive-ar"): Promise<boolean> } };
    if (!nav.xr) set("xr", "fail", "navigator.xr is unavailable");
    else void nav.xr.isSessionSupported("immersive-ar").then((ok) => set("xr", ok ? "pass" : "fail", ok ? "immersive-ar supported" : "immersive-ar not supported")).catch(() => set("xr", "fail", "WebXR support check failed"));
    const voices = () => {
      const list = speechSynthesis.getVoices();
      const have = (prefix: string) => list.some((v) => v.lang.toLowerCase().startsWith(prefix));
      const wanted: Array<[string, string]> = [["en", "English"], ["hi", "Hindi"], ["te", "Telugu"]];
      const missing = wanted.filter(([p]) => !have(p)).map(([, n]) => n);
      set("voices", missing.length ? "fail" : "pass", missing.length ? `Missing: ${missing.join(", ")}` : "All three language voices found");
    };
    voices();
    speechSynthesis.addEventListener("voiceschanged", voices);
    return () => { speechSynthesis.removeEventListener("voiceschanged", voices); stopRef.current(); };
  }, []);

  useEffect(() => {
    if (venue.status === "ready") set("venue", venue.source === "api" ? "pass" : "fail", `${venue.venue.name} v${venue.venue.version} · ${venue.source === "api" ? "published server copy" : "bundled offline copy"}`);
    else if (venue.status === "missing") set("venue", "fail", `Venue ${venue.id} not found`);
  }, [venue]);

  const runPhoneChecks = async () => {
    stopRef.current();
    setRunning(true);
    const Motion = DeviceMotionEvent as MotionCtor;
    try {
      if (typeof Motion.requestPermission === "function") {
        const p = await Motion.requestPermission();
        set("sensor", p === "granted" ? "pass" : "fail", p === "granted" ? "Motion permission granted" : "Motion permission denied");
      } else if ("DeviceMotionEvent" in window) set("sensor", "pass", "Motion API available (no prompt required)");
      else set("sensor", "fail", "Motion API unavailable");
    } catch (e) { set("sensor", "fail", `Sensor check failed: ${String(e)}`); }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 640 } }, audio: false });
      const el = video.current!;
      el.srcObject = stream;
      await el.play();
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      let stopped = false;
      const timer = setInterval(() => {
        if (!el.videoWidth || stopped) return;
        canvas.width = Math.min(640, el.videoWidth);
        canvas.height = Math.round((canvas.width / el.videoWidth) * el.videoHeight);
        ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
        const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const gray = new Uint8Array(canvas.width * canvas.height);
        for (let i = 0, p = 0; p < gray.length; i += 4, p++) gray[p] = Math.round(rgba.data[i]! * 0.299 + rgba.data[i + 1]! * 0.587 + rgba.data[i + 2]! * 0.114);
        const found = detectMarkers({ data: gray, width: canvas.width, height: canvas.height });
        if (found.length) set("marker", "pass", `Detected marker ${found.map((d) => `#${d.id}`).join(", ")}`);
        else set("marker", "checking", "Camera live · show a printed marker");
      }, 250);
      stopRef.current = () => { stopped = true; clearInterval(timer); stream.getTracks().forEach((t) => t.stop()); };
    } catch (e) { set("marker", "fail", `Camera unavailable: ${String(e)}`); }
    setRunning(false);
  };

  const reset = async () => {
    const id = venue.status === "ready" ? venue.venue.id : "office-hq";
    try { await fetch(`/api/demo/reset/${encodeURIComponent(id)}`, { method: "POST" }); } catch { /* status below explains it */ }
  };
  const values = Object.values(checks);
  const pass = values.filter((c) => c.status === "pass").length;

  return <main className="preflight">
    <header><div><Link to="/">← Hub</Link><h1>Demo preflight</h1><p>{pass}/{values.length} checks green. Run this on the demo phone.</p></div><div className={`score ${pass === values.length ? "all" : ""}`}>{pass}/{values.length}</div></header>
    <section className="checks">
      {Object.entries(checks).map(([key, c]) => <article key={key} className={c.status} data-testid={`check-${key}`}><i>{c.status === "pass" ? "✓" : c.status === "fail" ? "×" : "…"}</i><div><b>{c.label}</b><span>{c.detail}</span></div></article>)}
    </section>
    <section className="actions">
      <button className="primary" disabled={running} onClick={() => void runPhoneChecks()}>{running ? "Phone checks running" : "Run phone checks"}</button>
      <button onClick={() => void reset()}>Reset entire demo</button>
      <Link className="button" to="/nav">Open visitor app</Link>
      <Link className="button" to="/dashboard">Open dashboard</Link>
    </section>
    <video ref={video} muted playsInline className="camera" aria-label="Live marker test camera" />
    <p className="note">Marker detection runs locally at 4 Hz. No camera frames or audio are uploaded.</p>
  </main>;
}
