import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { parseVenue, type Venue } from "@/core/schema";
import { MarkerSheet, SheetStyles, mm } from "./MarkerSheet";
import { PAPERS, PAPER_IDS, fitsPaper, maxMarkerMm, smallestPaper, type Paper } from "./paper";

interface Loaded {
  venue: Venue;
  source: "published" | "draft";
}

async function load(id: string, wantDraft: boolean): Promise<Loaded> {
  if (wantDraft) {
    const d = await fetch(`/api/venues/${id}/draft`);
    if (d.ok) {
      const p = parseVenue(await d.json());
      if (p.ok) return { venue: p.data, source: "draft" };
    }
  }
  const r = await fetch(`/api/venues/${id}`);
  if (!r.ok) throw new Error(`Cannot load venue ${id} (${r.status})`);
  const p = parseVenue(await r.json());
  if (!p.ok) throw new Error(`Venue ${id} is invalid: ${p.issues[0]?.path} ${p.issues[0]?.message}`);
  return { venue: p.data, source: "published" };
}

/** /markers: printable ArUco stickers at true size. ?id=N highlights one marker, ?draft=1 prints the unpublished draft. */
export default function MarkersPage() {
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const venueId = q.get("venue") ?? "office-hq";
  const only = q.get("id") !== null ? Number(q.get("id")) : null;
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [floor, setFloor] = useState("all");
  const [paper, setPaper] = useState<Paper | null>(null);

  useEffect(() => {
    load(venueId, q.get("draft") === "1").then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [venueId, q]);

  const shown = useMemo(() => {
    if (!data) return [];
    const list = data.venue.markers.filter((m) => (floor === "all" || m.floor === floor) && (only === null || m.id === only));
    return [...list].sort((a, b) => a.floor.localeCompare(b.floor) || a.id - b.id);
  }, [data, floor, only]);

  const sizes = shown.map((m) => mm(m.sizeM));
  const auto = smallestPaper(sizes);
  const chosen: Paper = paper && sizes.every((s) => fitsPaper(paper, s)) ? paper : (auto ?? "A4");
  const tooBig = shown.filter((m) => !fitsPaper(chosen, mm(m.sizeM)));
  const { w, h } = PAPERS[chosen];

  if (error) return <div className="p-6 text-red-700">{error}</div>;
  if (!data) return <div className="p-6 text-slate-500">Loading markers…</div>;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <SheetStyles paper={chosen} w={w} h={h} />
      <div className="noprint border-b border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/" className="font-bold text-blue-700">
            Dora.AI
          </Link>
          <h1 className="text-xl font-extrabold">Marker sheet</h1>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${data.source === "draft" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
            {data.venue.name} · {data.source === "draft" ? "unpublished draft" : `v${data.venue.version} published`}
          </span>
          <span className="ml-auto text-sm text-slate-500">{shown.length} marker(s)</span>
          <button className="rounded border border-blue-700 bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white" onClick={() => window.print()}>
            🖨 Print
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <div className="flex items-center gap-1">
            <b>Floor</b>
            {["all", ...data.venue.floors.map((f) => f.id)].map((id) => (
              <button key={id} className={`rounded border px-2 py-0.5 ${floor === id ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"}`} onClick={() => setFloor(id)}>
                {id === "all" ? "All floors" : data.venue.floors.find((f) => f.id === id)?.name}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <b>Paper</b>
            {PAPER_IDS.map((p) => {
              const fits = sizes.every((s) => fitsPaper(p, s));
              return (
                <button
                  key={p}
                  disabled={!fits}
                  title={fits ? "" : `Too small: the biggest marker (${Math.max(0, ...sizes)} mm) needs a larger page (${p} holds up to ${Math.floor(maxMarkerMm(p))} mm)`}
                  className={`rounded border px-2 py-0.5 disabled:opacity-40 ${chosen === p ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"}`}
                  onClick={() => setPaper(p)}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
          <li>📏 Print at <b>100% / actual size</b> (no “fit to page”), then check the 100 mm bar with a ruler</li>
          <li>📐 The black square prints at exactly the size set on each marker in the editor. The app uses that size to measure distance.</li>
          <li>🧭 ▲ points up. Stick flat at the install height, no glare, not on glass or doors</li>
        </ul>
        {tooBig.length > 0 && <p className="mt-2 text-sm font-semibold text-red-700">{tooBig.map((m) => m.id).join(", ")}: marker too large for {chosen}.</p>}
        {shown.length === 0 && <p className="mt-2 text-sm text-slate-500">No markers to print. Place markers in the editor first.</p>}
      </div>
      <div className="sheets">
        {shown.map((m) => (
          <MarkerSheet key={m.id} marker={m} venue={data.venue} paper={chosen} highlight={only === m.id} />
        ))}
      </div>
    </div>
  );
}
