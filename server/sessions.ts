import fs from "node:fs";
import path from "node:path";
import { ID_RE } from "./store";

const SAFE_DEVICE = /[^A-Za-z0-9_-]/g;
const MAX_LINES = 50000;

export interface SessionInfo {
  file: string;
  device: string;
  startedAt: string;
}

/** One line of a recorded walk: when the server received it, and the bus message as sent by the phone. */
export interface SessionLine {
  recvT: number;
  msg: unknown;
}

/**
 * Walk recordings: data/sessions/<venue>/<YYYYMMDDTHHMMSS>-<device>.jsonl, one JSON object per line.
 * Appends are synchronous and tiny (10 Hz per phone); reads are used by the dashboard's "replay last walk".
 */
export class SessionStore {
  constructor(private readonly root: string) {}

  private dir(venue: string): string {
    if (!ID_RE.test(venue)) throw new Error("bad venue id");
    return path.join(this.root, "data", "sessions", venue);
  }

  /** Start a new recording file for a device; returns a function that appends a line. */
  open(venue: string, device: string, now = new Date()): { file: string; append(line: SessionLine): void } {
    const dir = this.dir(venue);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
    const file = `${stamp}-${device.replace(SAFE_DEVICE, "_").slice(0, 40) || "device"}.jsonl`;
    const full = path.join(dir, file);
    return {
      file,
      append: (line) => {
        try {
          fs.appendFileSync(full, `${JSON.stringify(line)}\n`);
        } catch {
          /* disk problems must never take the live relay down */
        }
      },
    };
  }

  list(venue: string): SessionInfo[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.dir(venue)).filter((n) => n.endsWith(".jsonl"));
    } catch {
      return [];
    }
    return names
      .sort()
      .reverse()
      .map((file) => {
        const m = /^(\d{8}T\d{6})-(.*)\.jsonl$/.exec(file);
        const s = m?.[1] ?? "";
        const startedAt = s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z` : "";
        return { file, device: m?.[2] ?? "", startedAt };
      });
  }

  read(venue: string, file: string): SessionLine[] | null {
    if (!/^[A-Za-z0-9_-]+\.jsonl$/.test(file) && !/^\d{8}T\d{6}-[A-Za-z0-9_-]*\.jsonl$/.test(file)) return null;
    let text: string;
    try {
      text = fs.readFileSync(path.join(this.dir(venue), file), "utf8");
    } catch {
      return null;
    }
    const out: SessionLine[] = [];
    for (const l of text.split("\n")) {
      if (!l) continue;
      try {
        out.push(JSON.parse(l) as SessionLine);
      } catch {
        /* a half-written last line */
      }
      if (out.length >= MAX_LINES) break;
    }
    return out;
  }

  /** The most recent recording that contains at least one pose (a connection that never walked is skipped). */
  latest(venue: string): { info: SessionInfo; lines: SessionLine[] } | null {
    for (const info of this.list(venue)) {
      const lines = this.read(venue, info.file);
      if (lines && lines.some((l) => (l.msg as { type?: string } | null)?.type === "pose")) return { info, lines };
    }
    return null;
  }
}
