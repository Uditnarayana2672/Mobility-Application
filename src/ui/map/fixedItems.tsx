import { roomLabelPoint, roomLabelWidth } from "@/core/geom";
import type { ReactNode } from "react";
import { catOf, poiKindOf } from "@/core/cats";
import type { Route } from "@/core/route";
import type { Venue } from "@/core/schema";
import type { MapItem, MapLayers, UserPose } from "./types";

/**
 * Screen-constant-size items (labels, icons, pins, user dot): drawn at a world position but not scaled with zoom.
 * Visibility follows the mock's rules: hide when the room is too small on screen for its label, hide POIs when zoomed out.
 */
export interface FixedItem {
  key: string;
  x: number;
  y: number;
  dx?: number;
  dy?: number;
  /** Keep upright on screen (default) or follow the map rotation (arrows). */
  noRot?: boolean;
  availW?: number;
  availH?: number;
  needW?: number;
  needH?: number;
  minScale?: number;
  layer?: keyof MapLayers;
  children: ReactNode;
}

export interface FixedContext {
  venue: Venue;
  floorId: string;
  layers: MapLayers;
  selected: MapItem | null;
  route: Route | null;
  user: UserPose | null;
  labels: boolean;
}

const rotate = (deg: number) => `rotate(${deg})`;

