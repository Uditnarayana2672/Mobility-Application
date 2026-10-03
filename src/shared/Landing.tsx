import { Link } from "react-router-dom";
import { mapsHref } from "./mapsLink";

/** First page of the site: choose the original Indore space designer (empty sheet) or the Indore maps app. */
export default function Landing() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-neutral-100" data-testid="landing">
      <div className="w-full max-w-3xl space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-extrabold tracking-tight">Dora.AI</h1>
          <p className="mt-2 text-neutral-400">Where would you like to go?</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link to="/designer" data-testid="go-designer" className="group rounded-2xl border border-neutral-800 bg-neutral-900 p-6 transition hover:border-sky-500 hover:bg-neutral-800">
            <div className="text-4xl">📐</div>
            <h2 className="mt-3 text-xl font-bold group-hover:text-sky-300">Designer</h2>
            <p className="mt-1 text-sm text-neutral-400">Start from an empty sheet and design an Indore space: rooms, doors, corridors and points of interest.</p>
          </Link>
          <Link to={mapsHref()} data-testid="go-maps" className="group rounded-2xl border border-neutral-800 bg-neutral-900 p-6 transition hover:border-emerald-500 hover:bg-neutral-800">
            <div className="text-4xl">🗺️</div>
            <h2 className="mt-3 text-xl font-bold group-hover:text-emerald-300">Indore Maps</h2>
            <p className="mt-1 text-sm text-neutral-400">Find your way inside an airport, a mall or a bus stand: the visitor map, search, voice and camera directions.</p>
          </Link>
        </div>
      </div>
    </div>
  );
}
