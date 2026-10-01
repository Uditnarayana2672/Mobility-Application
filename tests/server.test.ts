import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { createApi } from "../server/api";
import { attachWs } from "../server/ws";

let server: http.Server;
let base: string;
let root: string;
let ws: ReturnType<typeof attachWs>;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "indore-"));
  const api = createApi({ root });
  server = http.createServer((req, res) => {
    void api(req, res, () => {
      res.statusCode = 404;
      res.end("next");
    });
  });
  ws = attachWs(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  ws.close();
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("api", () => {
  it("health", async () => {
    const r = await fetch(`http://${base}/api/health`);
    expect((await r.json()).ok).toBe(true);
  });
  it("saves spike results to docs/spikes", async () => {
    const r = await fetch(`http://${base}/api/spikes/s3`, { method: "POST", body: JSON.stringify({ voices: 3 }) });
    expect(r.status).toBe(200);
    const saved = JSON.parse(fs.readFileSync(path.join(root, "docs", "spikes", "s3.json"), "utf8"));
    expect(saved.voices).toBe(3);
  });
  it("rejects bad names (no traversal)", async () => {
    const r = await fetch(`http://${base}/api/spikes/..%2Fevil`, { method: "POST", body: "{}" });
    expect(r.status).toBe(400);
  });
  it("venue PUT/GET", async () => {
    await fetch(`http://${base}/api/venues/hq`, { method: "PUT", body: JSON.stringify({ a: 1 }) });
    const r = await fetch(`http://${base}/api/venues/hq`);
    expect(await r.json()).toEqual({ a: 1 });
    expect((await fetch(`http://${base}/api/venues/none`)).status).toBe(404);
  });
  it("passes non-api urls through", async () => {
    expect((await fetch(`http://${base}/nav`)).status).toBe(404);
  });
});

describe("ws relay", () => {
  it("relays within a room only", async () => {
    const open = (room: string) =>
      new Promise<WebSocket>((res) => {
        const s = new WebSocket(`ws://${base}/ws?room=${room}`);
        s.on("open", () => res(s));
      });
    const [a, b, c] = await Promise.all([open("r1"), open("r1"), open("r2")]);
    const got: string[] = [];
    const other: string[] = [];
    b.on("message", (d) => got.push(d.toString()));
    c.on("message", (d) => other.push(d.toString()));
    a.send("hello");
    await new Promise((r) => setTimeout(r, 100));
    expect(got).toEqual(["hello"]);
    expect(other).toEqual([]);
    a.close();
    b.close();
    c.close();
  });
});
