import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startE2E, type E2E } from "./harness";

let e: E2E;
beforeAll(async () => {
  e = await startE2E({ fakeCamera: true });
});
afterAll(async () => e?.close());

/** A phone-like run on the laptop: ?pose=pdr uses the camera + step counting path the real phone now starts in (a fake camera gives the picture). */
describe("camera view on a phone: say it once, arrows over the camera", () => {
  it("one sentence opens the camera view with the route; the AR check, Look (AI) and Align are there; Look (AI) places you from the AI's answer", async () => {
    const page = await e.newPage();
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    const venue = (await (await page.request.get(`${e.url}/api/venues/my-office`)).json()) as { rooms: { id: string; name: string }[] };
    const pantry = venue.rooms.find((r) => r.name === "Pantry")!;
    await page.route("**/api/ai/look*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ nearest: { target: { room: pantry.id }, name: "Pantry" }, confidence: "high", saw: "A sign says PANTRY.", visible: [] }) }),
    );

    await page.goto(`${e.url}/nav?venue=my-office&pose=pdr`);
    await page.getByTestId("venue-card").click();
    await page.getByTestId("screen-locate").waitFor();
    await page.getByTestId("locate-say").click();
    await page.getByTestId("voice-input").fill("I am near the lift lobby and I want to go to the pantry");
    await page.getByTestId("voice-send").click();
    await page.locator("#s-ar.on").waitFor({ timeout: 20_000 });

    expect(await page.getByTestId("ar-dest").innerText()).toContain("Pantry");
    await page.getByTestId("ar-instruction").waitFor();
    await page.getByTestId("ar-canvas").waitFor();
    expect(await page.getByTestId("ar-look").count()).toBe(1);
    expect(await page.getByTestId("ar-align").count()).toBe(1);
    const check = page.getByTestId("ar-check");
    await check.locator("summary").click();
    const text = await check.innerText();
    expect(text).toContain("Secure page");
    expect(text).toMatch(/Position from/);

    // Align: no error, a toast confirms it
    await page.getByTestId("ar-align").click();
    await page.getByTestId("toast").filter({ hasText: "Aligned" }).waitFor();

    // Look (AI): the picture goes to the server, the answer places the visitor near the Pantry
    await page.getByTestId("ar-look").click();
    await page.getByTestId("toast").filter({ hasText: "AI: you are near Pantry" }).waitFor({ timeout: 15_000 });
    expect(errors).toEqual([]);
  });
});
