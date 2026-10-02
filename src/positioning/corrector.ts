import { bearingDelta, normaliseBearing } from "@/shared/frame";

export interface PlanePose {
  floor: string;
  x: number;
  y: number;
  heading: number;
}

export interface SmootherOptions {
  /** A correction bigger than this snaps. */
  snapM: number;
  /** Smaller corrections ease out over this long. */
  easeSec: number;
}
export const DEFAULT_SMOOTHER: SmootherOptions = { snapM: 1.5, easeSec: 0.5 };

const smooth = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/**
 * Keeps the dot from jumping. The source reports a continuous "raw" pose; when a fix moves it (new marker alignment, particle filter
 * re-seed) the source calls correct(before, after). Errors > snapM snap; smaller ones are hidden in an offset that eases to zero in easeSec.
 * Time only enters through update(dt), so tests run on a fake clock.
 */
export class PoseSmoother {
  private o0 = { x: 0, y: 0, h: 0 };
  private elapsed = 1e9;
  constructor(private readonly opts: SmootherOptions = DEFAULT_SMOOTHER) {}

  private offset(): { x: number; y: number; h: number } {
    const k = 1 - smooth(this.elapsed / this.opts.easeSec);
    return { x: this.o0.x * k, y: this.o0.y * k, h: this.o0.h * k };
  }

  /** The source's raw pose changed from `before` to `after` in one go. Returns "snap" or "ease". */
  correct(before: PlanePose, after: PlanePose): "snap" | "ease" {
    if (before.floor !== after.floor || Math.hypot(after.x - before.x, after.y - before.y) > this.opts.snapM) {
      this.o0 = { x: 0, y: 0, h: 0 };
      this.elapsed = 1e9;
      return "snap";
    }
    const cur = this.offset();
    this.o0 = { x: cur.x - (after.x - before.x), y: cur.y - (after.y - before.y), h: cur.h - bearingDelta(after.heading, before.heading) };
    this.elapsed = 0;
    return "ease";
  }

  /** Advance time and return the pose to display for the raw pose. */
  update(raw: PlanePose, dtSec: number): PlanePose {
    this.elapsed += Math.max(0, dtSec);
    const o = this.offset();
    return { floor: raw.floor, x: raw.x + o.x, y: raw.y + o.y, heading: normaliseBearing(raw.heading + o.h) };
  }

  /** True while a correction is still being eased out. */
  get easing(): boolean {
    return this.elapsed < this.opts.easeSec;
  }
}
