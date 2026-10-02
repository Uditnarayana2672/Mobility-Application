import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { createApi } from "../server/api";
import { attachWs, type RealtimeHub } from "../server/ws";

let server: http.Server;
let base: string;
let root: string;
let hub: RealtimeHub;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "indore-rt-"));
  fs.cpSync(path.join(process.cwd(), "public", "venues"), path.join(root, "public", "venues"), { recursive: true });
  const api = createApi({ root, onPublished: (kind, id, version) => hub.notify(id, kind, id, version) });
  server = http.createServer((req, res) => void api(req, res, () => ((res.statusCode = 404), res.end("next"))));
  hub = attachWs(server, { root, heartbeatMs: 200 });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  hub.close();
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const connect = (q: string) =>
  new Promise<{ ws: WebSocket; got: { type: string; deviceId?: string; payload: any }[] }>((res) => {
    const ws = new WebSocket(`ws://${base}/ws?${q}`);
    const got: { type: string; deviceId?: string; payload: any }[] = [];
    ws.on("message", (d) => got.push(JSON.parse(d.toString())));
    ws.on("open", () => res({ ws, got }));
  });
const pose = (x: number) => ({ type: "pose", deviceId: "ph-a", t: 1, payload: { user: { floor: "F1", x, y: 17, heading: 90, acc: 1, stale: false, markerId: 1, source: "ar" }, t: 1 } });

describe("realtime hub", () => {
  it("a phone's messages go to dashboards, not to other phones", async () => {
    const dash = await connect("room=r1&role=viewer");
    const phoneA = await connect("room=r1&role=device&device=ph-a");
    const phoneB = await connect("room=r1&role=device&device=ph-b");
    phoneA.ws.send(JSON.stringify(pose(5)));
    await wait(100);
    expect(dash.got.map((g) => g.type)).toEqual(["pose"]);
    expect(phoneB.got).toEqual([]);
    expect(phoneA.got).toEqual([]);
    for (const c of [dash, phoneA, phoneB]) c.ws.close();
  });

  it("replays each phone's last route, events and pose to a dashboard that joins late", async () => {
    const phoneA = await connect("room=r2&role=device&device=ph-a");
    const phoneB = await connect("room=r2&role=device&device=ph-b");
    phoneA.ws.send(JSON.stringify({ type: "route", deviceId: "ph-a", payload: { id: 1 } }));
    phoneA.ws.send(JSON.stringify({ type: "event", deviceId: "ph-a", payload: { kind: "scan", text: "s", at: 1 } }));
    phoneA.ws.send(JSON.stringify(pose(1)));
    phoneA.ws.send(JSON.stringify(pose(2)));
    phoneB.ws.send(JSON.stringify({ ...pose(9), deviceId: "ph-b" }));
    await wait(100);
    const late = await connect("room=r2&role=viewer");
    await wait(100);
    const a = late.got.filter((g) => g.deviceId === "ph-a");
    expect(a.map((g) => g.type)).toEqual(["route", "event", "pose"]);
    expect(a.at(-1)!.payload.user.x).toBe(2); // only the latest pose
    expect(late.got.filter((g) => g.deviceId === "ph-b")).toHaveLength(1);
    for (const c of [phoneA, phoneB, late]) c.ws.close();
  });

  it("records a phone's walk as JSONL and serves it back", async () => {
    const phone = await connect("room=rec&role=device&device=ph-rec");
    phone.ws.send(JSON.stringify({ type: "route", deviceId: "ph-rec", payload: { id: 1 } }));
    for (let i = 0; i < 5; i++) phone.ws.send(JSON.stringify({ ...pose(i), deviceId: "ph-rec" }));
    phone.ws.send("garbage that is not json");
    await wait(150);
    phone.ws.close();
    const dir = path.join(root, "data", "sessions", "rec");
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{8}T\d{6}-ph-rec\.jsonl$/);
    const lines = fs.readFileSync(path.join(dir, files[0]!), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(6);
    expect(lines[0].msg.type).toBe("route");
    expect(typeof lines[0].recvT).toBe("number");

    const last = await (await fetch(`http://${base}/api/sessions/rec/last`)).json();
    expect(last.device).toBe("ph-rec");
    expect(last.lines).toHaveLength(6);
    const list = await (await fetch(`http://${base}/api/sessions/rec`)).json();
    expect(list.sessions[0].file).toBe(files[0]);
    expect((await fetch(`http://${base}/api/sessions/nothing/last`)).status).toBe(404);
    expect((await fetch(`http://${base}/api/sessions/rec/..%2F..%2Fx`)).status).toBe(404);
  });

  it("publishing a venue pushes a notice to every client of that room", async () => {
    const phone = await connect("room=office-hq&role=device&device=ph-p");
    const dash = await connect("room=office-hq&role=viewer");
    const other = await connect("room=other&role=viewer");
    const venue = JSON.parse(fs.readFileSync(path.join(root, "public", "venues", "office-hq", "venue.json"), "utf8"));
    const r = await fetch(`http://${base}/api/venues/office-hq/publish`, { method: "POST", body: JSON.stringify(venue) });
    expect(r.status).toBe(200);
    const { version } = await r.json();
    await wait(100);
    for (const c of [phone, dash]) {
      const n = c.got.find((g) => g.type === "venue");
      expect(n?.payload.venue).toBe("office-hq");
      expect(n?.payload.version).toBe(version);
    }
    expect(other.got).toEqual([]);
    for (const c of [phone, dash, other]) c.ws.close();
  });

  it("plain peers (no role) still get the room relay", async () => {
    const open = () => new Promise<WebSocket>((res) => { const w = new WebSocket(`ws://${base}/ws?room=p1`); w.on("open", () => res(w)); });
    const [a, b] = await Promise.all([open(), open()]);
    const got: string[] = [];
    b.on("message", (d) => got.push(d.toString()));
    a.send("hello");
    await wait(80);
    expect(got).toEqual(["hello"]);
    a.close();
    b.close();
  });

  it("terminates a silent client after missed heartbeats", async () => {
    await wait(300); // let earlier tests' sockets finish closing
    const before = hub.wss.clients.size;
    const dead = await new Promise<WebSocket>((res) => {
      const ws = new WebSocket(`ws://${base}/ws?room=hb&role=device&device=ph-dead`);
      ws.on("open", () => {
        // A client that never answers pings: stop reading from the underlying socket.
        (ws as unknown as { _socket: { pause(): void } })._socket.pause();
        res(ws);
      });
    });
    await wait(60);
    expect(hub.wss.clients.size).toBe(before + 1);
    await wait(1000); // heartbeat 200 ms: first ping marks it, the next sweep terminates it
    expect(hub.wss.clients.size).toBe(before);
    dead.terminate();
  });
});
