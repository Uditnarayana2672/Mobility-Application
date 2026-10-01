import type { IncomingMessage, ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface ApiOptions {
  /** Repo root; spike results go to <root>/docs/spikes, venues to <root>/data/venues. */
  root: string;
}

export type Next = (err?: unknown) => void;

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MAX_BODY = 5 * 1024 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const text = await readBody(req);
  return text ? JSON.parse(text) : undefined;
}

/** Connect-style middleware handling everything under /api. Calls next() for other URLs. */
export function createApi(opts: ApiOptions) {
  const spikesDir = path.join(opts.root, "docs", "spikes");
  const venuesDir = path.join(opts.root, "data", "venues");

  return async function api(req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) return next();
    const parts = url.pathname.slice("/api/".length).split("/").filter(Boolean);
    const method = req.method ?? "GET";

    try {
      if (parts[0] === "health" && method === "GET") {
        return send(res, 200, { ok: true, time: new Date().toISOString() });
      }

      if (parts[0] === "spikes" && parts.length === 2 && method === "POST") {
        const name = parts[1] ?? "";
        if (!ID_RE.test(name)) return send(res, 400, { error: "bad spike name" });
        const body = await readJsonBody(req);
        await fs.mkdir(spikesDir, { recursive: true });
        const file = path.join(spikesDir, `${name}.json`);
        await fs.writeFile(file, JSON.stringify({ savedAt: new Date().toISOString(), ...(body as object) }, null, 2));
        return send(res, 200, { ok: true, file: `docs/spikes/${name}.json` });
      }

      if (parts[0] === "venues" && parts.length === 2) {
        const id = parts[1] ?? "";
        if (!ID_RE.test(id)) return send(res, 400, { error: "bad venue id" });
        const file = path.join(venuesDir, `${id}.json`);
        if (method === "GET") {
          try {
            return send(res, 200, JSON.parse(await fs.readFile(file, "utf8")));
          } catch {
            return send(res, 404, { error: "not found" });
          }
        }
        if (method === "PUT") {
          const body = await readJsonBody(req);
          await fs.mkdir(venuesDir, { recursive: true });
          await fs.writeFile(file, JSON.stringify(body, null, 2));
          return send(res, 200, { ok: true });
        }
      }

      return send(res, 404, { error: "unknown api route" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return send(res, e instanceof SyntaxError ? 400 : 500, { error: msg });
    }
  };
}
