import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";

export const WS_PATH = "/ws";

/**
 * Relay: clients connect to /ws?room=<name>; every message is forwarded to the
 * other clients in the same room. Used for phone -> dashboard mirroring.
 */
export function attachWs(server: Server) {
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map<string, Set<WebSocket>>();

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const room = url.searchParams.get("room") ?? "default";
    let set = rooms.get(room);
    if (!set) rooms.set(room, (set = new Set()));
    set.add(ws);
    ws.on("message", (data, isBinary) => {
      for (const peer of set) {
        if (peer !== ws && peer.readyState === WebSocket.OPEN) peer.send(data, { binary: isBinary });
      }
    });
    ws.on("close", () => {
      set.delete(ws);
      if (set.size === 0) rooms.delete(room);
    });
  });

  // Only claim our own path, so Vite's HMR socket keeps working.
  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname !== WS_PATH) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  };
  server.on("upgrade", onUpgrade);

  return {
    wss,
    close() {
      server.off("upgrade", onUpgrade);
      for (const c of wss.clients) c.terminate();
      wss.close();
    },
  };
}
