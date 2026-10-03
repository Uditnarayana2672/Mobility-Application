import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApi } from "../server/api";
import type { RegistryEntry } from "@/core/geofence";
import { decideVenue, wantsAutoVenue } from "@/navigator/autoVenue";
import { currentPosition, fetchRegistry, type GeoLike } from "@/shared/registry";

const office: RegistryEntry = { id: "office-hq", name: "Office", geo: { anchor: [22.7532, 75.8937], radiusM: 50, entrances: [] } };
const pg: RegistryEntry = { id: "my-pg", name: "My PG", geo: { anchor: [22.7000, 75.8000], radiusM: 30, entrances: [] } };
const bare: RegistryEntry = { id: "bare", name: "No location" };
const gps = (lat: number, lng: number, acc = 15) => ({ ok: true as const, fix: { lat, lng, acc } });

describe("which venue does this page open?", () => {
  const env = (search: string, coarse = true, geo: GeoLike | null = { getCurrentPosition: () => undefined }) => ({ search, coarsePointer: coarse, geo });
  it("only a live phone without ?venue= detects by GPS; ?auto=1 forces it, ?auto=0 / demo / sim switch it off", () => {
    expect(wantsAutoVenue(env(""))).toBe(true);
    expect(wantsAutoVenue(env("", false))).toBe(false); // a laptop
    expect(wantsAutoVenue(env("?auto=1", false))).toBe(true);
    expect(wantsAutoVenue(env("?venue=my-pg"))).toBe(false);
    expect(wantsAutoVenue(env("?demo=1"))).toBe(false);
    expect(wantsAutoVenue(env("?pose=sim"))).toBe(false);
    expect(wantsAutoVenue(env("?auto=0"))).toBe(false);
    expect(wantsAutoVenue(env("", true, null))).toBe(false); // no geolocation API
  });

  it("inside a venue's fence: that venue, with the match", () => {
    const c = decideVenue([office, pg, bare], gps(22.7533, 75.8938), null);
    expect(c).toMatchObject({ status: "ready", id: "office-hq", how: "gps" });
  });
  it("a fix that is nowhere near anything: ask, with every venue offered", () => {
    const c = decideVenue([office, pg], gps(28.6, 77.2, 10), "my-pg");
    expect(c).toMatchObject({ status: "ask", reason: "far" });
    expect(c.status === "ask" && c.venues.map((v) => v.id)).toEqual(["office-hq", "my-pg"]);
  });
  it("no GPS: the venue used last on this phone, else ask", () => {
    expect(decideVenue([office, pg], { ok: false, reason: "denied" }, "my-pg")).toMatchObject({ status: "ready", id: "my-pg", how: "last" });
    expect(decideVenue([office, pg], { ok: false, reason: "denied" }, "gone")).toMatchObject({ status: "ask", reason: "denied" });
    expect(decideVenue([office, pg], { ok: false, reason: "timeout" }, null)).toMatchObject({ status: "ask", reason: "timeout" });
  });
  it("no venue has a location yet: behave as before (last or default venue), never block the visitor", () => {
    expect(decideVenue([bare], gps(1, 1), null)).toMatchObject({ status: "ready", id: "office-hq", how: "default" });
    expect(decideVenue([], { ok: false, reason: "denied" }, null)).toMatchObject({ status: "ready", id: "office-hq" });
  });
});

describe("browser helpers", () => {
  it("currentPosition maps the geolocation API and its failures", async () => {
    const ok: GeoLike = { getCurrentPosition: (s) => s({ coords: { latitude: 1, longitude: 2, accuracy: 9 } }) };
    expect(await currentPosition(ok)).toEqual({ ok: true, fix: { lat: 1, lng: 2, acc: 9 } });
    const denied: GeoLike = { getCurrentPosition: (_s, e) => e({ code: 1 }) };
    expect(await currentPosition(denied)).toEqual({ ok: false, reason: "denied" });
    expect(await currentPosition(null)).toEqual({ ok: false, reason: "unavailable" });
    const never: GeoLike = { getCurrentPosition: () => undefined };
    expect(await currentPosition(never, 20)).toEqual({ ok: false, reason: "timeout" });
  });
  it("fetchRegistry returns [] on any failure", async () => {
    expect(await fetchRegistry((async () => { throw new Error("x"); }) as unknown as typeof fetch)).toEqual([]);
    expect(await fetchRegistry((async () => new Response("no", { status: 500 })) as unknown as typeof fetch)).toEqual([]);
  });
});

describe("GET /api/registry", () => {
  let server: http.Server;
  let base: string;
  let root: string;
  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "indore-reg-"));
    fs.cpSync(path.join(process.cwd(), "public", "venues"), path.join(root, "public", "venues"), { recursive: true });
    const seed = JSON.parse(fs.readFileSync(path.join(root, "public", "venues", "office-hq", "venue.json"), "utf8"));
    seed.geo = { anchor: [22.7532, 75.8937], radiusM: 40 };
    fs.writeFileSync(path.join(root, "public", "venues", "office-hq", "venue.json"), JSON.stringify(seed));
    fs.mkdirSync(path.join(root, "data", "venues", "draft-only"), { recursive: true });
    const api = createApi({ root });
    server = http.createServer((req, res) => void api(req, res, () => ((res.statusCode = 404), res.end("next"))));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("lists published venues with their location, and skips folders that have nothing published", async () => {
    const j = await (await fetch(`http://${base}/api/registry`)).json();
    const ids = j.venues.map((v: { id: string }) => v.id);
    expect(ids).toContain("office-hq");
    expect(ids).not.toContain("draft-only");
    const o = j.venues.find((v: { id: string }) => v.id === "office-hq");
    expect(o.geo).toMatchObject({ anchor: [22.7532, 75.8937], radiusM: 40 });
    expect(o.name).toBeTruthy();
  });
});
