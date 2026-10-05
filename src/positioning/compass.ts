import { delta } from "@/core/geo";

/**
 * Compass heading for arrows that point the right way. A gyro only knows turns, so its heading drifts; the phone's magnetic compass
 * knows the absolute direction but is wrong inside steel buildings and is noisy. This fuses both:
 *   - the compass says which way the camera looks relative to TRUE north;
 *   - the map's north is turned by an unknown angle (`offset`: true bearing = map bearing + offset);
 *   - every precise marker fix tells us the map heading, so offset = compass - map heading is LEARNED (and a number typed into the
 *     editor is the starting value);
 *   - after that the compass only nudges the gyro, gently, and only while it is steady and agrees with the gyro to within 70 degrees.
 */

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
export const norm360 = (d: number): number => ((d % 360) + 360) % 360;

/**
 * Direction the REAR CAMERA faces (degrees clockwise from true north) from a DeviceOrientation reading (alpha, beta, gamma in degrees,
 * `absolute` orientation). Works with the phone upright or tilted; null when it lies flat (the camera points at the floor or ceiling and
 * has no horizontal direction).
 */
export function cameraCompassHeading(alpha: number, beta: number, gamma: number): number | null {
  const x = rad(beta);
  const y = rad(gamma);
  const z = rad(alpha);
  const vx = -Math.cos(z) * Math.sin(y) - Math.sin(z) * Math.sin(x) * Math.cos(y);
  const vy = -Math.sin(z) * Math.sin(y) + Math.cos(z) * Math.sin(x) * Math.cos(y);
  if (Math.hypot(vx, vy) < 0.25) return null;
  return norm360(deg(Math.atan2(vx, vy)));
}

export interface FusionOptions {
  /** Known offset (venue.northOffsetDeg), used until markers teach a better one. */
  prior?: number | null;
  /** Fraction of the disagreement removed per compass sample. */
  gain?: number;
  /** Compass samples kept to judge steadiness. */
  window?: number;
  /** Largest circular spread (degrees) of the window that still counts as steady. */
  maxSpread?: number;
  /** Disagreement with the gyro beyond which the compass is ignored (interference). */
  maxDisagree?: number;
}

export class CompassFusion {
  private vx = 0;
  private vy = 0;
  private weight = 0;
  private readonly recent: number[] = [];
  private readonly gain: number;
  private readonly win: number;
  private readonly spread: number;
  private readonly disagree: number;

  constructor(opts: FusionOptions = {}) {
    this.gain = opts.gain ?? 0.03;
    this.win = opts.window ?? 8;
    this.spread = opts.maxSpread ?? 12;
    this.disagree = opts.maxDisagree ?? 70;
    if (opts.prior !== null && opts.prior !== undefined) this.seed(opts.prior, 3);
  }

  private seed(offset: number, w: number): void {
    this.vx = Math.cos(rad(offset)) * w;
    this.vy = Math.sin(rad(offset)) * w;
    this.weight = w;
  }

  /** Learned (or given) offset, or null while nothing is known. */
  get offset(): number | null {
    return this.weight > 0 ? norm360(deg(Math.atan2(this.vy, this.vx))) : null;
  }
  /** How much evidence stands behind the offset (a precise marker fix counts 1). */
  get evidence(): number {
    return this.weight;
  }

  /** The compass read `compass` while the map heading was known to be `mapHeading` (a marker fix). `w`: 1 precise, less for a guess. */
  learn(compass: number, mapHeading: number, w = 1): void {
    const o = rad(compass - mapHeading);
    // Old evidence fades a little so a wrong first guess is outvoted.
    const keep = Math.min(0.9, this.weight / (this.weight + 1));
    this.vx = this.vx * keep + Math.cos(o) * w;
    this.vy = this.vy * keep + Math.sin(o) * w;
    this.weight = this.weight * keep + w;
  }

  /** Is the compass steady (not swinging because of interference or the phone being shaken)? */
  steady(): boolean {
    if (this.recent.length < this.win) return false;
    let sx = 0;
    let sy = 0;
    for (const h of this.recent) {
      sx += Math.cos(rad(h));
      sy += Math.sin(rad(h));
    }
    const r = Math.hypot(sx, sy) / this.recent.length; // 1 = all the same direction
    return deg(Math.sqrt(Math.max(0, -2 * Math.log(Math.max(r, 1e-6))))) <= this.spread;
  }

  /** Feed one compass reading; returns the map heading it implies (null while the offset is unknown). */
  push(compass: number): number | null {
    this.recent.push(compass);
    while (this.recent.length > this.win) this.recent.shift();
    const o = this.offset;
    return o === null ? null : norm360(compass - o);
  }

  /** Degrees to add to the gyro heading to move it towards the compass, or null when the compass should not be trusted now. */
  correction(gyroMapHeading: number): number | null {
    const latest = this.recent[this.recent.length - 1];
    const o = this.offset;
    if (latest === undefined || o === null || !this.steady()) return null;
    const err = delta(latest - o - gyroMapHeading);
    if (Math.abs(err) > this.disagree) return null;
    return err * this.gain;
  }
}
