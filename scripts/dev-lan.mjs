// Starts Vite on the LAN (HTTPS) and prints the phone URL + QR code.
import { spawn } from "node:child_process";
import os from "node:os";
import qrcode from "qrcode-terminal";

const port = process.env.PORT ?? "8080";
const ips = [];
for (const addrs of Object.values(os.networkInterfaces())) {
  for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal) ips.push(a.address);
}
ips.sort((a, b) => (a.startsWith("192.168.") ? 0 : a.startsWith("10.") ? 1 : 2) - (b.startsWith("192.168.") ? 0 : b.startsWith("10.") ? 1 : 2));
const url = `https://${ips[0] ?? "localhost"}:${port}`;
console.log(`\n  Open on the phone: ${url}`);
if (ips.length > 1) console.log(`  (other interfaces: ${ips.slice(1).map((i) => `https://${i}:${port}`).join(", ")})`);
qrcode.generate(url, { small: true });

const child = spawn("npx", ["vite", "--host", "0.0.0.0", "--port", port, "--strictPort"], { stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
