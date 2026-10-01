import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import SpikeShell, { Btn, Readout, useLog } from "./SpikeShell";
import { arSupported, blockXrSelect, startAr, type ArHandle } from "./ar";

interface Live {
  tracking: string;
  pos: [number, number, number];
  anchors: number;
  anchorsSupported: boolean | null;
  hitOk: boolean;
  frames: number;
  lostEvents: number;
  features: string[];
}

const fresh = (): Live => ({
  tracking: "idle",
  pos: [0, 0, 0],
  anchors: 0,
  anchorsSupported: null,
  hitOk: false,
  frames: 0,
  lostEvents: 0,
  features: [],
});

export default function S1Page() {
  const overlay = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const ar = useRef<ArHandle | null>(null);
  const live = useRef<Live>(fresh());
  const [view, setView] = useState<Live>(live.current);
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [driftCm, setDriftCm] = useState("");
  const [notes, setNotes] = useState("");
  const { lines, log } = useLog();

  useEffect(() => {
    void arSupported().then(setSupported);
    blockXrSelect(hud.current);
    const t = setInterval(() => setView({ ...live.current, pos: [...live.current.pos] }), 200);
    return () => {
      clearInterval(t);
      ar.current?.stop();
    };
  }, []);

  const start = async () => {
    setError("");
    live.current = fresh();
    try {
      const anchored: { anchor: XRAnchor; mesh: THREE.Object3D }[] = [];
      let hitSource: XRHitTestSource | null = null;
      let lastHit: XRHitTestResult | null = null;
      let lastTracking = "idle";

      const reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.08, 0.1, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x00ffaa }),
      );
      reticle.matrixAutoUpdate = false;
      reticle.visible = false;

      const handle = await startAr({
        overlay: overlay.current!,
        optionalFeatures: ["hit-test", "anchors", "dom-overlay"],
        onFrame: ({ frame, refSpace, viewerPose, tracking }) => {
          const L = live.current;
          L.frames++;
          L.tracking = tracking;
          if (tracking !== lastTracking) {
            if (tracking === "lost") L.lostEvents++;
            log(`tracking: ${lastTracking} -> ${tracking}`);
            lastTracking = tracking;
          }
          if (viewerPose) {
            const p = viewerPose.transform.position;
            L.pos = [p.x, p.y, p.z];
          }
          if (hitSource) {
            const results = frame.getHitTestResults(hitSource);
            const first = results[0];
            const pose = first?.getPose(refSpace);
            if (first && pose) {
              lastHit = first;
              reticle.visible = true;
              reticle.matrix.fromArray(pose.transform.matrix);
              L.hitOk = true;
            } else {
              reticle.visible = false;
              lastHit = null;
            }
          }
          for (const a of anchored) {
            const pose = frame.getPose(a.anchor.anchorSpace, refSpace);
            if (pose) a.mesh.matrix.fromArray(pose.transform.matrix);
          }
        },
        onEnd: () => {
          setActive(false);
          log("session ended");
          ar.current = null;
        },
      });
      ar.current = handle;
      logFeatures(handle);
      handle.scene.add(reticle);

      const cubeAt = () => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial({ color: 0xff7a00 }));
        m.matrixAutoUpdate = false;
        m.visible = false;
        handle.scene.add(m);
        return m;
      };

      handle.session.addEventListener("select", () => {
        const hit = lastHit;
        if (!hit) {
          log("tap: no surface hit yet");
          return;
        }
        const mesh = cubeAt();
        // Cube sits on the plane: shift up by half its height in the pose's local frame.
        const lift = new THREE.Matrix4().makeTranslation(0, 0.1, 0);
        if (hit.createAnchor) {
          hit
            .createAnchor()
            .then((anchor) => {
              anchored.push({ anchor, mesh });
              // The update loop writes the anchor pose into mesh.matrix, so lift the geometry itself.
              mesh.geometry.applyMatrix4(lift);
              mesh.visible = true;
              live.current.anchors = anchored.length;
              live.current.anchorsSupported = true;
              log(`anchor created (#${anchored.length})`);
            })
            .catch((e) => {
              live.current.anchorsSupported = false;
              log(`anchor failed: ${String(e)}`);
              placeUnanchored(mesh, hit, handle, lift);
            });
        } else {
          live.current.anchorsSupported = false;
          log("anchors unsupported: placing a world-fixed cube instead");
          placeUnanchored(mesh, hit, handle, lift);
        }
      });

      const viewer = await handle.session.requestReferenceSpace("viewer");
      if (handle.session.requestHitTestSource) {
        hitSource = (await handle.session.requestHitTestSource({ space: viewer })) ?? null;
        log("hit-test source ready");
      } else {
        log("hit-test NOT available");
      }
      setActive(true);
      log("session started");
    } catch (e) {
      setError(String(e));
      log(`start failed: ${String(e)}`);
    }
  };

  function logFeatures(h: ArHandle) {
    live.current.features = h.enabledFeatures;
    log(`enabled features: ${h.enabledFeatures.join(", ") || "(not reported)"}`);
  }

  const getResults = () => ({
    arSupported: supported,
    features: view.features,
    anchorsSupported: view.anchorsSupported,
    hitTestWorked: view.hitOk,
    framesRendered: view.frames,
    trackingLostEvents: view.lostEvents,
    cubeDriftCmAfterWalk: driftCm === "" ? null : Number(driftCm),
    notes,
  });

  return (
    <SpikeShell name="s1" title="S1 · WebXR on phone" getResults={getResults} log={{ lines }}>
      <p className="text-sm text-neutral-300">
        Start AR, wait for the green ring on the floor, tap to place a cube, walk 10 m away and back, then measure how far the cube moved.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Readout label="immersive-ar" value={supported === null ? "…" : supported ? "supported" : "NO"} warn={supported === false} />
        <Readout label="tracking" value={view.tracking} warn={view.tracking === "lost"} />
        <Readout label="anchors" value={`${view.anchors} (${view.anchorsSupported === null ? "?" : view.anchorsSupported ? "ok" : "no"})`} />
        <Readout label="lost events" value={view.lostEvents} />
      </div>
      <Readout label="features" value={<span className="text-sm">{view.features.join(", ") || "-"}</span>} />
      <Btn disabled={!supported || active} onClick={start}>
        Start AR
      </Btn>
      {error && <div className="text-sm text-red-400">{error}</div>}
      <label className="block text-sm">
        Cube drift after walking 10 m and back (cm)
        <input className="mt-1 w-full rounded bg-neutral-800 p-2" inputMode="decimal" value={driftCm} onChange={(e) => setDriftCm(e.target.value)} />
      </label>
      <label className="block text-sm">
        Notes
        <textarea className="mt-1 w-full rounded bg-neutral-800 p-2" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div ref={overlay} style={{ display: active ? "block" : "none" }} className="fixed inset-0 z-10">
        <div ref={hud} className="absolute left-2 right-2 top-2 flex gap-2 rounded-lg bg-black/60 p-2 font-mono text-white">
          <div className="flex-1 text-sm">
            <div>
              pose x {view.pos[0].toFixed(2)} y {view.pos[1].toFixed(2)} z {view.pos[2].toFixed(2)}
            </div>
            <div>
              {view.tracking} · anchors {view.anchors} · lost {view.lostEvents}
            </div>
          </div>
          <button className="rounded bg-red-600 px-3 py-2 font-bold" onClick={() => ar.current?.stop()}>
            Exit
          </button>
        </div>
      </div>
    </SpikeShell>
  );
}

function placeUnanchored(mesh: THREE.Mesh, hit: XRHitTestResult, ar: ArHandle, lift: THREE.Matrix4) {
  const pose = hit.getPose(ar.refSpace);
  if (!pose) return;
  mesh.matrix.fromArray(pose.transform.matrix).multiply(lift);
  mesh.visible = true;
}
