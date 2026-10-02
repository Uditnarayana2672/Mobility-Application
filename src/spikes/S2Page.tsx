import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Link } from "react-router-dom";
import SpikeShell, { Btn, Readout, useLog } from "./SpikeShell";
import { arSupported, blockXrSelect, startAr, type ArHandle } from "./ar";
import { CameraReader } from "./camera";
import { detectMarkers } from "./aruco/detect";
import { hfovFromSquare, intrinsicsFromProjection, meanSidePx, solveMarkerPose, type Intrinsics } from "./aruco/pose";
import { MARKER_SIZE_M, MARKER_SIZE_MM } from "./aruco/print";

interface Seen {
  id: number;
  distance: number;
}
interface Sample {
  path: "A" | "B";
  id: number;
  tapeM: number;
  estimatedM: number;
}

const FOV_KEY = "indore.s2.hfov";
const DEFAULT_HFOV = 65;

function loadHfov(): number | null {
  try {
    const v = Number(localStorage.getItem(FOV_KEY));
    return v > 20 && v < 140 ? v : null;
  } catch {
    return null;
  }
}

// OpenCV camera (x right, y down, z fwd) -> WebXR camera (x right, y up, z back): rotate 180 deg about x.
const CV_TO_XR = new THREE.Matrix4().makeScale(1, -1, -1);

function poseMatrix(R: number[], t: number[]): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  m.set(R[0]!, R[1]!, R[2]!, t[0]!, R[3]!, R[4]!, R[5]!, t[1]!, R[6]!, R[7]!, R[8]!, t[2]!, 0, 0, 0, 1);
  return m;
}

