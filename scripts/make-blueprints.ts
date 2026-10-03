/**
 * Writes two illustrative drawings in the Blueprint designer's export format (the same format as public/maps/blr-kia-t2.json):
 *   public/maps/phoenix-citadel-indore.json   a three-floor mall
 *   public/maps/majestic-bus-stand.json       a two-floor bus station
 * They are schematics for wayfinding demos, NOT the owners' floor plans. The shops and brands in the mall are taken from public
 * descriptions of Phoenix Citadel (Indore); positions, sizes and the generic stores are invented. Edit the coordinates here (or open
 * the JSON in the designer) and run `npm run convert:venues` to rebuild the venues.
 * Run: npm run make:blueprints
 */
import fs from "node:fs";
import path from "node:path";

type El = Record<string, unknown> & { id: string; type: string; floor: string; x: number; y: number; width: number; height: number };
type Side = "N" | "S" | "E" | "W";

class Plan {
  elements: El[] = [];
  constructor(readonly floors: string[]) {}

  hall(floor: string, id: string, name: string, x: number, y: number, w: number, h: number): void {
    this.elements.push({ id, type: "hallway", name, floor, x, y, width: w, height: h, tags: [], custom_attributes: [], capacity: 0, accessible: true });
  }
  /** A place; `door` is the wall that faces the corridor it opens onto. */
  room(floor: string, id: string, type: string, name: string, x: number, y: number, w: number, h: number, door: Side | null, extra: Record<string, unknown> = {}): void {
    this.elements.push({ id, type, name, floor, x, y, width: w, height: h, tags: [], custom_attributes: [], capacity: 0, accessible: true, ...extra });
    if (!door) return;
    const c = door === "N" ? { x: x + w / 2, y } : door === "S" ? { x: x + w / 2, y: y + h } : door === "E" ? { x: x + w, y: y + h / 2 } : { x, y: y + h / 2 };
    this.elements.push({ id: `${id}-door`, type: "entry", name: "Door", floor, x: c.x - 3, y: c.y - 3, width: 6, height: 6, tags: [], custom_attributes: [], capacity: 0 });
  }
  entrance(floor: string, id: string, name: string, x: number, y: number, w: number, h: number): void {
    this.elements.push({ id, type: "entry", name, floor, x, y, width: w, height: h, tags: ["entrance"], custom_attributes: [], capacity: 0, accessible: true });
  }
  poi(floor: string, id: string, poiType: string, name: string, cx: number, cy: number): void {
    this.elements.push({ id, type: "poi", poiType, name, floor, x: cx, y: cy, width: 24, height: 24, tags: [poiType], custom_attributes: [], capacity: 0 });
  }

  /** Every place and entrance is connected to the corridor nearest to it, as the designer's connection tool would. */
  connections(): El[] {
    const gap = (a: El, b: El) => {
      const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0);
      const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height), 0);
      return Math.hypot(dx, dy);
    };
    const out: El[] = [];
    for (const floor of this.floors) {
      const halls = this.elements.filter((e) => e.floor === floor && e.type === "hallway");
      // the corridors of one floor lead into each other
      for (const a of halls) {
        for (const b of halls) if (a.id < b.id && gap(a, b) <= 12) out.push(link(floor, a.id, b.id));
      }
      for (const e of this.elements.filter((x) => x.floor === floor && x.type !== "hallway" && x.type !== "poi" && !x.id.endsWith("-door"))) {
        const nearest = [...halls].sort((p, q) => gap(e, p) - gap(e, q))[0];
        if (nearest) out.push(link(floor, nearest.id, e.id));
      }
    }
    return out;
  }
}

const link = (floor: string, source: string, target: string): El =>
  ({ id: `c-${source}--${target}`, source, target, floor, type: "straight", width: 2, capacity: 50, distance: 0, travel_time: 0, directed: false, bidirectional: true, wheelchair_accessible: true, allow_vehicles: false, pathType: "corridor", tags: [] }) as unknown as El;

function write(file: string, plan: Plan, name: string, extra: Record<string, unknown>): void {
  const out = {
    floors: plan.floors,
    currentFloor: plan.floors[0],
    trueNorth: 0,
    elements: plan.elements,
    connections: plan.connections(),
    metadata: { name, scale: { metersPerUnit: 0.5 }, customPois: [], createdAt: "2026-10-03T00:00:00.000Z", ...extra },
  };
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`${path.basename(file)}: ${plan.floors.length} floors, ${plan.elements.length} elements, ${out.connections.length} connections`);
}

