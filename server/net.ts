import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Certs {
  key: Buffer;
  cert: Buffer;
}

/** mkcert output from `npm run certs`; null when not generated yet. */
export function loadCerts(root: string): Certs | null {
  const key = path.join(root, "certs", "key.pem");
  const cert = path.join(root, "certs", "cert.pem");
  if (!fs.existsSync(key) || !fs.existsSync(cert)) return null;
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

export function lanIps(): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) out.push(a.address);
    }
  }
  // Prefer typical home/office ranges over virtual adapters (WSL, Docker, VPN).
  const score = (ip: string) => (ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : 2);
  return out.sort((a, b) => score(a) - score(b));
}
