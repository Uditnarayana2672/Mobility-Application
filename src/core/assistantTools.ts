import { nearestDoor } from "./doors";
import type { Target } from "./intent";
import { isRouteError, route, type RouteFrom, type RoutePrefs } from "./route";
import { search } from "./search";
import type { Venue } from "./schema";

export function searchPlaces(v: Venue, query: string, limit = 3) {
  return search(v, query).filter((h) => h.type === "poi" || h.room.access !== "staff").slice(0, limit).map((h) => ({
    name: h.type === "room" ? h.room.name : h.poi.name,
    target: h.type === "room" ? ({ room: h.id } as const) : ({ poi: h.id } as const),
    floor: h.type === "room" ? h.room.floor : h.poi.floor,
  }));
}

export function getRoute(v: Venue, from: RouteFrom | null, target: Target, prefs: Partial<RoutePrefs>) {
  if (!from) return { error: "position unavailable" as const };
  const result = route(v, from, target, prefs);
  if (isRouteError(result)) return result;
  return { destination: result.destName, etaSec: Math.round(result.time), walkM: Math.round(result.walkDist), via: result.via };
}

export function whereAmI(v: Venue, from: RouteFrom | null) {
  if (!from) return { located: false as const };
  const p = "node" in from ? v.nodes.find((n) => n.id === from.node) : from;
  if (!p) return { located: false as const };
  const floorName = v.floors.find((f) => f.id === p.floor)?.name ?? p.floor;
  const inside = v.rooms.find((r) => r.floor === p.floor && p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h);
  let near = inside?.name ?? "the corridor";
  if (!inside) {
    const closest = v.rooms.filter((r) => r.floor === p.floor).map((r) => ({ name: r.short || r.name, d: nearestDoor(r, p).dist })).sort((a, b) => a.d - b.d)[0];
    if (closest && closest.d < 9) near = closest.name;
  }
  return { located: true as const, floor: p.floor, floorName, x: p.x, y: p.y, near };
}

export function placeInfo(v: Venue, target: Target) {
  if ("room" in target) {
    const p = v.rooms.find((r) => r.id === target.room);
    return p ? { id: p.id, name: p.name, floor: p.floor, floorName: v.floors.find((f) => f.id === p.floor)?.name ?? p.floor, hours: p.hours, access: p.access, category: p.cat } : { error: "unknown place" as const };
  }
  const p = v.pois.find((x) => x.id === target.poi);
  return p ? { id: p.id, name: p.name, floor: p.floor, floorName: v.floors.find((f) => f.id === p.floor)?.name ?? p.floor, kind: p.kind } : { error: "unknown place" as const };
}
