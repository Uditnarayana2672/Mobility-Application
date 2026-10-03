import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { doorOutward } from "@/core/doors";
import type { Pose } from "@/navigator/poseSource";
import { startTicker } from "@/navigator/ticker";
import { PdrPoseSource } from "@/positioning/pdrPoseSource";
import { useVenue } from "@/shared/useVenue";
import type { Venue } from "@/core/schema";
import { MapCanvas } from "@/ui/map";

/**
 * Survey walk: walk through the building holding the phone like a camera. Every metre or so a picture is saved with the position the
 * app believes you are at. From those pictures the server builds the index that lets the app recognise places by sight.
 * Start at a marker (point the camera at it) or tell it which room's door you stand at; scan a marker again now and then to fix drift.
 */
const MIN_STEP_M = 0.8;
const MIN_TURN_DEG = 25;
const MAX_ACC = 3;

interface Status {
  count: number;
  floors: Record<string, number>;
  index: { builtAt: string; items: number; model: string; eval: { hitRate: number; medianErrM: number; wrongLockRate: number; answerRate: number; passed: boolean; items: number } | null } | null;
  building: boolean;
}

const pct = (n: number) => `${Math.round(n * 100)} %`;

function Survey({ venue }: { venue: Venue }) {
  const video = useRef<HTMLVideoElement>(null);
  const src = useMemo(() => new PdrPoseSource(venue), [venue]);
  const [pose, setPose] = useState<Pose | null>(null);
  const [camera, setCamera] = useState(false);
  const [recording, setRecording] = useState(false);
  const [saved, setSaved] = useState<{ x: number; y: number; floor: string }[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const last = useRef<{ x: number; y: number; heading: number; floor: string } | null>(null);
  const uploading = useRef(false);
  const [floor, setFloor] = useState(venue.floors[0]!.id);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/survey/${venue.id}`, { cache: "no-store" });
      if (r.ok) setStatus((await r.json()) as Status);
    } catch {
      /* offline */
    }
  }, [venue.id]);

  useEffect(() => {
    void refresh();
    src.start();
    const off = src.subscribe((p) => {
      setPose(p);
      setFloor(p.floor);
    });
    const stop = startTicker((dt) => src.tick(dt));
    return () => {
      off();
      stop();
      src.stop();
    };
  }, [src, refresh]);

  const startCamera = async () => {
    if (!video.current) return;
    try {
      await src.startCamera(video.current);
      setCamera(true);
      setMsg((m) => m || "Point the camera at a marker, or choose a room below.");
    } catch (e) {
      setMsg(`Camera: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const startAtRoom = (roomId: string) => {
    const r = venue.rooms.find((x) => x.id === roomId);
    if (!r) return;
    const out = doorOutward(r.door);
    const back = ((out + 180) * Math.PI) / 180;
    src.applyFix({ floor: r.floor, x: r.door.x + Math.sin(back) * 1.2, y: r.door.y - Math.cos(back) * 1.2, heading: out, acc: 2, markerId: null });
    setMsg(`Standing just inside ${r.name}, facing its door. Now walk.`);
  };

  const capture = useCallback(async (p: Pose) => {
    const v = video.current;
    if (!v || v.videoWidth === 0 || uploading.current) return;
    uploading.current = true;
    try {
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = Math.round((320 * v.videoHeight) / v.videoWidth);
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.8));
      if (!blob) return;
      const q = new URLSearchParams({ floor: p.floor, x: p.x.toFixed(2), y: p.y.toFixed(2), heading: p.heading.toFixed(0), acc: p.acc.toFixed(1) });
      const res = await fetch(`/api/survey/${venue.id}/frames?${q}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
      if (res.ok) {
        last.current = { x: p.x, y: p.y, heading: p.heading, floor: p.floor };
        setSaved((s) => [...s, { x: p.x, y: p.y, floor: p.floor }]);
      } else setMsg(`Upload refused: ${(await res.json().catch(() => ({ error: res.status }))).error}`);
    } finally {
      uploading.current = false;
    }
  }, [venue.id]);

  // Save a picture each time you have moved about a metre (or turned a lot) and the position is reasonably sure.
  useEffect(() => {
    if (!recording || !pose || pose.stale || pose.acc > MAX_ACC) return;
    const l = last.current;
    const moved = !l || l.floor !== pose.floor || Math.hypot(pose.x - l.x, pose.y - l.y) >= MIN_STEP_M;
    const turned = !!l && Math.abs(((pose.heading - l.heading + 540) % 360) - 180) >= MIN_TURN_DEG;
    if (moved || turned) void capture(pose);
  }, [recording, pose, capture]);

  // Keep the "N pictures saved" count honest: refresh when recording stops and every few pictures.
  useEffect(() => {
    if (!recording) void refresh();
  }, [recording, refresh]);
  useEffect(() => {
    if (saved.length > 0 && saved.length % 5 === 0) void refresh();
  }, [saved.length, refresh]);

  const build = async () => {
    setBusy(true);
    setMsg("Building the index: reading every picture with the image model…");
    try {
      const r = await fetch(`/api/survey/${venue.id}/build`, { method: "POST" });
      const j = await r.json();
      setMsg(r.ok ? (j.eval?.passed ? "Index built. It passed its own accuracy test, so phones will use it automatically." : "Index built, but it did NOT pass the accuracy test: phones will not use it unless ?vpr=1. Survey more (both directions, more landmarks).") : `Build failed: ${j.error}`);
    } catch (e) {
      setMsg(`Build failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const clear = async () => {
    if (!window.confirm("Delete all survey pictures and the index of this venue?")) return;
    await fetch(`/api/survey/${venue.id}`, { method: "DELETE" });
    setSaved([]);
    last.current = null;
    void refresh();
  };

  const ev = status?.index?.eval;
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3 p-3 text-sm" data-testid="survey-page">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-extrabold">Survey walk · {venue.name}</h1>
        <Link to="/" className="text-blue-700 underline">back</Link>
      </div>
      <p className="text-slate-600">
        Walk slowly through every corridor and room, in both directions, holding the phone upright like a camera. A picture is saved about every metre with the position the app believes you are at. Scan a marker now and then to correct drift.
      </p>
      <div className="relative overflow-hidden rounded-lg bg-black" style={{ aspectRatio: "4/3" }}>
        <video ref={video} playsInline muted className="h-full w-full object-cover" data-testid="survey-video" />
        {!camera && <button className="absolute inset-0 m-auto h-12 w-56 rounded-lg bg-blue-600 font-bold text-white" onClick={() => void startCamera()}>📷 Start the camera</button>}
        {pose && <div className="absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-xs text-white">{pose.source} · {pose.floor} · {pose.x.toFixed(1)}, {pose.y.toFixed(1)} · ±{pose.acc.toFixed(1)} m</div>}
        {recording && <div className="absolute right-2 top-2 rounded bg-red-600 px-2 py-1 text-xs font-bold text-white">● REC {saved.length}</div>}
      </div>

      {!pose && (
        <label className="flex flex-col gap-1">
          <b>Or start from a room (stand just inside it, facing its door):</b>
          <select className="rounded border border-slate-300 p-2" defaultValue="" onChange={(e) => e.target.value && startAtRoom(e.target.value)} data-testid="survey-start-room">
            <option value="" disabled>Choose a room…</option>
            {venue.rooms.map((r) => <option key={r.id} value={r.id}>{r.name} ({venue.floors.find((f) => f.id === r.floor)?.name})</option>)}
          </select>
        </label>
      )}

      <div className="flex gap-2">
        <button className={`flex-1 rounded-lg px-3 py-3 font-bold text-white ${recording ? "bg-red-600" : "bg-emerald-600"} disabled:opacity-40`} disabled={!camera || !pose} onClick={() => setRecording((r) => !r)} data-testid="survey-record">
          {recording ? "■ Stop recording" : "● Start recording"}
        </button>
        <button className="rounded-lg border border-slate-300 px-3 py-3 font-semibold disabled:opacity-40" disabled={busy || recording || !(status?.count || saved.length)} onClick={() => void build()} data-testid="survey-build">Build index</button>
      </div>
      {msg && <div className="rounded border border-slate-200 bg-slate-50 p-2" data-testid="survey-msg">{msg}</div>}

      <div className="relative h-56 overflow-hidden rounded-lg border border-slate-200">
        <MapCanvas venue={venue} floorId={floor} decor={false} user={pose ? { floor: pose.floor, x: pose.x, y: pose.y, heading: pose.heading, acc: pose.acc } : null}>
          {(view) => (
            <g style={{ pointerEvents: "none" }}>
              {saved.filter((s) => s.floor === floor).map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={3 / view.scale} fill="#10b981" opacity={0.8} />)}
            </g>
          )}
        </MapCanvas>
      </div>

      <div className="rounded border border-slate-200 p-2" data-testid="survey-status">
        <b>{status?.count ?? 0}</b> pictures saved{status && Object.keys(status.floors).length ? ` (${Object.entries(status.floors).map(([f, n]) => `${f}: ${n}`).join(", ")})` : ""}.
        {status?.index ? (
          <div className="mt-1">
            Index built {new Date(status.index.builtAt).toLocaleString()} from {status.index.items} pictures.
            {ev ? (
              <div className={ev.passed ? "text-emerald-700" : "text-amber-700"}>
                Self-test: right place {pct(ev.hitRate)} of the time, typical error {ev.medianErrM.toFixed(1)} m, wrong confident answers {pct(ev.wrongLockRate)}, answered {pct(ev.answerRate)}. {ev.passed ? "✔ Passed: phones use it automatically." : "✘ Not good enough yet: needs 20+ pictures, ≥ 90 % right, error ≤ 2 m, ≤ 3 % wrong."}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-1 text-slate-500">No index yet.</div>
        )}
        <button className="mt-2 text-xs text-red-700 underline" onClick={() => void clear()}>Delete the survey of this venue</button>
      </div>
    </div>
  );
}

export default function SurveyPage() {
  const v = useVenue();
  if (v.status === "loading") return <div className="p-6 text-neutral-500">Loading the map…</div>;
  if (v.status === "missing") return <div className="p-6">Venue “{v.id}” not found.</div>;
  return <Survey venue={v.venue} />;
}
