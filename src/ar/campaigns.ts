import { CampaignsFileSchema, type CampaignsFile } from "@/core/schema";

export async function loadCampaigns(venueId: string, signal?: AbortSignal): Promise<CampaignsFile> {
  try {
    const res = await fetch(`/api/campaigns/${encodeURIComponent(venueId)}`, { signal, cache: "no-store" });
    if (res.ok) {
      const parsed = CampaignsFileSchema.safeParse(await res.json());
      if (parsed.success) return parsed.data;
    }
  } catch {
    // Offline demo falls through to the bundled office campaign fixture.
  }
  try {
    const res = await fetch(`/venues/${encodeURIComponent(venueId)}/campaigns.json`, { signal, cache: "no-store" });
    if (res.ok) {
      const parsed = CampaignsFileSchema.safeParse(await res.json());
      if (parsed.success) return parsed.data;
    }
  } catch {
    // A non-seeded venue may legitimately have no campaigns.
  }
  return { venueId, version: 1, campaigns: [] };
}

export async function recordAdMetric(venueId: string, campaignId: string, kind: "impression" | "tap", dwellSec = 0): Promise<void> {
  try {
    await fetch(`/api/campaigns/${encodeURIComponent(venueId)}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId, kind, dwellSec }),
      keepalive: true,
    });
  } catch {
    // Navigation and AR must keep working while the metrics endpoint is offline.
  }
}
