// Generates certs/key.pem + certs/cert.pem with mkcert for localhost and this machine's LAN IPs.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ips = [];
for (const addrs of Object.values(os.networkInterfaces())) {
  for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal) ips.push(a.address);
}

try {
  execFileSync("mkcert", ["-version"], { stdio: "ignore" });
} catch {
  console.error("mkcert not found. Install it first (Windows: `winget install FiloSottile.mkcert`), see docs/https-on-phone.md");
  process.exit(1);
}

fs.mkdirSync("certs", { recursive: true });
execFileSync("mkcert", ["-install"], { stdio: "inherit" });
execFileSync(
  "mkcert",
  ["-key-file", path.join("certs", "key.pem"), "-cert-file", path.join("certs", "cert.pem"), "localhost", "127.0.0.1", "::1", ...ips],
  { stdio: "inherit" },
);
const caroot = execFileSync("mkcert", ["-CAROOT"]).toString().trim();
console.log(`\nCert covers: localhost, ${ips.join(", ")}`);
console.log(`Root CA to install on the phone: ${path.join(caroot, "rootCA.pem")}`);
console.log("Re-run this if your LAN IP changes.");
