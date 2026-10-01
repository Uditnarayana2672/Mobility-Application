import { useEffect, useRef, useState } from "react";
import SpikeShell, { Btn, Readout, useLog } from "./SpikeShell";
import { arSupported, blockXrSelect, startAr, type ArHandle } from "./ar";

interface Live {
  tracking: string;
  frames: number;
  lostEvents: number;
  limitedEvents: number;
  lostFrames: number;
  distanceM: number;
  seconds: number;
  x: number;
  z: number;
}
const fresh = (): Live => ({ tracking: "idle", frames: 0, lostEvents: 0, limitedEvents: 0, lostFrames: 0, distanceM: 0, seconds: 0, x: 0, z: 0 });

/** Full-screen DOM overlay (a placeholder "map" with a moving dot) on top of immersive-ar, to test whether tracking survives it. */
export default function S5Page() {
  const overlay = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const ar = useRef<ArHandle | null>(null);
  const live = useRef<Live>(fresh());
  const [view, setView] = useState<Live>(live.current);
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [runs, setRuns] = useState<Live[]>([]);
  const [notes, setNotes] = useState("");
  const { lines, log } = useLog();

  useEffect(() => {
    void arSupported().then(setSupported);
    blockXrSelect(hud.current);
    const t = setInterval(() => setView({ ...live.current }), 100);
    return () => {
      clearInterval(t);
      ar.current?.stop();
    };
  }, []);

  const start = async () => {
    setError("");
    live.current = fresh();
    let last = "idle";
    let prev: { x: number; z: number } | null = null;
    let t0 = 0;
    try {
      ar.current = await startAr({
        overlay: overlay.current!,
        optionalFeatures: ["dom-overlay"],
        onFrame: ({ time, viewerPose, tracking }) => {
          const L = live.current;
          if (!t0) t0 = time;
          L.seconds = (time - t0) / 1000;
          L.frames++;
          L.tracking = tracking;
          if (tracking === "lost") L.lostFrames++;
          if (tracking !== last) {
            if (tracking === "lost") L.lostEvents++;
            if (tracking === "limited") L.limitedEvents++;
            log(`tracking ${last} -> ${tracking} at ${L.seconds.toFixed(1)} s`);
            last = tracking;
          }
          if (viewerPose) {
            const p = viewerPose.transform.position;
            if (prev) L.distanceM += Math.hypot(p.x - prev.x, p.z - prev.z);
            prev = { x: p.x, z: p.z };
            L.x = p.x;
            L.z = p.z;
          }
        },
        onEnd: () => {
          setActive(false);
          setRuns((r) => [...r, { ...live.current }]);
          log("session ended; run recorded");
          ar.current = null;
        },
      });
      log(`enabled features: ${ar.current.enabledFeatures.join(", ") || "(not reported)"}`);
      setActive(true);
    } catch (e) {
      setError(String(e));
      log(`start failed: ${String(e)}`);
    }
  };

  const getResults = () => ({
    arSupported: supported,
    runs: runs.map((r) => ({
      durationS: Math.round(r.seconds),
      walkedM: Number(r.distanceM.toFixed(1)),
      trackingLostEvents: r.lostEvents,
      trackingLimitedEvents: r.limitedEvents,
      lostFramesPct: r.frames ? Number(((100 * r.lostFrames) / r.frames).toFixed(2)) : 0,
    })),
    notes,
  });

  // Dot position on the fake map: 1 m = 30 px around the screen centre.
  const dot = { left: `calc(50% + ${view.x * 30}px)`, top: `calc(50% + ${view.z * 30}px)` };

  return (
    <SpikeShell name="s5" title="S5 · Overlay-covered AR tracking" getResults={getResults} log={{ lines }}>
      <p className="text-sm text-neutral-300">
        Starts AR with an opaque-looking map overlay covering about 90% of the screen. Walk about 30 m for 2 minutes holding the phone as you would while navigating, then
        tap Exit. Pass: few or no tracking-lost events, and the dot follows you.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Readout label="immersive-ar" value={supported === null ? "…" : supported ? "supported" : "NO"} warn={supported === false} />
        <Readout label="tracking" value={view.tracking} warn={view.tracking === "lost"} />
      </div>
      <Btn disabled={!supported || active} onClick={start}>
        Start AR with map overlay
      </Btn>
      {error && <div className="text-sm text-red-400">{error}</div>}
      {runs.map((r, i) => (
        <div key={i} className="font-mono text-sm">
          run {i + 1}: {r.seconds.toFixed(0)} s, {r.distanceM.toFixed(1)} m, lost {r.lostEvents}, limited {r.limitedEvents}
        </div>
      ))}
      <label className="block text-sm">
        Notes (lighting, how you held the phone, did the dot match your walk?)
        <textarea className="mt-1 w-full rounded bg-neutral-800 p-2" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div ref={overlay} style={{ display: active ? "block" : "none" }} className="fixed inset-0 z-10">
        {/* Fake map covering ~90% of the screen; the camera is visible only in the top/bottom strips. */}
        <div
          className="absolute inset-x-0 overflow-hidden bg-slate-100"
          style={{ top: "5%", bottom: "5%", backgroundImage: "linear-gradient(#cbd5e1 1px, transparent 1px), linear-gradient(90deg, #cbd5e1 1px, transparent 1px)", backgroundSize: "30px 30px" }}
        >
          <div className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-600 shadow" style={dot} />
          <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-400" />
        </div>
        <div ref={hud} className="absolute inset-x-0 top-0 flex items-center gap-2 bg-black/70 p-2 font-mono text-sm text-white">
          <div className="flex-1">
            {view.tracking} · {view.seconds.toFixed(0)} s · {view.distanceM.toFixed(1)} m · lost {view.lostEvents} · limited {view.limitedEvents}
          </div>
          <button className="rounded bg-red-600 px-3 py-2 font-bold" onClick={() => ar.current?.stop()}>
            Exit
          </button>
        </div>
      </div>
    </SpikeShell>
  );
}
