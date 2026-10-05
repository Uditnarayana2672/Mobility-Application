import { Link } from "react-router-dom";

const ROUTES: [string, string][] = [
  ["/spikes", "Phase 0 spikes (WebXR, markers, voice, motion)"],
  ["/nav", "Visitor app: 2D map, search, voice, simulation (?demo=1 for the panel)"],
  ["/editor", "Map editor"],
  ["/owner", "Owner portal: status + version history"],
  ["/dashboard", "Laptop live view of the phone (mirrors /nav)"],
  ["/markers", "Printable ArUco markers"],
  ["/ads", "Advertiser portal: wall slots, creatives and live KPIs"],
  ["/survey", "Survey walk: record pictures to recognise places by sight"],
  ["/preflight", "Stage checklist: certificate, sensors, WebXR, voices, server and live marker"],
  ["/designer", "Original Indore space designer (empty sheet)"],
];

export default function Hub() {
  return (
    <div className="min-h-screen bg-neutral-950 p-6 text-neutral-100">
      <div className="mx-auto max-w-xl space-y-3">
        <Link to="/" className="text-sm text-sky-300 underline">← Designer or Indore Maps</Link>
        <h1 className="text-2xl font-bold">Dora.AI · Indore Maps</h1>
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
