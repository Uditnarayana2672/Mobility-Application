import { Link } from "react-router-dom";

const SPIKES = [
  ["s1", "S1 · WebXR hit-test, anchors, dom-overlay"],
  ["s2", "S2 · ArUco marker → pose (camera-access)"],
  ["s2/markers", "S2 · Printable A5 markers (IDs 0-3)"],
  ["s3", "S3 · Voice out + in (en-IN, hi-IN, te-IN)"],
  ["s4", "S4 · Steps + gyro heading"],
  ["s5", "S5 · Tracking under a full-screen overlay"],
] as const;

export default function SpikesIndex() {
  const secure = window.isSecureContext;
  return (
    <div className="min-h-screen bg-neutral-950 p-4 text-neutral-100">
      <div className="mx-auto max-w-xl space-y-3">
        <h1 className="text-xl font-bold">Phase 0 spikes</h1>
        <p className={secure ? "text-sm text-emerald-300" : "text-sm text-red-400"}>
          {secure ? "Secure context (HTTPS): camera, sensors and WebXR can work." : "NOT a secure context: camera, sensors and WebXR will be blocked. Open the https:// URL."}
        </p>
        <ul className="space-y-2">
          {SPIKES.map(([p, label]) => (
            <li key={p}>
              <Link className="block rounded-lg bg-neutral-800 p-4 text-lg active:bg-neutral-700" to={`/spikes/${p}`}>
                {label}
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-xs text-neutral-400">Test instructions and pass criteria: docs/PROGRESS.md</p>
      </div>
    </div>
  );
}
