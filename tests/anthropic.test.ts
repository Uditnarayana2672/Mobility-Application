import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createApi } from "../server/api";
import { AnthropicClient } from "../server/anthropic";
import { parseVenue, type Venue } from "../src/core";

const VENUE_FILE = "public/venues/my-office/venue.json";
const venue = (): Venue => {
  const r = parseVenue(JSON.parse(fs.readFileSync(VENUE_FILE, "utf8")));
  if (!r.ok) throw new Error("bad venue");
  return r.data;
};
const V = venue();
const idOf = (name: string) => V.rooms.find((r) => r.name === name)!.id;

/** A fake Anthropic Messages API that answers with one tool_use block and remembers what it was sent. */
function fakeApi(toolName: string, input: Record<string, unknown>) {
  const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    seen.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ content: [{ type: "tool_use", id: "tu_1", name: toolName, input }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { seen, fetchFn };
}
const signal = () => new AbortController().signal;

describe("Anthropic client: sentence -> start place and destination", () => {
  it("sends the key, the model and this venue's places, and returns only places that exist", async () => {
    const fake = fakeApi("plan_journey", { from_id: idOf("Lift Lobby"), to_id: idOf("Pantry") });
    const c = new AnthropicClient({ apiKey: "sk-test", fetchFn: fake.fetchFn });
    const r = await c.interpretJourney(V, "I am near lift lobby and I want to go to pantry", signal());
    expect(r.from?.name).toBe("Lift Lobby");
    expect(r.to?.name).toBe("Pantry");
    const call = fake.seen[0]!;
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call.headers["x-api-key"]).toBe("sk-test");
    expect(call.headers["anthropic-version"]).toBe("2023-06-01");
    expect(call.body.model).toBe("claude-haiku-4-5-20251001");
    expect(call.body.tool_choice).toEqual({ type: "tool", name: "plan_journey" });
    const prompt = JSON.stringify(call.body.messages);
    expect(prompt).toContain("Lift Lobby");
    expect(prompt).toContain("Pantry");
  });

  it("an invented id is dropped, never passed on", async () => {
    const fake = fakeApi("plan_journey", { from_id: "F1-r999", to_id: idOf("Pantry") });
    const r = await new AnthropicClient({ apiKey: "k", fetchFn: fake.fetchFn }).interpretJourney(V, "x", signal());
    expect(r.from).toBeNull();
    expect(r.to?.name).toBe("Pantry");
  });

  it("start and destination that are the same place give no destination", async () => {
    const fake = fakeApi("plan_journey", { from_id: idOf("Pantry"), to_id: idOf("Pantry") });
    const r = await new AnthropicClient({ apiKey: "k", fetchFn: fake.fetchFn }).interpretJourney(V, "x", signal());
    expect(r.to).toBeNull();
  });

  it("no key means unavailable; an API error is thrown to the caller", async () => {
    expect(new AnthropicClient({ apiKey: "" }).available()).toBe(false);
    const bad = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    await expect(new AnthropicClient({ apiKey: "k", fetchFn: bad }).interpretJourney(V, "x", signal())).rejects.toThrow(/401/);
  });
});

