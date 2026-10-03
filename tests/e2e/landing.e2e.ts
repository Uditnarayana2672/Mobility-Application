import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startE2E, type E2E } from "./harness";

let e: E2E;
beforeAll(async () => {
  e = await startE2E();
});
afterAll(async () => e?.close());

describe("first page: Designer or Indore Maps", () => {
  it("offers both, Designer opens the original empty-sheet designer, and it has a way to the maps", async () => {
    const page = await e.newPage();
    await page.goto(`${e.url}/`);
    await page.getByTestId("landing").waitFor();
    expect(await page.getByTestId("go-designer").count()).toBe(1);
    expect(await page.getByTestId("go-maps").count()).toBe(1);

    await page.getByTestId("go-designer").click();
    await page.getByText("Blueprint Designer").waitFor();
    expect(new URL(page.url()).pathname).toBe("/designer");

    await page.getByTestId("go-maps").click();
    await page.getByText("Dora.AI · Indore Maps").waitFor();
    expect(new URL(page.url()).pathname).toBe("/maps");
    expect(await page.getByText("Visitor app").count()).toBe(1);

    await page.getByText("← Designer or Indore Maps").click();
    await page.getByTestId("landing").waitFor();
  });
  it("Indore Maps opens the current app hub, and the old /legacy-editor address still reaches the designer", async () => {
    const page = await e.newPage();
    await page.goto(`${e.url}/`);
    await page.getByTestId("go-maps").click();
    await page.getByText("Dora.AI · Indore Maps").waitFor();
    await page.goto(`${e.url}/legacy-editor`);
    await page.getByText("Blueprint Designer").waitFor();
    expect(new URL(page.url()).pathname).toBe("/designer");
  });
});
