import { memo } from "react";
import { OBJECT_KINDS, catOf } from "@/core/cats";
import { routeRuns } from "@/core/playback";
import type { Route } from "@/core/route";
import { doorOutward, roomDoors } from "@/core/doors";
import { CORRIDOR_W } from "@/core/geo";
import type { Floor, Room, Venue } from "@/core/schema";
import type { MapItem, MapLayers } from "./types";

const NS = { vectorEffect: "non-scaling-stroke" } as const;

/** Door gap: a short white line across the wall on the room's door side. */
function Doors({ room }: { room: Room }) {
  return (
    <>
      {roomDoors(room).map((d, i) => {
        // The gap lies along the wall: perpendicular to the way out of the room.
        const out = (doorOutward(d) * Math.PI) / 180;
        const tx = Math.cos(out);
        const ty = Math.sin(out);
        return <line key={i} x1={d.x - tx * 0.7} y1={d.y - ty * 0.7} x2={d.x + tx * 0.7} y2={d.y + ty * 0.7} stroke="#fff" strokeWidth={0.7} />;
      })}
    </>
  );
}

function Underlay({ floor }: { floor: Floor }) {
  const bg = floor.background;
  if (!bg) return null;
  const t = bg.transform;
  return (
    <g transform={`translate(${t.x},${t.y}) rotate(${t.rotationDeg}) scale(${t.scale})`} opacity={bg.opacity} style={{ pointerEvents: "none" }}>
      <image href={bg.imageUrl} x={0} y={0} width={bg.widthPx} height={bg.heightPx} preserveAspectRatio="none" />
    </g>
  );
}

interface StaticProps {
  venue: Venue;
  floorId: string;
  layers: MapLayers;
  selected: MapItem | null;
}

