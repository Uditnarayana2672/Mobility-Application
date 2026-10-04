import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { parseCampaigns, parseVenue, type CampaignsFile, type ValidationResult, type Venue } from "../src/core/schema";
import { validate } from "../src/core/validate";
import type { AssistantRequest } from "../src/core/assistant";
import { AnthropicClient } from "./anthropic";
import { AssistantService } from "./assistant";
import { LocalSemanticRanker } from "./semantic";
import { NodeEmbedder, type PictureEmbedder } from "./vision/embed";
import { MAX_FRAME_BYTES, SurveyStore } from "./vision/survey";
import { VPR_MODEL } from "../src/vision/vpr";
import type { AssistantProvider } from "./assistant-provider";
import { SessionStore } from "./sessions";
import { createLocalSpeech, type SpeechService } from "./speech";
import { MAX_TTS_CHARS } from "./speech/tts";
import { STT_RATE } from "./speech/stt";
import { decodeWav, resample } from "../src/speech/wav";
import { DocStore, ID_RE, listVenueIds } from "./store";

export interface ApiOptions {
  /** Repo root; spike results go to <root>/docs/spikes, venue/campaign/upload data to <root>/data, seeds from <root>/public/venues. */
  root: string;
  /** Called after a venue / campaigns publish succeeded (the realtime hub turns it into a push to phones and dashboards). */
  onPublished?: (kind: "venue" | "campaigns", venueId: string, version: number) => void;
  onReset?: (venueId: string) => void;
  assistantProvider?: AssistantProvider;
  /** Claude on the server (default: ANTHROPIC_API_KEY from the environment; without a key it is simply off). */
  anthropic?: AnthropicClient;
  /** Local speech engines (Whisper + Piper). Default: created lazily from <root>/data/models. */
  speech?: SpeechService;
  /** Local free-form place ranker (default: a MiniLM embedding model on this machine, loaded in the background). `null` turns it off. */
  semantic?: Pick<LocalSemanticRanker, "rank" | "ready"> & { warm?(): void } | null;
  /** Image-embedding model for the survey index (default: DINOv2-small on this machine). */
  embedder?: PictureEmbedder;
}

export type Next = (err?: unknown) => void;

const MAX_JSON = 5 * 1024 * 1024;
const MAX_UPLOAD = 10 * 1024 * 1024;
const MAX_AUDIO = 2 * 1024 * 1024;
const MAX_LOOK = 2 * 1024 * 1024;
const MAX_MEDIA = 30 * 1024 * 1024;
const UPLOAD_TYPES: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };
const UPLOAD_MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };
const UPLOAD_NAME_RE = /^[a-f0-9]{16,64}\.(png|jpg|webp)$/;
const MEDIA_TYPES: Record<string, string> = { ...UPLOAD_TYPES, "video/mp4": ".mp4", "video/webm": ".webm" };
const MEDIA_MIME: Record<string, string> = { ...UPLOAD_MIME, ".mp4": "video/mp4", ".webm": "video/webm" };
const MEDIA_NAME_RE = /^[a-f0-9]{16,64}\.(png|jpg|webp|mp4|webm)$/;

/** Check the bytes really are the declared image type (we serve these back to browsers). */
function sniffImage(buf: Buffer, type: string): boolean {
  if (type === "image/png") return buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === "image/jpeg") return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (type === "image/webp") return buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP";
  return false;
}

