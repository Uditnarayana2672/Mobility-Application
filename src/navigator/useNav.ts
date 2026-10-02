import { useEffect, useMemo, useSyncExternalStore } from "react";
import { BroadcastChannelBus } from "@/bus";
import type { Venue } from "@/core/schema";
import type { VenueSource } from "@/shared/useVenue";
import { NavController, type NavState } from "./controller";
import { SimPoseSource } from "./simPose";
import { SpeechSynthesisOut } from "./speech";
import { startTicker } from "./ticker";

export interface NavRuntime {
  ctl: NavController;
  sim: SimPoseSource;
  bus: BroadcastChannelBus;
}

/** Builds the controller + simulator + bus for a venue, starts the ticker, applies the #deep-link, tears everything down on unmount. */
export function useNav(venue: Venue, source: VenueSource): { rt: NavRuntime; state: NavState } {
  const rt = useMemo<NavRuntime>(() => {
    const sim = new SimPoseSource(venue);
    const bus = new BroadcastChannelBus();
    const ctl = new NavController({ venue, venueSource: source, sim, speech: new SpeechSynthesisOut(), bus });
    return { ctl, sim, bus };
  }, [venue, source]);

  useEffect(() => {
    rt.ctl.start();
    const stop = startTicker((dt) => rt.ctl.tick(dt));
    rt.ctl.applyHash(window.location.hash);
    const onHash = () => {
      if (window.location.hash) rt.ctl.applyHash(window.location.hash);
    };
    window.addEventListener("hashchange", onHash);
    // Tests and the demo panel can reach the controller from the console.
    (window as unknown as { __nav?: NavController }).__nav = rt.ctl;
    return () => {
      window.removeEventListener("hashchange", onHash);
      stop();
      rt.ctl.dispose();
      rt.bus.close();
      delete (window as unknown as { __nav?: NavController }).__nav;
    };
  }, [rt]);

  const state = useSyncExternalStore(rt.ctl.subscribe, rt.ctl.getState);
  return { rt, state };
}
