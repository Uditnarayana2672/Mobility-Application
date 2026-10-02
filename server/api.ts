import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { parseCampaigns, parseVenue, type CampaignsFile, type ValidationResult, type Venue } from "../src/core/schema";
import { validate } from "../src/core/validate";
import type { AssistantRequest } from "../src/core/assistant";
import { AssistantService } from "./assistant";
import type { AssistantProvider } from "./assistant-provider";
import { SessionStore } from "./sessions";
import { DocStore, ID_RE, listVenueIds } from "./store";

export interface ApiOptions {
  /** Repo root; spike results go to <root>/docs/spikes, venue/campaign/upload data to <root>/data, seeds from <root>/public/venues. */
  root: string;
  /** Called after a venue / campaigns publish succeeded (the realtime hub turns it into a push to phones and dashboards). */
  onPublished?: (kind: "venue" | "campaigns", venueId: string, version: number) => void;
  onReset?: (venueId: string) => void;
  assistantProvider?: AssistantProvider;
}

export type Next = (err?: unknown) => void;

const MAX_JSON = 5 * 1024 * 1024;
const MAX_UPLOAD = 10 * 1024 * 1024;
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
  const assistant = new AssistantService(root, opts.assistantProvider);

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
    if (!isApi && !isUpload && !isMedia) return next();
    const method = req.method ?? "GET";

    try {
      if (isUpload) {
        if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "method not allowed");
        return await serveUpload(decodeURIComponent(url.pathname.slice("/uploads/".length)), res);
      }
      if (isMedia) {
        if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "method not allowed");
        return await serveMedia(decodeURIComponent(url.pathname.slice("/media/".length)), res);
      }
      const parts = url.pathname.slice("/api/".length).split("/").filter(Boolean);

      if (parts[0] === "health" && method === "GET") return send(res, 200, { ok: true, time: new Date().toISOString() });
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

      if (parts[0] === "venues") return await venueRoutes(parts, method, req, res);
      if (parts[0] === "campaigns" && parts.length >= 2) return await campaignRoutes(parts, method, req, res);

      return send(res, 404, { error: "unknown api route" });
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      return send(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}
