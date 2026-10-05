import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseVenue, type Venue } from "@/core";
import { HybridIntentResolver } from "@/navigator/intentResolver";
import { AssistantService } from "../server/assistant";
import type { AssistantProvider, AssistantTool } from "../server/assistant-provider";

const parsed = parseVenue(JSON.parse(fs.readFileSync("public/venues/office-hq/venue.json", "utf8")));
if (!parsed.ok) throw new Error("bad fixture");
const V: Venue = parsed.data;
const req = { venueId: V.id, text: "Can I get lunch here?", lang: "en" as const, from: { floor: "F1", x: 3, y: 17, heading: 0 }, prefs: {} };
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

class FakeProvider implements AssistantProvider {
  readonly name = "fake";
  constructor(private readonly enabled: boolean, private readonly run?: (execute: (name: AssistantTool["name"], args: Record<string, unknown>) => Promise<unknown>) => Promise<string>) {}
  available() { return this.enabled; }
  answer(input: { execute(name: AssistantTool["name"], args: Record<string, unknown>): Promise<unknown> }): Promise<string> { return this.run?.(input.execute) ?? Promise.resolve("A short answer."); }
}

describe("AssistantService", () => {
  it("degrades to deterministic suggestions when the provider is disabled and logs text only", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "indore-assistant-")); roots.push(root);
    const out = await new AssistantService(root, new FakeProvider(false)).ask(V, { ...req, text: "cafeteria maybe" });
    expect(out).toMatchObject({ fallback: true, reason: "disabled" });
    expect(out.suggestions[0]).toMatchObject({ name: "Cafeteria" });
    const log = fs.readFileSync(path.join(root, "data", "assistant", `${new Date().toISOString().slice(0, 10)}.jsonl`), "utf8");
    expect(log).toContain("cafeteria maybe");
    expect(log).not.toMatch(/audio|blob|base64/i);
  });

  it("executes route tools in core and returns only the server-created action", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "indore-assistant-")); roots.push(root);
    let toolResult: unknown;
    const provider = new FakeProvider(true, async (execute) => {
      toolResult = await execute("get_route", { type: "room", id: "F2-cafeteria" });
      return "The cafeteria is reachable.";
    });
    const out = await new AssistantService(root, provider).ask(V, req);
    expect(toolResult).toMatchObject({ destination: "Cafeteria", etaSec: expect.any(Number), walkM: expect.any(Number) });
    expect(out.action).toMatchObject({ type: "goto", target: { room: "F2-cafeteria" } });
    expect(out.fallback).toBe(false);
  });
});

describe("HybridIntentResolver", () => {
  const ctx = { venue: V, from: req.from, prefs: {}, lang: "en" as const };
  it("never calls the assistant for a confident deterministic intent", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const got = await new HybridIntentResolver(fetchFn).resolve("take me to cafeteria", ctx);
    expect(got.type).toBe("goto");
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it("calls the server for low-confidence free-form text and accepts a spoken answer", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ reply: "The office is open from 9 to 7.", suggestions: [], fallback: false }), { status: 200 }));
    const got = await new HybridIntentResolver(fetchFn).resolve("What are the office timings today?", ctx);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(got).toEqual({ type: "answer", text: "The office is open from 9 to 7.", suggestions: [] });
  });
});