function sniffMedia(buf: Buffer, type: string): boolean {
  if (type.startsWith("image/")) return sniffImage(buf, type);
  if (type === "video/mp4") return buf.length > 12 && buf.toString("ascii", 4, 8) === "ftyp";
  if (type === "video/webm") return buf.length > 4 && buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function readBuffer(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, `body larger than ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const text = (await readBuffer(req, MAX_JSON)).toString("utf8");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "body is not valid JSON");
  }
}

const failResults = (issues: { path: string; message: string }[]): ValidationResult[] =>
  issues.map((i) => ({ level: "fail", title: `Invalid data at ${i.path || "(root)"}`, detail: i.message }));

/** Connect-style middleware: /api/* plus static /uploads/*. Calls next() for anything else. */
export function createApi(opts: ApiOptions) {
  const { root } = opts;
  const spikesDir = path.join(root, "docs", "spikes");
  const uploadsDir = path.join(root, "data", "uploads");
  const mediaDir = path.join(root, "data", "media");
  const venues = new DocStore(root, "venue");
  const campaigns = new DocStore(root, "campaigns");
  const sessions = new SessionStore(root);
  // The local models load in the background when the server starts (not under tests, and not with LOCAL_AI_WARM=0).
  const warm = !process.env.VITEST && process.env.LOCAL_AI_WARM !== "0";
  const semantic = opts.semantic === undefined ? (process.env.VITEST ? null : new LocalSemanticRanker(root)) : opts.semantic;
  if (opts.semantic === undefined && warm) (semantic as LocalSemanticRanker | null)?.warm();
  const anthropic = opts.anthropic ?? new AnthropicClient();
  const assistant = new AssistantService(root, opts.assistantProvider, semantic, anthropic);
  const survey = new SurveyStore(root);
  const embedder: PictureEmbedder = opts.embedder ?? new NodeEmbedder(root);
  const building = new Map<string, Promise<unknown>>();
  const modelsDir = path.join(root, "data", "models", "hf");
  const ortDir = ((): string => {
    try {
      return path.dirname(createRequire(import.meta.url).resolve("onnxruntime-web")); // its dist/ folder
    } catch {
      return path.join(root, "node_modules", "onnxruntime-web", "dist");
    }
  })();
  let speechService: SpeechService | null = opts.speech ?? null;
  const speech = (): SpeechService => (speechService ??= createLocalSpeech(root, { warm }));
  if (warm && !opts.speech) speech();

  const checkId = (id: string | undefined, what: string): string => {
    if (!id || !ID_RE.test(id)) throw new HttpError(400, `bad ${what}`);
    return id;
  };

  async function serveUpload(name: string, res: ServerResponse): Promise<void> {
    if (!UPLOAD_NAME_RE.test(name)) throw new HttpError(404, "not found");
    const file = path.join(uploadsDir, name);
    try {
      await fs.access(file);
    } catch {
      throw new HttpError(404, "not found");
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", UPLOAD_MIME[path.extname(name)] ?? "application/octet-stream");
    // Content-addressed names never change, so they are safe to cache hard.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    createReadStream(file).pipe(res);
  }

  async function serveMedia(name: string, res: ServerResponse): Promise<void> {
    if (!MEDIA_NAME_RE.test(name)) throw new HttpError(404, "not found");
    const file = path.join(mediaDir, name);
    try { await fs.access(file); } catch { throw new HttpError(404, "not found"); }
    res.statusCode = 200;
    res.setHeader("Content-Type", MEDIA_MIME[path.extname(name)] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Accept-Ranges", "bytes");
    createReadStream(file).pipe(res);
  }

  /** The image model's files for the phone (so it works offline once downloaded). Only the one model, fetched from its hub on first use. */
  async function serveModel(rel: string, res: ServerResponse): Promise<void> {
    const clean = rel.replace(/^\/+/, "");
    if (!clean.startsWith(`${VPR_MODEL}/`) || clean.includes("..") || !/^[\w./-]+$/.test(clean)) throw new HttpError(404, "not found");
    const file = path.join(modelsDir, clean);
    let data: Buffer | null = null;
    try {
      data = await fs.readFile(file);
    } catch {
      const [org, name, ...rest] = clean.split("/");
      const r = await fetch(`https://huggingface.co/${org}/${name}/resolve/main/${rest.join("/")}`, { redirect: "follow" });
      if (!r.ok) throw new HttpError(404, "not found");
      data = Buffer.from(await r.arrayBuffer());
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, data);
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", clean.endsWith(".json") ? "application/json" : "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.end(data);
  }

  async function serveOrt(name: string, res: ServerResponse): Promise<void> {
    if (!/^ort-wasm-simd-threaded(\.[a-z]+)?\.(mjs|wasm)$/.test(name)) throw new HttpError(404, "not found");
    let data: Buffer;
    try {
      data = await fs.readFile(path.join(ortDir, name));
    } catch {
      throw new HttpError(404, "not found");
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : "text/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.end(data);
  }

  async function surveyRoutes(parts: string[], method: string, url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const venue = checkId(parts[1], "venue id");
    const sub = parts[2];
    if (!sub && method === "GET") {
      const frames = await survey.list(venue);
      const idx = await survey.index(venue);
      const floors: Record<string, number> = {};
      for (const f of frames) floors[f.floor] = (floors[f.floor] ?? 0) + 1;
      return send(res, 200, { count: frames.length, floors, index: idx ? { builtAt: idx.builtAt, items: idx.items.length, model: idx.model, eval: idx.eval } : null, building: building.has(venue) });
    }
    if (!sub && method === "DELETE") {
      await survey.clear(venue);
      return send(res, 200, { ok: true });
    }
    if (sub === "frames" && method === "POST") {
      const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
      if (type !== "image/jpeg") throw new HttpError(415, "content-type must be image/jpeg");
      const q = url.searchParams;
      const meta = { floor: q.get("floor") ?? "", x: Number(q.get("x")), y: Number(q.get("y")), heading: Number(q.get("heading")), acc: Number(q.get("acc") ?? 1) };
      if (!meta.floor || meta.floor.length > 32) throw new HttpError(400, "floor is required");
      const body = await readBuffer(req, MAX_FRAME_BYTES + 1024);
      try {
        const f = await survey.add(venue, body, meta);
        return send(res, 200, { ok: true, id: f.id });
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : "bad picture");
      }
    }
    if (sub === "build" && method === "POST") {
      if (building.has(venue)) throw new HttpError(409, "an index is already being built for this venue");
      const job = survey.build(venue, embedder).finally(() => building.delete(venue));
      building.set(venue, job);
      const file = await job;
      return send(res, 200, { ok: true, items: file.items.length, eval: file.eval });
    }
    if (sub === "index" && method === "GET") {
      const idx = await survey.index(venue);
      return idx ? send(res, 200, idx) : send(res, 404, { error: "no index built for this venue" });
    }
    if (sub === "frame" && parts[3] && method === "GET") {
      const jpg = await survey.picture(venue, parts[3]);
      if (!jpg) throw new HttpError(404, "not found");
      res.statusCode = 200;
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.end(jpg);
      return;
    }
    return send(res, 404, { error: "unknown survey route" });
  }

  async function venueRoutes(parts: string[], method: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (parts.length === 1 && method === "GET") return send(res, 200, { venues: await listVenueIds(root) });
    const id = checkId(parts[1], "venue id");
    const sub = parts[2];
    if (!sub && method === "GET") {
      const v = await venues.getPublished<Venue>(id);
      return v ? send(res, 200, v) : send(res, 404, { error: "no such venue" });
    }
    if (sub === "versions" && method === "GET") return send(res, 200, { versions: await venues.versions(id) });
    if (sub === "draft") {
      if (method === "GET") {
        const d = await venues.getDraft<Venue>(id);
        return d ? send(res, 200, d) : send(res, 404, { error: "no draft" });
      }
      if (method === "PUT") {
        const parsed = parseVenue(await readJsonBody(req));
        if (!parsed.ok) return send(res, 400, { error: "invalid venue", issues: parsed.issues });
        if (parsed.data.id !== id) return send(res, 400, { error: "venue id in body does not match the URL" });
        await venues.putDraft(id, { ...parsed.data, status: "draft" });
        return send(res, 200, { ok: true });
      }
    }
    if (sub === "publish" && method === "POST") {
      const body = await readJsonBody(req);
      const source = body !== undefined ? body : await venues.getDraft<unknown>(id);
      if (source === null || source === undefined) return send(res, 409, { error: "nothing to publish: no draft" });
      const parsed = parseVenue(source);
      if (!parsed.ok) return send(res, 422, { error: "invalid venue", results: failResults(parsed.issues) });
      if (parsed.data.id !== id) return send(res, 400, { error: "venue id in body does not match the URL" });
      const results = validate(parsed.data);
      if (results.some((r) => r.level === "fail")) return send(res, 422, { error: "validation failed", results });
      const stored = await venues.publish(id, parsed.data);
      opts.onPublished?.("venue", id, stored.version);
      return send(res, 200, { ok: true, version: stored.version, publishedAt: stored.publishedAt, results });
    }
    return send(res, 404, { error: "unknown venue route" });
  }

  async function campaignRoutes(parts: string[], method: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const id = checkId(parts[1], "venue id");
    const sub = parts[2];
    if (!sub && method === "GET") {
      const c = await campaigns.getPublished<CampaignsFile>(id);
      return c ? send(res, 200, c) : send(res, 404, { error: "no campaigns for this venue" });
    }
    if (sub === "versions" && method === "GET") return send(res, 200, { versions: await campaigns.versions(id) });
    if (sub === "events" && method === "POST") {
      const body = await readJsonBody(req) as { campaignId?: unknown; kind?: unknown; dwellSec?: unknown } | undefined;
      const campaignId = typeof body?.campaignId === "string" ? checkId(body.campaignId, "campaign id") : "";
      if (!campaignId || (body?.kind !== "impression" && body?.kind !== "tap")) throw new HttpError(400, "event needs campaignId and kind impression|tap");
      const live = await campaigns.getPublished<CampaignsFile>(id);
      if (!live) throw new HttpError(404, "no campaigns for this venue");
      const campaign = live.campaigns.find((c) => c.id === campaignId);
      if (!campaign) throw new HttpError(404, "no such campaign");
      if (body.kind === "tap") campaign.stats.taps += 1;
      else {
        const old = campaign.stats.impressions;
        const dwell = typeof body.dwellSec === "number" && Number.isFinite(body.dwellSec) ? Math.max(0, Math.min(300, body.dwellSec)) : 1;
        campaign.stats.impressions = old + 1;
        campaign.stats.dwell = (campaign.stats.dwell * old + dwell) / (old + 1);
      }
      await campaigns.putPublished(id, live);
      return send(res, 200, { ok: true, stats: campaign.stats });
    }
    if (sub === "draft") {
      if (method === "GET") {
        const d = await campaigns.getDraft<CampaignsFile>(id);
        return d ? send(res, 200, d) : send(res, 404, { error: "no draft" });
      }
      if (method === "PUT") {
        const parsed = parseCampaigns(await readJsonBody(req));
        if (!parsed.ok) return send(res, 400, { error: "invalid campaigns", issues: parsed.issues });
        if (parsed.data.venueId !== id) return send(res, 400, { error: "venueId in body does not match the URL" });
        await campaigns.putDraft(id, parsed.data);
        return send(res, 200, { ok: true });
      }
    }
    if (sub === "publish" && method === "POST") {
      const body = await readJsonBody(req);
      const source = body !== undefined ? body : await campaigns.getDraft<unknown>(id);
      if (source === null || source === undefined) return send(res, 409, { error: "nothing to publish: no draft" });
      const parsed = parseCampaigns(source);
      if (!parsed.ok) return send(res, 422, { error: "invalid campaigns", results: failResults(parsed.issues) });
      if (parsed.data.venueId !== id) return send(res, 400, { error: "venueId in body does not match the URL" });
      const venue = await venues.getPublished<Venue>(id);
      const results: ValidationResult[] = [];
      const wallIds = new Set((venue?.walls ?? []).map((w) => w.id));
      const roomIds = new Set((venue?.rooms ?? []).map((r) => r.id));
      for (const c of parsed.data.campaigns) {
        for (const w of c.walls) if (!wallIds.has(w)) results.push({ level: "fail", title: `Campaign ${c.id}: unknown ad wall ${w}`, detail: "The wall is not in the published venue." });
        if (c.target && !roomIds.has(c.target)) results.push({ level: "fail", title: `Campaign ${c.id}: unknown target room ${c.target}`, detail: "The target room is not in the published venue." });
      }
      if (!venue) results.push({ level: "fail", title: "Venue not published", detail: `Publish venue ${id} before its campaigns.` });
      if (results.length) return send(res, 422, { error: "validation failed", results });
      const stored = await campaigns.publish(id, parsed.data);
      opts.onPublished?.("campaigns", id, stored.version);
      return send(res, 200, { ok: true, version: stored.version, publishedAt: stored.publishedAt });
    }
    return send(res, 404, { error: "unknown campaigns route" });
  }

  return async function api(req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const isApi = url.pathname.startsWith("/api/");
    const isUpload = url.pathname.startsWith("/uploads/");
    const isMedia = url.pathname.startsWith("/media/");
    const isModel = url.pathname.startsWith("/models/");
    const isOrt = url.pathname.startsWith("/ort/");
    if (!isApi && !isUpload && !isMedia && !isModel && !isOrt) return next();
    const method = req.method ?? "GET";

    try {
      if (isUpload) {
        if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "method not allowed");
        return await serveUpload(decodeURIComponent(url.pathname.slice("/uploads/".length)), res);
      }
      if (isModel || isOrt) {
        if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "method not allowed");
        const rest = decodeURIComponent(url.pathname.slice(isModel ? "/models/".length : "/ort/".length));
        return await (isModel ? serveModel(rest, res) : serveOrt(rest, res));
      }
      if (isMedia) {
        if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "method not allowed");
        return await serveMedia(decodeURIComponent(url.pathname.slice("/media/".length)), res);
      }
      const parts = url.pathname.slice("/api/".length).split("/").filter(Boolean);

      if (parts[0] === "health" && method === "GET") return send(res, 200, { ok: true, time: new Date().toISOString() });
      if (parts[0] === "registry" && parts.length === 1 && method === "GET") {
        // Every published venue with where it is on Earth: what the phone needs to find out which building it is in.
        const out: { id: string; name: string; type: string; city: string; version: number; geo?: unknown }[] = [];
        for (const id of await listVenueIds(root)) {
          const parsed = parseVenue(await venues.getPublished<unknown>(id));
          if (parsed.ok) out.push({ id, name: parsed.data.name, type: parsed.data.type, city: parsed.data.city, version: parsed.data.version, geo: parsed.data.geo });
        }
        return send(res, 200, { venues: out });
      }
      if (parts[0] === "speech" && parts[1] === "status" && method === "GET") return send(res, 200, speech().status());
      if (parts[0] === "stt" && parts.length === 1 && method === "POST") {
        const lang = url.searchParams.get("lang");
        if (lang !== "en" && lang !== "hi" && lang !== "te") throw new HttpError(400, "lang must be en, hi or te");
        if (Number(req.headers["content-length"] ?? 0) > MAX_AUDIO) throw new HttpError(413, `audio larger than ${MAX_AUDIO} bytes`);
        const body = await readBuffer(req, MAX_AUDIO);
        let pcm;
        try {
          pcm = decodeWav(body);
        } catch (e) {
          throw new HttpError(415, e instanceof Error ? e.message : "audio must be a WAV file");
        }
        const out = await speech().stt.transcribe(resample(pcm.samples, pcm.rate, STT_RATE), lang);
        return send(res, 200, { text: out.text, ms: out.ms, lang });
      }
      if (parts[0] === "tts" && parts.length === 1 && method === "GET") {
        const lang = url.searchParams.get("lang");
        const text = url.searchParams.get("text") ?? "";
        if (lang !== "en" && lang !== "hi" && lang !== "te") throw new HttpError(400, "lang must be en, hi or te");
        if (!text.trim() || text.length > MAX_TTS_CHARS) throw new HttpError(400, `text must be 1..${MAX_TTS_CHARS} characters`);
        if (!speech().tts.languages().includes(lang)) throw new HttpError(503, `no ${lang} voice installed (run: npm run setup:speech)`);
        const wav = await speech().tts.synth(text, lang);
        res.statusCode = 200;
        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.end(wav);
        return;
      }
      if (parts[0] === "ai" && parts[1] === "status" && method === "GET") {
        return send(res, 200, { available: anthropic.available(), models: anthropic.available() ? anthropic.models : null });
      }
      if (parts[0] === "ai" && parts[1] === "look" && method === "POST") {
        const venueId = checkId(url.searchParams.get("venue") ?? undefined, "venue id");
        if (!anthropic.available()) throw new HttpError(503, "no ANTHROPIC_API_KEY on the server");
        const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
        if (type !== "image/jpeg") throw new HttpError(415, "content-type must be image/jpeg");
        const jpeg = await readBuffer(req, MAX_LOOK);
        if (!sniffImage(jpeg, "image/jpeg")) throw new HttpError(415, "file contents are not a valid image/jpeg");
        const venue = await venues.getPublished<Venue>(venueId);
        if (!venue) throw new HttpError(404, "no such venue");
        const floor = url.searchParams.get("floor") ?? undefined;
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 25_000);
        try {
          return send(res, 200, await anthropic.look(venue, jpeg, floor ? { floor } : undefined, ctl.signal));
        } catch (e) {
          throw new HttpError(502, ctl.signal.aborted ? "the AI took too long" : e instanceof Error ? e.message : "the AI could not read the picture");
        } finally {
          clearTimeout(timer);
        }
      }
      if (parts[0] === "assistant" && method === "POST") {
        const body = await readJsonBody(req) as Partial<AssistantRequest> | undefined;
        const venueId = checkId(body?.venueId, "venue id");
        if (!body || typeof body.text !== "string" || body.text.trim().length === 0 || body.text.length > 500) throw new HttpError(400, "assistant text must be 1..500 characters");
        if (body.lang !== "en" && body.lang !== "hi" && body.lang !== "te") throw new HttpError(400, "assistant lang must be en, hi or te");
        const venue = await venues.getPublished<Venue>(venueId);
        if (!venue) throw new HttpError(404, "no such venue");
        const from = body.from && (("node" in body.from && typeof body.from.node === "string") || (typeof body.from.floor === "string" && Number.isFinite(body.from.x) && Number.isFinite(body.from.y))) ? body.from : null;
        return send(res, 200, await assistant.ask(venue, { venueId, text: body.text.trim(), lang: body.lang, from, prefs: body.prefs ?? {} }));
      }
      if (parts[0] === "demo" && parts[1] === "reset" && parts.length === 3 && method === "POST") {
        const venueId = checkId(parts[2], "venue id");
        opts.onReset?.(venueId);
        return send(res, 200, { ok: true, venue: venueId, at: Date.now() });
      }
      if (parts[0] === "sessions" && method === "GET") {
        const venue = checkId(parts[1], "venue id");
        if (parts[2] === "last") {
          const last = sessions.latest(venue);
          return last ? send(res, 200, { file: last.info.file, device: last.info.device, startedAt: last.info.startedAt, lines: last.lines }) : send(res, 404, { error: "no recorded walk yet" });
        }
        if (parts[2]) {
          const lines = sessions.read(venue, parts[2]);
          return lines ? send(res, 200, { file: parts[2], lines }) : send(res, 404, { error: "no such recording" });
        }
        return send(res, 200, { sessions: sessions.list(venue) });
      }

      if (parts[0] === "spikes" && parts.length === 2 && method === "POST") {
        const name = checkId(parts[1], "spike name");
        const body = await readJsonBody(req);
        await fs.mkdir(spikesDir, { recursive: true });
        await fs.writeFile(path.join(spikesDir, `${name}.json`), JSON.stringify({ savedAt: new Date().toISOString(), ...(body as object) }, null, 2));
        return send(res, 200, { ok: true, file: `docs/spikes/${name}.json` });
      }

      if (parts[0] === "uploads" && parts.length === 1 && method === "POST") {
        const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
        const ext = UPLOAD_TYPES[type];
        if (!ext) throw new HttpError(415, "content-type must be image/png, image/jpeg or image/webp");
        const buf = await readBuffer(req, MAX_UPLOAD);
        if (!buf.length) throw new HttpError(400, "empty upload");
        if (!sniffImage(buf, type)) throw new HttpError(415, `file contents are not a valid ${type}`);
        const name = createHash("sha256").update(buf).digest("hex").slice(0, 32) + ext;
        await fs.mkdir(uploadsDir, { recursive: true });
        await fs.writeFile(path.join(uploadsDir, name), buf);
        return send(res, 200, { ok: true, url: `/uploads/${name}`, bytes: buf.length, contentType: type });
      }

      if (parts[0] === "media" && parts.length === 1 && method === "POST") {
        const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
        const ext = MEDIA_TYPES[type];
        if (!ext) throw new HttpError(415, "content-type must be PNG, JPEG, WebP, MP4 or WebM");
        const buf = await readBuffer(req, MAX_MEDIA);
        if (!buf.length) throw new HttpError(400, "empty upload");
        if (!sniffMedia(buf, type)) throw new HttpError(415, `file contents are not a valid ${type}`);
        const name = createHash("sha256").update(buf).digest("hex").slice(0, 32) + ext;
        await fs.mkdir(mediaDir, { recursive: true });
        await fs.writeFile(path.join(mediaDir, name), buf);
        return send(res, 200, { ok: true, url: `/media/${name}`, bytes: buf.length, contentType: type });
      }

      if (parts[0] === "survey" && parts.length >= 2) return await surveyRoutes(parts, method, url, req, res);
      if (parts[0] === "venues") return await venueRoutes(parts, method, req, res);
      if (parts[0] === "campaigns" && parts.length >= 2) return await campaignRoutes(parts, method, req, res);

      return send(res, 404, { error: "unknown api route" });
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      return send(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}
