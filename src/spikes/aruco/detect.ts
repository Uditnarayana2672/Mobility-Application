import { GRID, lookup } from "./dict";

export interface Pt {
  x: number;
  y: number;
}

export interface Detection {
  id: number;
  /** Outer corners of the black square, in marker order TL, TR, BR, BL (image px, y down). */
  corners: [Pt, Pt, Pt, Pt];
}

export interface GrayImage {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

const CELLS = GRID + 2; // black border cell on each side

function integralImage(img: GrayImage): Float64Array {
  const { width: w, height: h, data } = img;
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x]!;
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1]! + row;
    }
  }
  return integral;
}

/** Mean-adaptive threshold: 1 where the pixel is darker than its local mean by > c. */
function adaptiveDark(img: GrayImage, integral: Float64Array, win: number, c: number): Uint8Array {
  const { width: w, height: h, data } = img;
  const out = new Uint8Array(w * h);
  const r = win >> 1;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum =
        integral[y1 * (w + 1) + x1]! - integral[y0 * (w + 1) + x1]! - integral[y1 * (w + 1) + x0]! + integral[y0 * (w + 1) + x0]!;
      const mean = sum / ((x1 - x0) * (y1 - y0));
      out[y * w + x] = data[y * w + x]! < mean - c ? 1 : 0;
    }
  }
  return out;
}

interface Blob {
  pixels: number[]; // indices
}

function components(bin: Uint8Array, w: number, h: number, minPx: number, maxPx: number): Blob[] {
  const seen = new Uint8Array(w * h);
  const blobs: Blob[] = [];
  const stack: number[] = [];
  for (let i = 0; i < bin.length; i++) {
    if (!bin[i] || seen[i]) continue;
    const pixels: number[] = [];
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      pixels.push(p);
      const x = p % w;
      const y = (p - x) / w;
      if (x > 0 && bin[p - 1] && !seen[p - 1]) (seen[p - 1] = 1), stack.push(p - 1);
      if (x < w - 1 && bin[p + 1] && !seen[p + 1]) (seen[p + 1] = 1), stack.push(p + 1);
      if (y > 0 && bin[p - w] && !seen[p - w]) (seen[p - w] = 1), stack.push(p - w);
      if (y < h - 1 && bin[p + w] && !seen[p + w]) (seen[p + w] = 1), stack.push(p + w);
    }
    if (pixels.length >= minPx && pixels.length <= maxPx) blobs.push({ pixels });
  }
  return blobs;
}

/** Four corners of a convex-ish blob: farthest-point pair + extreme on each side of that diagonal. */
function quadOf(blob: Blob, w: number): [Pt, Pt, Pt, Pt] | null {
  const pts = blob.pixels.map((p) => ({ x: p % w, y: Math.floor(p / w) }));
  let cx = 0;
  let cy = 0;
  for (const p of pts) (cx += p.x), (cy += p.y);
  cx /= pts.length;
  cy /= pts.length;
  const far = (from: Pt) => {
    let best = pts[0]!;
    let bd = -1;
    for (const p of pts) {
      const d = (p.x - from.x) ** 2 + (p.y - from.y) ** 2;
      if (d > bd) (bd = d), (best = p);
    }
    return best;
  };
  const a = far({ x: cx, y: cy });
  const b = far(a);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 8) return null;
  let c: Pt | null = null;
  let d: Pt | null = null;
  let cMax = 0;
  let dMax = 0;
  for (const p of pts) {
    const s = (dx * (p.y - a.y) - dy * (p.x - a.x)) / len;
    if (s > cMax) (cMax = s), (c = p);
    if (-s > dMax) (dMax = -s), (d = p);
  }
  if (!c || !d || cMax < len * 0.15 || dMax < len * 0.15) return null;
  const quad = [a, c, b, d];
  // Order clockwise (image coords, y down): sort by angle around the centroid.
  quad.sort((p, q) => Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx));
  // Atan2 ascending in y-down coordinates is clockwise on screen.
  return quad as [Pt, Pt, Pt, Pt];
}

/** Homography mapping unit square (0,0),(1,0),(1,1),(0,1) -> quad corners (TL,TR,BR,BL). */
export function squareToQuad(q: readonly Pt[]): number[] {
  return homography(
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    q,
  );
}

/** 3x3 homography (row-major, h22 = 1) with dst ~ H * src, from 4 correspondences. */
export function homography(src: readonly Pt[], dst: readonly Pt[]): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!;
    const { x: u, y: v } = dst[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting on the 8x8 system.
  const n = 8;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r]![col]!) > Math.abs(A[piv]![col]!)) piv = r;
    [A[col], A[piv]] = [A[piv]!, A[col]!];
    const p = A[col]![col]!;
    if (Math.abs(p) < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (let k = col; k <= n; k++) A[col]![k]! /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r]![col]!;
      if (f === 0) continue;
      for (let k = col; k <= n; k++) A[r]![k]! -= f * A[col]![k]!;
    }
  }
  return [...A.map((row) => row[n]!), 1];
}

export function applyH(H: readonly number[], x: number, y: number): Pt {
  const w = H[6]! * x + H[7]! * y + H[8]!;
  return { x: (H[0]! * x + H[1]! * y + H[2]!) / w, y: (H[3]! * x + H[4]! * y + H[5]!) / w };
}

function sample(img: GrayImage, p: Pt): number {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return NaN;
  return img.data[y * img.width + x]!;
}

