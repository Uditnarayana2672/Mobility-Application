/**
 * Map view maths (pure). World units are metres (x east, y south). The screen shows the world rotated by `rot` degrees
 * (clockwise) and scaled by `scale` px/m around `center`, which sits at (W/2, H*anchorY) on screen.
 */
export interface MapView {
  /** World point shown at the anchor. */
  cx: number;
  cy: number;
  /** Pixels per metre. */
  scale: number;
  /** Clockwise rotation of the world on screen, degrees (heading-up uses -heading). */
  rot: number;
  /** Viewport size in px. */
  W: number;
  H: number;
  /** Vertical position of the anchor, 0..1 (0.5 = centre; navigation mode uses ~0.65). */
  anchorY: number;
}

export interface Limits {
  minScale: number;
  maxScale: number;
}

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const rad = (d: number): number => (d * Math.PI) / 180;

export function screenToWorld(v: MapView, px: number, py: number): { x: number; y: number } {
  const a = rad(-v.rot);
  const dx = px - v.W / 2;
  const dy = py - v.H * v.anchorY;
  return { x: v.cx + (dx * Math.cos(a) - dy * Math.sin(a)) / v.scale, y: v.cy + (dx * Math.sin(a) + dy * Math.cos(a)) / v.scale };
}

export function worldToScreen(v: MapView, x: number, y: number): { x: number; y: number } {
  const a = rad(v.rot);
  const dx = (x - v.cx) * v.scale;
  const dy = (y - v.cy) * v.scale;
  return { x: v.W / 2 + dx * Math.cos(a) - dy * Math.sin(a), y: v.H * v.anchorY + dx * Math.sin(a) + dy * Math.cos(a) };
}

/** Fit a w x h metre plate into the viewport with `pad` px margin, north-up, centred. */
export function fitView(v: MapView, w: number, h: number, lim: Limits, pad = 28): MapView {
  const s = clamp(Math.min((v.W - pad * 2) / w, (v.H - pad * 2) / h), lim.minScale, lim.maxScale);
  return { ...v, scale: s, cx: w / 2, cy: h / 2, rot: 0, anchorY: 0.5 };
}

/** Zoom by `k` keeping the world point under screen (px, py) fixed. */
export function zoomAt(v: MapView, px: number, py: number, k: number, lim: Limits): MapView {
  const before = screenToWorld(v, px, py);
  const next = { ...v, scale: clamp(v.scale * k, lim.minScale, lim.maxScale) };
  const after = screenToWorld(next, px, py);
  return { ...next, cx: next.cx + before.x - after.x, cy: next.cy + before.y - after.y };
}

/** Pan so the world point that was under the drag start follows the pointer (dxPx/dyPx = start - current, in screen px). */
export function panFrom(start: MapView, dxPx: number, dyPx: number): MapView {
  const a = rad(-start.rot);
  const dx = dxPx / start.scale;
  const dy = dyPx / start.scale;
  return { ...start, cx: start.cx + dx * Math.cos(a) - dy * Math.sin(a), cy: start.cy + dx * Math.sin(a) + dy * Math.cos(a) };
}

export const DEFAULT_VIEW: MapView = { cx: 30, cy: 18, scale: 8, rot: 0, W: 300, H: 300, anchorY: 0.5 };
