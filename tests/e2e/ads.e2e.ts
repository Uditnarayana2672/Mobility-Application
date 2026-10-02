import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { startE2E, type E2E } from "./harness";

let e: E2E;
let phone: Page;
let portal: Page;
let dashboard: Page;
const errors: string[] = [];

beforeAll(async () => {
  e = await startE2E();
  phone = await e.newPage();
  portal = await e.newPage();
  dashboard = await e.newPage();
  for (const [page, name] of [[phone, "phone"], [portal, "portal"], [dashboard, "dashboard"]] as const) {
    page.on("pageerror", (err) => errors.push(`${name}: ${err.message}`));
    page.on("console", (msg) => { if (msg.type() === "error" && !/favicon|speech/i.test(msg.text())) errors.push(`${name}: ${msg.text()}`); });
  }
});
afterAll(async () => e?.close());

describe("AR ads live control", () => {
  it("renders the simulated AR scene and removes a paused campaign in under 2 seconds", async () => {
    const before = await (await phone.request.get(`${e.url}/api/campaigns/office-hq`)).json() as { campaigns: { id: string; stats: { impressions: number } }[] };
    const beforeImpressions = before.campaigns.find((c) => c.id === "C1")!.stats.impressions;
    await phone.goto(`${e.url}/nav?demo=1#arad`);
    const ar = phone.getByTestId("screen-ar");
    await ar.waitFor({ state: "visible" });
    const canvas = phone.getByTestId("ar-canvas");
    await expect.poll(() => canvas.getAttribute("data-visible-ads")).toBe("1");
    await expect.poll(async () => {
      const now = await (await phone.request.get(`${e.url}/api/campaigns/office-hq`)).json() as typeof before;
      return now.campaigns.find((c) => c.id === "C1")!.stats.impressions;
    }, { timeout: 3000 }).toBe(beforeImpressions + 1);
    await dashboard.goto(`${e.url}/dashboard`);
    await expect.poll(() => dashboard.getByTestId("k-ad-impressions").textContent()).toBe("1");

    await portal.goto(`${e.url}/ads`);
    const row = portal.locator(".campaign-row").filter({ hasText: "BrewBox Coffee" });
    await row.waitFor();
    const pauseStarted = performance.now();
    await row.locator('input[type="checkbox"]').setChecked(false);
    await expect.poll(() => canvas.getAttribute("data-visible-ads"), { timeout: 2000, interval: 100 }).toBe("0");
    const latency = performance.now() - pauseStarted;
    console.info(`[phase4] pause-to-phone propagation: ${Math.round(latency)} ms`);
    expect(latency).toBeLessThan(2000);
  });

  it("shows the portal KPIs and has no browser errors", async () => {
    await portal.getByText("AR impressions").waitFor();
    expect(await portal.locator(".ads-kpis > div").count()).toBe(4);
    expect(errors).toEqual([]);
  });
});
