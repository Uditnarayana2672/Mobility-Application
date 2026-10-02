import { useEffect, useMemo, useRef, useState } from "react";
import { stepAction } from "@/core/instructions";
import type { Campaign, CampaignsFile } from "@/core/schema";
import type { NavController, NavState } from "@/navigator/controller";
import type { NavRuntime } from "@/navigator/useNav";
import { CanvasArRenderer } from "./CanvasArRenderer";
import { loadCampaigns, recordAdMetric } from "./campaigns";
import { buildSceneModel, type ArSceneModel } from "./sceneModel";
import { WebXrSceneRenderer } from "./WebXrRenderer";

interface Props { rt: NavRuntime; ctl: NavController; s: NavState }

export default function ArScreen({ rt, ctl, s }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const canvasRenderer = useRef<CanvasArRenderer | null>(null);
  const webRenderer = useRef<WebXrSceneRenderer | null>(null);
  const latest = useRef<ArSceneModel | null>(null);
  const seenSince = useRef(new Map<string, number>());
  const counted = useRef(new Set<string>());
  const [campaignFile, setCampaignFile] = useState<CampaignsFile>({ venueId: s.venue.id, version: 1, campaigns: [] });
  const [offer, setOffer] = useState<Campaign | null>(null);
  const [lookUp, setLookUp] = useState(false);
  const active = s.screen === "ar";
  const progress = s.snap?.s ?? 0;

  useEffect(() => {
    const abort = new AbortController();
    void loadCampaigns(s.venue.id, abort.signal).then(setCampaignFile);
    const off = rt.bus.on("campaigns", (notice) => {
      if (notice.venue === s.venue.id) void loadCampaigns(s.venue.id).then(setCampaignFile);
    });
    return () => { abort.abort(); off(); };
  }, [rt.bus, s.venue.id]);

  const scene = useMemo(() => {
    if (!s.user) return null;
    return buildSceneModel(s.route, s.venue, { ...s.user, progressM: progress }, campaignFile.campaigns);
  }, [campaignFile.campaigns, progress, s.route, s.user, s.venue]);
  latest.current = scene;

  useEffect(() => {
    if (rt.xr) {
      const renderer = new WebXrSceneRenderer(rt.xr);
      webRenderer.current = renderer;
      return () => { renderer.dispose(); webRenderer.current = null; };
    }
    return undefined;
  }, [rt.xr]);

  useEffect(() => {
    if (!canvas.current || rt.kind === "xr") return;
    const renderer = new CanvasArRenderer(canvas.current);
    canvasRenderer.current = renderer;
    return () => { renderer.dispose(); canvasRenderer.current = null; };
  }, [rt.kind]);

  useEffect(() => {
    if (!rt.xr) return;
    const push = () => { if (latest.current) webRenderer.current?.setScene(latest.current); };
    push();
    const timer = window.setInterval(push, 200);
    return () => window.clearInterval(timer);
  }, [rt.xr]);

  useEffect(() => {
    webRenderer.current?.setActive(active);
    if (!active) return;
    canvasRenderer.current?.activateMedia();
    counted.current.clear();
    seenSince.current.clear();
    setLookUp(false);
    const nudge = window.setTimeout(() => setLookUp(true), 20_000);
    return () => window.clearTimeout(nudge);
  }, [active]);

  useEffect(() => ctl.onArOpen(() => {
    webRenderer.current?.setActive(true);
    canvasRenderer.current?.activateMedia();
  }), [ctl]);

  useEffect(() => {
    if (!active || rt.kind === "xr") return;
    let raf = 0;
    const draw = (now: number) => {
      const model = latest.current;
      if (model && s.user && canvasRenderer.current) canvasRenderer.current.draw({ model, venue: s.venue, pose: s.user, timeSec: now / 1000 });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active, rt.kind, s.user, s.venue]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      const now = performance.now();
      const visible = new Set((latest.current?.adQuads ?? []).map((q) => q.campaign.id));
      for (const id of [...seenSince.current.keys()]) if (!visible.has(id)) seenSince.current.delete(id);
      for (const ad of latest.current?.adQuads ?? []) {
        const id = ad.campaign.id;
        if (counted.current.has(id)) continue;
        const since = seenSince.current.get(id);
        if (since === undefined) seenSince.current.set(id, now);
        else if (now - since >= 1000) {
          counted.current.add(id);
          ctl.recordAdImpression(id, ad.campaign.brand);
          void recordAdMetric(s.venue.id, id, "impression", (now - since) / 1000);
        }
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [active, ctl, s.venue.id]);

  const tapScene = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const id = rt.kind === "xr" ? webRenderer.current?.hitTest(e.clientX, e.clientY) : canvasRenderer.current?.hitTest(e.clientX, e.clientY);
    if (!id) return;
    const campaign = campaignFile.campaigns.find((c) => c.id === id);
    if (!campaign) return;
    ctl.recordAdTap(campaign.id, campaign.brand);
    void recordAdMetric(s.venue.id, campaign.id, "tap");
    setOffer(campaign);
  };

  const next = s.snap?.next;
  const tracking = !s.user ? "Waiting for location" : s.user.stale ? "Tracking lost" : `Tracking · ±${s.user.acc.toFixed(1)} m`;
  return (
    <section className={`scr ${active ? "on" : ""} ${rt.kind === "xr" ? "xr" : ""}`} id="s-ar" data-testid="screen-ar">
      <canvas ref={canvas} id="arcv" data-testid="ar-canvas" data-visible-ads={scene?.adQuads.length ?? 0} data-campaign-version={campaignFile.version} onPointerUp={tapScene} style={{ pointerEvents: "auto", opacity: rt.kind === "xr" ? 0.001 : 1 }} />
      <div className="ar-top">
        {next && s.route ? (
          <div className="ar-pill" data-testid="ar-instruction">
            <span className="ico">{next.step.kind === "turn" ? (next.step.dir === "left" ? "↰" : "↱") : next.step.kind === "vertical" ? "↕" : "📍"}</span>
            <span><span className="d">{Math.round(next.remaining)} m</span><br /><span className="a">{stepAction(next.step, s.lang)}</span></span>
          </div>
        ) : <div className="ar-pill"><span className="ico">⌖</span><span className="a">Move the phone slowly to look around</span></div>}
        <div className={`trk ${s.user?.stale ? "bad" : s.user && s.user.acc > 2 ? "mid" : ""}`}><i />{tracking}{rt.kind === "xr" ? " · same XR session" : " · simulated camera"}</div>
      </div>
      {lookUp && <button className="lookup show" data-testid="look-up" onClick={() => setLookUp(false)}>⚠ Look up and check your surroundings</button>}
      {rt.kind === "xr" && !rt.xr?.active && <div className="lookup show">AR tracking stopped. Return to the map and restart AR.</div>}
      <div className="ar-bottom">
        <div className="minimap ar-mini"><b>{s.user ? s.venue.floors.find((f) => f.id === s.user!.floor)?.short : "–"}</b><span>{s.route ? `${Math.round(Math.max(0, s.route.total - progress))} m left` : "Explore"}</span></div>
        <div className="ar-actions">
          <button className="fab" aria-label="voice" onClick={() => ctl.openVoice()}>🎤</button>
          <button className="fab wide" data-testid="ar-back" onClick={() => ctl.leaveAr()}>🗺 Map</button>
        </div>
      </div>
      <div className="ar-tag">Keep the phone below eye level while walking</div>
      {offer && (
        <div className="ar-offer-dim" data-testid="ad-offer" onClick={() => setOffer(null)}>
          <div className="ar-offer" onClick={(e) => e.stopPropagation()}>
            <button className="ar-offer-close" aria-label="close" onClick={() => setOffer(null)}>×</button>
            <div className="adcard" style={{ background: `linear-gradient(135deg,${offer.theme[0]},${offer.theme[1]})` }}>
              <div className="small" style={{ fontWeight: 800 }}>SPONSORED · {offer.type.toUpperCase()}</div>
              <b>{offer.brand}</b><h2>{offer.headline}</h2><p>{offer.offer}</p>
            </div>
            <button className="pbtn primary block" onClick={() => { const target = offer.target; setOffer(null); if (target) ctl.routeToRoom(target); else ctl.toast("Offer saved"); }}>{offer.cta || (offer.target ? "Route to offer" : "Save offer")}</button>
          </div>
        </div>
      )}
    </section>
  );
}
