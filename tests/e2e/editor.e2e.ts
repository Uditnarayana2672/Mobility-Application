import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { parseVenue, validate } from "@/core";
import type { Page } from "playwright-core";
import { startE2E, type E2E } from "./harness";

/**
 * Drives the real /editor in a real browser: blank venue -> upload a floor photo -> calibrate -> trace two floors
 * (walk path, rooms, markers, POI, ad wall) -> lift + stairs links -> checklist -> publish -> GET /api/venues/office-hq.
 */
let e: E2E;
let page: Page;
const errors: string[] = [];
const SHOTS = "tmp-shots";

beforeAll(async () => {
  e = await startE2E();
  fs.mkdirSync(SHOTS, { recursive: true });
  page = await e.newPage();
  page.on("pageerror", (err) => errors.push(`pageerror: ${err}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/404/.test(m.text())) errors.push(`console: ${m.text()}`); // the draft probe is a legitimate 404
  });
  page.on("dialog", (d) => void d.accept());
});
afterAll(async () => e?.close());

/** Screen position of a world point (metres), reading the plate rectangle's on-screen box. North-up, so this is a plain affine map. */
async function w2s(x: number, y: number, plate = { w: 60, h: 36 }) {
  const box = await page.locator('[data-testid="map-canvas"] svg > g > rect').first().boundingBox();
  if (!box) throw new Error("plate not found");
  const sx = box.width / (plate.w + 0.8);
  return { x: box.x + (x + 0.4) * sx, y: box.y + (y + 0.4) * sx };
}
const click = async (x: number, y: number) => {
  const p = await w2s(x, y);
  await page.mouse.click(p.x, p.y);
};
const drag = async (x0: number, y0: number, x1: number, y1: number) => {
  const a = await w2s(x0, y0);
  const b = await w2s(x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
};
const tool = (key: string) => page.keyboard.press(key);
const api = async (p: string) => (await page.request.get(`${e.url}${p}`)).json();
const draft = () => api("/api/venues/office-hq/draft");
const settle = () => page.waitForTimeout(1100); // autosave debounce is 800 ms

function makePhoto(file: string) {
  const W = 1600;
  const H = 900;
  const png = new PNG({ width: W, height: H });
  png.data.fill(255);
  const dark = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    png.data[i] = png.data[i + 1] = png.data[i + 2] = 40;
  };
  for (let x = 200; x <= 1200; x++) for (let t = -2; t <= 2; t++) dark(x, 450 + t); // the 1000 px "measured corridor"
  for (let y = 100; y < 800; y++) for (const x of [100, 1500]) dark(x, y);
  fs.writeFileSync(file, PNG.sync.write(png));
}

async function drawFloor(name: string, bigRoomName: string) {
  // walk path along the corridor centre-line
  await tool("w");
  for (const x of [2, 30, 58]) await click(x, 10);
  await page.keyboard.press("Escape");
  // rooms
  await tool("r");
  await drag(10, 11, 16, 18); // lift lobby
  await drag(20, 11, 26, 18); // stairs
  await drag(32, 2, 46, 9); // big room north of the corridor
  // name the big room via the properties panel
  await tool("v");
  await click(36, 5);
  await page.getByText("Name", { exact: true }).first().waitFor();
  const nameBox = page.locator("label:has-text('Name') input").first();
  await nameBox.fill(bigRoomName);
  await nameBox.press("Enter");
  // markers at the lift lobby, the stairs and the big room
  await tool("m");
  await click(13, 11.2);
  await click(23, 11.2);
  await click(39, 8.8);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

describe("editor end to end", () => {
  it("starts a blank venue", async () => {
    await page.goto(`${e.url}/editor`);
    await page.getByText("Demo Office · Tower A").first().waitFor();
    await page.getByText("⋯").click();
    await page.getByText("Start a blank venue").click();
    await page.locator("[data-type=room]").first().waitFor({ state: "detached" }).catch(() => undefined);
    expect(await page.locator("[data-type=room]").count()).toBe(0);
    await settle();
    expect((await draft()).rooms).toHaveLength(0);
  });

  it("uploads a floor photo and calibrates it with the Scale tool", async () => {
    const photo = path.join(e.root, "plan.png");
    makePhoto(photo);
    await page.locator("input[type=file]").setInputFiles(photo);
    await page.getByText("not calibrated: use the Scale tool").waitFor();
    // blocked until calibrated
    await page.getByRole("button", { name: "✔ Validate" }).click();
    await page.getByText("Floor photo not calibrated").or(page.getByText("Scale not calibrated")).first().waitFor();
    await page.getByRole("button", { name: "Properties" }).click();

    // The 1000 px line is 37.5 m under the guessed scale (0.0375 m/px) and really 50 m: scale -> 0.05.
    const a = { x: 200 * 0.0375, y: 450 * 0.0375 };
    const b = { x: 1200 * 0.0375, y: 450 * 0.0375 };
    await tool("s");
    await click(a.x, a.y);
    await click(b.x, b.y);
    await page.getByText("Calibrate scale").waitFor();
    // The modal is pre-filled with the drawn length; pixel rounding makes it ~37.5 m rather than exactly 37.50.
    const shown = Number(await page.locator("input[type=number]").last().inputValue());
    expect(shown).toBeGreaterThan(37);
    expect(shown).toBeLessThan(38);
    await page.locator("input[type=number]").last().fill("50");
    await page.getByRole("button", { name: "Apply scale" }).click();
    await page.getByText("✔ calibrated").waitFor();
    await settle();
    const d = await draft();
    const bg = d.floors[0].background;
    expect(bg.calibrated).toBe(true);
    expect(bg.transform.scale).toBeCloseTo((0.0375 * 50) / shown, 3); // scaled by real / drawn
    expect(Math.abs(bg.transform.scale - 0.05) / 0.05).toBeLessThan(0.02);
    expect(bg.imageUrl).toMatch(/^\/uploads\/[a-f0-9]{32}\.png$/);
    expect(d.scale.calibrated).toBe(true);
    // the uploaded photo is served back
    expect((await page.request.get(`${e.url}${bg.imageUrl}`)).status()).toBe(200);
    await page.screenshot({ path: `${SHOTS}/calibrated.png` });
  });

  it("traces floor 1, then floor 2", async () => {
    await tool("v");
    await drawFloor("floor1", "Workspace");
    await page.getByRole("button", { name: "＋ Floor" }).click();
    await page.getByRole("button", { name: "Floor 2" }).waitFor();
    await drawFloor("floor2", "Cafeteria");
    await settle();
    const d = await draft();
    expect(d.floors).toHaveLength(2);
    expect(d.rooms).toHaveLength(6);
    expect(d.markers.map((m: { id: number }) => m.id)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(d.rooms.map((r: { name: string }) => r.name)).toContain("Cafeteria");
    // every door got linked into the corridor
    for (const r of d.rooms) {
      const doorLinks = d.edges.filter((x: { a: string; b: string }) => (x.a === `${r.id}:door` || x.b === `${r.id}:door`) && x.a !== r.id && x.b !== r.id);
      expect(doorLinks.length, `${r.id} door link`).toBeGreaterThan(0);
    }
  });

  it("links the lifts and the stairs across floors, drops an entrance POI and an ad wall", async () => {
    await page.getByRole("button", { name: "Floor 1" }).click();
    // lift: pick on F1, switch floor, pick on F2, Enter
    await tool("l");
    await click(13, 15);
    await page.getByRole("button", { name: "Floor 2" }).click();
    await click(13, 15);
    await page.keyboard.press("Enter");
    await page.getByText("Linked 2 floors by lift").waitFor();
    // stairs: completes after the second pick
    await page.getByRole("button", { name: "🪜 Stairs" }).click();
    await click(23, 15);
    await page.getByRole("button", { name: "Floor 1" }).click();
    await click(23, 15);
    await page.getByText("Linked 2 floors by stairs").waitFor();

    await tool("p");
    await page.locator("select").filter({ hasText: "Main entrance" }).selectOption("entrance");
    await click(2, 10);
    await tool("a");
    await click(36, 9.2); // a blank stretch of the big room's south wall, away from its door (at x=39)
    await tool("v");
    await settle();
    const d = await draft();
    expect(d.edges.filter((x: { type: string }) => x.type === "lift")).toHaveLength(1);
    expect(d.edges.filter((x: { type: string }) => x.type === "stairs")).toHaveLength(1);
    expect(d.pois[0].kind).toBe("entrance");
    expect(d.walls).toHaveLength(1);
  });

  it("undo and redo step one committed action at a time", async () => {
    const before = (await draft()).walls.length;
    await tool("a");
    await click(20, 9.2);
    await tool("v");
    await settle();
    expect((await draft()).walls).toHaveLength(before + 1);
    await page.keyboard.press("Control+z");
    await settle();
    expect((await draft()).walls).toHaveLength(before);
    await page.keyboard.press("Control+y");
    await settle();
    expect((await draft()).walls).toHaveLength(before + 1);
    await page.keyboard.press("Control+z"); // leave the venue as it was
    await settle();
  });

  it("checklist is green and Publish writes version 2 that GET /api/venues/office-hq returns", async () => {
    await settle();
    const parsed = parseVenue(await draft());
    if (!parsed.ok) throw new Error(`draft invalid: ${JSON.stringify(parsed.issues)}`);
    const blocking = validate(parsed.data).filter((r) => r.level === "fail").map((r) => `${r.title}: ${r.detail}`);
    expect(blocking).toEqual([]);
    await page.getByRole("button", { name: "✔ Validate" }).click();
    await page.getByText("Ready to publish").waitFor();
    await page.screenshot({ path: `${SHOTS}/checklist.png` });
    await page.getByRole("button", { name: "🚀 Publish" }).click();
    await page.getByText("🚀 Published v2").waitFor();
    const live = await api("/api/venues/office-hq");
    expect(live.version).toBe(2);
    expect(live.status).toBe("published");
    expect(live.rooms).toHaveLength(6);
    expect(live.markers).toHaveLength(6);
    expect(live.floors[0].background.calibrated).toBe(true);
    expect((await page.request.get(`${e.url}/api/venues/office-hq/draft`)).status()).toBe(404);
    const versions = (await api("/api/venues/office-hq/versions")).versions;
    expect(versions[0]).toMatchObject({ version: 2, current: true });
    // a fresh page load shows the published map
    await page.reload();
    await page.getByText("v2 published").waitFor();
    expect(await page.locator("[data-type=room]").count()).toBe(3);
    expect(errors).toEqual([]);
  });
});