export default function S2Page() {
  const overlay = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const ar = useRef<ArHandle | null>(null);
  const seenRef = useRef<Seen[]>([]);
  const statsRef = useRef({ frames: 0, processed: 0, detections: 0, flipY: false, firstDetectionMs: null as number | null, lastMs: 0, cameraFrames: 0 });
  const [seen, setSeen] = useState<Seen[]>([]);
  const [stats, setStats] = useState({ ...statsRef.current });
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [tape, setTape] = useState("");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [path, setPath] = useState<"A" | "B" | null>(null);
  const [notes, setNotes] = useState("");
  const { lines, log } = useLog();

  // Fallback B
  const video = useRef<HTMLVideoElement>(null);
  const stopB = useRef<(() => void) | null>(null);
  const hfovRef = useRef<number>(loadHfov() ?? DEFAULT_HFOV);
  const [hfov, setHfov] = useState<number | null>(loadHfov());
  const lastB = useRef<{ side: number; width: number } | null>(null);

  useEffect(() => {
    void arSupported().then(setSupported);
    blockXrSelect(hud.current);
    const t = setInterval(() => {
      setSeen([...seenRef.current]);
      setStats({ ...statsRef.current });
    }, 200);
    return () => {
      clearInterval(t);
      ar.current?.stop();
      stopB.current?.();
    };
  }, []);

  const startA = async () => {
    setError("");
    setPath("A");
    Object.assign(statsRef.current, { frames: 0, processed: 0, detections: 0, firstDetectionMs: null, cameraFrames: 0 });
    try {
      let reader: CameraReader | null = null;
      const axes = new Map<number, THREE.AxesHelper>();
      let missStreak = 0;
      const t0 = performance.now();
      let loggedNoCamera = false;

      const handle = await startAr({
        overlay: overlay.current!,
        optionalFeatures: ["camera-access", "dom-overlay"],
        onFrame: ({ frame, viewerPose }, h) => {
          const st = statsRef.current;
          st.frames++;
          if (!viewerPose || st.frames % 3 !== 0) return;
          const view = viewerPose.views[0];
          if (!view) return;
          if (!view.camera) {
            if (!loggedNoCamera) {
              log("view.camera is missing: camera-access NOT granted (see log for features)");
              loggedNoCamera = true;
            }
            return;
          }
          try {
            reader ??= new CameraReader(h.renderer.getContext() as WebGL2RenderingContext, h.session);
            reader.flipY = st.flipY;
            const got = reader.read(view);
            h.renderer.resetState();
            if (!got) return;
            st.cameraFrames++;
            st.processed++;
            const K: Intrinsics = intrinsicsFromProjection(view.projectionMatrix, got.image.width, got.image.height);
            const dets = detectMarkers(got.image);
            seenRef.current = [];
            if (dets.length === 0) {
              missStreak++;
              // The camera texture may be vertically flipped on this UA: alternate the readback orientation while nothing is found.
              if (missStreak % 45 === 0) {
                st.flipY = !st.flipY;
                log(`no marker for ${missStreak} frames: trying flipY=${st.flipY}`);
              }
            } else {
              missStreak = 0;
              if (st.firstDetectionMs === null) {
                st.firstDetectionMs = Math.round(performance.now() - t0);
                log(`first detection after ${st.firstDetectionMs} ms (flipY=${st.flipY})`);
              }
              st.detections++;
            }
            const viewToRef = new THREE.Matrix4().fromArray(view.transform.matrix);
            for (const d of dets) {
              const pose = solveMarkerPose(d.corners, MARKER_SIZE_M, K);
              seenRef.current.push({ id: d.id, distance: pose.distance });
              let ax = axes.get(d.id);
              if (!ax) {
                ax = new THREE.AxesHelper(0.1);
                ax.matrixAutoUpdate = false;
                h.scene.add(ax);
                axes.set(d.id, ax);
              }
              ax.visible = true;
              ax.matrix.copy(viewToRef).multiply(CV_TO_XR).multiply(poseMatrix(pose.R, pose.t));
            }
            for (const [id, ax] of axes) if (!dets.some((d) => d.id === id)) ax.visible = false;
            st.lastMs = Math.round(performance.now() - t0);
          } catch (e) {
            if (!st.processed) log(`camera read failed: ${String(e)}`);
            st.processed++;
          }
        },
        onEnd: () => {
          setActive(false);
          log("session ended");
          ar.current = null;
        },
      });
      ar.current = handle;
      log(`enabled features: ${handle.enabledFeatures.join(", ") || "(not reported)"}`);
      if (!handle.enabledFeatures.includes("camera-access")) log("camera-access not in enabledFeatures: use fallback B");
      setActive(true);
    } catch (e) {
      setError(String(e));
      log(`start A failed: ${String(e)}. Use fallback B below.`);
    }
  };

  const startB = async () => {
    setError("");
    setPath("B");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false });
      const v = video.current!;
      v.srcObject = stream;
      await v.play();
      const c = document.createElement("canvas");
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      let raf = 0;
      let on = true;
      const loop = () => {
        if (!on) return;
        const w = 640;
        const h = Math.round((v.videoHeight / v.videoWidth) * w) || 480;
        c.width = w;
        c.height = h;
        ctx.drawImage(v, 0, 0, w, h);
        const px = ctx.getImageData(0, 0, w, h).data;
        const gray = new Uint8Array(w * h);
        for (let i = 0; i < gray.length; i++) gray[i] = (px[i * 4]! * 77 + px[i * 4 + 1]! * 150 + px[i * 4 + 2]! * 29) >> 8;
        const f = w / 2 / Math.tan((hfovRef.current * Math.PI) / 360);
        const K: Intrinsics = { fx: f, fy: f, cx: w / 2, cy: h / 2 };
        const dets = detectMarkers({ data: gray, width: w, height: h });
        seenRef.current = dets.map((d) => ({ id: d.id, distance: solveMarkerPose(d.corners, MARKER_SIZE_M, K).distance }));
        lastB.current = dets[0] ? { side: meanSidePx(dets[0].corners), width: w } : null;
        statsRef.current.processed++;
        if (dets.length) statsRef.current.detections++;
        raf = requestAnimationFrame(loop);
      };
      loop();
      stopB.current = () => {
        on = false;
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((t) => t.stop());
        stopB.current = null;
      };
      log(`fallback B running (hFOV ${hfovRef.current.toFixed(1)} deg, ${hfov === null ? "ASSUMED: use Calibrate at 1 m" : "calibrated"})`);
    } catch (e) {
      setError(String(e));
      log(`fallback B failed: ${String(e)}`);
    }
  };

  const calibrate = () => {
    const m = lastB.current;
    if (path !== "B" || !m) {
      log("calibrate: start fallback B and keep the marker in view, face-on, at exactly 1.00 m");
      return;
    }
    const v = hfovFromSquare(m.side, m.width, MARKER_SIZE_M, 1);
    if (!(v > 20 && v < 140)) {
      log(`calibrate: implausible FOV ${v.toFixed(1)} deg, check the distance and that the marker is face-on`);
      return;
    }
    hfovRef.current = v;
    setHfov(v);
    try {
      localStorage.setItem(FOV_KEY, String(v));
    } catch {
      log("could not store FOV in localStorage (value only kept for this session)");
    }
    log(`calibrated: hFOV = ${v.toFixed(1)} deg (square ${m.side.toFixed(1)} px of ${m.width} px at 1.00 m)`);
  };

  const record = () => {
    const top = seen[0];
    const tapeM = Number(tape);
    if (!top || !Number.isFinite(tapeM) || tapeM <= 0 || !path) {
      log("record: need a visible marker and a tape distance in metres");
      return;
    }
    setSamples((s) => [...s, { path, id: top.id, tapeM, estimatedM: top.distance }]);
    log(`sample: tape ${tapeM} m, estimated ${top.distance.toFixed(3)} m`);
  };

  const getResults = () => ({
    arSupported: supported,
    markerSizeMm: MARKER_SIZE_MM,
    dictionary: "IND_4X4_50 (custom generated, see src/spikes/aruco/dict.ts)",
    pathUsed: path,
    fallbackBHfovDeg: hfov,
    stats,
    samples,
    notes,
  });

  const top = seen[0];

  return (
    <SpikeShell name="s2" title="S2 · Marker → pose" getResults={getResults} log={{ lines }}>
      <p className="text-sm text-neutral-300">
        Print the markers first: <Link className="text-sky-400 underline" to="/spikes/s2/markers">/spikes/s2/markers</Link> (A5, black square {MARKER_SIZE_MM} mm).
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Readout label="marker id" value={top ? top.id : "-"} />
        <Readout label="distance" value={top ? `${top.distance.toFixed(2)} m` : "-"} />
        <Readout label="frames read" value={stats.cameraFrames || stats.processed} />
        <Readout label="detections" value={stats.detections} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn disabled={!supported || active} onClick={startA}>
          A · AR + camera-access
        </Btn>
        <Btn disabled={path === "B"} className="bg-neutral-600" onClick={startB}>
          B · camera outside XR
        </Btn>
        {path === "B" && (
          <Btn className="bg-red-700" onClick={() => stopB.current?.()}>
            Stop B
          </Btn>
        )}
        <Btn className="bg-amber-600" onClick={calibrate}>
          Calibrate at 1 m
        </Btn>
      </div>
      <p className="text-xs text-neutral-400">
        B-mode FOV: {hfov === null ? `${DEFAULT_HFOV}° (assumed)` : `${hfov.toFixed(1)}° (calibrated, stored in this browser)`}. To calibrate: run B, tape-measure exactly 1.00 m from the phone to the
        marker, hold the marker face-on (not tilted) and press Calibrate.
      </p>
      <video ref={video} playsInline muted className={path === "B" ? "w-full rounded" : "hidden"} />
      <p className="text-xs text-neutral-400">
        Fallback C (only if A and B both fail): Chrome image tracking via chrome://flags/#webxr-incubations. Not implemented here.
      </p>
      {error && <div className="text-sm text-red-400">{error}</div>}
      <div className="flex items-end gap-2">
        <label className="flex-1 text-sm">
          Tape distance (m)
          <input className="mt-1 w-full rounded bg-neutral-800 p-2" inputMode="decimal" value={tape} onChange={(e) => setTape(e.target.value)} />
        </label>
        <Btn onClick={record}>Record sample</Btn>
      </div>
      <div className="text-xs text-neutral-300">
        {samples.map((s, i) => (
          <div key={i}>
            #{i + 1} [{s.path}] id {s.id}: tape {s.tapeM.toFixed(2)} m → est {s.estimatedM.toFixed(2)} m (err {((s.estimatedM - s.tapeM) * 100).toFixed(0)} cm)
          </div>
        ))}
      </div>
      <label className="block text-sm">
        Notes (e.g. error after 20 m walk and back, in cm)
        <textarea className="mt-1 w-full rounded bg-neutral-800 p-2" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div ref={overlay} style={{ display: active ? "block" : "none" }} className="fixed inset-0 z-10">
        <div ref={hud} className="absolute left-2 right-2 top-2 space-y-2 rounded-lg bg-black/60 p-2 font-mono text-white">
          <div className="flex items-center gap-2">
            <div className="flex-1 text-xl font-bold">{top ? `id ${top.id} · ${top.distance.toFixed(2)} m` : "no marker"}</div>
            <button className="rounded bg-red-600 px-3 py-2 font-bold" onClick={() => ar.current?.stop()}>
              Exit
            </button>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <input className="w-20 rounded bg-neutral-800 p-1" inputMode="decimal" placeholder="tape m" value={tape} onChange={(e) => setTape(e.target.value)} />
            <button className="rounded bg-sky-600 px-3 py-1 font-bold" onClick={record}>
              Record
            </button>
            <span>
              samples {samples.length} · det {stats.detections} · flipY {String(stats.flipY)}
            </span>
          </div>
        </div>
      </div>
    </SpikeShell>
  );
}
