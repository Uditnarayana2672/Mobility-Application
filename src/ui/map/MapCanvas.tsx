import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { Route } from "@/core/route";
import type { Venue } from "@/core/schema";
import { buildFixedItems, fixedTransform, fixedVisible } from "./fixedItems";
import { Defs, RouteLines, StaticLayers } from "./layers";
import { DEFAULT_LAYERS, type MapHandle, type MapItem, type MapLayers, type PointerPhase, type UserPose } from "./types";
import { DEFAULT_VIEW, clamp, fitView, panFrom, screenToWorld, zoomAt, type MapView } from "./viewMath";

export interface MapCanvasProps {
  venue: Venue;
  floorId: string;
  layers?: Partial<MapLayers>;
  selected?: MapItem | null;
  route?: Route | null;
  /** Route length already travelled (m); the travelled part is drawn grey. */
  progress?: number;
  user?: UserPose | null;
  /** Map rotation in degrees (heading-up = -heading). Controlled. */
  rotation?: number;
  /** Where the view anchor sits vertically (0..1). */
  anchorY?: number;
  /** Keep the map centred on the user (eased every frame); a manual pan/zoom should call onUserMove, which the host answers by clearing this. */
  followUser?: boolean;
  minScale?: number;
  maxScale?: number;
  /** Called on pointer down/move/up/hover in world coordinates. Return true from "down" to capture the gesture (no panning). */
  onPointer?: (phase: PointerPhase, world: { x: number; y: number }, ev: PointerEvent | ReactPointerEvent) => boolean | void;
  /** Called on a tap (no drag) with the item under the pointer, if any. */
  onSelect?: (item: MapItem | null, world: { x: number; y: number }, ev: PointerEvent | ReactPointerEvent) => void;
  /** Called when the user pans or zooms by hand (e.g. to stop following). */
  onUserMove?: () => void;
  /** Extra SVG drawn in world coordinates above the map (rubber bands, handles). A function receives the current view (for pixel-sized handles). */
  children?: ReactNode | ((view: MapView) => ReactNode);
  className?: string;
  cursor?: string;
}

const TYPES = new Set(["room", "marker", "wall", "poi", "node"]);

/**
 * SVG indoor map, shared by /editor, /nav and /dashboard. World units are metres (x east, y south).
 * Pan (drag), pinch / wheel zoom, controlled `rotation`; the venue, route and user dot are plain props.
 */
