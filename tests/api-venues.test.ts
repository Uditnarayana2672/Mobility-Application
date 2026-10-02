import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createApi } from "../server/api";

let server: http.Server;
let base: string;
let root: string;

const venue = () => JSON.parse(fs.readFileSync(path.join(root, "public", "venues", "office-hq", "venue.json"), "utf8"));
const call = (p: string, init?: RequestInit) => fetch(`http://${base}${p}`, init);
const put = (body: unknown): RequestInit => ({ method: "PUT", body: JSON.stringify(body) });
const post = (p: string, body?: unknown) => call(p, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

// 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "indore-api-"));
  fs.cpSync(path.join(process.cwd(), "public", "venues"), path.join(root, "public", "venues"), { recursive: true });
  const api = createApi({ root, assistantProvider: { name: "test-offline", available: () => false, answer: async () => "unused" } });
  server = http.createServer((req, res) => void api(req, res, () => ((res.statusCode = 404), res.end("next"))));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("venues", () => {
  it("serves the seed as the published version", async () => {
    const v = await (await call("/api/venues/office-hq")).json();
    expect(v.id).toBe("office-hq");
    expect(v.version).toBe(1);
    expect((await call("/api/venues/nope")).status).toBe(404);
    expect((await (await call("/api/venues")).json()).venues).toContain("office-hq");
  });

  it("draft: 404 before PUT, 400 for invalid, round-trips when valid", async () => {
    expect((await call("/api/venues/office-hq/draft")).status).toBe(404);
    const bad = venue();
    bad.floors = [];
    const r = await call("/api/venues/office-hq/draft", put(bad));
    expect(r.status).toBe(400);
    expect((await r.json()).issues.length).toBeGreaterThan(0);
    const good = venue();
    good.name = "Edited";
    expect((await call("/api/venues/office-hq/draft", put(good))).status).toBe(200);
    const d = await (await call("/api/venues/office-hq/draft")).json();
    expect(d.name).toBe("Edited");
    expect(d.status).toBe("draft");
    // published is untouched
    expect((await (await call("/api/venues/office-hq")).json()).name).not.toBe("Edited");
  });

  it("rejects a body whose id does not match the URL", async () => {
    const v = venue();
    v.id = "other";
    expect((await call("/api/venues/office-hq/draft", put(v))).status).toBe(400);
  });

  it("publish: 422 with results when validation fails, published stays put", async () => {
    const broken = venue();
    broken.markers = broken.markers.filter((m: { floor: string }) => m.floor !== "F2");
    const r = await post("/api/venues/office-hq/publish", broken);
    expect(r.status).toBe(422);
    const body = await r.json();
    expect(body.results.some((x: { level: string; title: string }) => x.level === "fail" && x.title === "Floor 2: no markers")).toBe(true);
    expect((await (await call("/api/venues/office-hq")).json()).version).toBe(1);
  });

  it("publish: uses the draft, bumps the version, removes the draft", async () => {
    const r = await post("/api/venues/office-hq/publish");
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.version).toBe(2);
    const live = await (await call("/api/venues/office-hq")).json();
    expect(live.version).toBe(2);
    expect(live.name).toBe("Edited");
    expect(live.status).toBe("published");
    expect((await call("/api/venues/office-hq/draft")).status).toBe(404);
    const versions = (await (await call("/api/venues/office-hq/versions")).json()).versions;
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions[0].current).toBe(true);
  });

  it("publish with nothing to publish is 409", async () => {
    expect((await post("/api/venues/office-hq/publish")).status).toBe(409);
  });

  it("keeps only the last 5 versions", async () => {
    for (let i = 0; i < 7; i++) {
      const v = venue();
      v.name = `Edit ${i}`;
      expect((await post("/api/venues/office-hq/publish", v)).status).toBe(200);
    }
    const versions = (await (await call("/api/venues/office-hq/versions")).json()).versions;
    expect(versions.map((v: { version: number }) => v.version)).toEqual([9, 8, 7, 6, 5]);
    const files = fs.readdirSync(path.join(root, "data", "venues", "office-hq", "versions")).sort();
    expect(files).toEqual(["v5.json", "v6.json", "v7.json", "v8.json", "v9.json"]);
    expect((await (await call("/api/venues/office-hq")).json()).version).toBe(9);
  });
});

