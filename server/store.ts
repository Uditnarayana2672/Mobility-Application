import { promises as fs } from "node:fs";
import path from "node:path";

export const KEEP_VERSIONS = 5;
export const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export type DocKind = "venue" | "campaigns";

export interface VersionInfo {
  version: number;
  publishedAt: string | null;
  current: boolean;
}

interface Versioned {
  version?: number;
  publishedAt?: string;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Atomic-ish write: temp file then rename. */
async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

/**
 * File-backed store for one kind of document per venue (no DB).
 *   data/venues/<id>/published.json | draft.json | versions/v<N>.json      (kind "venue")
 *   data/venues/<id>/campaigns/published.json | draft.json | versions/...   (kind "campaigns")
 * If nothing has been published yet, the seed public/venues/<id>/{venue,campaigns}.json is served as the published version.
 */
export class DocStore {
  constructor(
    private readonly root: string,
    private readonly kind: DocKind,
  ) {}

  private dir(id: string): string {
    const base = path.join(this.root, "data", "venues", id);
    return this.kind === "venue" ? base : path.join(base, "campaigns");
  }
  private seedFile(id: string): string {
    return path.join(this.root, "public", "venues", id, this.kind === "venue" ? "venue.json" : "campaigns.json");
  }

  async getPublished<T>(id: string): Promise<T | null> {
    return (await readJson<T>(path.join(this.dir(id), "published.json"))) ?? (await readJson<T>(this.seedFile(id)));
  }

  async getDraft<T>(id: string): Promise<T | null> {
    return readJson<T>(path.join(this.dir(id), "draft.json"));
  }

  async putDraft(id: string, doc: unknown): Promise<void> {
    await writeJson(path.join(this.dir(id), "draft.json"), doc);
  }

  /** Replace the live document without creating a content version (used for mutable campaign counters). */
  async putPublished(id: string, doc: unknown): Promise<void> {
    await writeJson(path.join(this.dir(id), "published.json"), doc);
  }

  /** Archive + replace the published document. Returns the stored (version-bumped) document. */
  async publish<T extends Versioned>(id: string, doc: T): Promise<T> {
    const prev = await this.getPublished<Versioned>(id);
    const dir = this.dir(id);
    // Archive the previous published version (seed included) so it can be rolled back to.
    if (prev && typeof prev.version === "number") await writeJson(path.join(dir, "versions", `v${prev.version}.json`), prev);
    const next = { ...doc, version: (prev?.version ?? 0) + 1, publishedAt: new Date().toISOString() } as T & { status?: string };
    if ("status" in next) next.status = "published";
    await writeJson(path.join(dir, "versions", `v${next.version}.json`), next);
    await writeJson(path.join(dir, "published.json"), next);
    await fs.rm(path.join(dir, "draft.json"), { force: true });
    await this.prune(id);
    return next;
  }

  private async prune(id: string): Promise<void> {
    const vdir = path.join(this.dir(id), "versions");
    const nums = await this.versionNumbers(vdir);
    for (const n of nums.slice(KEEP_VERSIONS)) await fs.rm(path.join(vdir, `v${n}.json`), { force: true });
  }

  /** Version numbers on disk, newest first. */
  private async versionNumbers(vdir: string): Promise<number[]> {
    let names: string[] = [];
    try {
      names = await fs.readdir(vdir);
    } catch {
      return [];
    }
    return names
      .map((n) => /^v(\d+)\.json$/.exec(n))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => Number(m[1]))
      .sort((a, b) => b - a);
  }

  async versions(id: string): Promise<VersionInfo[]> {
    const vdir = path.join(this.dir(id), "versions");
    const current = (await this.getPublished<Versioned>(id))?.version ?? null;
    const out: VersionInfo[] = [];
    for (const n of await this.versionNumbers(vdir)) {
      const doc = await readJson<Versioned>(path.join(vdir, `v${n}.json`));
      out.push({ version: n, publishedAt: doc?.publishedAt ?? null, current: n === current });
    }
    // Seed-only venue: show it as the single live version.
    if (!out.length && current !== null) out.push({ version: current, publishedAt: null, current: true });
    return out;
  }

  async getVersion<T>(id: string, version: number): Promise<T | null> {
    return readJson<T>(path.join(this.dir(id), "versions", `v${version}.json`));
  }
}

/** Venue ids that exist (published on disk or seeded under public/venues). */
export async function listVenueIds(root: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const base of [path.join(root, "data", "venues"), path.join(root, "public", "venues")]) {
    try {
      for (const e of await fs.readdir(base, { withFileTypes: true })) if (e.isDirectory() && ID_RE.test(e.name)) ids.add(e.name);
    } catch {
      /* directory missing */
    }
  }
  return [...ids].sort();
}
