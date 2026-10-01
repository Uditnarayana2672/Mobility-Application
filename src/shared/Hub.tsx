import { Link } from "react-router-dom";

const ROUTES: [string, string][] = [
  ["/spikes", "Phase 0 spikes (WebXR, markers, voice, motion)"],
  ["/nav", "Visitor app (Phase 2+)"],
  ["/editor", "Map editor (Phase 1)"],
  ["/dashboard", "Laptop live view (Phase 3)"],
  ["/markers", "Printable markers (Phase 1)"],
  ["/ads", "Advertiser portal (Phase 4)"],
  ["/legacy-editor", "Old Blueprint editor (frozen)"],
];

export default function Hub() {
  return (
    <div className="min-h-screen bg-neutral-950 p-6 text-neutral-100">
      <div className="mx-auto max-w-xl space-y-3">
        <h1 className="text-2xl font-bold">Indore Spaces</h1>
        <ul className="space-y-2">
          {ROUTES.map(([to, label]) => (
            <li key={to}>
              <Link to={to} className="block rounded-lg bg-neutral-800 p-4 active:bg-neutral-700">
                <span className="font-mono text-sky-300">{to}</span> <span className="text-neutral-300">{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
