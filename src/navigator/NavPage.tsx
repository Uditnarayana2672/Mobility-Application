import { useState } from "react";
import { Link } from "react-router-dom";
import { useVenue, type VenueSource } from "@/shared/useVenue";
import type { Venue } from "@/core/schema";
import DemoPanel from "./DemoPanel";
import MapScreen from "./MapScreen";
import { CaptionToast, FloorPromptOverlay, SearchOverlay, TransitionOverlay, VoiceOverlay } from "./Overlays";
import { ArStubScreen, ArrivedScreen, CityScreen, LocateScreen } from "./screens";
import { useNav } from "./useNav";
import "./nav.css";

function NavApp({ venue, source }: { venue: Venue; source: VenueSource }) {
  const { rt, state: s } = useNav(venue, source);
  const { ctl } = rt;
  const demo = new URLSearchParams(window.location.search).get("demo") === "1";
  const [panel, setPanel] = useState(false);
  const light = s.screen === "locate" || s.screen === "ar";
  return (
    <div className={`is-nav ${demo ? "demo" : ""}`} data-testid="nav-root" data-screen={s.screen} data-mode={s.mode}>
      <DemoPanel rt={rt} s={s} open={panel} onClose={() => setPanel(false)} />
      <div className="phone-wrap">
        <div className="phone">
          <div className="notch" />
          <div className="screen">
            <div className={`statusbar ${light ? "light" : ""}`}><span>9:41</span><span>5G ▂▄▆ 🔋</span></div>
            <CityScreen ctl={ctl} s={s} />
            <LocateScreen ctl={ctl} s={s} />
            <MapScreen ctl={ctl} s={s} />
            <ArStubScreen ctl={ctl} s={s} />
            <ArrivedScreen ctl={ctl} s={s} />
            {s.overlay === "search" && <SearchOverlay key={`${s.searchSeed}|${s.pickLoc}`} ctl={ctl} s={s} />}
            {s.overlay === "voice" && <VoiceOverlay ctl={ctl} s={s} />}
            <TransitionOverlay ctl={ctl} s={s} />
            <FloorPromptOverlay ctl={ctl} s={s} />
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
