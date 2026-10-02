import * as THREE from "three";
import type { ArFrameCtx, ArHandle } from "@/spikes/ar";
import type { XrPoseSource } from "@/positioning/xrPoseSource";
import type { AdQuad, ArSceneModel, MapPoint3 } from "./sceneModel";

interface DynamicMesh {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  mapPoints: MapPoint3[];
  current: Float32Array;
  ad?: AdQuad;
}

interface DynamicSprite {
  sprite: THREE.Sprite;
  mapPoint: MapPoint3;
}

interface CachedMedia {
  signature: string;
  poster: THREE.CanvasTexture;
  live: THREE.Texture | null;
  video: HTMLVideoElement | null;
  loading: boolean;
}

/** Three.js content layer which is attached to the XrPoseSource's already-running XR session. */
export class WebXrSceneRenderer {
  private readonly root = new THREE.Group();
  private readonly meshes: DynamicMesh[] = [];
  private readonly sprites: DynamicSprite[] = [];
  private readonly adMeshes = new Map<THREE.Object3D, string>();
  private readonly videos = new Set<HTMLVideoElement>();
  private readonly media = new Map<string, CachedMedia>();
  private scene: ArSceneModel | null = null;
  private active = false;
  private handle: ArHandle | null = null;
  private off: (() => void) | null;
  private lastFrameMs: number | null = null;

  constructor(source: XrPoseSource) {
    this.root.name = "indore-ar-content";
    this.off = source.onSceneFrame((ctx, handle, mapPointToXr) => this.frame(ctx, handle, mapPointToXr));
  }

  setScene(scene: ArSceneModel): void {
    this.scene = scene;
    this.rebuild();
  }

  setActive(active: boolean): void {
    this.active = active;
    this.root.visible = active;
    if (active) for (const v of this.videos) void v.play().catch(() => undefined);
    else for (const v of this.videos) v.pause();
  }

