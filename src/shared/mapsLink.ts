/** The venue the "Indore Maps" buttons open (the PG). */
export const MAPS_VENUE = "my-pg";

/**
 * Where "Indore Maps" goes: the visitor map of the PG. On a laptop it opens with the demo controls and the simulated walker
 * (?demo=1); on a phone it opens plain so the real sensors and camera are used.
 */
export function mapsHref(coarsePointer: boolean = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches): string {
  return `/nav?venue=${MAPS_VENUE}${coarsePointer ? "" : "&demo=1"}`;
}