export const MapCanvas = forwardRef<MapHandle, MapCanvasProps>(function MapCanvas(props, ref) {
  const { venue, floorId, selected = null, route = null, progress = 0, user = null, rotation = 0, anchorY = 0.5, minScale = 2, maxScale = 60, children, className, cursor } = props;
  const layers = useMemo<MapLayers>(() => ({ ...DEFAULT_LAYERS, ...props.layers }), [props.layers]);
  const floor = venue.floors.find((f) => f.id === floorId) ?? venue.floors[0];
  const box = useRef<HTMLDivElement>(null);
  const lim = useMemo(() => ({ minScale, maxScale }), [minScale, maxScale]);
  const [view, setViewState] = useState<MapView>(() => fitView({ ...DEFAULT_VIEW, anchorY }, floor?.w ?? 60, floor?.h ?? 36, { minScale, maxScale }));
  const viewRef = useRef(view);
  const setView = useCallback((v: MapView) => {
    viewRef.current = v;
    setViewState(v);
  }, []);
  const propsRef = useRef(props);
  propsRef.current = props;

  // Track the container size.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const W = r.width || 300;
      const H = r.height || 300;
      const cur = viewRef.current;
      if (W !== cur.W || H !== cur.H) {
        const first = cur.W === DEFAULT_VIEW.W && cur.H === DEFAULT_VIEW.H;
        const next = { ...cur, W, H };
        setView(first && floor ? fitView(next, floor.w, floor.h, lim) : next);
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [floor, lim, setView]);

  // Refit when switching floors (except while following the user: keep the zoom); keep rotation/anchor in sync with props.
  const lastFloor = useRef(floorId);
  useEffect(() => {
    if (lastFloor.current !== floorId && floor) {
      lastFloor.current = floorId;
      if (!propsRef.current.followUser) setView(fitView(viewRef.current, floor.w, floor.h, lim));
    }
  }, [floorId, floor, lim, setView]);

  // Follow the user: ease the view centre towards the dot every frame (time-based, so it is smooth at any pose rate).
  const followUser = !!props.followUser;
  useEffect(() => {
    if (!followUser || typeof requestAnimationFrame === "undefined") return;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const u = propsRef.current.user;
      const cur = viewRef.current;
      if (u && u.floor === propsRef.current.floorId) {
        const k = 1 - Math.exp(-dt * 10);
        const dx = u.x - cur.cx;
        const dy = u.y - cur.cy;
        if (Math.abs(dx) > 0.005 || Math.abs(dy) > 0.005) setView({ ...cur, cx: cur.cx + dx * k, cy: cur.cy + dy * k });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [followUser, setView]);
  const shown: MapView = useMemo(() => ({ ...view, rot: rotation, anchorY: props.anchorY ?? view.anchorY }), [view, rotation, props.anchorY]);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useImperativeHandle(
    ref,
    () => ({
      fit: () => floor && setView(fitView(viewRef.current, floor.w, floor.h, lim)),
      zoomBy: (k) => setView({ ...viewRef.current, scale: clamp(viewRef.current.scale * k, lim.minScale, lim.maxScale) }),
      centerOn: (x, y, scale) => setView({ ...viewRef.current, cx: x, cy: y, scale: scale ? clamp(scale, lim.minScale, lim.maxScale) : viewRef.current.scale }),
      screenToWorld: (px, py) => screenToWorld(shownRef.current, px, py),
      getScale: () => shownRef.current.scale,
    }),
    [floor, lim, setView],
  );

  // Gestures (pan / pinch / tap / capture), ported from the mock's MapView.bind().
  const gesture = useRef<{
    ptrs: Map<number, { x: number; y: number }>;
    drag: { x: number; y: number; start: MapView; target: EventTarget | null } | null;
    pinch: { d: number; s: number } | null;
    captured: boolean;
    moved: number;
  }>({ ptrs: new Map(), drag: null, pinch: null, captured: false, moved: 0 });

  const local = (ev: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  const world = (p: { x: number; y: number }) => screenToWorld(shownRef.current, p.x, p.y);

  const onDown = (ev: ReactPointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    try {
      ev.currentTarget.setPointerCapture(ev.pointerId);
    } catch {
      /* synthetic events */
    }
    const p = local(ev);
    g.ptrs.set(ev.pointerId, p);
    g.moved = 0;
    if (g.ptrs.size === 1) {
      g.captured = !!propsRef.current.onPointer?.("down", world(p), ev);
      g.drag = { x: p.x, y: p.y, start: shownRef.current, target: ev.target };
    } else if (g.ptrs.size === 2) {
      const [a, b] = [...g.ptrs.values()] as [{ x: number; y: number }, { x: number; y: number }];
      g.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: viewRef.current.scale };
      g.captured = false;
    }
  };

  const onMove = (ev: ReactPointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    const p = local(ev);
    if (!g.ptrs.has(ev.pointerId)) {
      propsRef.current.onPointer?.("hover", world(p), ev);
      return;
    }
    g.ptrs.set(ev.pointerId, p);
    if (g.ptrs.size === 2 && g.pinch) {
      const [a, b] = [...g.ptrs.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const scale = clamp((g.pinch.s * Math.hypot(a.x - b.x, a.y - b.y)) / g.pinch.d, lim.minScale, lim.maxScale);
      setView({ ...viewRef.current, scale });
      propsRef.current.onUserMove?.();
      return;
    }
    if (!g.drag) return;
    g.moved = Math.max(g.moved, Math.hypot(p.x - g.drag.x, p.y - g.drag.y));
    if (g.captured) {
      propsRef.current.onPointer?.("move", world(p), ev);
      return;
    }
    if (g.moved > 4) {
      setView(panFrom(g.drag.start, g.drag.x - p.x, g.drag.y - p.y));
      propsRef.current.onUserMove?.();
    }
  };

  const onUp = (ev: ReactPointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    const p = local(ev);
    g.ptrs.delete(ev.pointerId);
    if (g.ptrs.size < 2) g.pinch = null;
    if (g.ptrs.size === 0 && g.drag) {
      if (g.captured) propsRef.current.onPointer?.("up", world(p), ev);
      else if (g.moved <= 4) {
        const el = (g.drag.target as Element | null)?.closest?.("[data-id]") ?? null;
        const type = el?.getAttribute("data-type") ?? "";
        const item: MapItem | null = el && TYPES.has(type) ? { type: type as MapItem["type"], id: el.getAttribute("data-id") ?? "" } : null;
        propsRef.current.onSelect?.(item, world(p), ev);
      }
      g.drag = null;
      g.captured = false;
    }
  };

  // Wheel must be non-passive to prevent page scroll.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      setView(zoomAt(shownRef.current, ev.clientX - r.left, ev.clientY - r.top, ev.deltaY < 0 ? 1.12 : 1 / 1.12, lim));
      propsRef.current.onUserMove?.();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [lim, setView]);

  const fixed = useMemo(
    () => buildFixedItems({ venue, floorId, layers, selected, route, user, labels: layers.labels }),
    [venue, floorId, layers, selected, route, user],
  );

  const s = shown.scale;
  const worldTransform = `translate(${shown.W / 2},${shown.H * shown.anchorY}) rotate(${shown.rot}) scale(${s}) translate(${-shown.cx},${-shown.cy})`;

  return (
    <div ref={box} className={className} style={{ position: "absolute", inset: 0, overflow: "hidden", cursor }} data-testid="map-canvas">
      <svg
        width="100%"
        height="100%"
        style={{ display: "block", touchAction: "none", userSelect: "none", background: "#e9edf3" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <Defs />
        <g transform={worldTransform}>
          <StaticLayers venue={venue} floorId={floorId} layers={layers} selected={selected} />
          <RouteLines route={route} progress={progress} floorId={floorId} activeFloor={user?.floor} />
          {user && user.floor === floorId && (
            <circle
              cx={user.x}
              cy={user.y}
              r={Math.max(0.6, user.acc ?? 1)}
              fill={user.stale ? "rgba(138,148,166,.16)" : "rgba(47,91,234,.14)"}
              stroke={user.stale ? "rgba(138,148,166,.35)" : "rgba(47,91,234,.35)"}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {typeof children === "function" ? children(shown) : children}
          {fixed.map((e) =>
            fixedVisible(e, s, layers) ? (
              <g key={e.key} transform={fixedTransform(e, s, shown.rot)}>
                {e.children}
              </g>
            ) : null,
          )}
        </g>
      </svg>
    </div>
  );
});
