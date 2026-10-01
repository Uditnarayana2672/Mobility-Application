import { useEffect, useRef, useState } from "react";
import SpikeShell, { Btn, Readout, useLog } from "./SpikeShell";
import { StepDetector } from "@/core/steps";
import { HeadingIntegrator } from "@/core/heading";

interface DriftRun {
  seconds: number;
  driftDeg: number;
  driftPerMin: number;
}
interface StepRun {
  counted: number;
  actual: number;
  errorPct: number;
}

interface MotionPermissionCtor {
  requestPermission?: () => Promise<"granted" | "denied">;
}

export default function S4Page() {
  const { lines, log } = useLog();
  const steps = useRef(new StepDetector());
  const heading = useRef(new HeadingIntegrator(0));
  const [stepCount, setStepCount] = useState(0);
  const [bearing, setBearing] = useState(0);
  const [rate, setRate] = useState(0);
  const [hz, setHz] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [actualSteps, setActualSteps] = useState("50");
  const [stepRuns, setStepRuns] = useState<StepRun[]>([]);
  const [driftRuns, setDriftRuns] = useState<DriftRun[]>([]);
  const [driftStart, setDriftStart] = useState<{ t: number; total: number } | null>(null);
  const [notes, setNotes] = useState("");
  const sampleCount = useRef({ n: 0, t0: 0 });
  const lastT = useRef(0);

  useEffect(() => {
    if (!running) return;
    const onMotion = (e: DeviceMotionEvent) => {
      const t = performance.now();
      lastT.current = t;
      const a = e.accelerationIncludingGravity;
      const r = e.rotationRate;
      if (!a || a.x === null || a.y === null || a.z === null) return;
      steps.current.push(t, a.x, a.y, a.z);
      if (r && r.alpha !== null && r.beta !== null && r.gamma !== null) {
        heading.current.update(t, { alpha: r.alpha, beta: r.beta, gamma: r.gamma }, [a.x, a.y, a.z]);
        setRate(-(r.alpha * (a.z / 9.81) + r.beta * (a.x / 9.81) + r.gamma * (a.y / 9.81)));
      }
      sampleCount.current.n++;
      if (!sampleCount.current.t0) sampleCount.current.t0 = t;
    };
    window.addEventListener("devicemotion", onMotion);
    const ui = setInterval(() => {
      setStepCount(steps.current.steps);
      setBearing(heading.current.bearing);
      const { n, t0 } = sampleCount.current;
      if (t0) setHz(Math.round((n / ((performance.now() - t0) / 1000)) * 10) / 10);
    }, 150);
    return () => {
      window.removeEventListener("devicemotion", onMotion);
      clearInterval(ui);
    };
  }, [running]);

  const start = async () => {
    setError("");
    try {
      const DM = DeviceMotionEvent as unknown as MotionPermissionCtor;
      if (typeof DM.requestPermission === "function") {
        const p = await DM.requestPermission();
        if (p !== "granted") throw new Error("motion permission denied");
      }
      sampleCount.current = { n: 0, t0: 0 };
      setRunning(true);
      log("listening to devicemotion");
      setTimeout(() => {
        if (!sampleCount.current.n) {
          setError("No devicemotion events received. Check Chrome site settings → Motion sensors, and that the page is HTTPS.");
          log("no devicemotion events after 2 s");
        }
      }, 2000);
    } catch (e) {
      setError(String(e));
    }
  };

  const resetSteps = () => {
    steps.current.reset();
    setStepCount(0);
    log("step counter reset");
  };
  const recordSteps = () => {
    const actual = Number(actualSteps);
    if (!actual) return;
    const counted = steps.current.steps;
    const errorPct = ((counted - actual) / actual) * 100;
    setStepRuns((r) => [...r, { counted, actual, errorPct }]);
    log(`step run: counted ${counted}, actual ${actual} (${errorPct.toFixed(1)}%)`);
  };

  const driftBegin = () => {
    heading.current.reset(0);
    setDriftStart({ t: performance.now(), total: heading.current.total });
    log("drift test started: lay the phone still on a table");
  };
  const driftEnd = () => {
    if (!driftStart) return;
    const seconds = (performance.now() - driftStart.t) / 1000;
    const driftDeg = heading.current.total - driftStart.total;
    const run = { seconds, driftDeg, driftPerMin: (driftDeg / seconds) * 60 };
    setDriftRuns((r) => [...r, run]);
    setDriftStart(null);
    log(`drift: ${driftDeg.toFixed(2)} deg in ${seconds.toFixed(0)} s = ${run.driftPerMin.toFixed(2)} deg/min`);
  };

  const getResults = () => ({
    sampleRateHz: hz,
    stepRuns,
    driftRuns,
    notes,
  });

  const liveDrift = driftStart ? (heading.current.total - driftStart.total) / ((performance.now() - driftStart.t) / 1000) * 60 : null;

  return (
    <SpikeShell name="s4" title="S4 · Motion sensors" getResults={getResults} log={{ lines }}>
      <Btn disabled={running} onClick={start}>
        {running ? "Sensors on" : "Start sensors"}
      </Btn>
      {error && <div className="text-sm text-red-400">{error}</div>}
      <div className="grid grid-cols-2 gap-2">
        <Readout label="steps" value={stepCount} />
        <Readout label="heading °" value={bearing.toFixed(0)} />
        <Readout label="turn rate °/s" value={rate.toFixed(1)} />
        <Readout label="sample rate Hz" value={hz} warn={running && hz > 0 && hz < 20} />
      </div>

      <h2 className="font-semibold">Steps: pass = within ±5% over 50 steps</h2>
      <div className="flex items-end gap-2">
        <Btn className="bg-neutral-600" onClick={resetSteps}>
          Reset
        </Btn>
        <label className="flex-1 text-sm">
          Actual steps walked
          <input className="mt-1 w-full rounded bg-neutral-800 p-2" inputMode="numeric" value={actualSteps} onChange={(e) => setActualSteps(e.target.value)} />
        </label>
        <Btn onClick={recordSteps}>Record</Btn>
      </div>
      {stepRuns.map((r, i) => (
        <div key={i} className={`font-mono text-sm ${Math.abs(r.errorPct) <= 5 ? "text-emerald-300" : "text-red-400"}`}>
          run {i + 1}: {r.counted} vs {r.actual} → {r.errorPct.toFixed(1)}%
        </div>
      ))}

      <h2 className="font-semibold">Gyro heading drift: pass = under 10° per minute</h2>
      <div className="flex gap-2">
        <Btn disabled={!running || !!driftStart} onClick={driftBegin}>
          Start (phone still)
        </Btn>
        <Btn disabled={!driftStart} className="bg-emerald-700" onClick={driftEnd}>
          Stop (≥ 60 s)
        </Btn>
      </div>
      {liveDrift !== null && <div className="font-mono text-lg">{liveDrift.toFixed(1)} °/min so far</div>}
      {driftRuns.map((r, i) => (
        <div key={i} className={`font-mono text-sm ${Math.abs(r.driftPerMin) < 10 ? "text-emerald-300" : "text-red-400"}`}>
          run {i + 1}: {r.driftDeg.toFixed(1)}° in {r.seconds.toFixed(0)} s → {r.driftPerMin.toFixed(1)}°/min
        </div>
      ))}
      <p className="text-xs text-neutral-400">
        Also try: hold the phone upright (portrait) and slowly turn a full 360° on the spot; the heading should return to ≈ the start value (it counts clockwise).
      </p>
      <label className="block text-sm">
        Notes
        <textarea className="mt-1 w-full rounded bg-neutral-800 p-2" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
    </SpikeShell>
  );
}
