import { normaliseBearing } from "@/shared/frame";

/** devicemotion rotationRate, degrees/second, in device axes (alpha = z, beta = x, gamma = y). */
export interface RotationRate {
  alpha: number;
  beta: number;
  gamma: number;
}

/**
 * Gyro-integrated heading. The turn rate about the world vertical is the
 * rotation rate projected on "up", estimated from the gravity reading
 * (accelerationIncludingGravity points up on Android Chrome when at rest).
 * Heading is a bearing (0 = north, clockwise); a counter-clockwise (positive
 * about up) rotation therefore decreases it. Starts at `initial` (no compass).
 */
export class HeadingIntegrator {
  bearing: number;
  private up: [number, number, number] = [0, 0, 1];
  private upInit = false;
  private lastT: number | null = null;
  /** Total yaw integrated since reset, unwrapped, degrees clockwise. */
  total = 0;

  constructor(initial = 0, private readonly upAlpha = 0.05) {
    this.bearing = normaliseBearing(initial);
  }

  reset(initial = 0): void {
    this.bearing = normaliseBearing(initial);
    this.total = 0;
    this.lastT = null;
  }

  update(tMs: number, rate: RotationRate, accel: [number, number, number]): void {
    const m = Math.hypot(accel[0], accel[1], accel[2]);
    if (m > 1e-3) {
      const u: [number, number, number] = [accel[0] / m, accel[1] / m, accel[2] / m];
      if (!this.upInit) {
        this.up = u;
        this.upInit = true;
      } else {
        for (let i = 0; i < 3; i++) this.up[i] = (this.up[i] ?? 0) + this.upAlpha * (u[i]! - (this.up[i] ?? 0));
      }
    }
    if (this.lastT !== null) {
      const dt = (tMs - this.lastT) / 1000;
      if (dt > 0 && dt < 0.5) {
        const un = Math.hypot(...this.up) || 1;
        // rotationRate: beta about x, gamma about y, alpha about z.
        const yawCcw = (rate.beta * this.up[0] + rate.gamma * this.up[1] + rate.alpha * this.up[2]) / un;
        const dCw = -yawCcw * dt;
        this.total += dCw;
        this.bearing = normaliseBearing(this.bearing + dCw);
      }
    }
    this.lastT = tMs;
  }
}
