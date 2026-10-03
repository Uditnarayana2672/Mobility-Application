/**
 * Converts the drawings in public/maps (Blueprint designer format) into Dora.AI venues and writes the list the app shows:
 *   public/venues/<id>/venue.json   one per drawing below
 *   public/venues/index.json        the venues offered on the first screen, in this order
 * The drawing's own scale (metadata.scale.metersPerUnit) is used. The mall and the bus station drawings are made by
 * `npm run make:blueprints`. Run: npm run convert:venues
 */
import fs from "node:fs";
import path from "node:path";
import { importBlueprint, readBlueprint, type BpFile } from "../src/editor/blueprintImport";

interface Job {
  src: string;
  id: string;
  name: string;
  type: string;
  city: string;
  address: string;
  icon: string;
}
const JOBS: Job[] = [
  { src: "blr-kia-t2.json", id: "airport", name: "Kempegowda Airport", type: "Airport", city: "Bengaluru", address: "Kempegowda International Airport, Terminal 2", icon: "✈️" },
  { src: "phoenix-citadel-indore.json", id: "phoenix-citadel", name: "Phoenix Citadel Mall", type: "Shopping mall", city: "Indore", address: "Phoenix Citadel, Indore", icon: "🛍️" },
  { src: "majestic-bus-stand.json", id: "majestic-bus-stand", name: "Majestic Bus Stand", type: "Bus station", city: "Bengaluru", address: "Kempegowda Bus Station (Majestic), Bengaluru", icon: "🚌" },
];

const root = path.resolve(import.meta.dirname, "..");

// Several toilets share a name ("Toilet (male)"): add where they are, taken from the element id (L1-wc-landside-west-male -> "Landside West").
const WORDS: Record<string, string> = { air: "Airside", dom: "Domestic", intl: "International", greet: "Greeting hall", reclaim: "Reclaim" };
const place = (id: string): string =>
  id
    .split("-")
    .slice(2)
    .filter((t) => !["male", "female", "accessible", "family"].includes(t))
    .map((t) => WORDS[t] ?? t[0]!.toUpperCase() + t.slice(1))
    .join(" ");

function convert(job: Job): { floors: number } {
  const json = JSON.parse(fs.readFileSync(path.join(root, "public", "maps", job.src), "utf8")) as { metadata?: { scale?: { metersPerUnit?: number } } };
  const read = readBlueprint(json);
  if (!read.ok) throw new Error(`${job.src}: ${read.error}`);
  const file: BpFile = read.file;

  const keyOf = (e: { floor: string; type: string; name: string }) => `${e.floor}|${e.type}|${e.name}`;
  const counts = new Map<string, number>();
  for (const e of file.elements) counts.set(keyOf(e), (counts.get(keyOf(e)) ?? 0) + 1);
  for (const e of file.elements) if ((counts.get(keyOf(e)) ?? 0) > 1 && e.type === "toilet") e.name = `${e.name} · ${place(e.id)}`;
  // Names must still be unique per floor; number any that are not.
  const seen = new Map<string, number>();
  for (const e of file.elements) {
    if (e.type === "hallway" || e.type === "wall") continue;
    const k = `${e.floor}|${e.name}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n > 1 && e.type !== "poi" && e.type !== "entry") e.name = `${e.name} ${n}`;
  }

  const mPerUnit = json.metadata?.scale?.metersPerUnit ?? 0.5;
  const res = importBlueprint(file, { id: job.id, name: job.name, type: job.type, city: job.city, address: job.address, pxPerMetre: 1 / mPerUnit });
  res.venue.status = "published";
  const out = path.join(root, "public", "venues", job.id, "venue.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(res.venue, null, 2) + "\n");

  const by = { info: 0, warn: 0, fail: 0 };
  for (const i of res.issues) by[i.level]++;
  console.log(`${job.id}: ${res.stats.floors} floors, ${res.stats.rooms} rooms, ${res.stats.corridors} corridors, ${res.stats.entrances} entrances, ${res.stats.lifts} lift links; size ${res.sizeM.w} x ${res.sizeM.h} m; issues`, by);
  for (const i of res.issues.filter((x) => x.level !== "info").slice(0, 12)) console.log(`  [${i.level}] ${i.title}`);
  return { floors: res.stats.floors };
}

const index: { id: string; name: string; type: string; floors: number; icon: string }[] = [];
for (const job of JOBS) {
  const { floors } = convert(job);
  index.push({ id: job.id, name: job.name, type: job.type, floors, icon: job.icon });
}
// the built-in demo office stays available
const office = JSON.parse(fs.readFileSync(path.join(root, "public", "venues", "office-hq", "venue.json"), "utf8")) as { name: string; type?: string; floors: unknown[] };
index.push({ id: "office-hq", name: office.name, type: office.type || "Office", floors: office.floors.length, icon: "🏢" });
fs.writeFileSync(path.join(root, "public", "venues", "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log("written public/venues/index.json:", index.map((i) => i.id).join(", "));
