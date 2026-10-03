import type { FrameEmbedder } from "./embedBrowser";
import { FixVoter, VprIndex, type VprFix, type VprIndexFile } from "./vpr";

export type VisionMode = "auto" | "on" | "off";

/** `?vpr=1` forces vision on, `?vpr=0` forces it off, otherwise it switches itself on only when the venue's index passed its own accuracy test. */
export function visionModeFromQuery(search: string): VisionMode {
  const v = new URLSearchParams(search).get("vpr");
  return v === "1" ? "on" : v === "0" ? "off" : "auto";
}

export type VisionState = "off" | "no-index" | "failed-test" | "loading" | "ready" | "error";

export interface VprDeps {
  fetchIndex(): Promise<VprIndexFile | null>;
  makeEmbedder(): Promise<FrameEmbedder>;
}

/**
 * Runs place recognition on live camera pictures: loads the venue's index, decides whether vision may be used (mode + the index's own
 * accuracy test), embeds frames one at a time and returns a fix only after two agreeing answers (FixVoter).
 */
export class VprLocator {
  state: VisionState = "off";
  detail = "";
  private index: VprIndex | null = null;
  private embedder: FrameEmbedder | null = null;
  private busy = false;
  private readonly voter = new FixVoter(2, 3);
  lastSimilarity: number | null = null;

  constructor(private readonly deps: VprDeps, private readonly mode: VisionMode = "auto") {}

  /** Load the index (cheap) and, if vision is allowed, the model (a few seconds, once). Never throws. */
  async start(): Promise<VisionState> {
    if (this.mode === "off") return (this.state = "off");
    this.state = "loading";
    try {
      const file = await this.deps.fetchIndex();
      if (!file || file.items.length === 0) return (this.state = "no-index");
      if (this.mode === "auto" && !file.eval?.passed) {
        this.detail = file.eval ? `self-test: ${Math.round(file.eval.hitRate * 100)} % hits, ${Math.round(file.eval.wrongLockRate * 100)} % wrong` : "no self-test";
        return (this.state = "failed-test");
      }
      this.index = VprIndex.from(file);
      this.embedder = await this.deps.makeEmbedder();
      return (this.state = "ready");
    } catch (e) {
      this.detail = e instanceof Error ? e.message : String(e);
      return (this.state = "error");
    }
  }

  get ready(): boolean {
    return this.state === "ready";
  }

  /** One camera picture -> an agreed position, or null. Skips (returns null) while the previous picture is still being worked on. */
  async frame(rgba: Uint8ClampedArray, width: number, height: number, nowMs: number): Promise<VprFix | null> {
    if (!this.ready || !this.index || !this.embedder || this.busy) return null;
    this.busy = true;
    try {
      const vec = await this.embedder.embed(rgba, width, height);
      const raw = this.index.locate(vec);
      this.lastSimilarity = raw?.similarity ?? null;
      return this.voter.push(raw, nowMs);
    } catch (e) {
      this.state = "error";
      this.detail = e instanceof Error ? e.message : String(e);
      return null;
    } finally {
      this.busy = false;
    }
  }
}
