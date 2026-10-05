import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import jpeg from "jpeg-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApi } from "../server/api";
import { NodeEmbedder, type PictureEmbedder } from "../server/vision/embed";
import { describePicture } from "../src/vision/pool";
import { normalise, VprIndex } from "../src/vision/vpr";

/** A small JPEG whose look is decided by `seed`: coloured blocks on grey. */
export function picture(seed: number, shift = 0, bright = 0, W = 160, H = 120): Buffer {
  let s = seed >>> 0;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const px = new Uint8Array(W * H * 4).fill(255);
  const grey = (i: number) => {
    px[i] = px[i + 1] = px[i + 2] = 128;
  };
  for (let i = 0; i < W * H; i++) grey(i * 4);
  for (let k = 0; k < 12; k++) {
    const x0 = Math.floor(r() * W);
    const y0 = Math.floor(r() * H);
    const w = 14 + Math.floor(r() * 60);
    const h = 14 + Math.floor(r() * 50);
    const c = [r() * 255, r() * 255, r() * 255];
    for (let y = y0; y < Math.min(H, y0 + h); y++) {
      for (let x = Math.max(0, x0 + shift); x < Math.min(W, x0 + shift + w); x++) {
        const i = (y * W + x) * 4;
        px[i] = Math.max(0, Math.min(255, c[0]! + bright));
        px[i + 1] = Math.max(0, Math.min(255, c[1]! + bright));
        px[i + 2] = Math.max(0, Math.min(255, c[2]! + bright));
      }
    }
  }
  return Buffer.from(jpeg.encode({ data: px, width: W, height: H }, 80).data);
}

/** A fake model: the picture's average colours in a 4x3 grid (distinct pictures -> distinct vectors, no download needed). */
const gridEmbedder: PictureEmbedder = {
  model: "test-grid",
  async embedImage(bytes) {
    const img = jpeg.decode(bytes, { useTArray: true });
    const v: number[] = [];
    for (let gy = 0; gy < 3; gy++) {
      for (let gx = 0; gx < 4; gx++) {
        const sum = [0, 0, 0];
        let n = 0;
        for (let y = Math.floor((gy * img.height) / 3); y < Math.floor(((gy + 1) * img.height) / 3); y++) {
          for (let x = Math.floor((gx * img.width) / 4); x < Math.floor(((gx + 1) * img.width) / 4); x++) {
            const i = (y * img.width + x) * 4;
            sum[0]! += img.data[i]!;
            sum[1]! += img.data[i + 1]!;
            sum[2]! += img.data[i + 2]!;
            n++;
          }
        }
        v.push(sum[0]! / n - 128, sum[1]! / n - 128, sum[2]! / n - 128);
      }
    }
    return normalise(v);
  },
};