/** Mean over a small plus-shaped patch around p (radius in px). */
function patch(img: GrayImage, p: Pt, r: number): number {
  const vals = [p, { x: p.x - r, y: p.y }, { x: p.x + r, y: p.y }, { x: p.x, y: p.y - r }, { x: p.x, y: p.y + r }].map((q) => sample(img, q));
  if (vals.some(Number.isNaN)) return NaN;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/** Try to read a marker from a clockwise quad; returns the detection or null. */
function decode(img: GrayImage, quad: [Pt, Pt, Pt, Pt]): Detection | null {
  const H = squareToQuad(quad);
  const cell = (cx: number, cy: number): Pt => applyH(H, (cx + 0.5) / CELLS, (cy + 0.5) / CELLS);
  const side = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
  const r = Math.max(0.5, (side / CELLS) * 0.2);

  // Local black / white references: border cells and the quiet zone just outside.
  let black = 0;
  let nb = 0;
  for (let i = 0; i < CELLS; i++) {
    for (const [cx, cy] of [[i, 0], [i, CELLS - 1], [0, i], [CELLS - 1, i]] as const) {
      const v = patch(img, cell(cx, cy), r);
      if (Number.isNaN(v)) return null;
      black += v;
      nb++;
    }
  }
  black /= nb;
  let white = 0;
  let nw = 0;
  for (let i = 0; i < CELLS; i++) {
    const t = (i + 0.5) / CELLS;
    for (const q of [applyH(H, t, -0.5 / CELLS), applyH(H, t, 1 + 0.5 / CELLS), applyH(H, -0.5 / CELLS, t), applyH(H, 1 + 0.5 / CELLS, t)]) {
      const v = patch(img, q, r);
      if (Number.isNaN(v)) return null;
      white += v;
      nw++;
    }
  }
  white /= nw;
  if (white - black < 40) return null; // not enough contrast for a printed marker
  const thr = (black + white) / 2;

  // Border cells must all be black.
  for (let i = 0; i < CELLS; i++) {
    for (const [cx, cy] of [[i, 0], [i, CELLS - 1], [0, i], [CELLS - 1, i]] as const) {
      if (patch(img, cell(cx, cy), r) > thr) return null;
    }
  }
  let code = 0;
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      if (patch(img, cell(gx + 1, gy + 1), r) > thr) code |= 1 << (gy * GRID + gx);
    }
  }
  const hit = lookup(code);
  if (!hit) return null;
  const k = hit.rotation;
  const q = quad;
  const corners = [q[k % 4]!, q[(k + 1) % 4]!, q[(k + 2) % 4]!, q[(k + 3) % 4]!] as [Pt, Pt, Pt, Pt];
  return { id: hit.id, corners };
}

export interface DetectOptions {
  /** Adaptive-threshold window sizes (px); several allow near and far markers. */
  windows?: number[];
  /** Offset below local mean for "dark". */
  c?: number;
}

/** Box-filter downscale by an integer factor. */
function downscale(img: GrayImage, k: number): GrayImage {
  const w = Math.floor(img.width / k);
  const h = Math.floor(img.height / k);
  const out = new Uint8Array(w * h);
  const area = k * k;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < k; dy++) {
        const row = (y * k + dy) * img.width + x * k;
        for (let dx = 0; dx < k; dx++) sum += img.data[row + dx]!;
      }
      out[y * w + x] = Math.round(sum / area);
    }
  }
  return { data: out, width: w, height: h };
}

function detectAtScale(img: GrayImage, opts: DetectOptions): Detection[] {
  const { width: w, height: h } = img;
  // The border of a marker must be thinner than the window or it is flattened to "background": use small, medium and
  // large windows so far markers (thin border) and close markers (fills the frame) are both seen.
  const windows = opts.windows ?? [Math.max(9, (w / 24) | 1), Math.max(21, (w / 8) | 1), Math.max(41, (w / 3) | 1)];
  const found = new Map<number, Detection>();
  const minPx = Math.max(60, (w * h) / 5000);
  const maxPx = w * h * 0.6;
  const integral = integralImage(img);
  for (const win of windows) {
    const bin = adaptiveDark(img, integral, win, opts.c ?? 7);
    for (const blob of components(bin, w, h, minPx, maxPx)) {
      const quad = quadOf(blob, w);
      if (!quad) continue;
      const det = decode(img, quad);
      if (det && !found.has(det.id)) found.set(det.id, det);
    }
  }
  return [...found.values()];
}

/**
 * Detect markers in a grayscale image. Corners are the outer corners of the black border.
 * The mean-adaptive threshold only sees borders thinner than its window, so a marker that fills the frame is found on
 * a 2x downscaled copy (corners are mapped back to full resolution; the full-resolution result wins when both find it).
 */
export function detectMarkers(img: GrayImage, opts: DetectOptions = {}): Detection[] {
  const found = new Map<number, Detection>();
  for (const k of [1, 2]) {
    if (k > 1 && img.width / k < 160) break;
    const scaled = k === 1 ? img : downscale(img, k);
    for (const d of detectAtScale(scaled, opts)) {
      if (found.has(d.id)) continue;
      const corners = d.corners.map((p) => ({ x: p.x * k, y: p.y * k })) as [Pt, Pt, Pt, Pt];
      found.set(d.id, { id: d.id, corners });
    }
  }
  return [...found.values()];
}
