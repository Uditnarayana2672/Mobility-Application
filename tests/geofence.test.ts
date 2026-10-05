import { describe, expect, it } from "vitest";
import { distanceM, distanceToPolygonM, matchVenues, parseLatLngLines, pickVenue, type RegistryEntry } from "@/core";

// A 40 m x 25 m building near Vijay Nagar, Indore (made-up corners).
const lat0 = 22.7532;
const lng0 = 75.8937;
const dLat = (m: number) => m / 111_320;
const dLng = (m: number) => m / (111_320 * Math.cos((lat0 * Math.PI) / 180));
const rect = (x: number, y: number, w: number, h: number): [number, number][] => [
  [lat0 + dLat(y), lng0 + dLng(x)],
  [lat0 + dLat(y), lng0 + dLng(x + w)],
  [lat0 + dLat(y + h), lng0 + dLng(x + w)],
  [lat0 + dLat(y + h), lng0 + dLng(x)],
];
const at = (x: number, y: number, acc = 10) => ({ lat: lat0 + dLat(y), lng: lng0 + dLng(x), acc });

const OFFICE: RegistryEntry = { id: "office", name: "Office", geo: { anchor: [lat0 + dLat(12), lng0 + dLng(20)], radiusM: 60, footprint: rect(0, 0, 40, 25), entrances: [{ name: "Main door", latlng: [lat0 + dLat(0), lng0 + dLng(20)], marker: 1 }] } };
const PG: RegistryEntry = { id: "pg", name: "My PG", geo: { anchor: [lat0 + dLat(400), lng0 + dLng(20)], radiusM: 25, entrances: [] } };
const NOGEO: RegistryEntry = { id: "bare", name: "No location" };

describe("geofence maths", () => {
  it("distance between points is metres", () => {
    expect(distanceM([lat0, lng0], [lat0 + dLat(100), lng0])).toBeCloseTo(100, 0);
    expect(distanceM([lat0, lng0], [lat0, lng0 + dLng(100)])).toBeCloseTo(100, 0);
  });
  it("point in polygon: 0 inside, metres to the nearest wall outside", () => {
    expect(distanceToPolygonM([lat0 + dLat(10), lng0 + dLng(10)], rect(0, 0, 40, 25))).toBe(0);
    expect(distanceToPolygonM([lat0 + dLat(10), lng0 + dLng(-30)], rect(0, 0, 40, 25))).toBeCloseTo(30, 0);
    expect(distanceToPolygonM([lat0 + dLat(35), lng0 + dLng(50)], rect(0, 0, 40, 25))).toBeCloseTo(Math.hypot(10, 10), 0);
  });
});

describe("picking the venue from one GPS fix", () => {
  const reg = [OFFICE, PG, NOGEO];
  it("inside the building outline", () => {
    const m = pickVenue(reg, at(20, 10, 8))!;
    expect(m).toMatchObject({ id: "office", inside: true, distanceM: 0 });
    expect(m.entrance).toMatchObject({ name: "Main door", marker: 1 });
  });
  it("just outside but within the fix's own accuracy counts (GPS drifts indoors)", () => {
    expect(pickVenue(reg, at(80, 10, 60))?.id).toBe("office"); // 40 m outside, accuracy 60 m
    expect(pickVenue(reg, at(80, 10, 5))).toBeNull(); // 40 m outside, accuracy 5 m: a sure fix that is outside is outside
    expect(pickVenue(reg, at(55, 10, 5))?.id).toBe("office"); // 15 m outside: inside the 25 m minimum tolerance
  });
  it("a circle fence is used when there is no outline", () => {
    expect(pickVenue(reg, at(20, 400 + 10, 10))?.id).toBe("pg");
    expect(pickVenue(reg, at(20, 400 + 80, 10))).toBeNull();
  });
  it("far from everything: no venue; venues without a location are never matched", () => {
    expect(matchVenues(reg, at(5000, 5000, 20))).toEqual([]);
    expect(matchVenues([NOGEO], at(0, 0))).toEqual([]);
  });
  it("two venues about equally near is ambiguous (the visitor is asked), but inside beats near", () => {
    const a: RegistryEntry = { id: "a", name: "A", geo: { anchor: [lat0, lng0], radiusM: 10, entrances: [] } };
    const b: RegistryEntry = { id: "b", name: "B", geo: { anchor: [lat0, lng0 + dLng(60)], radiusM: 10, entrances: [] } };
    expect(pickVenue([a, b], at(30, 0, 40))).toBeNull();
    expect(pickVenue([a, b], at(0, 0, 40))?.id).toBe("a");
  });
});

describe("pasting corners copied from a map", () => {
  it("reads 'lat, lng' lines and reports the bad ones", () => {
    const r = parseLatLngLines("22.7532, 75.8937\n22.7533 75.8940\n\nnonsense\n95, 10\n");
    expect(r.points).toEqual([[22.7532, 75.8937], [22.7533, 75.894]]);
    expect(r.bad).toEqual(["nonsense", "95, 10"]);
  });
});