/* ---------------------------------------------------------------- Phoenix Citadel, Indore (mall) */
function mall(): Plan {
  const FL = ["Ground Floor", "First Floor", "Second Floor"];
  const p = new Plan(FL);
  const code = ["G", "1", "2"];
  FL.forEach((floor, i) => {
    const k = code[i]!;
    p.hall(floor, `${k}-concourse`, "Main Concourse", 20, 140, 360, 20);
    p.hall(floor, `${k}-atrium-n`, "Central Atrium (North)", 190, 30, 20, 112);
    p.hall(floor, `${k}-atrium-s`, "Central Atrium (South)", 190, 158, 20, 112);
    // the core: toilets, lifts and escalators stand at the same place on every floor so they link up
    p.room(floor, `${k}-wc-male`, "toilet", "Toilet (male)", 170, 45, 18, 24, "E", { tags: ["toilet", "male"] });
    p.room(floor, `${k}-wc-female`, "toilet", "Toilet (female)", 170, 71, 18, 24, "E", { tags: ["toilet", "female"] });
    p.room(floor, `${k}-wc-accessible`, "toilet", "Toilet (accessible)", 170, 97, 18, 24, "E", { tags: ["toilet", "accessible"] });
    p.room(floor, `${k}-el-1`, "elevator", "Elevator EL-1 (North Atrium)", 212, 45, 20, 22, "W", { tags: ["vertical-circulation", "elevator"] });
    p.room(floor, `${k}-esc-1`, "escalator", "Escalator ESC-1 (North Atrium)", 212, 72, 20, 30, "W", { tags: ["vertical-circulation", "escalator"] });
    p.room(floor, `${k}-el-2`, "elevator", "Elevator EL-2 (South Atrium)", 212, 180, 20, 22, "W", { tags: ["vertical-circulation", "elevator"] });
    p.room(floor, `${k}-esc-2`, "escalator", "Escalator ESC-2 (South Atrium)", 212, 207, 20, 30, "W", { tags: ["vertical-circulation", "escalator"] });
  });

  const L = [20, 70, 120];
  const R = [234, 284, 334];
  type Slot = [string, string, Record<string, unknown>?];
  const shops = (floor: string, k: string, top: Slot[], bottom: Slot[]) => {
    const put = (row: Slot[], y: number, door: Side, tag: string) =>
      row.forEach((s, j) => {
        if (!s) return;
        const x = j < 3 ? L[j]! : R[j - 3]!;
        const w = j < 3 ? 48 : 46;
        p.room(floor, `${k}-${tag}${j + 1}`, s[1], s[0], x, y, w, 70, door, s[2] ?? {});
      });
    put(top, 60, "S", "t");
    put(bottom, 170, "N", "b");
  };
  const S = (name: string): Slot => [name, "shop"];
  shops("Ground Floor", "G",
    [S("Marks & Spencer"), S("H&M"), S("Westside"), S("Shoppers Stop"), S("Lifestyle"), ["Customer Care & Lost and Found", "service", { tags: ["need:info"] }]],
    [S("Mango"), S("Vero Moda"), S("Forever New"), S("Nykaa Luxe"), S("Adidas"), S("Max")]);
  shops("First Floor", "1",
    [S("Rado"), S("Senco Gold & Diamonds"), S("Footwear Store"), S("Electronics Store"), S("Kids' Wear"), S("Books & Stationery")],
    [["TimeZone", "entertainment"], ["FunCity", "entertainment"], ["Gaming Zone", "entertainment"], S("Eyewear Store"), S("Perfumes & Beauty"), S("Sportswear Store")]);
  // second floor: food court side and the cinema side
  const f2 = "Second Floor";
  [["Punjab Grill", 20], ["Molecule", 70], ["GT Road", 120]].forEach(([n, x], j) => p.room(f2, `2-t${j + 1}`, "eatery", n as string, x as number, 60, 48, 70, "S", { tags: ["food"] }));
  p.room(f2, "2-cinema", "entertainment", "INOX Multiplex", 234, 60, 146, 70, "S", { capacity: 1386, tags: ["need:movie"] });
  p.room(f2, "2-foodcourt", "eatery", "Food Court", 20, 170, 98, 70, "N", { tags: ["food"], capacity: 650 });
  p.room(f2, "2-ampm", "eatery", "AM PM", 120, 170, 48, 70, "N", { tags: ["food"] });
  p.room(f2, "2-insignia", "entertainment", "Insignia (INOX Premium)", 234, 170, 46, 70, "N", { tags: ["need:movie"] });
  p.room(f2, "2-boxoffice", "ticket", "INOX Box Office", 284, 170, 46, 70, "N", { tags: ["need:ticket"] });
  p.room(f2, "2-coffee", "eatery", "Coffee House", 334, 170, 46, 70, "N", { tags: ["food", "coffee"] });

  // entrances, points of interest
  p.entrance("Ground Floor", "G-ent-n", "North Entrance", 188, 2, 24, 14);
  p.entrance("Ground Floor", "G-ent-s", "South Entrance", 188, 284, 24, 14);
  p.entrance("Ground Floor", "G-ent-w", "West Entrance", 2, 142, 14, 16);
  p.entrance("Ground Floor", "G-ent-e", "East Entrance", 384, 142, 14, 16);
  p.entrance("First Floor", "1-ent-car", "Multilevel Car Park Link", 384, 142, 14, 16);
  p.poi("Ground Floor", "G-info", "info", "Information Desk", 160, 150);
  p.poi("Ground Floor", "G-atm-1", "atm", "ATM", 60, 150);
  p.poi("Ground Floor", "G-atm-2", "atm", "ATM", 340, 150);
  p.poi("Ground Floor", "G-water-1", "drinkingwater", "Drinking Water", 110, 150);
  p.poi("Ground Floor", "G-water-2", "drinkingwater", "Drinking Water", 290, 150);
  p.poi("Ground Floor", "G-charge", "charging", "Charging Station", 250, 150);
  p.poi("Ground Floor", "G-trolley", "trolley", "Trolley Bay", 30, 150);
  p.poi("First Floor", "1-baby", "babycare", "Baby Care Room", 100, 150);
  p.poi("First Floor", "1-water", "drinkingwater", "Drinking Water", 290, 150);
  p.poi("First Floor", "1-charge", "charging", "Charging Station", 60, 150);
  p.poi("Second Floor", "2-water", "drinkingwater", "Drinking Water", 60, 150);
  p.poi("Second Floor", "2-charge", "charging", "Charging Station", 340, 150);
  return p;
}

