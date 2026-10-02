import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startE2E, type E2E } from "./harness";

let e: E2E;
beforeAll(async () => {
  e = await startE2E();
});
afterAll(async () => e?.close());

describe("/owner", () => {
  it("shows the live version, counts and the version history after a publish", async () => {
    const page = await e.newPage();
    await page.goto(`${e.url}/owner`);
    await page.getByText("Live v1").waitFor();
    expect(await page.getByText("Demo Office · Tower A").count()).toBeGreaterThan(0);
    // publish v2 straight through the API (same body shape the editor sends)
    const seed = await (await page.request.get(`${e.url}/api/venues/office-hq`)).json();
    const r = await page.request.post(`${e.url}/api/venues/office-hq/publish`, { data: seed });
    expect(r.status()).toBe(200);
    await page.reload();
    await page.getByText("Live v2").waitFor();
    expect(await page.locator("[data-version]").count()).toBe(2);
    expect(await page.locator("[data-version='2']").getByText("live").count()).toBe(1);
  });
});
