import { parseVenue, type ValidationResult, type Venue } from "@/core/schema";

/** Thin fetch wrappers for the venue REST API (same origin; see server/api.ts). */
export const DEFAULT_VENUE_ID = "office-hq";

async function readError(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { error?: string; issues?: { path: string; message: string }[] };
    const extra = j.issues?.length ? `: ${j.issues[0]!.path} ${j.issues[0]!.message}` : "";
    return `${j.error ?? r.statusText}${extra}`;
  } catch {
    return r.statusText || `HTTP ${r.status}`;
  }
}

function toVenue(json: unknown, what: string): Venue {
  const p = parseVenue(json);
  if (!p.ok) throw new Error(`${what} is not a valid venue: ${p.issues[0]?.path} ${p.issues[0]?.message}`);
  return p.data;
}

/** The draft if there is one, otherwise the published venue. */
export async function loadVenue(id: string): Promise<{ venue: Venue; hasDraft: boolean }> {
  const d = await fetch(`/api/venues/${id}/draft`);
  if (d.ok) return { venue: toVenue(await d.json(), "Draft"), hasDraft: true };
  const p = await fetch(`/api/venues/${id}`);
  if (!p.ok) throw new Error(`Cannot load venue ${id}: ${await readError(p)}`);
  return { venue: toVenue(await p.json(), "Published venue"), hasDraft: false };
}

export async function saveDraft(venue: Venue): Promise<void> {
  const r = await fetch(`/api/venues/${venue.id}/draft`, { method: "PUT", body: JSON.stringify(venue) });
  if (!r.ok) throw new Error(await readError(r));
}

export type PublishOutcome = { ok: true; version: number } | { ok: false; error: string; results: ValidationResult[] };

export async function publishVenue(venue: Venue): Promise<PublishOutcome> {
  const r = await fetch(`/api/venues/${venue.id}/publish`, { method: "POST", body: JSON.stringify(venue) });
  if (r.ok) return { ok: true, version: ((await r.json()) as { version: number }).version };
  if (r.status === 422) {
    const j = (await r.json()) as { error?: string; results?: ValidationResult[] };
    return { ok: false, error: j.error ?? "validation failed", results: j.results ?? [] };
  }
  return { ok: false, error: await readError(r), results: [] };
}

/** Upload a floor photo; returns the served URL and the image's pixel size. */
export async function uploadImage(file: File): Promise<{ imageUrl: string; widthPx: number; heightPx: number }> {
  const r = await fetch("/api/uploads", { method: "POST", body: file, headers: { "Content-Type": file.type } });
  if (!r.ok) throw new Error(await readError(r));
  const { url } = (await r.json()) as { url: string };
  const size = await imageSize(URL.createObjectURL(file));
  return { imageUrl: url, ...size };
}

function imageSize(objectUrl: string): Promise<{ widthPx: number; heightPx: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ widthPx: img.naturalWidth, heightPx: img.naturalHeight });
    };
    img.onerror = () => reject(new Error("Could not read the image"));
    img.src = objectUrl;
  });
}

/** The bundled sample office (public/venues/<id>/venue.json), for "Reset to sample". */
export async function fetchSample(id: string): Promise<Venue> {
  const r = await fetch(`/venues/${id}/venue.json`);
  if (!r.ok) throw new Error("Sample venue not found");
  return toVenue(await r.json(), "Sample venue");
}

export interface VersionInfo {
  version: number;
  publishedAt: string | null;
  current: boolean;
}
export async function fetchVersions(id: string): Promise<VersionInfo[]> {
  const r = await fetch(`/api/venues/${id}/versions`);
  if (!r.ok) throw new Error(await readError(r));
  return ((await r.json()) as { versions: VersionInfo[] }).versions;
}
