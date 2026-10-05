import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { startE2E, type E2E } from "./harness";

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

describe("Blueprint import in the editor", () => {
  it("choose the file, check the size line, import, and the draft holds the rooms", async () => {
    await page.goto(`${e.url}/editor`);
    await page.getByText("Demo Office · Tower A").first().waitFor();
    await page.getByText("⋯").click();
    await page.getByTestId("menu-import").click();
    await page.getByTestId("import-dialog").waitFor();
    await page.getByTestId("import-file").setInputFiles("tests/fixtures/blueprint-office.json");
    await page.getByTestId("import-size").waitFor();
    const scale = Number(await page.getByTestId("import-scale").inputValue());
    expect(scale).toBeGreaterThan(20);
    await page.getByTestId("import-scale").fill("80");
    expect(await page.getByTestId("import-size").innerText()).toMatch(/15\.8 m × 9\.5 m/);
    await page.getByRole("button", { name: "Import and replace" }).click();
    await page.getByTestId("import-dialog").waitFor({ state: "detached" });
    await page.waitForTimeout(1200);
    const draft = await (await page.request.get(`${e.url}/api/venues/office-hq/draft`)).json();
    expect(draft.rooms.map((r: { name: string }) => r.name)).toEqual(expect.arrayContaining(["Lobby", "Pantry", "Servers room"]));
    expect(draft.markers.length).toBeGreaterThan(2);
    expect(draft.edges.some((x: { width?: number }) => x.width !== undefined)).toBe(true);
  });

  it("a file that is not a Blueprint export is refused with a reason", async () => {
    await page.reload();
    await page.getByText("⋯").click();
    await page.getByTestId("menu-import").click();
    await page.getByTestId("import-file").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') });
    await page.getByText(/Missing the floors list/).waitFor();
  });

  it("no unexpected console errors", () => {
    expect(errors).toEqual([]);
  });
});
