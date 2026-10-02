import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { parseVenue, type Venue } from "@/core/schema";
import { validate } from "@/core/validate";
import { fetchVersions, type VersionInfo } from "@/editor/api";

interface State {
  published: Venue;
  draft: Venue | null;
  versions: VersionInfo[];
}

async function load(id: string): Promise<State> {
  const [pub, dr, versions] = await Promise.all([fetch(`/api/venues/${id}`), fetch(`/api/venues/${id}/draft`), fetchVersions(id).catch(() => [])]);
  if (!pub.ok) throw new Error(`Cannot load venue ${id} (${pub.status})`);
  const p = parseVenue(await pub.json());
  if (!p.ok) throw new Error(`Venue ${id} is invalid: ${p.issues[0]?.path} ${p.issues[0]?.message}`);
  let draft: Venue | null = null;
  if (dr.ok) {
    const d = parseVenue(await dr.json());
    if (d.ok) draft = d.data;
  }
  return { published: p.data, draft, versions };
}

const DOT = { pass: "bg-emerald-500", warn: "bg-amber-500", fail: "bg-red-500" } as const;
const MARK = { pass: "✓", warn: "!", fail: "✕" } as const;

/** /owner: venue summary, publish status and version history. Editing happens in /editor. */
export default function OwnerPage() {
  const venueId = useMemo(() => new URLSearchParams(window.location.search).get("venue") ?? "office-hq", []);
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    load(venueId).then(setS, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [venueId]);
  const shown = s?.draft ?? s?.published ?? null;
  const results = useMemo(() => (shown ? validate(shown) : []), [shown]);

  if (error) return <div className="p-6 text-red-700">{error}</div>;
  if (!s || !shown) return <div className="p-6 text-slate-500">Loading…</div>;
  const fails = results.filter((r) => r.level === "fail").length;
  const warns = results.filter((r) => r.level === "warn").length;
  const v = s.published;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/" className="font-bold text-blue-700">
            Indore Spaces
          </Link>
          <h1 className="text-2xl font-extrabold">Owner portal</h1>
          <div className="ml-auto flex gap-2">
            <Link className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium" to="/markers">
              Marker sheet
            </Link>
            <Link className="rounded border border-blue-700 bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white" to={`/editor?venue=${v.id}`}>
              Edit &amp; publish
            </Link>
          </div>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-bold">{v.name}</h2>
          <p className="text-sm text-slate-500">
            {v.type} · {v.city}
            {v.address ? ` · ${v.address}` : ""}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              [v.floors.length, "floors"],
              [v.rooms.length, "rooms"],
              [v.markers.length, "markers"],
              [v.walls.length, "ad walls"],
              [v.pois.length, "POIs"],
            ].map(([n, l]) => (
              <div key={l} className="rounded border border-slate-200 py-2 text-center">
                <div className="text-xl font-bold">{n}</div>
                <div className="text-xs text-slate-500">{l}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="font-bold">Publish status</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold">
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">Live v{v.version}</span>
              {s.draft && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">unpublished changes</span>}
              <span className={`rounded-full px-2 py-0.5 ${fails ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>{fails ? `${fails} blocking` : "checks pass"}</span>
              {warns > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">{warns} warning(s)</span>}
            </div>
            <p className="mt-2 text-xs text-slate-500">Checks run on the {s.draft ? "draft" : "published map"}.</p>
            <div className="mt-2">
              {results.slice(0, 8).map((r, i) => (
                <div key={i} className="flex gap-2 border-b border-slate-100 py-1.5">
                  <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${DOT[r.level]}`}>{MARK[r.level]}</div>
                  <div className="text-sm font-semibold">{r.title}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="font-bold">Version history</h3>
            {s.versions.length === 0 && <p className="mt-2 text-sm text-slate-500">No versions yet.</p>}
            <ul className="mt-2">
              {s.versions.map((x) => (
                <li key={x.version} className="flex items-center gap-3 border-b border-slate-100 py-2 text-sm" data-version={x.version}>
                  <b>v{x.version}</b>
                  <span className="flex-1 text-slate-500">{x.publishedAt ? new Date(x.publishedAt).toLocaleString() : "initial version"}</span>
                  {x.current && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">live</span>}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">Visitors only ever see a published version, never a half-finished draft. The last 5 versions are kept. Marker IDs stay the same across versions.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
