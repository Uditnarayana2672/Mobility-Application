// Copies every venue you PUBLISHED on this machine (data/venues/<id>/published.json) into public/venues/<id>/venue.json,
// so a static deployment (GitHub Pages) ships the same maps. office-hq is the built-in demo and is left alone.
// Usage: npm run export:venues   (then commit public/venues). Note: whatever is in public/venues is public on the deployed site.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const from = path.join(root, "data", "venues");
const to = path.join(root, "public", "venues");
if (!fs.existsSync(from)) {
  console.log("No data/venues here: nothing to export.");
  process.exit(0);
}
let n = 0;
for (const id of fs.readdirSync(from)) {
  if (id === "office-hq") continue;
  const src = path.join(from, id, "published.json");
  if (!fs.existsSync(src)) continue;
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
console.log(n ? `${n} venue(s) written to public/venues.` : "Nothing to export.");