/** Geometry that only changes when the venue, floor, layers or selection change (not on pan/zoom). */
export const StaticLayers = memo(function StaticLayers({ venue, floorId, layers, selected }: StaticProps) {
  const floor = venue.floors.find((f) => f.id === floorId) ?? venue.floors[0];
  if (!floor) return null;
  const nodes = new Map(venue.nodes.map((n) => [n.id, n]));
  const gridX: number[] = [];
  const gridY: number[] = [];
  if (layers.grid) {
    for (let i = 0; i <= floor.w; i += 5) gridX.push(i);
    for (let j = 0; j <= floor.h; j += 5) gridY.push(j);
  }
  return (
    <>
      {layers.underlay && <Underlay floor={floor} />}
      {layers.grid && (
        <g>
          {gridX.map((x) => <line key={`gx${x}`} x1={x} y1={0} x2={x} y2={floor.h} stroke="#cdd5e0" strokeWidth={1} opacity={0.7} {...NS} />)}
          {gridY.map((y) => <line key={`gy${y}`} x1={0} y1={y} x2={floor.w} y2={y} stroke="#cdd5e0" strokeWidth={1} opacity={0.7} {...NS} />)}
        </g>
      )}
      <rect x={-0.4} y={-0.4} width={floor.w + 0.8} height={floor.h + 0.8} rx={1} fill="#f5f6f8" fillOpacity={layers.underlay && floor.background ? 0.35 : 1} stroke="#b8c1ce" strokeWidth={2} {...NS} />
      {venue.corridors
        .filter((c) => c.floor === floor.id)
        .map((c, i) => (
          <g key={`c${i}`}>
            <rect x={c.x} y={c.y} width={c.w} height={c.h} fill="#fff" fillOpacity={layers.underlay && floor.background ? 0.5 : 1} />
            <line x1={c.x} y1={c.y + c.h / 2} x2={c.x + c.w} y2={c.y + c.h / 2} stroke="#eef1f5" strokeWidth={1} strokeDasharray="6 6" {...NS} />
          </g>
        ))}
      {/* Corridors drawn as walk lines (the editor's way): a floor-coloured strip of the line's width, under the rooms. */}
      <g style={{ pointerEvents: "none" }}>
        {venue.edges.map((e, i) => {
          const a = nodes.get(e.a);
          const b = nodes.get(e.b);
          if (!a || !b || e.type !== "walk" || a.floor !== floor.id || b.floor !== floor.id || a.kind !== "corridor" || b.kind !== "corridor") return null;
          return <line key={`cw${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#fff" strokeOpacity={layers.underlay && floor.background ? 0.5 : 1} strokeWidth={e.width ?? CORRIDOR_W} strokeLinecap="round" />;
        })}
      </g>
      <g>
        {venue.rooms
          .filter((r) => r.floor === floor.id)
          .map((r) => {
            const cat = catOf(r.cat) ?? catOf("workspace")!;
            const sel = selected?.type === "room" && selected.id === r.id;
            return (
              <g key={r.id}>
                <rect
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  rx={0.4}
                  fill={cat.fill}
                  fillOpacity={layers.underlay && floor.background ? 0.7 : 1}
                  stroke={sel ? "#2f5bea" : cat.stroke}
                  strokeWidth={sel ? 3.5 : 1.3}
                  data-type="room"
                  data-id={r.id}
                  style={{ cursor: "pointer" }}
                  {...NS}
                />
                {r.cat === "restricted" && <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="url(#hatch)" style={{ pointerEvents: "none" }} />}
              </g>
            );
          })}
      </g>
      {layers.objects && (
        <g>
          {venue.objects
            .filter((o) => o.floor === floor.id)
            .map((o) => {
              const k = OBJECT_KINDS[o.kind] ?? OBJECT_KINDS.custom;
              const sel = selected?.type === "object" && selected.id === o.id;
              return (
                <g key={o.id} transform={`translate(${o.x},${o.y}) rotate(${o.rotation})`} data-type="object" data-id={o.id} style={{ cursor: "pointer" }}>
                  <title>{o.label || k.label}</title>
                  <rect x={-o.w / 2} y={-o.h / 2} width={o.w} height={o.h} rx={Math.min(o.w, o.h) * 0.12} fill={k.fill} stroke={sel ? "#2f5bea" : k.stroke} strokeWidth={sel ? 3 : 1.1} {...NS} />
                  <text x={0} y={0} fontSize={Math.max(0.25, Math.min(o.w, o.h) * 0.6)} textAnchor="middle" dominantBaseline="central" style={{ pointerEvents: "none" }}>
                    {k.icon}
                  </text>
                </g>
              );
            })}
        </g>
      )}
      {layers.doors && <g>{venue.rooms.filter((r) => r.floor === floor.id).map((r) => <Doors key={r.id} room={r} />)}</g>}
      {layers.walknet && (
        <g>
          {venue.edges.map((e, i) => {
            const a = nodes.get(e.a);
            const b = nodes.get(e.b);
            if (!a || !b || e.type !== "walk" || a.floor !== floor.id || b.floor !== floor.id) return null;
            const sel = selected?.type === "edge" && selected.id === `${e.a}|${e.b}`;
            return (
              <g key={i}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={sel ? "#2f5bea" : "#0f9d8a"} strokeWidth={sel ? 4 : 2.5} opacity={0.9} {...NS} style={{ pointerEvents: "none" }} />
                {a.kind === "corridor" && b.kind === "corridor" && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={12} data-type="edge" data-id={`${e.a}|${e.b}`} style={{ cursor: "pointer" }} {...NS} />}
              </g>
            );
          })}
        </g>
      )}
      {layers.walls && (
        <g>
          {venue.walls
            .filter((w) => w.floor === floor.id)
            .map((w) => {
              const sel = selected?.type === "wall" && selected.id === w.id;
              return <line key={w.id} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke={sel ? "#2f5bea" : "#e8890c"} strokeWidth={6} strokeLinecap="round" data-type="wall" data-id={w.id} style={{ cursor: "pointer" }} {...NS} />;
            })}
        </g>
      )}
    </>
  );
});

interface RouteProps {
  route: Route | null;
  progress: number;
  floorId: string;
  /** The floor the user is on. Route runs on any other floor are drawn dashed (a preview of where the route goes next). */
  activeFloor?: string;
}

/** Route polyline: travelled part grey, remaining part blue, white casing; dashed (and lighter) on floors other than the user's. */
export const RouteLines = memo(function RouteLines({ route, progress, floorId, activeFloor }: RouteProps) {
  if (!route) return null;
  const done = routeRuns(route, 0, progress);
  const todo = routeRuns(route, progress, route.total);
  const dashed = activeFloor !== undefined && activeFloor !== floorId;
  const draw = (runs: ReturnType<typeof routeRuns>, col: string, key: string) =>
    runs
      .filter((r) => r.floor === floorId)
      .map((run, i) => {
        const d = run.pts.map((p, j) => `${j ? "L" : "M"}${p.x} ${p.y}`).join(" ");
        return (
          <g key={`${key}${i}`} data-testid={dashed ? "route-dashed" : "route-solid"}>
            <path d={d} fill="none" stroke="#fff" strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" {...NS} />
            <path d={d} fill="none" stroke={dashed && col === "#2f5bea" ? "#6f8df0" : col} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dashed ? "2 11" : undefined} {...NS} />
          </g>
        );
      });
  return (
    <g>
      {draw(done, "#b4bccb", "d")}
      {draw(todo, "#2f5bea", "t")}
    </g>
  );
});

export function Defs() {
  return (
    <defs>
      <pattern id="hatch" width={1.2} height={1.2} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={1.2} height={1.2} fill="none" />
        <line x1={0} y1={0} x2={0} y2={1.2} stroke="#d9707a" strokeWidth={0.35} opacity={0.6} />
      </pattern>
      <linearGradient id="cone" x1={0} y1={1} x2={0} y2={0}>
        <stop offset="0%" stopColor="#2f5bea" stopOpacity={0.55} />
        <stop offset="100%" stopColor="#2f5bea" stopOpacity={0} />
      </linearGradient>
    </defs>
  );
}
