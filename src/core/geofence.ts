import type { Geo } from "./schema";

/**
 * Which venue is the phone in? Pure maths over the venue registry and one GPS fix. GPS indoors is only good to some tens of metres,
 * so this answers "which building" (never "which room"): a fix counts as inside a venue when it is within the building outline
 * (or the fence circle around the anchor), or outside it by no more than the fix's own accuracy.
 */
export type LatLng = readonly [number, number];

export interface RegistryEntry {
  id: string;
  name: string;
  type?: string;
  city?: string;
  geo?: Geo;
}

export interface GpsFix {
  lat: number;
  lng: number;
  /** Horizontal accuracy radius, metres. */
  acc: number;
}

export interface VenueMatch {
  id: string;
  name: string;
  /** Distance from the fix to the fence (0 when inside), metres. */
  distanceM: number;
  inside: boolean;
  /** The nearest entrance, if the venue lists any. */
  entrance?: { name: string; distanceM: number; marker?: number };
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Local flat metres (x east, y north) around an origin: exact enough for a building. */
function toLocal(origin: LatLng, p: LatLng): { x: number; y: number } {
  return { x: rad(p[1] - origin[1]) * R * Math.cos(rad(origin[0])), y: rad(p[0] - origin[0]) * R };
}

function distToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const den = dx * dx + dy * dy;
  const t = den === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / den));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Distance in metres from a point to a polygon outline; 0 when inside. */
export function distanceToPolygonM(p: LatLng, poly: readonly LatLng[]): number {
  const pts = poly.map((q) => toLocal(p, q));
  const o = { x: 0, y: 0 };
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > o.y !== b.y > o.y && o.x < ((b.x - a.x) * (o.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  if (inside) return 0;
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) best = Math.min(best, distToSegment(o, pts[i]!, pts[j]!));
  return best;
}

/** Distance from a fix to a venue's fence (building outline, else a circle around the anchor), or null when the venue has no location. */
export function distanceToVenueM(geo: Geo | undefined, fix: LatLng): number | null {
  if (!geo) return null;
  if (geo.footprint && geo.footprint.length >= 3) return distanceToPolygonM(fix, geo.footprint);
  return Math.max(0, distanceM(fix, geo.anchor) - geo.radiusM);
}

export const MIN_TOLERANCE_M = 25;
export const MAX_TOLERANCE_M = 120;

/** Venues the fix can be in, nearest first. A fix with poor accuracy widens the fence, but never beyond MAX_TOLERANCE_M. */
export function matchVenues(entries: readonly RegistryEntry[], fix: GpsFix): VenueMatch[] {
  const here: LatLng = [fix.lat, fix.lng];
  const tol = Math.max(MIN_TOLERANCE_M, Math.min(MAX_TOLERANCE_M, fix.acc));
  const out: VenueMatch[] = [];
  for (const e of entries) {
    const d = distanceToVenueM(e.geo, here);
    if (d === null || d > tol) continue;
    let entrance: VenueMatch["entrance"];
    for (const en of e.geo?.entrances ?? []) {
      const dd = distanceM(here, en.latlng);
      if (!entrance || dd < entrance.distanceM) entrance = { name: en.name, distanceM: Math.round(dd), marker: en.marker };
    }
    out.push({ id: e.id, name: e.name, distanceM: Math.round(d), inside: d === 0, entrance });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
}

/** One clear answer, or null when nothing is near or two venues are about equally near (then the visitor is asked). */
export function pickVenue(entries: readonly RegistryEntry[], fix: GpsFix): VenueMatch | null {
  const m = matchVenues(entries, fix);
  if (!m.length) return null;
  const [a, b] = m;
  if (b && !(a!.inside && !b.inside) && b.distanceM - a!.distanceM < 15) return null;
  return a ?? null;
}

/** Parses "22.7196, 75.8577" lines (as copied from a map) into corners. Bad lines are reported, not dropped silently. */
export function parseLatLngLines(text: string): { points: [number, number][]; bad: string[] } {
  const points: [number, number][] = [];
  const bad: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const m = /^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/.exec(t);
    const lat = m ? Number(m[1]) : NaN;
    const lng = m ? Number(m[2]) : NaN;
    if (m && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) points.push([lat, lng]);
    else bad.push(t);
  }
  return { points, bad };
}
