// Copies venues you PUBLISHED on this machine (data/venues/<id>/published.json) into public/venues/<id>/venue.json,
// so a static deployment (GitHub Pages) ships the same maps.
// Usage: npm run export:venues -- <id> [<id> ...]      (with no ids it only lists what could be exported)
// Whatever is in public/venues is PUBLIC on the deployed site, so nothing is exported unless you name it.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const from = path.join(root, "data", "venues");
const to = path.join(root, "public", "venues");
const ids = process.argv.slice(2);
const have = fs.existsSync(from) ? fs.readdirSync(from).filter((id) => fs.existsSync(path.join(from, id, "published.json"))) : [];

if (!ids.length) {
  console.log(have.length ? `Published on this machine: ${have.join(", ")}\nExport with: npm run export:venues -- <id> [<id> ...]` : "Nothing published on this machine (data/venues is empty).");
  process.exit(0);
}
let n = 0;
for (const id of ids) {
  const src = path.join(from, id, "published.json");
  if (!fs.existsSync(src)) {
    console.warn(`skip ${id}: not published on this machine`);
    continue;
  }
  const v = JSON.parse(fs.readFileSync(src, "utf8"));
  if (!v || v.id !== id || !Array.isArray(v.rooms)) {
    console.warn(`skip ${id}: not a venue file`);
    continue;
  }
  fs.mkdirSync(path.join(to, id), { recursive: true });
  fs.writeFileSync(path.join(to, id, "venue.json"), JSON.stringify(v, null, 2) + "\n");
  console.log(`exported ${id} (v${v.version}, ${v.rooms.length} rooms)`);
  n++;
}
console.log(n ? `${n} venue(s) written to public/venues.` : "Nothing exported.");