describe("Anthropic client: camera picture -> where the camera is", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  it("sends the picture, returns the nearest place, what it read and the places in view", async () => {
    const fake = fakeApi("report_view", { nearest_id: idOf("Pantry"), confidence: "high", saw: "A sign on the door says PANTRY.", visible: [{ id: idOf("Meeting Room 3"), direction: "right" }, { id: "nope", direction: "left" }] });
    const r = await new AnthropicClient({ apiKey: "k", fetchFn: fake.fetchFn }).look(V, jpeg, { floor: "F1" }, signal());
    expect(r.nearest?.name).toBe("Pantry");
    expect(r.confidence).toBe("high");
    expect(r.saw).toContain("PANTRY");
    expect(r.visible).toEqual([{ target: { room: idOf("Meeting Room 3") }, name: "Meeting Room 3", direction: "right" }]);
    const content = (fake.seen[0]!.body.messages as { content: { type: string; source?: { media_type: string; data: string } }[] }[])[0]!.content;
    expect(content[0]!.type).toBe("image");
    expect(content[0]!.source).toEqual({ type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") });
    expect(fake.seen[0]!.body.model).toBe("claude-sonnet-5-5");
  });
  it("'none' confidence gives no place", async () => {
    const fake = fakeApi("report_view", { nearest_id: idOf("Pantry"), confidence: "none", saw: "A blank wall.", visible: [] });
    const r = await new AnthropicClient({ apiKey: "k", fetchFn: fake.fetchFn }).look(V, jpeg, undefined, signal());
    expect(r.nearest).toBeNull();
    expect(r.confidence).toBe("none");
  });
});

describe("server endpoints", () => {
  let server: http.Server;
  let base: string;
  let root: string;
  let fake: ReturnType<typeof fakeApi>;
  const call = (p: string, init?: RequestInit) => fetch(`http://${base}${p}`, init);

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "indore-ai-"));
    fs.mkdirSync(path.join(root, "public", "venues", "my-office"), { recursive: true });
    fs.copyFileSync(VENUE_FILE, path.join(root, "public", "venues", "my-office", "venue.json"));
    fake = fakeApi("plan_journey", { from_id: idOf("Server Rooms"), to_id: idOf("Meeting Room 3") });
    const api = createApi({ root, anthropic: new AnthropicClient({ apiKey: "sk-test", fetchFn: fake.fetchFn }), semantic: null });
    server = http.createServer((req, res) => void api(req, res, () => ((res.statusCode = 404), res.end("next"))));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("/api/ai/status says whether a key is set, and never shows it", async () => {
    const j = (await (await call("/api/ai/status")).json()) as { available: boolean; models: { vision: string } };
    expect(j.available).toBe(true);
    expect(j.models.vision).toBe("claude-sonnet-5-5");
    expect(JSON.stringify(j)).not.toContain("sk-test");
  });

  it("/api/assistant turns a free sentence into a journey action from Claude's answer", async () => {
    const res = await call("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ venueId: "my-office", text: "i am standing beside the servers, take me to the third meeting room please", lang: "en", from: null, prefs: {} }) });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { action: { type: string; fromName: string; name: string }; reply: string };
    expect(j.action).toMatchObject({ type: "journey", fromName: "Server Rooms", name: "Meeting Room 3" });
    expect(j.reply).toContain("Meeting Room 3");
  });

  it("/api/ai/look returns what the AI saw; refuses a non-JPEG and a missing key", async () => {
    const view = fakeApi("report_view", { nearest_id: idOf("Pantry"), confidence: "medium", saw: "A kitchen counter.", visible: [] });
    const api2 = createApi({ root, anthropic: new AnthropicClient({ apiKey: "k", fetchFn: view.fetchFn }), semantic: null });
    const s2 = http.createServer((req, res) => void api2(req, res, () => ((res.statusCode = 404), res.end("next"))));
    await new Promise<void>((r) => s2.listen(0, "127.0.0.1", r));
    const b2 = `127.0.0.1:${(s2.address() as AddressInfo).port}`;
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
    const ok = await fetch(`http://${b2}/api/ai/look?venue=my-office&floor=F1`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: jpeg });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ nearest: { name: "Pantry" }, confidence: "medium" });
    const bad = await fetch(`http://${b2}/api/ai/look?venue=my-office`, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
    expect(bad.status).toBe(415);
    s2.close();

    const off = createApi({ root, anthropic: new AnthropicClient({ apiKey: "" }), semantic: null });
    const s3 = http.createServer((req, res) => void off(req, res, () => ((res.statusCode = 404), res.end("next"))));
    await new Promise<void>((r) => s3.listen(0, "127.0.0.1", r));
    const b3 = `127.0.0.1:${(s3.address() as AddressInfo).port}`;
    expect((await fetch(`http://${b3}/api/ai/look?venue=my-office`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: jpeg })).status).toBe(503);
    expect(((await (await fetch(`http://${b3}/api/ai/status`)).json()) as { available: boolean }).available).toBe(false);
    s3.close();
  });
});
