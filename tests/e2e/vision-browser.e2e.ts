import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startE2E, type E2E } from "./harness";

let e: E2E;
beforeAll(async () => {
  e = await startE2E();
});
afterAll(async () => e?.close());

/** The image model in a real browser: loaded from this server's /models and /ort, run with WebAssembly. Needs the model cached once (run any survey build, or SPEECH_REAL tests). */
describe("image model in the browser", () => {
  it("embeds pictures: unit-length descriptors, same picture -> same vector, different pictures -> different vectors", { timeout: 240_000 }, async () => {
    const page = await e.newPage();
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await page.goto(`${e.url}/survey`);
    // (a string, so the test runner does not rewrite the browser's own dynamic import)
    const out = (await page.evaluate(`(async () => {
      const { createBrowserEmbedder } = await import("/src/vision/embedBrowser.ts");
      const t0 = performance.now();
      const emb = await createBrowserEmbedder();
      const loadMs = performance.now() - t0;
      const W = 224, H = 168;
      const make = (seed) => {
        let s = seed;
        const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
        const px = new Uint8ClampedArray(W * H * 4).fill(255);
        for (let i = 0; i < W * H; i++) px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 128;
        for (let k = 0; k < 12; k++) {
          const x0 = Math.floor(r() * W), y0 = Math.floor(r() * H), w = 14 + Math.floor(r() * 70), h = 14 + Math.floor(r() * 50);
          const c = [r() * 255, r() * 255, r() * 255];
          for (let y = y0; y < Math.min(H, y0 + h); y++) for (let x = x0; x < Math.min(W, x0 + w); x++) for (let ch = 0; ch < 3; ch++) px[(y * W + x) * 4 + ch] = c[ch];
        }
        return px;
      };
      const t1 = performance.now();
      const a1 = await emb.embed(make(1), W, H);
      const embedMs = performance.now() - t1;
      const a2 = await emb.embed(make(1), W, H);
      const b = await emb.embed(make(2), W, H);
      const dot = (p, q) => p.reduce((s, v, i) => s + v * q[i], 0);
      return { dim: a1.length, norm: Math.sqrt(dot(a1, a1)), same: dot(a1, a2), diff: dot(a1, b), loadMs, embedMs };
    })()`)) as { dim: number; norm: number; same: number; diff: number; loadMs: number; embedMs: number };
    console.log("browser embedder:", JSON.stringify(out));
    expect(out.dim).toBe(768);
    expect(out.norm).toBeCloseTo(1, 4);
    expect(out.same).toBeGreaterThan(0.999);
    expect(out.diff).toBeLessThan(0.97);
    expect(errors).toEqual([]);
  });
});
