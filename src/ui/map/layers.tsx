import { memo } from "react";
import { catOf } from "@/core/cats";
import { routeRuns } from "@/core/playback";
import type { Route } from "@/core/route";
import type { Floor, Room, Venue } from "@/core/schema";
import type { MapItem, MapLayers } from "./types";

const NS = { vectorEffect: "non-scaling-stroke" } as const;

/** Door gap: a short white line across the wall on the room's door side. */
function Door({ room }: { room: Room }) {
  const { x, y, side } = room.door;
  const horiz = side === "N" || side === "S";
  return <line x1={horiz ? x - 0.7 : x} y1={horiz ? y : y - 0.7} x2={horiz ? x + 0.7 : x} y2={horiz ? y : y + 0.7} stroke="#fff" strokeWidth={0.7} />;
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
      {layers.doors && <g>{venue.rooms.filter((r) => r.floor === floor.id).map((r) => <Door key={r.id} room={r} />)}</g>}
      {layers.walknet && (
        <g>
          {venue.edges.map((e, i) => {
            const a = nodes.get(e.a);
            const b = nodes.get(e.b);
            if (!a || !b || e.type !== "walk" || a.floor !== floor.id || b.floor !== floor.id) return null;
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0f9d8a" strokeWidth={2.5} opacity={0.9} {...NS} />;
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
}

/** Route polyline: travelled part grey, remaining part blue, white casing. */
export const RouteLines = memo(function RouteLines({ route, progress, floorId }: RouteProps) {
  if (!route) return null;
  const done = routeRuns(route, 0, progress);
  const todo = routeRuns(route, progress, route.total);
  const draw = (runs: ReturnType<typeof routeRuns>, col: string, key: string) =>
    runs
      .filter((r) => r.floor === floorId)
      .map((run, i) => {
        const d = run.pts.map((p, j) => `${j ? "L" : "M"}${p.x} ${p.y}`).join(" ");
        return (
          <g key={`${key}${i}`}>
            <path d={d} fill="none" stroke="#fff" strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" {...NS} />
            <path d={d} fill="none" stroke={col} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" {...NS} />
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
