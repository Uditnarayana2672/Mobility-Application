import { describe, expect, it, vi } from "vitest";
import { staticFetch } from "@/shared/staticHost";
import { loadVenue } from "@/shared/useVenue";
import fs from "node:fs";

describe("static host (GitHub Pages)", () => {
  it("answers /api/ calls at once without touching the network", async () => {
    const real = vi.fn();
    const f = staticFetch(real as unknown as typeof fetch);
    const r = await f("/api/venues/airport");
    expect(r.status).toBe(503);
    expect(real).not.toHaveBeenCalled();
  });
  it("leaves absolute URLs alone and keeps files under the site's base path", async () => {
    const real = vi.fn(async (_input: unknown, _init?: unknown) => new Response("{}"));
    const f = staticFetch(real as unknown as typeof fetch);
    await f("https://example.com/x");
    await f("/venues/airport/venue.json");
    expect(real).toHaveBeenNthCalledWith(1, "https://example.com/x", undefined);
    expect(real.mock.calls[1]![0]).toMatch(/\/venues\/airport\/venue\.json$/);
  });
  it("loads a shipped venue other than the demo when there is no server", async () => {
    const raw = fs.readFileSync("public/venues/airport/venue.json", "utf8");
    const f = (async (u: string) => (u.startsWith("/api/") ? new Response("{}", { status: 503 }) : new Response(raw))) as unknown as typeof fetch;
    const r = await loadVenue("airport", { fetchFn: f });
    expect(r?.venue.id).toBe("airport");
    expect(r?.source).toBe("bundled");
  });
  it("a venue that is not shipped is simply missing", async () => {
    const f = (async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
    expect(await loadVenue("nope", { fetchFn: f })).toBeNull();
  });
});
