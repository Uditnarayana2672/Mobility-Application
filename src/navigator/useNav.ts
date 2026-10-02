import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { BroadcastChannelBus, CompositeBus, WebSocketBus, type Bus } from "@/bus";
import type { Venue } from "@/core/schema";
import { PdrPoseSource } from "@/positioning/pdrPoseSource";
import { XrPoseSource } from "@/positioning/xrPoseSource";
import { loadVenue, type VenueSource } from "@/shared/useVenue";
import { NavController, type NavState } from "./controller";
import type { PoseKind } from "./poseSource";
import { readRuntimeConfig, usesBroadcast, wsPublishes, type RuntimeConfig } from "./runtimeConfig";
import { SimPoseSource } from "./simPose";
import { SpeechSynthesisOut } from "./speech";
import { startTicker } from "./ticker";

export interface NavRuntime {
  ctl: NavController;
  /** The laptop simulator. Only drives the controller when kind === "sim" (the demo panel is hidden otherwise). */
  sim: SimPoseSource;
  xr: XrPoseSource | null;
  pdr: PdrPoseSource | null;
  kind: PoseKind;
  cfg: RuntimeConfig;
  bus: Bus;
  /** BroadcastChannel part (demo panel resets its mirrored state), if any. */
  bc: BroadcastChannelBus | null;
  /** Switch the pose source (rebuilds the controller; used from the locate screen when AR is unavailable). */
  switchKind(k: PoseKind): void;
}

const env = () => ({
  search: typeof location === "undefined" ? "" : location.search,
  coarsePointer: typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches,
  hasXr: typeof navigator !== "undefined" && "xr" in navigator && !!(navigator as Navigator & { xr?: unknown }).xr,
});

/**
 * Builds the controller + pose source + bus for a venue, starts the ticker, applies the #deep-link (simulator only),
 * refreshes the venue when the server says it was republished, and tears everything down on unmount.
 * `overlayRef` = the element WebXR uses as its DOM overlay (the whole app).
 */
export function useNav(venue: Venue, source: VenueSource, overlayRef: RefObject<HTMLElement>): { rt: NavRuntime; state: NavState } {
  const base = useMemo(() => readRuntimeConfig(env()), []);
  const [kind, setKind] = useState<PoseKind>(base.kind);
  // After a source switch (from the locate screen) the rebuilt controller opens on the locate screen again, not the city list.
  const switched = useRef(false);

  const rt = useMemo<NavRuntime>(() => {
    const cfg: RuntimeConfig = { ...base, kind, demo: base.demo && kind === "sim" };
    const sim = new SimPoseSource(venue);
    const xr = kind === "xr" ? new XrPoseSource(venue, () => overlayRef.current) : null;
    const pdr = kind === "pdr" ? new PdrPoseSource(venue) : null;
    const bc = usesBroadcast(cfg) ? new BroadcastChannelBus() : null;
    const ws = new WebSocketBus({ room: venue.id, role: "device", sendTypes: wsPublishes(cfg) ? undefined : [] });
    const bus: Bus = bc ? new CompositeBus([bc, ws]) : ws;
    const ctl = new NavController({ venue, venueSource: source, sim: xr ?? pdr ?? sim, speech: new SpeechSynthesisOut(), bus });
    // A live phone has no demo switch: the floor prompt waits for the visitor (tap) or a lobby marker.
    if (kind !== "sim") ctl.setAutoConfirm(false);
    return { ctl, sim, xr, pdr, kind, cfg, bus, bc, switchKind: (k) => {
        switched.current = true;
        setKind(k);
      },
    };
  }, [venue, source, kind, base, overlayRef]);

  useEffect(() => {
    rt.ctl.start();
    if (switched.current) rt.ctl.openLocate();
    const stop = startTicker((dt) => rt.ctl.tick(dt));
    if (rt.kind === "sim") rt.ctl.applyHash(window.location.hash);
    const onHash = () => {
      if (rt.kind === "sim" && window.location.hash) rt.ctl.applyHash(window.location.hash);
    };
    window.addEventListener("hashchange", onHash);
    // "venue published": fetch the new version and swap it in (deferred while navigating).
    const offVenue = rt.bus.on("venue", (n) => {
      if (n.venue !== venue.id) return;
      void loadVenue(venue.id).then((r) => {
        if (r && r.source === "api") rt.ctl.setVenue(r.venue);
      });
    });
    // Tests and the demo panel can reach the controller from the console.
    (window as unknown as { __nav?: NavController }).__nav = rt.ctl;
    return () => {
      offVenue();
      window.removeEventListener("hashchange", onHash);
      stop();
      rt.xr?.stopAr();
      rt.ctl.dispose();
      rt.bus.close();
      delete (window as unknown as { __nav?: NavController }).__nav;
    };
  }, [rt, venue.id]);

  const state = useSyncExternalStore(rt.ctl.subscribe, rt.ctl.getState);
  return { rt, state };
}
