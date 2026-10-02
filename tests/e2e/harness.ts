import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { createServer, type ViteDevServer } from "vite";

/**
 * End-to-end harness: a throwaway data root (seed venue copied from public/), the real Vite dev server (with the REST/WS plugin)
 * and a headless Chromium-family browser (Edge on this machine, or Chrome / $E2E_BROWSER).
 */
const CANDIDATES = [
  process.env.E2E_BROWSER,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter((p): p is string => !!p);

export function findBrowser(): string | null {
  return CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

export interface E2E {
  url: string;
  root: string;
  browser: Browser;
  context: BrowserContext;
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

export async function startE2E(): Promise<E2E> {
  const exe = findBrowser();
  if (!exe) throw new Error("No Chromium-family browser found; set E2E_BROWSER");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "indore-e2e-"));
  fs.cpSync(path.join(process.cwd(), "public", "venues"), path.join(root, "public", "venues"), { recursive: true });
  process.env.INDORE_ROOT = root;
  const port = await freePort();
  const server: ViteDevServer = await createServer({ root: process.cwd(), logLevel: "error", server: { port, strictPort: true, host: "127.0.0.1" } });
  await server.listen();
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 900 } });
  return {
    url: `https://127.0.0.1:${port}`,
    root,
    browser,
    context,
    newPage: () => context.newPage(),
    async close() {
      await context.close();
      await browser.close();
      await server.close();
      delete process.env.INDORE_ROOT;
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
