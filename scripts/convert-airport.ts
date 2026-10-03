/**
 * Converts the airport drawing made in the Blueprint designer (public/maps/blr-kia-t2.json) into a Dora.AI venue:
 *   public/venues/airport/venue.json
 * The drawing's own scale (metadata.scale.metersPerUnit) is used. Run: npm run convert:airport
 */
import fs from "node:fs";
import path from "node:path";
import { importBlueprint, readBlueprint, type BpFile } from "../src/editor/blueprintImport";

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "public", "maps", "blr-kia-t2.json");
const out = path.join(root, "public", "venues", "airport", "venue.json");

const json = JSON.parse(fs.readFileSync(src, "utf8")) as { metadata?: { name?: string; terminal?: string; scale?: { metersPerUnit?: number } }; elements: { id: string; name: string; floor: string; type: string }[] };
const read = readBlueprint(json);
if (!read.ok) throw new Error(read.error);
const file: BpFile = read.file;

// Several toilets share a name ("Toilet (male)"): add where they are, taken from the element id (L1-wc-landside-west-male -> "Landside West").
const WORDS: Record<string, string> = { air: "Airside", dom: "Domestic", intl: "International", greet: "Greeting hall", reclaim: "Reclaim" };
const place = (id: string): string =>
  id
    .split("-")
    .slice(2)
    .filter((t) => !["male", "female", "accessible", "family"].includes(t))
    .map((t) => WORDS[t] ?? t[0]!.toUpperCase() + t.slice(1))
    .join(" ");
const keyOf = (e: { floor: string; type: string; name: string }) => `${e.floor}|${e.type}|${e.name}`;
const counts = new Map<string, number>();
for (const e of file.elements) counts.set(keyOf(e), (counts.get(keyOf(e)) ?? 0) + 1);
for (const e of file.elements) {
  if ((counts.get(keyOf(e)) ?? 0) > 1 && e.type === "toilet") e.name = `${e.name} · ${place(e.id)}`;
}
// Names must still be unique per floor after that; number any that are not.
const seen = new Map<string, number>();
for (const e of file.elements) {
  if (e.type === "hallway" || e.type === "wall") continue;
  const k = `${e.floor}|${e.name}`;
  const n = (seen.get(k) ?? 0) + 1;
  seen.set(k, n);
  if (n > 1 && e.type !== "poi" && e.type !== "entry") e.name = `${e.name} ${n}`;
}

const mPerUnit = json.metadata?.scale?.metersPerUnit ?? 0.5;
const res = importBlueprint(file, {
  id: "airport",
  name: "Airport",
  type: "Airport",
  city: "Bengaluru",
  address: json.metadata?.name ? `${json.metadata.name}` : "",
  pxPerMetre: 1 / mPerUnit,
});

res.venue.status = "published";
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(res.venue, null, 2) + "\n");

console.log("stats", res.stats, "size (m)", res.sizeM);
const by = { info: 0, warn: 0, fail: 0 };
for (const i of res.issues) by[i.level]++;
console.log("issues", by);
for (const i of res.issues.filter((x) => x.level !== "info").slice(0, 40)) console.log(`  [${i.level}] ${i.title} — ${i.detail}`);
console.log("written", path.relative(root, out));
