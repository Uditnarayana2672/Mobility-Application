import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startE2E, type E2E } from "./harness";

let e: E2E;
beforeAll(async () => {
  e = await startE2E();
});
afterAll(async () => e?.close());

describe("first page: Designer or Indore Maps", () => {
  it("offers both; Designer opens the original empty-sheet designer; its Indore Maps button opens the airport visitor map", async () => {
    const page = await e.newPage();
    await page.goto(`${e.url}/`);
    await page.getByTestId("landing").waitFor();
    expect(await page.getByTestId("go-designer").count()).toBe(1);
    expect(await page.getByTestId("go-maps").count()).toBe(1);

    await page.getByTestId("go-designer").click();
    await page.getByText("Blueprint Designer").waitFor();
    expect(new URL(page.url()).pathname).toBe("/designer");

    await page.getByTestId("go-maps").click();
    await page.getByTestId("screen-city").waitFor();
    const u = new URL(page.url());
    expect(u.pathname).toBe("/nav");
    expect(u.searchParams.get("venue")).toBe("airport");
    expect(await page.getByTestId("screen-city").innerText()).toContain("Airport");
  });
  it("Indore Maps on the first page opens the same airport map with the demo controls on a laptop", async () => {
    const page = await e.newPage();
    await page.goto(`${e.url}/`);
    await page.getByTestId("go-maps").click();
    await page.getByTestId("screen-city").waitFor();
    expect(new URL(page.url()).searchParams.get("demo")).toBe("1");
    expect(await page.getByText("Demo controls").count()).toBeGreaterThan(0);
  });
  it("the tool list is still at /maps, and the old /legacy-editor address reaches the designer", async () => {
    const page = await e.newPage();
    await page.goto(`${e.url}/maps`);
    await page.getByText("Dora.AI · Indore Maps").waitFor();
    await page.getByText("← Designer or Indore Maps").click();
    await page.getByTestId("landing").waitFor();
    await page.goto(`${e.url}/legacy-editor`);
    await page.getByText("Blueprint Designer").waitFor();
    expect(new URL(page.url()).pathname).toBe("/designer");
  });
});
