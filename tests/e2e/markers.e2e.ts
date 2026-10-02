import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { PNG } from "pngjs";
import type { Page } from "playwright-core";
import { detectMarkers } from "@/spikes/aruco/detect";
import { startE2E, type E2E } from "./harness";

/** /markers in a real browser: true printed size, A5 page size in the PDF, and the printed images are detectable. */
let e: E2E;
let page: Page;
const MM_PER_PX = 25.4 / 96;

beforeAll(async () => {
  e = await startE2E();
  page = await e.newPage();
  await page.goto(`${e.url}/markers`);
  await page.locator(".sheet").first().waitFor();
});
afterAll(async () => e?.close());

describe("/markers", () => {
  it("lists every marker of the published venue, one sheet each", async () => {
    expect(await page.locator(".sheet").count()).toBe(8);
    expect(await page.getByText("v1 published").count()).toBeGreaterThan(0);
  });

  it("prints the black square at exactly markers[].sizeM (120 mm) and the ruler bar at 100 mm", async () => {
    const code = await page.locator(".sheet svg.aruco").first().boundingBox();
    expect(code!.width * MM_PER_PX).toBeCloseTo(120, 1);
    expect(code!.height * MM_PER_PX).toBeCloseTo(120, 1);
    const ruler = await page.locator(".sheet .ruler").first().boundingBox();
    expect(ruler!.width * MM_PER_PX).toBeCloseTo(100, 1);
    const sheet = await page.locator(".sheet").first().boundingBox();
    expect(sheet!.width * MM_PER_PX).toBeCloseTo(148, 1); // A5
    expect(sheet!.height * MM_PER_PX).toBeCloseTo(210, 1);
  });

  it("a marker with a different sizeM prints at that size, and the paper options follow what fits", async () => {
    const p = await e.newPage();
    await p.route("**/api/venues/office-hq", async (route) => {
      const r = await route.fetch();
      const v = await r.json();
      v.markers[0].sizeM = 0.08; // 80 mm fits A6
      for (let i = 1; i < v.markers.length; i++) v.markers[i].sizeM = 0.08;
      await route.fulfill({ json: v });
    });
    await p.goto(`${e.url}/markers`);
    await p.locator(".sheet").first().waitFor();
    const code = await p.locator(".sheet svg.aruco").first().boundingBox();
    expect(code!.width * MM_PER_PX).toBeCloseTo(80, 1);
    expect(await p.getByRole("button", { name: "A6" }).isEnabled()).toBe(true);
    // the same page with 120 mm markers does not allow A6
    expect(await page.getByRole("button", { name: "A6" }).isDisabled()).toBe(true);
    await p.close();
  });

  it("the print PDF is A5 with one page per marker", async () => {
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const text = pdf.toString("latin1");
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
    expect(box, "MediaBox not found in the PDF").not.toBeNull();
    expect(Number(box![1])).toBeCloseTo(419.53, 0); // 148 mm in points
    expect(Number(box![2])).toBeCloseTo(595.28, 0); // 210 mm in points
    expect((text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length).toBe(8);
  });

  it("every printed sheet is detected as its own ArUco id (screenshot -> detector)", async () => {
    const ids = await page.locator(".sheet").evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-marker-sheet"))));
    expect(ids).toHaveLength(8);
    for (const id of ids) {
      const buf = await page.locator(`.sheet[data-marker-sheet="${id}"]`).screenshot();
      const png = PNG.sync.read(buf);
      const gray = new Uint8Array(png.width * png.height);
      for (let i = 0; i < gray.length; i++) gray[i] = Math.round(png.data[i * 4]! * 0.299 + png.data[i * 4 + 1]! * 0.587 + png.data[i * 4 + 2]! * 0.114);
      const dets = detectMarkers({ data: gray, width: png.width, height: png.height });
      expect(dets.map((d) => d.id), `sheet ${id}`).toContain(id);
    }
    fs.mkdirSync("tmp-shots", { recursive: true });
    await page.screenshot({ path: "tmp-shots/markers.png" });
  });
});
