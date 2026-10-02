import type { Plugin } from "vite";
import type { Server } from "node:http";
import { createApi } from "./api";
import { attachWs, type RealtimeHub } from "./ws";

/** Attaches the REST router and the WebSocket hub to Vite's own (HTTPS) server: one origin. A publish pushes a notice to the venue's room. */
export function indoreServer(root: string): Plugin {
  return {
    name: "indore-server",
    configureServer(server) {
      let hub: RealtimeHub | null = null;
      if (server.httpServer) hub = attachWs(server.httpServer as unknown as Server, { root });
      server.middlewares.use(createApi({ root, onPublished: (kind, id, version) => hub?.notify(id, kind, id, version), onReset: (id) => hub?.reset(id) }));
    },
  };
}
