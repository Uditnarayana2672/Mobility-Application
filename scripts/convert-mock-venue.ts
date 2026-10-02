/**
 * Converts the mock's default venue + campaigns (docs/mock-ui/js/data.js) to schema v2 JSON:
 *   public/venues/office-hq/venue.json, public/venues/office-hq/campaigns.json
 * Run: npm run convert:mock
 */
import fs from "node:fs";
import path from "node:path";
import { loadMock } from "../tests/golden/loadMock";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function convertMockVenue(IS: any): { venue: unknown; campaigns: unknown } {
  const m = IS.defaultVenue();
  const venue = {
    schemaVersion: 2,
    id: m.id,
    name: m.name,
    type: m.type,
    city: m.city,
    address: m.address,
    latlng: m.latlng,
    version: 1,
    status: "published",
    scale: { metersPerUnit: 1, calibrated: true, reference: m.scale.reference },
    floors: m.floors.map((f: any) => ({ id: f.id, name: f.name, short: f.short, elevation: f.elevation, height: 3, w: f.w, h: f.h })),
    corridors: m.corridors,
    rooms: m.rooms,
    nodes: m.nodes,
    edges: m.edges,
    // Mock ids were strings ("M01"); v2 uses the numeric ArUco id (M01 -> 1).
    markers: m.markers.map((k: any) => ({ id: Number(String(k.id).slice(1)), floor: k.floor, name: k.name, x: k.x, y: k.y, z: k.z, normal: k.normal, sizeM: 0.12, note: k.note })),
    walls: m.walls,
    pois: m.pois,
  };
  const campaigns = {
    venueId: m.id,
    version: 1,
    campaigns: IS.defaultCampaigns().map((c: any) => ({ ...c, status: c.status })),
  };
  return { venue, campaigns };
}

if (process.argv[1] && /convert-mock-venue/.test(process.argv[1])) {
  const { venue, campaigns } = convertMockVenue(loadMock());
  const dir = path.join(process.cwd(), "public", "venues", "office-hq");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "venue.json"), JSON.stringify(venue, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "campaigns.json"), JSON.stringify(campaigns, null, 2) + "\n");
  console.log("wrote", dir);
}
