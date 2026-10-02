import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { SessionStore } from "./sessions";

export const WS_PATH = "/ws";
const HEARTBEAT_MS = 15000;
const KEEP_EVENTS = 30;

export interface WsOptions {
  /** Repo root: walks are recorded to <root>/data/sessions. Without it nothing is recorded. */
  root?: string;
  heartbeatMs?: number;
}

type Role = "device" | "viewer" | "peer";

interface Client {
  ws: WebSocket;
  room: string;
  role: Role;
  device: string;
  alive: boolean;
  rec: ReturnType<SessionStore["open"]> | null;
}

/** Last messages of one phone, replayed to dashboards that join later. */
interface DeviceState {
  route?: string;
  pose?: string;
  events: string[];
}

export interface RealtimeHub {
  wss: WebSocketServer;
  /** Server push: tell every client in a room that something was republished ("venue" | "campaigns"). */
  notify(room: string, type: "venue" | "campaigns", venue: string, version: number): void;
  close(): void;
}

/**
 * Relay + hub. Clients connect to /ws?room=<venue>&role=device|viewer&device=<id>.
 * - a phone ("device") publishes pose/route/event; messages go to everyone in the room except other phones;
 * - a dashboard ("viewer") first gets a replay of each phone's last route/events/pose, then live traffic;
 * - the server pushes {type:"venue"|"campaigns"} when something is published (see notify);
 * - phones' messages are appended to data/sessions/<room>/*.jsonl for "replay last walk";
 * - ping/pong heartbeat drops dead sockets (a phone that walked out of Wi-Fi range).
 * Clients without a role ("peer", e.g. old tests) get the plain room relay.
 */
export function attachWs(server: Server, opts: WsOptions = {}): RealtimeHub {
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map<string, Set<Client>>();
  const state = new Map<string, Map<string, DeviceState>>();
  const sessions = opts.root ? new SessionStore(opts.root) : null;

  const remember = (room: string, device: string, raw: string, type: string): void => {
    let devices = state.get(room);
    if (!devices) state.set(room, (devices = new Map()));
    let d = devices.get(device);
    if (!d) devices.set(device, (d = { events: [] }));
    if (type === "pose") d.pose = raw;
    else if (type === "route") d.route = raw;
    else if (type === "event") {
      d.events.push(raw);
      if (d.events.length > KEEP_EVENTS) d.events.shift();
    }
  };

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const room = url.searchParams.get("room") ?? "default";
    const r = url.searchParams.get("role");
    const role: Role = r === "device" || r === "viewer" ? r : "peer";
    const device = (url.searchParams.get("device") ?? "").slice(0, 64) || "anon";
    const client: Client = { ws, room, role, device, alive: true, rec: null };
    let set = rooms.get(room);
    if (!set) rooms.set(room, (set = new Set()));
    set.add(client);

    if (role === "viewer") {
      for (const d of state.get(room)?.values() ?? []) {
        if (d.route) ws.send(d.route);
        for (const e of d.events) ws.send(e);
        if (d.pose) ws.send(d.pose);
      }
    }

    ws.on("pong", () => {
      client.alive = true;
    });
    ws.on("message", (data, isBinary) => {
      client.alive = true;
      if (role === "device") {
        let type = "";
        let msg: unknown = null;
        const raw = data.toString();
        try {
          msg = JSON.parse(raw);
          type = (msg as { type?: string }).type ?? "";
        } catch {
          /* relayed as is, just not remembered */
        }
        if (type === "pose" || type === "route" || type === "event") {
          remember(room, device, raw, type);
          if (sessions) {
            client.rec ??= sessions.open(room, device);
            client.rec.append({ recvT: Date.now(), msg });
          }
        }
      }
      for (const peer of set) {
        if (peer === client || peer.ws.readyState !== WebSocket.OPEN) continue;
        if (role === "device" && peer.role === "device") continue;
        peer.ws.send(data, { binary: isBinary });
      }
    });
    ws.on("close", () => {
      set.delete(client);
      if (set.size === 0) rooms.delete(room);
    });
  });

  const beat = setInterval(() => {
    for (const set of rooms.values()) {
      for (const c of set) {
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        try {
          c.ws.ping();
        } catch {
          c.ws.terminate();
        }
      }
    }
  }, opts.heartbeatMs ?? HEARTBEAT_MS);
  beat.unref();

  // Only claim our own path, so Vite's HMR socket keeps working.
  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname !== WS_PATH) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  };
  server.on("upgrade", onUpgrade);

  return {
    wss,
    notify(room, type, venue, version) {
      const text = JSON.stringify({ type, payload: { venue, version, at: Date.now() }, deviceId: "server", t: Date.now() });
      for (const c of rooms.get(room) ?? []) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(text);
    },
    close() {
      clearInterval(beat);
      server.off("upgrade", onUpgrade);
      for (const c of wss.clients) c.terminate();
      wss.close();
    },
  };
}
