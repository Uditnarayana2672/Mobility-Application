import type { ArSceneModel, MapPoint3 } from "./sceneModel";
import type { Pose } from "@/navigator/poseSource";
import type { Venue } from "@/core/schema";

interface CamPoint { x: number; y: number; z: number }
interface ScreenPoint { x: number; y: number }

export interface CanvasFrame {
  model: ArSceneModel;
  venue: Venue;
  pose: Pose;
  timeSec: number;
}

/** Pinhole canvas renderer ported from docs/mock-ui/js/ar.js for the laptop/PDR fallback. */
export class CanvasArRenderer {
  private g: CanvasRenderingContext2D;
  private w = 320;
  private h = 640;
  private dpr = 1;
  private focal = 400;
  private eyeZ = 1.45;
  private pose: Pose | null = null;
  private hits: { id: string; poly: ScreenPoint[] }[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private media = new Map<string, HTMLImageElement | HTMLVideoElement>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    const g = canvas.getContext("2d");
    if (!g) throw new Error("2D canvas is unavailable");
    this.g = g;
    this.resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => this.resize());
    this.resizeObserver?.observe(canvas.parentElement ?? canvas);
    this.resize();
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    for (const item of this.media.values()) if (item instanceof HTMLVideoElement) item.pause();
    this.media.clear();
  }

  activateMedia(): void {
    for (const item of this.media.values()) if (item instanceof HTMLVideoElement) void item.play().catch(() => undefined);
  }

  hitTest(x: number, y: number): string | null {
    const r = this.canvas.getBoundingClientRect();
    const px = x - r.left;
    const py = y - r.top;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const hit = this.hits[i]!;
      let inside = false;
      for (let a = 0, b = hit.poly.length - 1; a < hit.poly.length; b = a++) {
        const pa = hit.poly[a]!;
        const pb = hit.poly[b]!;
        if ((pa.y > py) !== (pb.y > py) && px < ((pb.x - pa.x) * (py - pa.y)) / (pb.y - pa.y) + pa.x) inside = !inside;
      }
      if (inside) return hit.id;
    }
    return null;
  }

  draw(frame: CanvasFrame): void {
    const { model, venue, pose, timeSec } = frame;
    this.pose = pose;
    this.eyeZ = model.floorElevation + 1.45;
    this.hits = [];
    this.g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const horizon = this.h * 0.47;
    const sky = this.g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#26313f");
    sky.addColorStop(1, "#8794a2");
    this.g.fillStyle = sky;
    this.g.fillRect(0, 0, this.w, horizon);
    const floor = this.g.createLinearGradient(0, horizon, 0, this.h);
    floor.addColorStop(0, "#9da6b0");
    floor.addColorStop(1, "#46505c");
    this.g.fillStyle = floor;
    this.g.fillRect(0, horizon, this.w, this.h - horizon);

    const plate = venue.floors.find((f) => f.id === model.floor);
    if (plate) {
      for (let x = 0; x <= plate.w; x += 2) this.line({ x, y: 0, z: model.floorElevation }, { x, y: plate.h, z: model.floorElevation }, "rgba(255,255,255,.10)");
      for (let y = 0; y <= plate.h; y += 2) this.line({ x: 0, y, z: model.floorElevation }, { x: plate.w, y, z: model.floorElevation }, "rgba(255,255,255,.10)");
    }

    for (const c of model.chevrons) this.chevron(c.at, c.bearing, c.opacity * (0.72 + 0.28 * Math.sin(timeSec * 5 - c.distanceM)));
    const wallTop = model.floorElevation + (plate?.height ?? 3);
    const panels = venue.rooms.filter((room) => room.floor === model.floor).flatMap((room) => {
      const x0 = room.x; const x1 = room.x + room.w; const y0 = room.y; const y1 = room.y + room.h;
      return [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]] as const;
    }).sort((a, b) => Math.hypot((b[0] + b[2]) / 2 - pose.x, (b[1] + b[3]) / 2 - pose.y) - Math.hypot((a[0] + a[2]) / 2 - pose.x, (a[1] + a[3]) / 2 - pose.y));
    for (const [x1, y1, x2, y2] of panels) this.poly([
      { x: x1, y: y1, z: model.floorElevation }, { x: x2, y: y2, z: model.floorElevation },
      { x: x2, y: y2, z: wallTop }, { x: x1, y: y1, z: wallTop },
    ], "rgba(205,200,190,.92)", "rgba(20,30,45,.18)");
    for (const t of model.turnArrows) {
      this.poly([t.before, t.at, t.after], "rgba(255,196,0,.92)", "#fff", 12);
      this.label(`${t.dir === "left" ? "↰" : "↱"} ${t.label} · ${Math.round(t.distanceM)} m`, { ...t.at, z: t.at.z + 1.7 }, "#ffc400", "#241b00");
    }
    if (model.floorChangeArrow) {
      const f = model.floorChangeArrow;
      this.pin(f.at, `${f.via === "lift" ? "↕" : "⇧"} ${f.label}`);
    }
    if (model.destinationPin) this.pin(model.destinationPin.at, `📍 ${model.destinationPin.label}`);

    for (const ad of model.adQuads) {
      const pts = ad.corners.map((p) => this.project(p));
      if (pts.some((p) => p === null)) continue;
      const poly = pts as ScreenPoint[];
      this.g.save();
      this.path(poly);
      this.g.clip();
      const minX = Math.min(...poly.map((p) => p.x));
      const maxX = Math.max(...poly.map((p) => p.x));
      const minY = Math.min(...poly.map((p) => p.y));
      const maxY = Math.max(...poly.map((p) => p.y));
      const media = this.getMedia(ad.campaign.id, ad.campaign.mediaUrl, ad.campaign.type);
      if (media && (media instanceof HTMLImageElement ? media.complete : media.readyState >= 2)) this.g.drawImage(media, minX, minY, maxX - minX, maxY - minY);
      else this.drawPoster(ad.campaign.brand, ad.campaign.headline, ad.campaign.theme, minX, minY, maxX - minX, maxY - minY, ad.campaign.type);
      this.g.restore();
      this.path(poly);
      this.g.strokeStyle = "rgba(255,255,255,.9)";
      this.g.lineWidth = 2;
      this.g.stroke();
      this.hits.push({ id: ad.campaign.id, poly });
      if (ad.distanceM < 8) this.label("Tap for offer", { ...ad.centre, z: ad.corners[3].z - 0.25 }, "rgba(255,255,255,.94)", "#14213d");
    }

    const vignette = this.g.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.25, this.w / 2, this.h / 2, this.h * 0.72);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,.42)");
    this.g.fillStyle = vignette;
    this.g.fillRect(0, 0, this.w, this.h);
  }

  private resize(): void {
    const r = (this.canvas.parentElement ?? this.canvas).getBoundingClientRect();
    this.w = Math.max(100, r.width || 320);
    this.h = Math.max(100, r.height || 640);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.focal = Math.min(this.h * 0.58, this.w * 1.25);
  }

  private camera(p: MapPoint3): CamPoint | null {
    const pose = this.pose;
    if (!pose) return null;
    const h = (pose.heading * Math.PI) / 180;
    const fx = Math.sin(h);
    const fy = -Math.cos(h);
    const rx = Math.cos(h);
    const ry = Math.sin(h);
    const dx = p.x - pose.x;
    const dy = p.y - pose.y;
    const forward = dx * fx + dy * fy;
    return { x: dx * rx + dy * ry, y: p.z - this.eyeZ + forward * 0.105, z: forward };
  }

  private project(p: MapPoint3): ScreenPoint | null {
    const c = this.camera(p);
    if (!c || c.z < 0.25) return null;
    return { x: this.w / 2 + (this.focal * c.x) / c.z, y: this.h * 0.5 - (this.focal * c.y) / c.z };
  }

  private path(points: readonly ScreenPoint[]): void {
    this.g.beginPath();
    points.forEach((p, i) => (i ? this.g.lineTo(p.x, p.y) : this.g.moveTo(p.x, p.y)));
    this.g.closePath();
  }

  private poly(points: readonly MapPoint3[], fill: string, stroke: string, width = 1): void {
    const p = points.map((v) => this.project(v));
    if (p.some((v) => v === null)) return;
    this.path(p as ScreenPoint[]);
    this.g.fillStyle = fill;
    this.g.fill();
    this.g.strokeStyle = stroke;
    this.g.lineWidth = width;
    this.g.stroke();
  }

  private line(a: MapPoint3, b: MapPoint3, stroke: string): void {
    const p = this.project(a);
    const q = this.project(b);
    if (!p || !q) return;
    this.g.beginPath();
    this.g.moveTo(p.x, p.y);
    this.g.lineTo(q.x, q.y);
    this.g.strokeStyle = stroke;
    this.g.lineWidth = 1;
    this.g.stroke();
  }

  private chevron(at: MapPoint3, bearing: number, opacity: number): void {
    const h = (bearing * Math.PI) / 180;
    const fx = Math.sin(h);
    const fy = -Math.cos(h);
    const rx = Math.cos(h);
    const ry = Math.sin(h);
    const local = [[0.45, 0], [-0.18, 0.48], [-0.42, 0.48], [0.13, 0], [-0.42, -0.48], [-0.18, -0.48]];
    this.poly(local.map(([f, r]) => ({ x: at.x + fx * f! + rx * r!, y: at.y + fy * f! + ry * r!, z: at.z })), `rgba(34,211,238,${Math.max(0.18, opacity)})`, "rgba(255,255,255,.7)");
  }

  private label(text: string, at: MapPoint3, bg: string, fg = "#fff"): void {
    const p = this.project(at);
    if (!p) return;
    this.g.font = "700 14px system-ui,sans-serif";
    const w = this.g.measureText(text).width + 22;
    this.g.fillStyle = bg;
    this.g.beginPath();
    this.g.roundRect(p.x - w / 2, p.y - 17, w, 30, 15);
    this.g.fill();
    this.g.fillStyle = fg;
    this.g.textAlign = "center";
    this.g.textBaseline = "middle";
    this.g.fillText(text, p.x, p.y - 2);
  }

  private pin(at: MapPoint3, text: string): void {
    this.label(text, at, "#e8453c");
    const top = this.project(at);
    const bottom = this.project({ ...at, z: at.z - 1.3 });
    if (top && bottom) this.line(at, { ...at, z: at.z - 1.3 }, "#e8453c");
  }

  private getMedia(id: string, url: string | undefined, type: "image" | "video"): HTMLImageElement | HTMLVideoElement | null {
    if (!url) return null;
    const key = `${id}:${type}:${url}`;
    const old = this.media.get(key);
    if (old) return old;
    if (type === "video") {
      const v = document.createElement("video");
      v.src = url;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = "auto";
      this.media.set(key, v);
      return v;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    this.media.set(key, img);
    return img;
  }

  private drawPoster(brand: string, headline: string, theme: readonly [string, string], x: number, y: number, w: number, h: number, type: "image" | "video"): void {
    const gr = this.g.createLinearGradient(x, y, x + w, y + h);
    gr.addColorStop(0, theme[0]);
    gr.addColorStop(1, theme[1]);
    this.g.fillStyle = gr;
    this.g.fillRect(x, y, w, h);
    const size = Math.max(10, Math.min(25, h * 0.16));
    this.g.fillStyle = "#fff";
    this.g.textAlign = "left";
    this.g.font = `700 ${Math.max(9, size * 0.55)}px system-ui`;
    this.g.fillText(`${type === "video" ? "▶ " : ""}${brand.toUpperCase()}`, x + 12, y + size);
    this.g.font = `800 ${size}px system-ui`;
    this.g.fillText(headline, x + 12, y + h * 0.58, Math.max(10, w - 24));
  }
}
