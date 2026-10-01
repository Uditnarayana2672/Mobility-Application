import type { Plugin } from "vite";
import type { Server } from "node:http";
import { createApi } from "./api";
import { attachWs } from "./ws";

/** Attaches the REST router and the WebSocket relay to Vite's own (HTTPS) server: one origin. */
export function indoreServer(root: string): Plugin {
  return {
    name: "indore-server",
    configureServer(server) {
      server.middlewares.use(createApi({ root }));
      if (server.httpServer) attachWs(server.httpServer as unknown as Server);
    },
  };
}
