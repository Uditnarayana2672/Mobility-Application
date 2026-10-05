import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildIndexFile, type SurveyItem, type VprIndexFile } from "../../src/vision/vpr";
import type { PictureEmbedder } from "./embed";

/** One surveyed picture: where it was taken. */
export interface FrameMeta {
  id: string;
  floor: string;
  x: number;
  y: number;
  heading: number;
  /** Accuracy of the position when the picture was taken, metres. */
  acc: number;
  at: string;
}

export const MAX_FRAMES_PER_VENUE = 3000;
export const MAX_FRAME_BYTES = 400 * 1024;

/**
 * Survey pictures of a venue and the embedding index built from them:
 *   data/venues/<id>/survey/frames/<id>.jpg   the pictures
 *   data/venues/<id>/survey/frames.jsonl      one line of FrameMeta per picture
 *   data/venues/<id>/survey/index.json        the descriptors + the accuracy self-test (VprIndexFile)
 */
export class SurveyStore {
  constructor(private readonly root: string) {}

  private dir(venue: string): string {
    return path.join(this.root, "data", "venues", venue, "survey");
  }

  async list(venue: string): Promise<FrameMeta[]> {
    try {
      const text = await fs.readFile(path.join(this.dir(venue), "frames.jsonl"), "utf8");
      return text
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as FrameMeta);
    } catch {
      return [];
    }
  }

  async add(venue: string, jpeg: Buffer, meta: Omit<FrameMeta, "id" | "at">): Promise<FrameMeta> {
    if (jpeg.length === 0 || jpeg.length > MAX_FRAME_BYTES) throw new Error(`picture must be 1..${MAX_FRAME_BYTES} bytes`);
    if (!(jpeg[0] === 0xff && jpeg[1] === 0xd8)) throw new Error("picture must be a JPEG");
    if (![meta.x, meta.y, meta.heading, meta.acc].every(Number.isFinite)) throw new Error("bad position");
    const existing = await this.list(venue);
    if (existing.length >= MAX_FRAMES_PER_VENUE) throw new Error(`a venue keeps at most ${MAX_FRAMES_PER_VENUE} survey pictures`);
    const id = createHash("sha256").update(jpeg).digest("hex").slice(0, 20);
    if (existing.some((f) => f.id === id)) return existing.find((f) => f.id === id)!;
    const full: FrameMeta = { ...meta, id, at: new Date().toISOString() };
    await fs.mkdir(path.join(this.dir(venue), "frames"), { recursive: true });
    await fs.writeFile(path.join(this.dir(venue), "frames", `${id}.jpg`), jpeg);
    await fs.appendFile(path.join(this.dir(venue), "frames.jsonl"), `${JSON.stringify(full)}\n`);
    return full;
  }

  async picture(venue: string, id: string): Promise<Buffer | null> {
    if (!/^[a-f0-9]{20}$/.test(id)) return null;
    try {
      return await fs.readFile(path.join(this.dir(venue), "frames", `${id}.jpg`));
    } catch {
      return null;
    }
  }

  async clear(venue: string): Promise<void> {
    await fs.rm(this.dir(venue), { recursive: true, force: true });
  }

  /** Embed every picture, run the leave-one-out self test and write the index. */
  async build(venue: string, embedder: PictureEmbedder, onProgress?: (done: number, total: number) => void): Promise<VprIndexFile> {
    const frames = await this.list(venue);
    const items: SurveyItem[] = [];
    for (const f of frames) {
      const jpg = await this.picture(venue, f.id);
      if (!jpg) continue;
      items.push({ id: f.id, floor: f.floor, x: f.x, y: f.y, heading: f.heading, vec: (await embedder.embedImage(jpg)).map((v) => Math.round(v * 1e4) / 1e4) });
      onProgress?.(items.length, frames.length);
    }
    const file = buildIndexFile(items, embedder.model);
    await fs.mkdir(this.dir(venue), { recursive: true });
    await fs.writeFile(path.join(this.dir(venue), "index.json"), JSON.stringify(file));
    return file;
  }

  async index(venue: string): Promise<VprIndexFile | null> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.dir(venue), "index.json"), "utf8")) as VprIndexFile;
    } catch {
      return null;
    }
  }
}
