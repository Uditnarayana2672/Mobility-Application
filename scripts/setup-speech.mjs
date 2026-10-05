/**
 * Downloads the local speech models once (nothing is sent to a cloud service afterwards):
 *   - Piper (text to speech): the piper binary + English, Hindi and Telugu voices -> data/models/piper
 *   - Whisper (speech to text): downloaded by the server on first use into data/models/hf (this script warms it with --whisper)
 * Usage: npm run setup:speech            (Piper + voices)
 *        npm run setup:speech -- --whisper   (also pre-download Whisper)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pipeline as streamPipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const root = process.cwd();
const dir = path.join(root, "data", "models", "piper");
fs.mkdirSync(dir, { recursive: true });

const PIPER_VERSION = "2023.11.14-2";
const PLATFORM = process.platform;
const ARCH = process.arch;
const archive =
  PLATFORM === "win32" ? "piper_windows_amd64.zip"
  : PLATFORM === "darwin" ? (ARCH === "arm64" ? "piper_macos_aarch64.tar.gz" : "piper_macos_x64.tar.gz")
  : ARCH === "arm64" ? "piper_linux_aarch64.tar.gz" : "piper_linux_x86_64.tar.gz";

const VOICES = {
  en: "en/en_US/lessac/medium/en_US-lessac-medium",
  hi: "hi/hi_IN/pratham/medium/hi_IN-pratham-medium",
  te: "te/te_IN/venkatesh/medium/te_IN-venkatesh-medium",
};

async function download(url, to) {
  if (fs.existsSync(to) && fs.statSync(to).size > 0) return false;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`${url} -> HTTP ${res.status}`);
  const tmp = `${to}.part`;
  await streamPipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, to);
  return true;
}

const exe = path.join(dir, "piper", PLATFORM === "win32" ? "piper.exe" : "piper");
if (!fs.existsSync(exe)) {
  const file = path.join(dir, archive);
  console.log(`downloading Piper ${PIPER_VERSION} (${archive}) ...`);
  await download(`https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/${archive}`, file);
  console.log("unpacking ...");
  if (archive.endsWith(".zip")) {
    if (PLATFORM === "win32") {
      execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -Force -LiteralPath '${file}' -DestinationPath '${dir}'`], { stdio: "inherit" });
    } else {
      execFileSync("unzip", ["-o", file, "-d", dir], { stdio: "inherit" });
    }
  } else {
    execFileSync("tar", ["-xzf", file, "-C", dir], { stdio: "inherit" });
  }
  fs.rmSync(file, { force: true });
}
if (!fs.existsSync(exe)) throw new Error(`piper executable not found at ${exe}`);

for (const [lang, p] of Object.entries(VOICES)) {
  const base = path.basename(p);
  for (const ext of [".onnx", ".onnx.json"]) {
    const got = await download(`https://huggingface.co/rhasspy/piper-voices/resolve/main/${p}${ext}`, path.join(dir, base + ext));
    if (got) console.log(`voice ${lang}: ${base}${ext}`);
  }
}
console.log("Piper ready:", exe);

if (process.argv.includes("--whisper")) {
  const { preloadWhisper } = await import("../server/speech/stt");
  console.log("downloading Whisper ...");
  await preloadWhisper(root);
  console.log("Whisper ready");
}
