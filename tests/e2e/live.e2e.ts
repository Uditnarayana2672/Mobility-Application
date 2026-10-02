import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { startE2E, type E2E } from "./harness";

/**
 * The live path, end to end in a real browser, with the phone and the dashboard in SEPARATE browser contexts: BroadcastChannel cannot
 * carry anything between them, so everything the dashboard shows travelled over the /ws relay (?bus=ws on the simulated phone).
 * Then: late-joining dashboard replay from the server, "replay last walk" from the JSONL recording, and the "venue published" push.
 */
let e: E2E;
let phoneCtx: BrowserContext;
let dashCtx: BrowserContext;
let phone: Page;
let dash: Page;
const errors: string[] = [];

const watch = (p: Page, name: string) => {
  p.on("pageerror", (err) => errors.push(`${name} pageerror: ${err}`));
  p.on("console", (m) => {
    if (m.type() === "error" && !/404|favicon|speech|WebSocket/i.test(m.text())) errors.push(`${name} console: ${m.text()}`);
  });
};
const T = (p: Page, id: string) => p.getByTestId(id);
const nav = <R>(p: Page, fn: string): Promise<R> => p.evaluate(`(() => { const n = window.__nav; return (${fn})(n); })()`) as Promise<R>;

beforeAll(async () => {
  e = await startE2E();
  phoneCtx = await e.browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 420, height: 860 } });
  dashCtx = await e.browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 900 } });
  phone = await phoneCtx.newPage();
  dash = await dashCtx.newPage();
  watch(phone, "phone");
  watch(dash, "dash");
});
afterAll(async () => {
  await phoneCtx?.close();
  await dashCtx?.close();
  await e?.close();
});

describe("phone -> /ws -> dashboard (two browser contexts)", () => {
  it("the dashboard connects to the server and waits", async () => {
    await dash.goto(`${e.url}/dashboard`);
    await T(dash, "ws-status").filter({ hasText: "open" }).waitFor({ timeout: 15_000 });
    await T(dash, "conn-text").filter({ hasText: "Waiting for a phone" }).waitFor();
  });

  it("a scan on the phone shows up live: source badge, anchor, floor, event log", async () => {
    await phone.goto(`${e.url}/nav?demo=1&bus=ws`);
    await T(phone, "screen-city").waitFor();
    await nav(phone, "(n) => n.scanMarker(1, true)");
    await T(dash, "log").getByText(/Marker 1 scanned/).waitFor({ timeout: 15_000 });
    await T(dash, "conn-text").filter({ hasText: "phone connected" }).waitFor({ timeout: 10_000 });
    expect(await T(dash, "s-floor").textContent()).toBe("Floor 1");
    expect(await T(dash, "source-badge").getAttribute("data-source")).toMatch(/marker|sim/);
    expect(await T(dash, "s-anchor").textContent()).toMatch(/#1/);
    // sanity: nothing travelled by BroadcastChannel (separate contexts), so this was the WebSocket
  });

  it("a route and a walk are mirrored: destination, progress, trail", async () => {
    await nav(phone, "(n) => { n.showPlace({ room: 'F2-cafeteria' }); n.preview(); n.startNav(); }");
    await T(dash, "r-dest").filter({ hasText: "Cafeteria" }).waitFor({ timeout: 10_000 });
    await T(dash, "r-bar").waitFor();
    await dash.waitForFunction(() => Number(document.querySelector('[data-testid="r-bar"]')?.getAttribute("data-pct") ?? 0) > 3, undefined, { timeout: 20_000 });
    await T(dash, "trail").waitFor({ state: "attached", timeout: 10_000 });
  });

  it("a dashboard opened late gets the phone's last state replayed by the server", async () => {
    const late = await dashCtx.newPage();
    watch(late, "late");
    await late.goto(`${e.url}/dashboard`);
    await T(late, "r-dest").filter({ hasText: "Cafeteria" }).waitFor({ timeout: 15_000 });
    await T(late, "log").getByText(/Marker 1 scanned/).waitFor({ timeout: 10_000 });
    await late.close();
  });

  it("the walk was recorded to JSONL on the server", async () => {
    const dir = path.join(e.root, "data", "sessions", "office-hq");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBeGreaterThan(0);
    const lines = fs.readFileSync(path.join(dir, files[files.length - 1]!), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.some((l) => l.msg.type === "pose")).toBe(true);
    expect(lines.some((l) => l.msg.type === "route")).toBe(true);
    expect(lines.some((l) => l.msg.type === "event")).toBe(true);
  });

  it("the phone going away leaves the dashboard 'offline'; 'Replay last walk' replays the recording", async () => {
    await phone.close();
    await T(dash, "conn-text").filter({ hasText: "Phone offline" }).waitFor({ timeout: 15_000 });
    await T(dash, "replay-btn-live").or(T(dash, "replay-btn")).first().click();
    await T(dash, "replay-note").filter({ hasText: /Replaying/ }).waitFor({ timeout: 10_000 });
    await T(dash, "conn-text").filter({ hasText: "Replaying a recorded walk" }).waitFor();
    await T(dash, "log").getByText(/Marker 1 scanned/).waitFor({ timeout: 10_000 });
    await T(dash, "replay-note").filter({ hasText: "Replay finished" }).waitFor({ timeout: 60_000 });
  });

  it("publishing a venue pushes 'venue published' to a connected phone and dashboard", async () => {
    phone = await phoneCtx.newPage();
    watch(phone, "phone2");
    await phone.goto(`${e.url}/nav?demo=1&bus=ws`);
    await T(phone, "screen-city").waitFor();
    await nav(phone, "(n) => n.scanMarker(1, true)");
    await T(dash, "ws-status").filter({ hasText: "open" }).waitFor();
    const venue = JSON.parse(fs.readFileSync(path.join(e.root, "public", "venues", "office-hq", "venue.json"), "utf8"));
    const r = await dash.evaluate(async (body) => {
      const res = await fetch("/api/venues/office-hq/publish", { method: "POST", body: JSON.stringify(body) });
      return { status: res.status, version: ((await res.json()) as { version: number }).version };
    }, venue);
    expect(r.status).toBe(200);
    await T(dash, "notice").getByText(new RegExp(`v${r.version}`)).waitFor({ timeout: 10_000 });
    await phone.getByText(new RegExp(`Map updated \\(v${r.version}\\)`)).waitFor({ timeout: 10_000 });
    expect(await nav<number>(phone, "(n) => n.getState().venue.version")).toBe(r.version);
  });

  it("?pose=xr on a browser without WebXR offers step counting; ?pose=pdr shows the camera scan + the debug overlay", async () => {
    const p = await phoneCtx.newPage();
    watch(p, "live-ui");
    await p.goto(`${e.url}/nav?pose=xr&debug=1`);
    await T(p, "screen-city").waitFor();
    await T(p, "venue-card").click();
    await T(p, "live-locate").waitFor();
    await p.getByText("AR tracking is not available").waitFor({ timeout: 10_000 });
    expect(await T(p, "start-ar").isDisabled()).toBe(true);
    await T(p, "debug-overlay").waitFor();
    await p.getByRole("button", { name: "Use step counting instead" }).click();
    await T(p, "start-cam").waitFor();
    expect(await T(p, "nav-root").getAttribute("data-pose")).toBe("pdr");
    await T(p, "debug-overlay").getByText(/PDR/).waitFor();
    // no demo marker chips on a live phone
    expect(await T(p, "marker-chips").isVisible()).toBe(false);
    await p.close();
  });

  it("no unexpected console errors", () => {
    expect(errors).toEqual([]);
  });
});
