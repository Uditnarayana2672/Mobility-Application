import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import type { Page } from "playwright-core";
import { startE2E, type E2E } from "./harness";

/**
 * The on-stage backup, end to end in a real browser: /nav (simulation) and /dashboard in two pages of one browser context
 * (BroadcastChannel needs the same browser). Scan marker 1, ask "Cafeteria kahan hai?", compare stairs vs lift, walk to
 * Floor 2 and see "You have arrived", with the dashboard mirroring the whole thing.
 */
let e: E2E;
let phone: Page;
let dash: Page;
const errors: string[] = [];
const SHOTS = "tmp-shots";

const watch = (p: Page, name: string) => {
  p.on("pageerror", (err) => errors.push(`${name} pageerror: ${err}`));
  p.on("console", (m) => {
    if (m.type() === "error" && !/404|favicon|speech/i.test(m.text())) errors.push(`${name} console: ${m.text()}`);
  });
};

beforeAll(async () => {
  e = await startE2E();
  fs.mkdirSync(SHOTS, { recursive: true });
  dash = await e.newPage();
  phone = await e.newPage();
  watch(dash, "dash");
  watch(phone, "phone");
});
afterAll(async () => e?.close());

const T = (p: Page, id: string) => p.getByTestId(id);

describe("visitor app + dashboard, laptop simulation", () => {
  it("opens the dashboard first (waiting for a phone) and the visitor app with the demo panel", async () => {
    await dash.goto(`${e.url}/dashboard`);
    await T(dash, "conn-text").filter({ hasText: "Waiting for a phone" }).waitFor();
    await phone.goto(`${e.url}/nav?demo=1`);
    await T(phone, "screen-city").waitFor();
    await T(phone, "demo-panel").waitFor();
    await phone.screenshot({ path: `${SHOTS}/nav-1-city.png` });
  });

  it("scans marker 1 (the demo script, step 3): blue dot, floor and anchor known", async () => {
    await T(phone, "venue-card").click();
    await T(phone, "screen-locate").waitFor();
    await phone.locator('[data-marker="1"]').click();
    await T(phone, "sheet-explore").waitFor();
    await phone.getByText("You are on Floor 1").waitFor();
    await phone.getByText(/anchored by 1/).waitFor();
    await phone.screenshot({ path: `${SHOTS}/nav-2-explore.png` });
    // the dashboard sees the scan
    await T(dash, "log").getByText(/Marker 1 scanned/).waitFor({ timeout: 10_000 });
    await T(dash, "conn-text").filter({ hasText: "phone connected" }).waitFor({ timeout: 10_000 });
    expect(await T(dash, "s-floor").textContent()).toBe("Floor 1");
  });

  it("search with an alias, then back out", async () => {
    await T(phone, "search-pill").click();
    await T(phone, "search-input").fill("canteen");
    await T(phone, "search-row").first().waitFor();
    expect(await T(phone, "search-row").first().getAttribute("data-id")).toBe("F2-cafeteria");
    await phone.screenshot({ path: `${SHOTS}/nav-3-search.png` });
    await T(phone, "search-back").click();
    await T(phone, "sheet-explore").waitFor();
  });

  it("asks 'Cafeteria kahan hai?' by text (step 4): place card, then Directions with stairs vs lift (step 5)", async () => {
    await T(phone, "btn-mic").click();
    await T(phone, "voice-overlay").waitFor();
    await T(phone, "voice-input").fill("Cafeteria kahan hai?");
    await T(phone, "voice-send").click();
    await T(phone, "sheet-place").waitFor({ timeout: 10_000 });
    expect(await T(phone, "place-name").textContent()).toBe("Cafeteria");
    await T(phone, "voice-overlay").waitFor({ state: "detached" });
    await phone.screenshot({ path: `${SHOTS}/nav-4-place.png` });

    await T(phone, "btn-directions").click();
    await T(phone, "sheet-preview").waitFor();
    const vias = await T(phone, "route-options").locator(".opt").evaluateAll((els) => els.map((x) => x.getAttribute("data-via")));
    expect(vias.sort()).toEqual(["lift", "stairs"]);
    await phone.screenshot({ path: `${SHOTS}/nav-5-preview.png` });
    // the dashboard mirrors the planned route
    await T(dash, "r-dest").filter({ hasText: "Cafeteria" }).waitFor({ timeout: 10_000 });

    // Avoid stairs -> one accessible (lift) route; back again
    await T(phone, "avoid-stairs").setChecked(true);
    await phone.waitForFunction(() => document.querySelectorAll('[data-testid="route-options"] .opt').length === 1);
    expect(await T(phone, "route-options").locator(".opt").first().getAttribute("data-via")).toBe("lift");
    await T(phone, "avoid-stairs").setChecked(false);
    await phone.waitForFunction(() => document.querySelectorAll('[data-testid="route-options"] .opt').length === 2);
  });

  it("walks to Floor 2 at x3 (steps 6-7): banner, transition, floor prompt, arrival", async () => {
    await T(phone, "d-speed").locator('button[data-m="3"]').click();
    await T(phone, "btn-start").click();
    await T(phone, "banner").waitFor();
    await T(phone, "navbar").waitFor();
    await phone.screenshot({ path: `${SHOTS}/nav-6-nav.png` });
    // spoken lines always show as captions (headless has no voices: caption only)
    await T(phone, "caption").filter({ hasText: /./ }).waitFor({ timeout: 10_000 });
    // dashboard tracks the walk live, including the other floor
    await T(dash, "r-prog").filter({ hasText: /\/ \d+ m/ }).waitFor({ timeout: 10_000 });
    await dash.screenshot({ path: `${SHOTS}/dash-1-walking.png` });

    await T(phone, "transition").waitFor({ timeout: 60_000 });
    await phone.screenshot({ path: `${SHOTS}/nav-7-transition.png` });
    await T(phone, "floor-prompt").waitFor({ timeout: 30_000 });
    await phone.getByText("Are you on Floor 2 now?").waitFor();
    await phone.screenshot({ path: `${SHOTS}/nav-8-floorprompt.png` });
    await T(dash, "s-floor").filter({ hasText: "Floor 2" }).waitFor({ timeout: 10_000 });
    expect(await T(phone, "navmap").getAttribute("data-floor")).toBe("F2");

    await T(phone, "screen-arrived").waitFor({ state: "visible", timeout: 120_000 });
    expect(await T(phone, "arrived-title").textContent()).toBe("You have arrived at Cafeteria");
    await phone.screenshot({ path: `${SHOTS}/nav-9-arrived.png` });
  });

  it("the dashboard mirrored the whole walk", async () => {
    const log = await T(dash, "log").innerText();
    for (const w of ["scan", "route", "nav", "floor", "arrive"]) expect(log).toMatch(new RegExp(`\\b${w}\\b`));
    expect(log).toMatch(/Arrived at Cafeteria/);
    expect(log).not.toMatch(/offroute/);
    expect(await T(dash, "trail").count()).toBeGreaterThan(0);
    await dash.screenshot({ path: `${SHOTS}/dash-2-arrived.png` });
  });

  it("had no page or console errors", () => {
    expect(errors).toEqual([]);
  });
});
