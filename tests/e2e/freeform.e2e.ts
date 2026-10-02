import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { startE2E, type E2E } from "./harness";

/**
 * The free-form editor in a real browser: snapping is off by default, an L-shaped room is drawn by clicking its corners,
 * a second door is added, furniture is placed, a corridor line is bent, then Publish -> the visitor app draws the outline,
 * the furniture, and routes into the room.
 */
let e: E2E;
let page: Page;
const errors: string[] = [];

beforeAll(async () => {
  e = await startE2E();
  page = await e.newPage();
  page.on("pageerror", (err) => errors.push(`pageerror: ${err}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/404|WebSocket/i.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  page.on("dialog", (d) => void d.accept());
});
afterAll(async () => e?.close());

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
const settle = () => page.waitForTimeout(1100);

describe("free-form editor end to end", () => {
  it("starts blank with snapping OFF (the toggle is there, key G flips it)", async () => {
    await page.goto(`${e.url}/editor`);
    await page.getByText("Demo Office · Tower A").first().waitFor();
    await page.getByText("⋯").click();
    await page.getByText("Start a blank venue").click();
    await settle();
    const snap = page.getByTestId("snap-toggle");
    expect(await snap.isChecked()).toBe(false);
    await page.keyboard.press("g");
    expect(await snap.isChecked()).toBe(true);
    await page.keyboard.press("g");
    expect(await snap.isChecked()).toBe(false);
  });

  it("lays a corridor and draws an L-shaped room by clicking its corners (Enter closes)", async () => {
    await tool("w");
    for (const x of [2, 30, 58]) await click(x, 17.3);
    await page.keyboard.press("Escape");
    await tool("r");
    await page.getByTestId("room-shape").getByText("Free shape").click();
    for (const [x, y] of [[5.3, 6.1], [15.2, 6.1], [15.2, 10.4], [22.7, 10.4], [22.7, 15.1], [5.3, 15.1]] as const) await click(x, y);
    await page.keyboard.press("Enter");
    await settle();
    const d = await draft();
    expect(d.rooms).toHaveLength(1);
    const room = d.rooms[0];
    expect(room.polygon).toHaveLength(6);
    // snapping is off: the corners are not on the 0.5 m grid
    expect(room.polygon.some((p: [number, number]) => p[0] * 2 !== Math.round(p[0] * 2))).toBe(true);
    expect(room.door.y).toBeGreaterThan(14); // the door is on the wall facing the corridor
    expect(room.door.side).toBeUndefined();
  });

  it("draws a rectangle bathroom, adds a second door to the L room, places a bed and a toilet", async () => {
    await page.getByTestId("room-shape").getByText("Rectangle").click();
    await drag(27, 8, 33, 15.2);
    await tool("d");
    await click(5.3, 10.5); // the L room's left wall
    await tool("f");
    await click(8, 9); // a bed (default kind)
    await page.getByTestId("object-kind").selectOption("toilet");
    await click(30, 11);
    await tool("m");
    await click(10, 15.4);
    await tool("v");
    await settle();
    const d = await draft();
    expect(d.rooms).toHaveLength(2);
    const l = d.rooms.find((r: { polygon?: unknown }) => r.polygon);
    expect(l.extraDoors).toHaveLength(1);
    expect(l.extraDoors[0].normal).toBe(270);
    expect(d.objects.map((o: { kind: string }) => o.kind).sort()).toEqual(["bed", "toilet"]);
    expect(d.markers).toHaveLength(1);
  });

  it("bends a corridor line by dragging its middle dot, then Publish is allowed", async () => {
    await tool("v");
    const before = await draft();
    const nodes = new Map<string, { x: number; y: number }>(before.nodes.map((n: { id: string; x: number; y: number }) => [n.id, n]));
    const edge = before.edges
      .filter((x: { type: string; a: string; b: string }) => x.type === "walk" && nodes.get(x.a) && nodes.get(x.b) && before.nodes.find((n: { id: string; kind: string }) => n.id === x.a)?.kind === "corridor" && before.nodes.find((n: { id: string; kind: string }) => n.id === x.b)?.kind === "corridor")
      .sort((p: { a: string; b: string }, q: { a: string; b: string }) => Math.hypot(nodes.get(q.a)!.x - nodes.get(q.b)!.x, nodes.get(q.a)!.y - nodes.get(q.b)!.y) - Math.hypot(nodes.get(p.a)!.x - nodes.get(p.b)!.x, nodes.get(p.a)!.y - nodes.get(p.b)!.y))[0]!;
    const a = nodes.get(edge.a)!;
    const b = nodes.get(edge.b)!;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    await click(mid.x, mid.y); // select the line
    await page.getByRole("heading", { name: "Corridor line" }).waitFor();
    await drag(mid.x, mid.y, mid.x, mid.y + 2.4); // the white dot in the middle
    await settle();
    const after = await draft();
    expect(after.nodes.length).toBe(before.nodes.length + 1);
    expect(after.nodes.some((n: { x: number; y: number }) => Math.abs(n.x - mid.x) < 0.5 && Math.abs(n.y - (mid.y + 2.4)) < 0.5)).toBe(true);
    await page.getByRole("button", { name: "✔ Validate" }).click();
    await page.getByText("Ready to publish").waitFor();
    await page.getByRole("button", { name: "🚀 Publish" }).click();
    await page.getByText("🚀 Published v2").waitFor();
    const live = await api("/api/venues/office-hq");
    expect(live.rooms.find((r: { polygon?: unknown }) => r.polygon).polygon).toHaveLength(6);
    expect(live.objects).toHaveLength(2);
  });

  it("the visitor app draws the outline and the furniture, and routes into the free-form room", async () => {
    const phone = await e.newPage();
    phone.on("pageerror", (err) => errors.push(`phone pageerror: ${err}`));
    await phone.goto(`${e.url}/nav?demo=1`);
    await phone.getByTestId("screen-city").waitFor();
    await phone.evaluate("window.__nav.scanMarker(0, true)");
    await phone.getByTestId("navmap").waitFor();
    expect(await phone.locator('path[data-type="room"]').count()).toBe(1);
    expect(await phone.locator('[data-type="object"]').count()).toBe(2);
    const dest = await phone.evaluate("(() => { const n = window.__nav; n.showPlace({ room: 'F1-r1' }); n.preview(); return n.getState().route && n.getState().route.destName; })()");
    expect(dest).toBe("New room");
    await phone.close();
  });

  it("no unexpected console errors", () => {
    expect(errors).toEqual([]);
  });
});
