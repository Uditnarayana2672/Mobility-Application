/** Production/demo server: serves dist/ over HTTPS with the same REST + WebSocket handlers as `vite dev`. */
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import qrcode from "qrcode-terminal";
import { createApi } from "./api";
import { lanIps, loadCerts } from "./net";
import { attachWs, type RealtimeHub } from "./ws";

const root = process.cwd();
const dist = path.join(root, "dist");
const port = Number(process.env.PORT ?? 8443);

const certs = loadCerts(root);
if (!certs) {
  console.error("No certs/key.pem + certs/cert.pem. Run `npm run certs` first (see docs/https-on-phone.md).");
  process.exit(1);
}
if (!fs.existsSync(path.join(dist, "index.html"))) {
  console.error("dist/ is missing. Run `npm run build` first.");
  process.exit(1);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webp": "image/webp",
};

let hub: RealtimeHub | null = null;
const api = createApi({ root, onPublished: (kind, id, version) => hub?.notify(id, kind, id, version) });

const server = https.createServer(certs, (req, res) => {
  void api(req, res, () => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "https://x").pathname);
    let file = path.join(dist, pathname);
    // Block path traversal, fall back to the SPA shell for unknown routes.
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(dist, "index.html");
    }
    res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  });
});

hub = attachWs(server, { root });

server.listen(port, "0.0.0.0", () => {
  const ip = lanIps()[0] ?? "localhost";
  const url = `https://${ip}:${port}`;
  console.log(`\n  Indore Spaces (production build)\n  ${url}\n`);
  qrcode.generate(url, { small: true });
});
