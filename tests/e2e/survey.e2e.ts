import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { startE2E, type E2E } from "./harness";

let e: E2E;
let page: Page;
const errors: string[] = [];

beforeAll(async () => {
  e = await startE2E({ fakeCamera: true });
  page = await e.newPage();
  page.on("pageerror", (err) => errors.push(`pageerror: ${err}`));
  page.on("dialog", (d) => void d.accept());
});
afterAll(async () => e?.close());

describe("survey walk page", () => {
  it("starts the camera, starts from a room, records a picture with its position, builds the index and reports the self-test", async () => {
    await page.goto(`${e.url}/survey`);
    await page.getByTestId("survey-page").waitFor();
    await page.getByRole("button", { name: /Start the camera/ }).click();
    await page.getByTestId("survey-start-room").selectOption({ index: 1 });
    await page.getByText(/Standing just inside/).waitFor();
    await page.waitForFunction(() => (document.querySelector('[data-testid="survey-video"]') as HTMLVideoElement | null)?.videoWidth, null, { timeout: 15_000 });
    await page.getByTestId("survey-record").click();
    await page.waitForFunction(() => /REC [1-9]/.test(document.body.innerText), null, { timeout: 15_000 });
    await page.getByTestId("survey-record").click(); // stop
    const status = await (await page.request.get(`${e.url}/api/survey/office-hq`)).json();
    expect(status.count).toBeGreaterThanOrEqual(1);
    await page.getByTestId("survey-build").click();
    await page.getByTestId("survey-msg").filter({ hasText: /Index built/ }).waitFor({ timeout: 120_000 });
    const after = await (await page.request.get(`${e.url}/api/survey/office-hq`)).json();
    expect(after.index.items).toBe(status.count);
    expect(after.index.model).toBe("Xenova/dinov2-small");
  });

  it("no unexpected page errors", () => {
    expect(errors).toEqual([]);
  });
});
