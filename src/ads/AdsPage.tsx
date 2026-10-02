import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Campaign, CampaignsFile, Venue } from "@/core/schema";
import { loadCampaigns } from "@/ar/campaigns";
import { useVenue } from "@/shared/useVenue";
import "./ads.css";

const THEMES: Record<string, [string, string]> = {
  Ember: ["#ff7a18", "#af002d"], Ocean: ["#4facfe", "#00c6a7"], Sunrise: ["#f7971e", "#ffd200"], Grape: ["#7f53ac", "#647dee"], Forest: ["#11998e", "#38ef7d"],
};

function emptyCampaign(): Campaign {
  return { id: `C${Date.now().toString(36)}`, name: "New campaign", brand: "Your Brand", type: "image", theme: THEMES.Grape!, headline: "Your headline here", offer: "Describe the offer.", cta: "Save offer", target: null, walls: [], status: "paused", start: "2026-10-02", end: "2026-12-31", hours: "09:00–19:00", budget: 5000, stats: { impressions: 0, taps: 0, dwell: 0 } };
}

async function publish(file: CampaignsFile): Promise<CampaignsFile> {
  const res = await fetch(`/api/campaigns/${encodeURIComponent(file.venueId)}/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(file) });
  const body = await res.json() as { version?: number; publishedAt?: string; error?: string };
  if (!res.ok) throw new Error(body.error ?? `publish failed (${res.status})`);
  return { ...file, version: body.version ?? file.version, publishedAt: body.publishedAt };
}

function Portal({ venue }: { venue: Venue }) {
  const [file, setFile] = useState<CampaignsFile>({ venueId: venue.id, version: 1, campaigns: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading campaigns…");
  const [busy, setBusy] = useState(false);

  useEffect(() => { void loadCampaigns(venue.id).then((f) => { setFile(f); setSelected(f.campaigns[0]?.id ?? null); setStatus(`Live version ${f.version}`); }); }, [venue.id]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (busy) return;
      void loadCampaigns(venue.id).then((fresh) => setFile((old) => ({ ...old, campaigns: old.campaigns.map((c) => ({ ...c, stats: fresh.campaigns.find((x) => x.id === c.id)?.stats ?? c.stats })) })));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [busy, venue.id]);

  const campaign = file.campaigns.find((c) => c.id === selected) ?? null;
  const totals = useMemo(() => file.campaigns.reduce((a, c) => ({ impressions: a.impressions + c.stats.impressions, taps: a.taps + c.stats.taps }), { impressions: 0, taps: 0 }), [file.campaigns]);
  const patchCampaign = (patch: Partial<Campaign>) => setFile((f) => ({ ...f, campaigns: f.campaigns.map((c) => c.id === selected ? { ...c, ...patch } : c) }));

  const saveLive = async (next = file, message = "Campaign saved and pushed to AR") => {
    setBusy(true); setStatus("Publishing…");
    try { const stored = await publish(next); setFile(stored); setStatus(`${message} · v${stored.version}`); }
    catch (e) { setStatus(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const toggle = (id: string, on: boolean) => {
    const next = { ...file, campaigns: file.campaigns.map((c) => c.id === id ? { ...c, status: on ? "active" as const : "paused" as const } : c) };
    setFile(next);
    void saveLive(next, on ? "Campaign resumed" : "Campaign paused — removing from phones");
  };

  const upload = async (creative: File) => {
    setBusy(true); setStatus(`Uploading ${creative.name}…`);
    try {
      const res = await fetch("/api/media", { method: "POST", headers: { "content-type": creative.type }, body: creative });
      const body = await res.json() as { url?: string; error?: string };
      if (!res.ok || !body.url) throw new Error(body.error ?? "upload failed");
      patchCampaign({ mediaUrl: body.url, type: creative.type.startsWith("video/") ? "video" : "image" });
      setStatus("Creative uploaded — save the campaign to publish it");
    } catch (e) { setStatus(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="is-ads">
      <header><Link className="brand" to="/"><i />Indore Spaces</Link><nav><Link to="/editor">Map editor</Link><Link to="/dashboard">Dashboard</Link><Link className="on" to="/ads">Ads</Link></nav><span>{venue.name}</span></header>
      <main>
        <div className="ads-title"><div><h1>AR campaigns</h1><p>Place image and video creative on approved, surveyed wall slots.</p></div><button className="primary" onClick={() => { const c = emptyCampaign(); setFile((f) => ({ ...f, campaigns: [...f.campaigns, c] })); setSelected(c.id); }}>+ New campaign</button></div>
        <section className="ads-kpis">
          <div><b>{file.campaigns.filter((c) => c.status === "active").length}</b><span>active campaigns</span></div>
          <div><b>{totals.impressions.toLocaleString()}</b><span>AR impressions</span></div>
          <div><b>{totals.taps.toLocaleString()}</b><span>taps</span></div>
          <div><b>{totals.impressions ? `${((totals.taps / totals.impressions) * 100).toFixed(1)}%` : "—"}</b><span>tap-through rate</span></div>
        </section>
        <div className="ads-workspace">
          <aside>
            {file.campaigns.map((c) => <button key={c.id} className={`campaign-row ${selected === c.id ? "on" : ""}`} onClick={() => setSelected(c.id)}>
              <span className="thumb" style={{ background: `linear-gradient(135deg,${c.theme[0]},${c.theme[1]})` }}>{c.type === "video" ? "▶" : "▧"}</span>
              <span><b>{c.brand}</b><small>{c.name}</small><small>{c.stats.impressions} imp · {c.stats.taps} taps</small></span>
              <label className="switch" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={c.status === "active"} disabled={busy} onChange={(e) => toggle(c.id, e.target.checked)} /><i /></label>
            </button>)}
          </aside>
          {campaign ? <section className="campaign-editor">
            <div className="creative-col">
              <div className="creative" style={{ background: `linear-gradient(135deg,${campaign.theme[0]},${campaign.theme[1]})` }}>
                {campaign.mediaUrl && campaign.type === "image" ? <img src={campaign.mediaUrl} alt="campaign creative" /> : null}
                {campaign.mediaUrl && campaign.type === "video" ? <video src={campaign.mediaUrl} muted loop playsInline autoPlay /> : null}
                {!campaign.mediaUrl && <><small>{campaign.type === "video" ? "▶ VIDEO" : campaign.brand.toUpperCase()}</small><h2>{campaign.headline}</h2><p>{campaign.offer}</p></>}
                <em>SPONSORED · PLACEHOLDER BRAND</em>
              </div>
              <div className="performance"><h3>Performance</h3><p><b>{campaign.stats.impressions}</b> impressions</p><p><b>{campaign.stats.taps}</b> taps</p><p><b>{campaign.stats.dwell.toFixed(1)} s</b> average dwell</p><small>Impression = within 10 m and in view for at least 1 second.</small></div>
            </div>
            <div className="fields">
              <h2>Campaign details</h2>
              <label>Name<input value={campaign.name} onChange={(e) => patchCampaign({ name: e.target.value })} /></label>
              <div className="two"><label>Brand<input value={campaign.brand} onChange={(e) => patchCampaign({ brand: e.target.value })} /></label><label>Creative type<select value={campaign.type} onChange={(e) => patchCampaign({ type: e.target.value as Campaign["type"] })}><option value="image">Image</option><option value="video">Video</option></select></label></div>
              <label>Headline<input value={campaign.headline} onChange={(e) => patchCampaign({ headline: e.target.value })} /></label>
              <label>Offer text<textarea rows={3} value={campaign.offer} onChange={(e) => patchCampaign({ offer: e.target.value })} /></label>
              <div className="two"><label>Colour theme<select value={Object.entries(THEMES).find(([, v]) => v[0] === campaign.theme[0])?.[0] ?? "Grape"} onChange={(e) => patchCampaign({ theme: THEMES[e.target.value]! })}>{Object.keys(THEMES).map((k) => <option key={k}>{k}</option>)}</select></label><label>Upload creative<input type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} /></label></div>
              <label>Tap action<select value={campaign.target ?? ""} onChange={(e) => { const target = e.target.value || null; patchCampaign({ target, cta: target ? `Route to ${venue.rooms.find((r) => r.id === target)?.name ?? "destination"}` : "Save offer" }); }}><option value="">Save offer</option>{venue.rooms.filter((r) => r.access !== "staff").map((r) => <option key={r.id} value={r.id}>Route to {r.name}</option>)}</select></label>
              <div className="two"><label>Start<input type="date" value={campaign.start} onChange={(e) => patchCampaign({ start: e.target.value })} /></label><label>End<input type="date" value={campaign.end} onChange={(e) => patchCampaign({ end: e.target.value })} /></label></div>
              <div className="two"><label>Show during<input value={campaign.hours} onChange={(e) => patchCampaign({ hours: e.target.value })} /></label><label>Budget (₹)<input type="number" value={campaign.budget} onChange={(e) => patchCampaign({ budget: Number(e.target.value) })} /></label></div>
              <h3>Wall slots</h3>
              <div className="wall-list">{venue.walls.map((w) => { const shared = file.campaigns.find((c) => c.id !== campaign.id && c.status === "active" && c.walls.includes(w.id)); return <label className="wall" key={w.id}><input type="checkbox" checked={campaign.walls.includes(w.id)} disabled={!w.approved} onChange={(e) => patchCampaign({ walls: e.target.checked ? [...campaign.walls, w.id] : campaign.walls.filter((id) => id !== w.id) })} /><span><b>{w.id} · {w.label}</b><small>{venue.floors.find((f) => f.id === w.floor)?.name} · {Math.hypot(w.x2 - w.x1, w.y2 - w.y1).toFixed(1)} × {w.height} m{shared ? ` · shared with ${shared.brand}` : ""}</small></span><em>{w.approved ? "approved" : "awaiting owner"}</em></label>; })}</div>
              <div className="editor-actions"><button className="primary" disabled={busy} onClick={() => void saveLive()}>Save & publish</button><button className="danger" onClick={() => { const next = { ...file, campaigns: file.campaigns.filter((c) => c.id !== campaign.id) }; setFile(next); setSelected(next.campaigns[0]?.id ?? null); void saveLive(next, "Campaign deleted"); }}>Delete</button><span>{status}</span></div>
            </div>
          </section> : <section className="empty">Select or create a campaign.</section>}
        </div>
      </main>
    </div>
  );
}

export default function AdsPage() {
  const venue = useVenue();
  if (venue.status === "loading") return <div className="p-6">Loading…</div>;
  if (venue.status === "missing") return <div className="p-6">Venue not found.</div>;
  return <Portal venue={venue.venue} />;
}
