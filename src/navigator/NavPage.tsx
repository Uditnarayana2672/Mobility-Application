import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useVenue, type VenueSource } from "@/shared/useVenue";
import type { Venue } from "@/core/schema";
import ArScreen from "@/ar/ArScreen";
import DemoPanel from "./DemoPanel";
import { DebugOverlay, LiveHud, ScanSheet } from "./LiveUi";
import MapScreen from "./MapScreen";
import { CaptionToast, FloorPromptOverlay, SearchOverlay, TransitionOverlay, VoiceOverlay } from "./Overlays";
import { ArrivedScreen, CityScreen, LocateScreen } from "./screens";
import { useNav } from "./useNav";
import "./nav.css";

function NavApp({ venue, source }: { venue: Venue; source: VenueSource }) {
  const root = useRef<HTMLDivElement>(null);
  const { rt, state: s } = useNav(venue, source, root);
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
            <LocateScreen ctl={ctl} s={s} rt={rt} />
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

export default function NavPage() {
  const v = useVenue();
  if (v.status === "loading") return <div className="p-6 text-neutral-500">Loading the map…</div>;
  if (v.status === "missing") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-bold">Venue “{v.id}” not found</h1>
        <p className="max-w-md text-neutral-600">The server has no published map with this id, and there is no bundled copy.</p>
        <Link to="/" className="text-blue-600 underline">back to hub</Link>
      </div>
    );
  }
  return <NavApp venue={v.venue} source={v.source} />;
}