  hitTest(clientX: number, clientY: number): string | null {
    const h = this.handle;
    if (!h || !this.active) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1), h.camera);
    for (const hit of ray.intersectObjects([...this.adMeshes.keys()], false)) {
      const id = this.adMeshes.get(hit.object);
      if (id) return id;
    }
    return null;
  }

  dispose(): void {
    this.off?.();
    this.off = null;
    this.clear(false);
    this.root.removeFromParent();
  }

  private frame(ctx: ArFrameCtx, handle: ArHandle, mapPointToXr: (p: MapPoint3) => [number, number, number] | null): void {
    this.handle = handle;
    if (this.root.parent !== handle.scene) handle.scene.add(this.root);
    this.root.visible = this.active;
    if (!this.active || !this.scene) return;
    const dt = this.lastFrameMs === null ? 1 / 60 : Math.min(0.1, Math.max(0, (ctx.time - this.lastFrameMs) / 1000));
    this.lastFrameMs = ctx.time;
    const lerp = 1 - Math.exp(-dt / 0.5);
    for (const item of this.meshes) {
      const attr = item.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const snap = item.ad ? this.planeSnap(ctx, handle, item.ad, mapPointToXr) : null;
      for (let i = 0; i < item.mapPoints.length; i++) {
        const target = mapPointToXr(item.mapPoints[i]!);
        if (!target) continue;
        const k = i * 3;
        const tx = target[0] + (snap?.x ?? 0);
        const ty = target[1] + (snap?.y ?? 0);
        const tz = target[2] + (snap?.z ?? 0);
        if (!Number.isFinite(item.current[k]!)) {
          item.current[k] = tx; item.current[k + 1] = ty; item.current[k + 2] = tz;
        } else {
          item.current[k] = item.current[k]! + (tx - item.current[k]!) * lerp;
          item.current[k + 1] = item.current[k + 1]! + (ty - item.current[k + 1]!) * lerp;
          item.current[k + 2] = item.current[k + 2]! + (tz - item.current[k + 2]!) * lerp;
        }
        attr.setXYZ(i, item.current[k]!, item.current[k + 1]!, item.current[k + 2]!);
      }
      attr.needsUpdate = true;
      item.mesh.geometry.computeBoundingSphere();
    }
    for (const item of this.sprites) {
      const p = mapPointToXr(item.mapPoint);
      if (p) {
        const target = new THREE.Vector3(...p);
        if (!Number.isFinite(item.sprite.position.x)) item.sprite.position.copy(target);
        else item.sprite.position.lerp(target, lerp);
      }
    }
  }

  private planeSnap(ctx: ArFrameCtx, handle: ArHandle, ad: AdQuad, mapPointToXr: (p: MapPoint3) => [number, number, number] | null): THREE.Vector3 | null {
    const target = mapPointToXr(ad.centre);
    const planes = (ctx.frame as XRFrame & { detectedPlanes?: Set<XRPlane> }).detectedPlanes;
    if (!target || !planes) return null;
    let best: THREE.Vector3 | null = null;
    let bestD = 0.3;
    for (const plane of planes) {
      const pose = ctx.frame.getPose(plane.planeSpace, handle.refSpace);
      if (!pose) continue;
      const m = pose.transform.matrix;
      // planeSpace +Y is the plane normal; a small world-Y component means a vertical plane.
      if (Math.abs(m[5] ?? 1) > 0.35) continue;
      const p = new THREE.Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
      const d = p.distanceTo(new THREE.Vector3(...target));
      if (d < bestD) {
        bestD = d;
        best = p.sub(new THREE.Vector3(...target));
      }
    }
    return best;
  }

  private rebuild(): void {
    this.clear(true);
    const scene = this.scene;
    if (!scene) return;
    for (const c of scene.chevrons) {
      const h = (c.bearing * Math.PI) / 180;
      const fx = Math.sin(h); const fy = -Math.cos(h); const rx = Math.cos(h); const ry = Math.sin(h);
      const p = [[0.46, 0], [-0.18, 0.48], [-0.43, 0.48], [0.13, 0], [-0.43, -0.48], [-0.18, -0.48]].map(([f, r]) => ({ x: c.at.x + fx * f! + rx * r!, y: c.at.y + fy * f! + ry * r!, z: c.at.z }));
      this.addPolygon(p, new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: c.opacity, side: THREE.DoubleSide, depthWrite: false }));
    }
    for (const t of scene.turnArrows) {
      const p = [t.before, t.at, t.after];
      const ribbon: MapPoint3[] = [];
      for (let i = 0; i < p.length; i++) {
        const a = p[Math.max(0, i - 1)]!; const b = p[Math.min(p.length - 1, i + 1)]!;
        const dx = b.x - a.x; const dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
        ribbon.push({ x: p[i]!.x - (dy / len) * 0.32, y: p[i]!.y + (dx / len) * 0.32, z: p[i]!.z + 0.05 });
      }
      for (let i = p.length - 1; i >= 0; i--) {
        const a = p[Math.max(0, i - 1)]!; const b = p[Math.min(p.length - 1, i + 1)]!;
        const dx = b.x - a.x; const dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
        ribbon.push({ x: p[i]!.x + (dy / len) * 0.32, y: p[i]!.y - (dx / len) * 0.32, z: p[i]!.z + 0.05 });
      }
      this.addPolygon(ribbon, new THREE.MeshBasicMaterial({ color: 0xffc400, side: THREE.DoubleSide }));
      this.addSprite(`${t.dir === "left" ? "↰" : "↱"} ${t.label} · ${Math.round(t.distanceM)} m`, { ...t.at, z: t.at.z + 1.6 }, "#ffc400", "#211900");
    }
    if (scene.floorChangeArrow) this.addSprite(`${scene.floorChangeArrow.via === "lift" ? "↕" : "⇧"} ${scene.floorChangeArrow.label}`, scene.floorChangeArrow.at, "#7c3aed", "#fff");
    if (scene.destinationPin) this.addSprite(`📍 ${scene.destinationPin.label}`, scene.destinationPin.at, "#e8453c", "#fff");
    for (const ad of scene.adQuads) {
      const mat = this.adMaterial(ad);
      const mesh = this.addQuad(ad.corners, mat, ad);
      this.adMeshes.set(mesh, ad.campaign.id);
    }
  }

  private addPolygon(points: MapPoint3[], material: THREE.Material): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
    const tris: MapPoint3[] = [];
    for (let i = 1; i < points.length - 1; i++) tris.push(points[0]!, points[i]!, points[i + 1]!);
    return this.addTriangles(tris, material);
  }

  private addQuad(points: readonly [MapPoint3, MapPoint3, MapPoint3, MapPoint3], material: THREE.Material, ad: AdQuad): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
    const mesh = this.addTriangles([points[0], points[3], points[1], points[1], points[3], points[2]], material, ad);
    mesh.geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0], 2));
    return mesh;
  }

  private addTriangles(points: MapPoint3[], material: THREE.Material, ad?: AdQuad): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
    const geometry = new THREE.BufferGeometry();
    const current = new Float32Array(points.length * 3);
    current.fill(Number.NaN);
    geometry.setAttribute("position", new THREE.BufferAttribute(current, 3));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.meshes.push({ mesh, mapPoints: points, current, ad });
    return mesh;
  }

  private addSprite(text: string, point: MapPoint3, bg: string, fg: string): void {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = bg; g.beginPath(); g.roundRect(2, 2, 508, 124, 50); g.fill();
    g.fillStyle = fg; g.font = "700 38px system-ui,sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 256, 64, 470);
    const texture = new THREE.CanvasTexture(c);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(2.4, 0.6, 1);
    sprite.position.set(Number.NaN, Number.NaN, Number.NaN);
    this.root.add(sprite);
    this.sprites.push({ sprite, mapPoint: point });
  }

  private adMaterial(ad: AdQuad): THREE.MeshBasicMaterial {
    const url = ad.campaign.mediaUrl;
    const signature = JSON.stringify([url, ad.campaign.type, ad.campaign.theme, ad.campaign.brand, ad.campaign.headline]);
    let cached = this.media.get(ad.campaign.id);
    if (cached && cached.signature !== signature) {
      cached.video?.pause();
      if (cached.video) this.videos.delete(cached.video);
      cached.poster.dispose(); cached.live?.dispose();
      this.media.delete(ad.campaign.id);
      cached = undefined;
    }
    if (!cached) {
      cached = { signature, poster: new THREE.CanvasTexture(this.posterCanvas(ad)), live: null, video: null, loading: false };
      this.media.set(ad.campaign.id, cached);
    }
    const material = new THREE.MeshBasicMaterial({ map: cached.live ?? cached.poster, side: THREE.DoubleSide, transparent: true });
    if (url && ad.campaign.type === "video") {
      if (!cached.video) {
        const video = document.createElement("video");
        video.src = url; video.muted = true; video.loop = true; video.playsInline = true; video.preload = "auto"; video.poster = "";
        cached.video = video;
        this.videos.add(video);
        const texture = new THREE.VideoTexture(video);
        video.addEventListener("loadeddata", () => {
          cached!.live = texture;
          for (const [object, id] of this.adMeshes) if (id === ad.campaign.id && object instanceof THREE.Mesh) {
            const mat = object.material as THREE.MeshBasicMaterial;
            mat.map = texture; mat.needsUpdate = true;
          }
        }, { once: true });
        if (this.active) void video.play().catch(() => undefined);
      }
      return material;
    }
    if (url && !cached.live && !cached.loading) {
      cached.loading = true;
      new THREE.TextureLoader().load(url, (texture) => {
        cached!.live = texture; cached!.loading = false;
        for (const [object, id] of this.adMeshes) if (id === ad.campaign.id && object instanceof THREE.Mesh) {
          const mat = object.material as THREE.MeshBasicMaterial;
          mat.map = texture; mat.needsUpdate = true;
        }
      }, undefined, () => { cached!.loading = false; });
    }
    return material;
  }

  private posterCanvas(ad: AdQuad): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = 640; c.height = 360;
    const g = c.getContext("2d")!;
    const gr = g.createLinearGradient(0, 0, c.width, c.height); gr.addColorStop(0, ad.campaign.theme[0]); gr.addColorStop(1, ad.campaign.theme[1]);
    g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height); g.fillStyle = "#fff";
    g.font = "700 28px system-ui"; g.fillText(`${ad.campaign.type === "video" ? "▶ " : ""}${ad.campaign.brand.toUpperCase()}`, 32, 70);
    g.font = "800 54px system-ui"; g.fillText(ad.campaign.headline, 32, 190, 575);
    g.font = "700 20px system-ui"; g.fillText("SPONSORED · PLACEHOLDER BRAND", 32, 325);
    return c;
  }

  private clear(keepMedia: boolean): void {
    const mediaTextures = new Set<THREE.Texture>();
    for (const item of this.media.values()) { mediaTextures.add(item.poster); if (item.live) mediaTextures.add(item.live); }
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        if ("geometry" in o && o.geometry instanceof THREE.BufferGeometry) o.geometry.dispose();
        const material = o.material as THREE.Material;
        const withMap = material as THREE.Material & { map?: THREE.Texture | null };
        if (withMap.map && !mediaTextures.has(withMap.map)) withMap.map.dispose();
        material.dispose();
      }
    });
    this.root.clear();
    this.meshes.length = 0;
    this.sprites.length = 0;
    this.adMeshes.clear();
    if (!keepMedia) {
      for (const v of this.videos) v.pause();
      this.videos.clear();
      for (const item of this.media.values()) { item.poster.dispose(); item.live?.dispose(); }
      this.media.clear();
    }
  }
}
