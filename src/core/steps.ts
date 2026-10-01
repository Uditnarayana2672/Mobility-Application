/**
 * Step detector for phone-in-hand walking: peak + threshold + debounce on the
 * high-pass-filtered acceleration magnitude (m/s^2, gravity included in input).
 * Streaming: call push() for every devicemotion sample.
 */
export interface StepOptions {
  /** Minimum smoothed dynamic magnitude (m/s^2) for a peak to count. */
  threshold: number;
  /** Minimum time between steps (ms). Walking is ~1.2-2.5 steps/s. */
  debounceMs: number;
  /** Gravity estimate low-pass factor per sample (0..1, smaller = slower). */
  gravityAlpha: number;
  /** Smoothing of the dynamic magnitude (0..1, larger = less smoothing). */
  smoothAlpha: number;
}

export const DEFAULT_STEP_OPTIONS: StepOptions = {
  threshold: 1.1,
  debounceMs: 300,
  gravityAlpha: 0.02,
  smoothAlpha: 0.3,
};

export class StepDetector {
  steps = 0;
  private readonly o: StepOptions;
  private gravity = 0;
  private init = false;
  private smooth = 0;
  private prev2 = 0;
  private prev1 = 0;
  private prev1T = 0;
  private n = 0;
  private lastStepT = -Infinity;

  constructor(opts: Partial<StepOptions> = {}) {
    this.o = { ...DEFAULT_STEP_OPTIONS, ...opts };
  }

  reset(): void {
    this.steps = 0;
    this.init = false;
    this.n = 0;
    this.lastStepT = -Infinity;
  }

  /** Returns true when this sample completes a step. */
  push(tMs: number, ax: number, ay: number, az: number): boolean {
    const mag = Math.hypot(ax, ay, az);
    if (!this.init) {
      this.gravity = mag;
      this.smooth = 0;
      this.init = true;
    }
    this.gravity += this.o.gravityAlpha * (mag - this.gravity);
    const dyn = mag - this.gravity;
    this.smooth += this.o.smoothAlpha * (dyn - this.smooth);

    const cur = this.smooth;
    let stepped = false;
    // prev1 is a local maximum when prev2 < prev1 >= cur.
    if (this.n >= 2 && this.prev1 > this.prev2 && this.prev1 >= cur && this.prev1 > this.o.threshold) {
      if (this.prev1T - this.lastStepT >= this.o.debounceMs) {
        this.steps++;
        this.lastStepT = this.prev1T;
        stepped = true;
      }
    }
    this.prev2 = this.prev1;
    this.prev1 = cur;
    this.prev1T = tMs;
    this.n++;
    return stepped;
  }
}
