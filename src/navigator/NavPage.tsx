import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DEFAULT_VENUE_ID, useVenue, type VenueSource } from "@/shared/useVenue";
import { rememberVenue } from "@/shared/registry";
import { useVenueChoice } from "./autoVenue";
import type { Venue } from "@/core/schema";
import ArScreen from "@/ar/ArScreen";
import DemoPanel from "./DemoPanel";
import { DebugOverlay, LiveHud, ScanSheet, type LocateHints } from "./LiveUi";
import MapScreen from "./MapScreen";
import { CaptionToast, FloorPromptOverlay, SearchOverlay, TransitionOverlay, VoiceOverlay } from "./Overlays";
import { ArrivedScreen, CityScreen, LocateScreen } from "./screens";
import { useNav } from "./useNav";
import "./nav.css";

function NavApp({ venue, source, auto, hints }: { venue: Venue; source: VenueSource; auto?: boolean; hints?: LocateHints }) {
  const root = useRef<HTMLDivElement>(null);
  const { rt, state: s } = useNav(venue, source, root, auto);
  const { ctl } = rt;
  const demo = rt.cfg.demo;
  const [panel, setPanel] = useState(false);
  const light = s.screen === "locate" || s.screen === "ar";
  return (
    <div ref={root} className={`is-nav ${demo ? "demo" : ""} ${rt.kind === "xr" && s.screen === "ar" ? "xr-ar-open" : ""}`} data-testid="nav-root" data-pose={rt.kind} data-screen={s.screen} data-mode={s.mode}>
      <DemoPanel rt={rt} s={s} open={panel} onClose={() => setPanel(false)} />
      <div className="phone-wrap">
        <div className="phone">
          <div className="notch" />
          <div className="screen">
            <div className={`statusbar ${light ? "light" : ""}`}><span>9:41</span><span>5G ▂▄▆ 🔋</span></div>
            <CityScreen ctl={ctl} s={s} />
            <LocateScreen ctl={ctl} s={s} rt={rt} hints={hints} />
            <MapScreen ctl={ctl} s={s} />
            <ArScreen rt={rt} ctl={ctl} s={s} />
            <ArrivedScreen ctl={ctl} s={s} />
            {s.overlay === "search" && <SearchOverlay key={`${s.searchSeed}|${s.pickLoc}`} ctl={ctl} s={s} />}
            {s.overlay === "voice" && <VoiceOverlay ctl={ctl} s={s} />}
            <TransitionOverlay ctl={ctl} s={s} />
            <FloorPromptOverlay ctl={ctl} s={s} />
            <LiveHud rt={rt} ctl={ctl} s={s} />
            <ScanSheet rt={rt} ctl={ctl} s={s} />
            {rt.cfg.debug && <DebugOverlay rt={rt} ctl={ctl} s={s} />}
            <CaptionToast s={s} />
            {demo && <button className="demo-fab" data-testid="demo-fab" aria-label="demo controls" onClick={() => setPanel(true)}>🎬</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

const ASK_TITLE = {
  far: "You don’t seem to be inside a mapped place",
  denied: "Location is off, so I can’t tell which building you are in",
  unavailable: "This phone could not tell where it is",
  timeout: "Finding your location took too long",
  empty: "No places are mapped yet",
} as const;

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">{children}</div>;
}

/** Loads the chosen venue and shows the app; a short banner says how the building was found. */
function NavFor({ id, how, name, entranceMarker }: { id: string; how: string; name?: string; entranceMarker?: number | null }) {
  const v = useVenue(id);
  const [banner, setBanner] = useState(how === "gps");
  useEffect(() => {
    if (v.status === "ready") rememberVenue(v.venue.id);
  }, [v]);
  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner(false), 5000);
    return () => window.clearTimeout(t);
  }, [banner]);
  if (v.status === "loading") return <div className="p-6 text-neutral-500">Loading the map…</div>;
  if (v.status === "missing") {
    return (
      <Centered>
        <h1 className="text-xl font-bold">Venue “{v.id}” not found</h1>
        <p className="max-w-md text-neutral-600">The server has no published map with this id, and there is no bundled copy.</p>
        <Link to="/maps" className="text-blue-600 underline">back to hub</Link>
      </Centered>
    );
  }
  return (
    <>
      <NavApp venue={v.venue} source={v.source} auto={how === "gps" || how === "last" || how === "picked"} hints={{ entranceMarker }} />
      {banner && (
        <div className="pointer-events-none fixed left-1/2 top-3 z-[999] -translate-x-1/2 rounded-full bg-slate-900/90 px-4 py-2 text-sm font-semibold text-white shadow-lg" data-testid="venue-banner">
          📍 You’re at {name ?? v.venue.name}
        </div>
      )}
    </>
  );
}

export default function NavPage() {
  const { choice, retry } = useVenueChoice();
  const [picked, setPicked] = useState<string | null>(null);
  if (picked) return <NavFor id={picked} how="picked" />;
  if (choice.status === "detecting") {
    return (
      <Centered>
        <div className="text-4xl">📍</div>
        <h1 className="text-lg font-bold" data-testid="detecting">Finding your building…</h1>
        <p className="max-w-xs text-sm text-neutral-600">Allow location when asked. It is only used to tell which mapped place you are in.</p>
      </Centered>
    );
  }
  if (choice.status === "ask") {
    return (
      <Centered>
        <h1 className="max-w-sm text-lg font-bold" data-testid="venue-ask">{ASK_TITLE[choice.reason]}</h1>
        <p className="max-w-sm text-sm text-neutral-600">Pick the place you are visiting:</p>
        <div className="flex w-full max-w-sm flex-col gap-2">
          {choice.venues.map((e) => (
            <button key={e.id} className="rounded-xl border border-slate-300 bg-white p-3 text-left shadow-sm" data-testid="venue-option" onClick={() => { rememberVenue(e.id); setPicked(e.id); }}>
              <b>{e.name}</b>
              <div className="text-xs text-slate-500">{[e.type, e.city].filter(Boolean).join(" · ")}</div>
            </button>
          ))}
          {choice.venues.length === 0 && <button className="rounded-xl border border-slate-300 bg-white p-3 shadow-sm" onClick={() => setPicked(DEFAULT_VENUE_ID)}>Open the demo office</button>}
        </div>
        <button className="text-sm font-semibold text-blue-700 underline" data-testid="venue-retry" onClick={retry}>Try again</button>
      </Centered>
    );
  }
  return <NavFor id={choice.id} how={choice.how} name={choice.match?.name} entranceMarker={choice.match?.entrance?.marker ?? null} />;
}
