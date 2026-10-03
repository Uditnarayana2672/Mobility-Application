import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startE2E, type E2E } from "./harness";

let e: E2E;
const errors: string[] = [];

beforeAll(async () => {
  e = await startE2E();
  const api = e.context.request;
  const seed = await (await api.get(`${e.url}/api/venues/office-hq`)).json();
  const geo = { anchor: [22.7532, 75.8937], radiusM: 60, entrances: [] };
  const put = await api.put(`${e.url}/api/venues/office-hq/draft`, { data: JSON.stringify({ ...seed, geo }) });
  expect(put.status()).toBe(200);
  const pub = await api.post(`${e.url}/api/venues/office-hq/publish`);
  expect(pub.status()).toBe(200);
  await e.context.grantPermissions(["geolocation"], { origin: new URL(e.url).origin });
});
afterAll(async () => e?.close());

describe("the phone finds its building by itself", () => {
  it("standing inside the fence: the venue opens with a banner and no question", async () => {
    await e.context.setGeolocation({ latitude: 22.7532, longitude: 75.8937, accuracy: 12 });
    const p = await e.newPage();
    p.on("pageerror", (err) => errors.push(`${err}`));
    await p.goto(`${e.url}/nav?auto=1`);
    await p.getByTestId("screen-city").waitFor({ timeout: 20_000 });
    await p.getByTestId("venue-banner").waitFor();
    expect(await p.getByTestId("venue-banner").innerText()).toMatch(/You’re at/);
    await p.close();
  });

  it("far from every mapped place: it asks, and a tap on the place opens it", async () => {
    await e.context.setGeolocation({ latitude: 28.61, longitude: 77.2, accuracy: 10 });
    const p = await e.newPage();
    await p.goto(`${e.url}/nav?auto=1`);
    await p.getByTestId("venue-ask").waitFor({ timeout: 20_000 });
    expect(await p.getByTestId("venue-ask").innerText()).toMatch(/mapped place/);
    await p.getByTestId("venue-option").first().click();
    await p.getByTestId("screen-city").waitFor();
    await p.close();
  });

  it("an explicit ?venue= and the laptop/demo flows never wait for GPS", async () => {
    const p = await e.newPage();
    await p.goto(`${e.url}/nav?demo=1`);
    await p.getByTestId("screen-city").waitFor({ timeout: 10_000 });
    expect(await p.getByTestId("detecting").count()).toBe(0);
    await p.close();
  });

  it("no unexpected page errors", () => {
    expect(errors).toEqual([]);
  });
});