/* ---------------------------------------------------------------- Majestic (Kempegowda) bus station */
function bus(): Plan {
  const G = "Ground Floor - Platforms";
  const U = "First Floor - Waiting & Retiring Rooms";
  const p = new Plan([G, U]);
  p.hall(G, "G-concourse", "Main Concourse", 0, 170, 600, 24);
  p.hall(G, "G-west-n", "West Walk (North)", 30, 40, 16, 132);
  p.hall(G, "G-west-s", "West Walk (South)", 30, 192, 16, 132);
  p.hall(G, "G-east-n", "East Walk (North)", 540, 40, 16, 132);
  p.hall(G, "G-east-s", "East Walk (South)", 540, 192, 16, 132);
  // 24 platforms: 1-10 BMTC city buses, 11-18 KSRTC intercity and interstate (Terminal 1), 19-24 KSRTC (Terminal 2)
  const group = (n: number): string[] => (n <= 10 ? ["bmtc", "city bus"] : n <= 18 ? ["ksrtc", "intercity", "interstate", "terminal 1"] : ["ksrtc", "terminal 2"]);
  for (let i = 0; i < 12; i++) {
    const top = i + 1;
    const bottom = i + 13;
    p.room(G, `G-plat-${top}`, "platform", `Platform ${top}`, 60 + 36 * i, 90, 36, 76, "S", { tags: group(top) });
    p.room(G, `G-plat-${bottom}`, "platform", `Platform ${bottom}`, 60 + 36 * i, 198, 36, 76, "N", { tags: group(bottom) });
  }
  // west: tickets, enquiry, cloak room, shops
  p.room(G, "G-ksrtc-res", "ticket", "KSRTC Advance Reservation", 4, 44, 24, 40, "E", { tags: ["ksrtc reservation", "ksrtc reservation counter", "advance booking"] });
  p.room(G, "G-bmtc-pass", "ticket", "BMTC Bus Pass Counter", 4, 88, 24, 40, "E", { tags: ["bmtc pass", "bmtc pass counter", "bus pass counter"] });
  p.room(G, "G-enquiry", "service", "Enquiry & Control Room", 4, 132, 24, 36, "E", { tags: ["enquiry"] });
  p.room(G, "G-cloak", "service", "Cloak Room (Luggage Storage)", 4, 196, 24, 40, "E", { tags: ["need:baggage", "luggage", "cloak room"] });
  p.room(G, "G-medical", "shop", "Medical Store", 4, 240, 24, 40, "E");
  p.room(G, "G-books", "shop", "Book & Magazine Stall", 4, 284, 24, 36, "E");
  // east: toilets, tea stall, lift and stairs to the waiting hall, canteen
  p.room(G, "G-wc-male", "toilet", "Toilet (male)", 500, 44, 38, 40, "E", { tags: ["toilet", "male"] });
  p.room(G, "G-wc-female", "toilet", "Toilet (female)", 500, 88, 38, 40, "E", { tags: ["toilet", "female"] });
  p.room(G, "G-tea", "eatery", "Tea & Snacks Stall", 500, 132, 38, 36, "E", { tags: ["food", "coffee"] });
  p.room(G, "G-el-1", "elevator", "Elevator EL-1 (to Waiting Hall)", 558, 44, 22, 24, "W", { tags: ["vertical-circulation", "elevator"] });
  p.room(G, "G-st-1", "stairs", "Staircase S1 (to Waiting Hall)", 558, 88, 22, 30, "W", { tags: ["vertical-circulation", "stairs"] });
  p.room(G, "G-juice", "eatery", "Juice & Tea Stall", 500, 196, 38, 40, "E", { tags: ["food", "coffee"] });
  p.room(G, "G-canteen", "eatery", "Majestic Canteen", 558, 196, 38, 60, "W", { tags: ["food"] });
  p.entrance(G, "G-ent-a", "Entry/Exit A - KSR Railway Station", 2, 176, 10, 12);
  p.entrance(G, "G-ent-d", "Entry/Exit D - Namma Metro Majestic", 588, 176, 10, 12);
  p.poi(G, "G-info", "info", "Enquiry Counter", 90, 182);
  p.poi(G, "G-atm", "atm", "ATM", 400, 182);
  p.poi(G, "G-water-1", "drinkingwater", "Drinking Water", 200, 182);
  p.poi(G, "G-water-2", "drinkingwater", "Drinking Water", 480, 182);
  p.poi(G, "G-charge", "charging", "Charging Station", 300, 182);

  // first floor
  p.hall(U, "U-walk", "Upper Walkway", 300, 170, 300, 24);
  p.hall(U, "U-east-n", "East Walk (North)", 540, 40, 16, 132);
  p.room(U, "U-el-1", "elevator", "Elevator EL-1 (to Waiting Hall)", 558, 44, 22, 24, "W", { tags: ["vertical-circulation", "elevator"] });
  p.room(U, "U-st-1", "stairs", "Staircase S1 (to Waiting Hall)", 558, 88, 22, 30, "W", { tags: ["vertical-circulation", "stairs"] });
  p.room(U, "U-wc-male", "toilet", "Toilet (male)", 500, 44, 38, 40, "E", { tags: ["toilet", "male"] });
  p.room(U, "U-wc-female", "toilet", "Toilet (female)", 500, 88, 38, 40, "E", { tags: ["toilet", "female"] });
  p.room(U, "U-waiting", "waiting", "General Waiting Hall", 300, 90, 190, 76, "S", { capacity: 400 });
  p.room(U, "U-ladies", "waiting", "Ladies' Waiting Room", 300, 198, 90, 60, "N");
  p.room(U, "U-retiring", "waiting", "Retiring Rooms (Dormitory)", 394, 198, 96, 60, "N", { tags: ["need:rest"] });
  p.room(U, "U-food", "eatery", "Upper Floor Food Stall", 494, 198, 40, 60, "N", { tags: ["food"] });
  p.poi(U, "U-water", "drinkingwater", "Drinking Water", 420, 182);
  p.poi(U, "U-charge", "charging", "Charging Station", 360, 182);
  return p;
}

const root = path.resolve(import.meta.dirname, "..");
write(path.join(root, "public", "maps", "phoenix-citadel-indore.json"), mall(), "Phoenix Citadel Mall, Indore (illustrative)", {
  disclaimer: "Illustrative schematic for wayfinding demos. Shop positions and the generic stores are invented; brand names follow public descriptions of the mall. Not the official layout.",
});
write(path.join(root, "public", "maps", "majestic-bus-stand.json"), bus(), "Kempegowda Bus Station (Majestic), Bengaluru (illustrative)", {
  disclaimer: "Illustrative schematic for wayfinding demos: 24 platforms in two rows, with BMTC city buses on 1-10 and KSRTC intercity/interstate on 11-24. Positions are invented; not the official layout.",
});