let server: http.Server;
let base: string;
let root: string;
const call = (p: string, init?: RequestInit) => fetch(`http://${base}${p}`, init);
const upload = (venue: string, jpg: Buffer, floor: string, x: number, y: number, heading = 90, acc = 1) =>
  call(`/api/survey/${venue}/frames?floor=${floor}&x=${x}&y=${y}&heading=${heading}&acc=${acc}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: jpg });

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "indore-survey-"));
  const api = createApi({ root, embedder: gridEmbedder });
  server = http.createServer((req, res) => void api(req, res, () => ((res.statusCode = 404), res.end("next"))));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("describePicture", () => {
  it("joins the class token and the mean patch token, unit length", () => {
    const dim = 4;
    const tokens = [1, 0, 0, 0, /* patches */ 0, 2, 0, 0, 0, 4, 0, 0];
    const v = describePicture(tokens, 3, dim);
    expect(v).toHaveLength(8);
    expect(Math.hypot(...v)).toBeCloseTo(1, 6);
    expect(v[0]).toBeGreaterThan(0); // class part
    expect(v[5]).toBeGreaterThan(0); // patch-mean part (second dimension)
  });
});

describe("survey API", () => {
  it("stores pictures with their position, ignores a repeat, and refuses what is not a JPEG or not positioned", async () => {
    const a = picture(1);
    const r = await upload("pg", a, "F1", 2, 3);
    expect(r.status).toBe(200);
    const id = (await r.json()).id;
    expect(await (await upload("pg", a, "F1", 2, 3)).json()).toMatchObject({ id }); // same picture: same id
    expect((await call("/api/survey/pg/frames?floor=F1&x=1&y=1&heading=0", { method: "POST", headers: { "Content-Type": "image/png" }, body: a })).status).toBe(415);
    expect((await call("/api/survey/pg/frames?floor=F1&x=1&y=1&heading=0", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: Buffer.from("not a jpeg") })).status).toBe(400);
    expect((await call("/api/survey/pg/frames?floor=F1&x=abc&y=1&heading=0", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: a })).status).toBe(400);
    expect((await call("/api/survey/pg/frames?x=1&y=1&heading=0", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: a })).status).toBe(400);
    const status = await (await call("/api/survey/pg")).json();
    expect(status).toMatchObject({ count: 1, floors: { F1: 1 }, index: null });
    expect((await call(`/api/survey/pg/frame/${id}`)).headers.get("content-type")).toBe("image/jpeg");
    expect((await call("/api/survey/pg/frame/nope")).status).toBe(404);
  });

  it("builds an index with the self-test, serves it, and a new picture is located with it", async () => {
    // 30 places 1 m apart along y = 5, each with its own look, photographed twice (a little shifted)
    for (let i = 0; i < 30; i++) {
      expect((await upload("pg2", picture(100 + i), "F1", i, 5)).status).toBe(200);
      expect((await upload("pg2", picture(100 + i, 3, 6), "F1", i + 0.4, 5)).status).toBe(200);
    }
    const built = await (await call("/api/survey/pg2/build", { method: "POST" })).json();
    expect(built.items).toBe(60);
    expect(built.eval).toMatchObject({ items: 60 });
    const idx = await (await call("/api/survey/pg2/index")).json();
    expect(idx).toMatchObject({ version: 1, model: "test-grid", dim: 36 });
    const index = new VprIndex(idx.items);
    const q = await gridEmbedder.embedImage(picture(100 + 17, 2, 4));
    const fix = index.locate(q, { minSimilarity: 0.5 });
    expect(fix).not.toBeNull();
    expect(Math.abs(fix!.x - 17.2)).toBeLessThan(1.5);
    expect(fix!.floor).toBe("F1");
    const status = await (await call("/api/survey/pg2")).json();
    expect(status.index).toMatchObject({ items: 60, model: "test-grid" });
  });

  it("no index yet -> 404; clearing removes pictures and index", async () => {
    expect((await call("/api/survey/empty/index")).status).toBe(404);
    await upload("gone", picture(5), "F1", 1, 1);
    expect((await call("/api/survey/gone", { method: "DELETE" })).status).toBe(200);
    expect((await (await call("/api/survey/gone")).json()).count).toBe(0);
  });

  it("only the image model is served as a file, and only the onnxruntime wasm names", async () => {
    expect((await call("/models/../../package.json")).status).toBe(404);
    expect((await call("/models/Xenova/whisper-small/config.json")).status).toBe(404); // not the image model
    expect((await call("/ort/evil.mjs")).status).toBe(404);
    expect((await call("/ort/ort-wasm-simd-threaded.wasm")).headers.get("content-type")).toBe("application/wasm");
  });
});

const real = process.env.SPEECH_REAL === "1" ? describe : describe.skip;
real("real image model (DINOv2-small) on synthetic places", () => {
  it("tells 12 different places apart and finds a shifted, brighter photo of each", { timeout: 300_000 }, async () => {
    const e = new NodeEmbedder(process.cwd());
    const items = [];
    for (let i = 0; i < 12; i++) items.push({ id: `p${i}`, floor: "F1", x: i * 4, y: 0, heading: 0, vec: await e.embedImage(picture(500 + i)) });
    const index = new VprIndex(items);
    let ok = 0;
    for (let i = 0; i < 12; i++) {
      const fix = index.locate(await e.embedImage(picture(500 + i, 4, 12)), { minSimilarity: 0.4, minMargin: 0.01 });
      if (fix && Math.abs(fix.x - i * 4) < 1) ok++;
    }
    console.log("places found:", ok, "/ 12");
    expect(ok).toBeGreaterThanOrEqual(10);
  });
});
