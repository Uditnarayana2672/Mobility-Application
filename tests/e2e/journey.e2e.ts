import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startE2E, type E2E } from "./harness";

let e: E2E;
beforeAll(async () => {
  e = await startE2E();
});
afterAll(async () => e?.close());

describe("my office: say where you are and where you want to go, in one sentence", () => {
  it("the first screen has a Say-it button; the sentence starts the route from the place named", async () => {
    const page = await e.newPage();
    await page.goto(`${e.url}/nav?venue=my-office&demo=1`);
    await page.getByTestId("venue-card").click();
    await page.getByTestId("screen-locate").waitFor();
    await page.getByTestId("locate-say").click();
    await page.getByTestId("voice-overlay").waitFor();
    await page.getByTestId("voice-input").fill("I am near the lift lobby and I want to go to the pantry");
    await page.getByTestId("voice-send").click();
    await page.getByTestId("sheet-preview").waitFor({ timeout: 15_000 });
    expect(await page.getByTestId("route-from").innerText()).toContain("Lift Lobby");
    expect(await page.getByTestId("sheet-preview").innerText()).toContain("Pantry");
    expect(await page.getByTestId("route-options").locator(".opt").count()).toBeGreaterThan(0);
  });

  it("Change start lists the entrances first and replans from the one chosen", async () => {
    const page = await e.newPage();
    await page.goto(`${e.url}/nav?venue=my-office&demo=1`);
    await page.getByTestId("venue-card").click();
    await page.getByTestId("locate-say").click();
    await page.getByTestId("voice-input").fill("I am near the lift lobby and I want to go to the pantry");
    await page.getByTestId("voice-send").click();
    await page.getByTestId("sheet-preview").waitFor({ timeout: 15_000 });
    const before = await page.getByTestId("route-from").innerText();
    expect(before).toContain("Lift Lobby");
    await page.getByTestId("change-start").click();
    await page.getByTestId("search-overlay").waitFor();
    const first = await page.getByTestId("search-row").first().innerText();
    expect(first).toMatch(/Point A|Entrance/);
    await page.getByTestId("search-row").filter({ hasText: "Entrance E" }).click();
    await page.waitForFunction((b) => document.querySelector('[data-testid="route-from"]')?.textContent !== b, before, { timeout: 10_000 });
    expect(await page.getByTestId("route-from").innerText()).not.toContain("Lift Lobby");
    expect(await page.getByTestId("sheet-preview").innerText()).toContain("Pantry");
  });
});
