import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { startE2E, type E2E } from "./harness";

let e: E2E;
let page: Page;

beforeAll(async () => { e = await startE2E(); page = await e.newPage(); });
afterAll(async () => e?.close());

describe("preflight", () => {
  it("reports the secure origin, live server and published venue", async () => {
    await page.goto(`${e.url}/preflight`);
    await expect.poll(() => page.getByTestId("check-certificate").getAttribute("class")).toContain("pass");
    await expect.poll(() => page.getByTestId("check-server").getAttribute("class")).toContain("pass");
    await expect.poll(() => page.getByTestId("check-venue").getAttribute("class")).toContain("pass");
    expect(await page.getByTestId("check-venue").textContent()).toContain("published server copy");
  });

  it("offers the global reset and both stage views", async () => {
    const reset = page.getByRole("button", { name: "Reset entire demo" });
    const response = page.waitForResponse((r) => r.url().includes("/api/demo/reset/") && r.request().method() === "POST");
    await reset.click();
    expect((await response).ok()).toBe(true);
    expect(await page.getByRole("link", { name: "Open visitor app" }).getAttribute("href")).toBe("/nav");
    expect(await page.getByRole("link", { name: "Open dashboard" }).getAttribute("href")).toBe("/dashboard");
  });
});
