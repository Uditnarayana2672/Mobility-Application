import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { detectMarkers, type GrayImage } from "@/spikes/aruco/detect";

const DIR = path.join(__dirname, "fixtures", "markers-real");
const NAME_RE = /^id(\d+)_.*\.(jpe?g|png)$/i;
const MAX_W = 640;

function decode(file: string): { data: Uint8Array | Buffer; width: number; height: number } {
  const buf = fs.readFileSync(file);
  if (/\.png$/i.test(file)) {
    const p = PNG.sync.read(buf);
    return { data: p.data, width: p.width, height: p.height };
  }
  const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return { data: j.data, width: j.width, height: j.height };
}

/** RGBA -> gray, box-averaged down to MAX_W wide (same scale the AR path uses). */
function toGray(img: { data: Uint8Array | Buffer; width: number; height: number }): GrayImage {
  const k = Math.max(1, Math.floor(img.width / MAX_W));
  const w = Math.floor(img.width / k);
  const h = Math.floor(img.height / k);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < k; dy++) {
        for (let dx = 0; dx < k; dx++) {
          const i = ((y * k + dy) * img.width + (x * k + dx)) * 4;
          sum += img.data[i]! * 0.299 + img.data[i + 1]! * 0.587 + img.data[i + 2]! * 0.114;
        }
      }
      out[y * w + x] = Math.round(sum / (k * k));
    }
  }
  return { data: out, width: w, height: h };
}

const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /\.(jpe?g|png)$/i.test(f)) : [];

describe("real marker photos (tests/fixtures/markers-real)", () => {
  it("every image is named id<NN>_<note>.<ext>", () => {
    const bad = files.filter((f) => !NAME_RE.test(f));
    expect(bad).toEqual([]);
  });

  if (files.length === 0) console.log("markers-real: no fixtures yet (add phone photos named like id07_dimlight.jpg)");

  for (const f of files) {
    const m = NAME_RE.exec(f);
    if (!m) continue;
    const expected = Number(m[1]);
    it(`${f} → id ${expected}`, () => {
      const dets = detectMarkers(toGray(decode(path.join(DIR, f))));
      expect(dets.map((d) => d.id)).toContain(expected);
    });
  }
});