export function buildFixedItems(c: FixedContext): FixedItem[] {
  const { venue: v, floorId, layers, selected, route, user } = c;
  const items: FixedItem[] = [];

  for (const r of v.rooms.filter((x) => x.floor === floorId)) {
    const cat = catOf(r.cat) ?? catOf("workspace")!;
    const lp = roomLabelPoint(r);
    const cx = lp.x;
    const cy = lp.y;
    const labelW = roomLabelWidth(r);
    const text = r.short || r.name;
    items.push({
      key: `ri-${r.id}`,
      x: cx,
      y: cy,
      dy: c.labels ? -4 : 6,
      availW: labelW,
      availH: r.h,
      needW: 30,
      needH: 44,
      layer: "labels",
      children: (
        <text textAnchor="middle" fontSize={17} y={0} style={{ pointerEvents: "none" }}>
          {r.icon || cat.icon}
        </text>
      ),
    });
    items.push({
      key: `rl-${r.id}`,
      x: cx,
      y: cy,
      dy: 16,
      availW: labelW,
      availH: r.h,
      needW: text.length * 6.3 + 6,
      needH: 30,
      layer: "labels",
      children: (
        <text textAnchor="middle" fontSize={11} fontWeight={600} fill="#3a4658" stroke="#fff" strokeWidth={3} paintOrder="stroke" style={{ pointerEvents: "none" }} y={0}>
          {text}
        </text>
      ),
    });
  }

  if (layers.pois) {
    for (const p of v.pois.filter((x) => x.floor === floorId)) {
      const k = poiKindOf(p.kind) ?? { icon: "📍", label: "" };
      const sel = selected?.type === "poi" && selected.id === p.id;
      items.push({
        key: `p-${p.id}`,
        x: p.x,
        y: p.y,
        minScale: 7,
        children: (
          <g data-type="poi" data-id={p.id} style={{ cursor: "pointer" }}>
            <circle r={10} fill="#fff" stroke={sel ? "#2f5bea" : "#c3cbd8"} strokeWidth={sel ? 2.5 : 1} />
            <text textAnchor="middle" fontSize={12} y={4.5}>{k.icon}</text>
          </g>
        ),
      });
    }
  }

  if (layers.walknet) {
    for (const n of v.nodes.filter((x) => x.floor === floorId)) {
      const sel = selected?.type === "node" && selected.id === n.id;
      items.push({
        key: `n-${n.id}`,
        x: n.x,
        y: n.y,
        children: (
          <g data-type="node" data-id={n.id} style={{ cursor: "pointer" }}>
            <circle r={n.kind === "room" ? 5 : 3.6} fill={n.kind === "corridor" ? "#0f9d8a" : n.kind === "door" ? "#e8890c" : "#7c4dff"} stroke={sel ? "#2f5bea" : "#fff"} strokeWidth={sel ? 2.5 : 1.2} />
          </g>
        ),
      });
    }
  }

  if (layers.walls) {
    for (const w of v.walls.filter((x) => x.floor === floorId)) {
      const mx = (w.x1 + w.x2) / 2;
      const my = (w.y1 + w.y2) / 2;
      items.push({
        key: `wa-${w.id}`,
        x: mx,
        y: my,
        noRot: true,
        children: <path d="M0,-26 L5,-14 L0,-17 L-5,-14 Z" fill="#e8890c" transform={rotate(w.normal)} />,
      });
      items.push({
        key: `wl-${w.id}`,
        x: mx,
        y: my,
        children: (
          <g data-type="wall" data-id={w.id} style={{ cursor: "pointer" }}>
            <rect x={-17} y={-9} width={34} height={18} rx={6} fill="#e8890c" />
            <text textAnchor="middle" y={4} fontSize={10} fontWeight={700} fill="#fff">{w.id}</text>
          </g>
        ),
      });
    }
  }

  if (layers.markers) {
    for (const m of v.markers.filter((x) => x.floor === floorId)) {
      const sel = selected?.type === "marker" && selected.id === String(m.id);
      items.push({
        key: `ma-${m.id}`,
        x: m.x,
        y: m.y,
        noRot: true,
        children: <path d="M0,-24 L4.5,-14 L0,-16.5 L-4.5,-14 Z" fill="#2f5bea" transform={rotate(m.normal)} />,
      });
      items.push({
        key: `mk-${m.id}`,
        x: m.x,
        y: m.y,
        children: (
          <g data-type="marker" data-id={String(m.id)} style={{ cursor: "pointer" }}>
            <rect x={-10} y={-10} width={20} height={20} rx={4} fill="#fff" stroke={sel ? "#e8453c" : "#2f5bea"} strokeWidth={sel ? 3 : 2} />
            {[[-7, -7], [2, -7], [-7, 2]].map(([px, py]) => <rect key={`${px}${py}`} x={px} y={py} width={5} height={5} fill="#14213d" />)}
            <rect x={2.5} y={2.5} width={3.5} height={3.5} fill="#14213d" />
            <text y={23} textAnchor="middle" fontSize={10} fontWeight={700} fill="#2f5bea" stroke="#fff" strokeWidth={3} paintOrder="stroke">{m.id}</text>
          </g>
        ),
      });
    }
  }

  if (route) {
    route.hops.forEach((h, i) => {
      if (h.type === "walk") return;
      const a = route.points[i];
      const b = route.points[i + 1];
      if (!a || !b) return;
      const idx = (id: string) => v.floors.findIndex((f) => f.id === id);
      for (const [p, q] of [[a, b], [b, a]] as const) {
        if (p.floor !== floorId) continue;
        const fl = v.floors.find((f) => f.id === q.floor)?.name ?? q.floor;
        const label = `${h.type === "lift" ? "🛗 Lift" : "🪜 Stairs"} ${idx(q.floor) > idx(p.floor) ? "↑" : "↓"} ${fl}`;
        items.push({
          key: `pill-${i}-${p.floor}`,
          x: p.x,
          y: p.y,
          dx: -12,
          dy: -20,
          children: (
            <g>
              <rect x={-4} y={-13} width={label.length * 6.2 + 8} height={24} rx={12} fill="#7c4dff" />
              <text x={4} y={3.5} fontSize={11} fontWeight={700} fill="#fff">{label}</text>
            </g>
          ),
        });
      }
    });
    const end = route.points[route.points.length - 1];
    if (end && end.floor === floorId) {
      items.push({
        key: "pin",
        x: end.x,
        y: end.y,
        children: (
          <g>
            <path d="M0,0 C-12,-14 -12,-28 0,-28 C12,-28 12,-14 0,0 Z" fill="#e8453c" stroke="#fff" strokeWidth={2} />
            <circle cx={0} cy={-19} r={4.5} fill="#fff" />
          </g>
        ),
      });
    }
  }

  if (user && user.floor === floorId) {
    const col = user.stale ? "#8a94a6" : "#2f5bea";
    items.push({
      key: "user-cone",
      x: user.x,
      y: user.y,
      noRot: true,
      children: (
        <path
          d="M0,0 L-26,-46 A52,52 0 0 1 26,-46 Z"
          transform={`${rotate(user.heading)} scale(${user.stale ? 1.5 : 1}, 1)`}
          fill={user.stale ? "#8a94a6" : "url(#cone)"}
          opacity={user.stale ? 0.25 : 0.85}
        />
      ),
    });
    items.push({ key: "user-dot", x: user.x, y: user.y, children: <circle r={8.5} fill={col} stroke="#fff" strokeWidth={3} /> });
  }

  return items;
}

export function fixedVisible(e: FixedItem, scale: number, layers: MapLayers): boolean {
  if (e.layer && !layers[e.layer]) return false;
  if (e.minScale && scale < e.minScale) return false;
  if (e.needW && ((e.availW ?? 99) * scale < e.needW || (e.needH && (e.availH ?? 99) * scale < e.needH))) return false;
  return true;
}

export function fixedTransform(e: FixedItem, scale: number, rot: number): string {
  return `translate(${e.x},${e.y}) scale(${1 / scale}) ${e.noRot ? "" : `rotate(${-rot})`} translate(${e.dx ?? 0},${e.dy ?? 0})`;
}
