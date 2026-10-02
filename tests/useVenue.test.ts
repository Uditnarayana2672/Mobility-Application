import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { bundledVenue, loadVenue } from "@/shared/useVenue";

const raw = fs.readFileSync("public/venues/office-hq/venue.json", "utf8");
const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("loadVenue", () => {
  it("bundled fixture parses", () => {
    expect(bundledVenue()?.id).toBe("office-hq");
  });
  it("uses the API venue when it is valid", async () => {
    const v = JSON.parse(raw);
    v.name = "From the server";
    const r = await loadVenue("office-hq", { fetchFn: ok(v) });
    expect(r?.source).toBe("api");
    expect(r?.venue.name).toBe("From the server");
  });
  it("falls back to the bundled venue on network error, non-OK, invalid JSON shape, or timeout", async () => {
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const hang = ((_u: string, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch;
    for (const f of [down, ok({ error: "no" }, 404), ok({ nope: 1 }), hang]) {
      const r = await loadVenue("office-hq", { fetchFn: f, timeoutMs: 30 });
      expect(r?.source).toBe("bundled");
    }
  });
  it("another venue id with the server down is simply missing", async () => {
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await loadVenue("mall-1", { fetchFn: down })).toBeNull();
  });
});