describe("assistant endpoint", () => {
  it("keeps the provider server-side and degrades to local suggestions", async () => {
    const r = await post("/api/assistant", { venueId: "office-hq", text: "cafeteria maybe", lang: "en", from: { floor: "F1", x: 3, y: 17 }, prefs: {} });
    expect(r.status).toBe(200);
    const out = await r.json();
    expect(out).toMatchObject({ fallback: true, reason: "disabled" });
    expect(out.suggestions[0].name).toBe("Cafeteria");
  });
  it("validates requests", async () => {
    expect((await post("/api/assistant", { venueId: "office-hq", text: "", lang: "en" })).status).toBe(400);
    expect((await post("/api/assistant", { venueId: "office-hq", text: "hello", lang: "fr" })).status).toBe(400);
  });
});

describe("campaigns", () => {
  const campaigns = () => JSON.parse(fs.readFileSync(path.join(root, "public", "venues", "office-hq", "campaigns.json"), "utf8"));
  it("serves the seed, validates wall ids on publish", async () => {
    const seed = await (await call("/api/campaigns/office-hq")).json();
    expect(seed.campaigns.length).toBe(3);
    const bad = campaigns();
    bad.campaigns[0].walls = ["W404"];
    const r = await post("/api/campaigns/office-hq/publish", bad);
    expect(r.status).toBe(422);
    expect((await r.json()).results[0].title).toContain("W404");
  });
  it("draft then publish bumps the version", async () => {
    const c = campaigns();
    c.campaigns[0].status = "paused";
    expect((await call("/api/campaigns/office-hq/draft", put(c))).status).toBe(200);
    const r = await post("/api/campaigns/office-hq/publish");
    expect(r.status).toBe(200);
    expect((await r.json()).version).toBe(2);
    const live = await (await call("/api/campaigns/office-hq")).json();
    expect(live.campaigns[0].status).toBe("paused");
  });
  it("persists impression and tap metrics", async () => {
    const before = await (await call("/api/campaigns/office-hq")).json();
    const imp = await post("/api/campaigns/office-hq/events", { campaignId: "C1", kind: "impression", dwellSec: 2 });
    expect(imp.status).toBe(200);
    expect((await imp.json()).stats.impressions).toBe(before.campaigns[0].stats.impressions + 1);
    expect((await post("/api/campaigns/office-hq/events", { campaignId: "C1", kind: "tap" })).status).toBe(200);
    const after = await (await call("/api/campaigns/office-hq")).json();
    expect(after.campaigns[0].stats.taps).toBe(before.campaigns[0].stats.taps + 1);
  });
});

describe("uploads", () => {
  const up = (body: Buffer | string, type: string) => call("/api/uploads", { method: "POST", body, headers: { "content-type": type } });
  it("stores an image content-addressed and serves it back", async () => {
    const r = await up(PNG, "image/png");
    expect(r.status).toBe(200);
    const { url } = await r.json();
    expect(url).toMatch(/^\/uploads\/[a-f0-9]{32}\.png$/);
    const got = await call(url);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await got.arrayBuffer()).equals(PNG)).toBe(true);
    expect((await (await up(PNG, "image/png")).json()).url).toBe(url); // same bytes, same name
  });
  it("rejects wrong type, fake contents and path tricks", async () => {
    expect((await up(PNG, "text/html")).status).toBe(415);
    expect((await up("<script>alert(1)</script>", "image/png")).status).toBe(415);
    expect((await call("/uploads/..%2F..%2Fpackage.json")).status).toBe(404);
    expect((await call("/uploads/nope.png")).status).toBe(404);
  });
  it("refuses oversize bodies", async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 10, 1);
    big.set(PNG.subarray(0, 8));
    // The server may reset the connection after replying 413; both count as a refusal.
    const r = await up(big, "image/png").catch(() => null);
    if (r) expect(r.status).toBe(413);
  });
});

describe("ad media", () => {
  it("stores campaign creatives under data/media and serves them", async () => {
    const r = await call("/api/media", { method: "POST", body: PNG, headers: { "content-type": "image/png" } });
    expect(r.status).toBe(200);
    const { url } = await r.json();
    expect(url).toMatch(/^\/media\/[a-f0-9]{32}\.png$/);
    expect(fs.existsSync(path.join(root, "data", "media", path.basename(url)))).toBe(true);
    expect((await call(url)).headers.get("content-type")).toBe("image/png");
  });
});
