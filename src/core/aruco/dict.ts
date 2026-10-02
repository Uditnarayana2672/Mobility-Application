/**
 * ArUco-style 4x4 marker dictionary, 50 ids ("IND_4X4_50").
 *
 * Why 4x4: with only 16 data bits each cell is large at A5 print size, so the
 * code survives blur and the low-res camera image used in AR. 50 ids is plenty
 * for a floor (doc 03 expects ~6-12 markers/floor).
 *
 * It is generated deterministically (not OpenCV's table, which we can't verify
 * offline): codes are accepted greedily when their Hamming distance to every
 * rotation of every earlier code, and to their own rotations, is >= MIN_DIST.
 * We print the markers ourselves, so OpenCV compatibility is not needed.
 * Cell convention: bit 1 = white, 0 = black; row-major from the marker's top-left.
 */
export const GRID = 4;
export const MIN_DIST = 3;
export const DICT_SIZE = 50;

export function rotate90(code: number): number {
  // Rotate the 4x4 grid 90 degrees clockwise: new(r, c) = old(GRID-1-c, r).
  let out = 0;
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const bit = (code >> ((GRID - 1 - c) * GRID + r)) & 1;
      out |= bit << (r * GRID + c);
    }
  }
  return out;
}

function popcount(x: number): number {
  let n = 0;
  for (let v = x; v; v &= v - 1) n++;
  return n;
}

function build(): number[] {
  const codes: number[] = [];
  const rots: number[][] = [];
  let state = 0x1234567;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  // Visit all 16-bit values in a deterministic pseudo-random order.
  const order = Array.from({ length: 1 << 16 }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  for (const cand of order) {
    const pc = popcount(cand);
    if (pc < 4 || pc > 12) continue; // avoid near-blank / near-solid patterns
    const cr = [cand, rotate90(cand), rotate90(rotate90(cand)), rotate90(rotate90(rotate90(cand)))];
    let ok = true;
    for (let k = 1; k < 4 && ok; k++) if (popcount(cr[0]! ^ cr[k]!) < MIN_DIST) ok = false;
    for (let i = 0; i < codes.length && ok; i++) {
      for (const a of cr) for (const b of rots[i]!) if (popcount(a ^ b) < MIN_DIST) ok = false;
    }
    if (!ok) continue;
    codes.push(cand);
    rots.push(cr);
    if (codes.length === DICT_SIZE) break;
  }
  return codes;
}

export const DICTIONARY: readonly number[] = build();

/** Returns {id, rotation} when `code` equals dictionary entry `id` rotated by `rotation` x 90 deg clockwise. */
export function lookup(code: number): { id: number; rotation: number } | null {
  for (let id = 0; id < DICTIONARY.length; id++) {
    let c = DICTIONARY[id]!;
    for (let rot = 0; rot < 4; rot++) {
      if (c === code) return { id, rotation: rot };
      c = rotate90(c);
    }
  }
  return null;
}

/** Bit grid (GRID x GRID booleans, true = white) for printing. */
export function markerBits(id: number): boolean[][] {
  const code = DICTIONARY[id];
  if (code === undefined) throw new Error(`marker id ${id} out of range`);
  return Array.from({ length: GRID }, (_, r) => Array.from({ length: GRID }, (_, c) => ((code >> (r * GRID + c)) & 1) === 1));
}

const hamming = (a: number, b: number): number => popcount(a ^ b);

/** Min Hamming distance between any two different codes over all 4 rotations of the second. */
export function minInterCodeDistance(codes: readonly number[] = DICTIONARY): number {
  let min = Infinity;
  for (let i = 0; i < codes.length; i++) {
    for (let j = i + 1; j < codes.length; j++) {
      let c = codes[j]!;
      for (let r = 0; r < 4; r++) {
        min = Math.min(min, hamming(codes[i]!, c));
        c = rotate90(c);
      }
    }
  }
  return min;
}

/** Min Hamming distance between a code and its own 90/180/270 rotations (0 = rotation-ambiguous). */
export function minSelfRotationDistance(codes: readonly number[] = DICTIONARY): number {
  let min = Infinity;
  for (const code of codes) {
    let c = code;
    for (let r = 1; r < 4; r++) {
      c = rotate90(c);
      min = Math.min(min, hamming(code, c));
    }
  }
  return min;
}
