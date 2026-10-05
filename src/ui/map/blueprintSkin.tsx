import { doorOutward, roomDoors } from "@/core/doors";
import { roomPolygon } from "@/core/geom";
import type { MapObject, Room } from "@/core/schema";
import { OBJECT_KINDS, type CatInfo } from "@/core/cats";

/**
 * The "Blueprint" look: an architectural plan on light drafting paper. Real wall thickness, door openings with their swing arc,
 * furniture drawn as plan symbols, a 1 m / 5 m paper grid, a north arrow and a scale bar. Same data as the classic skin; only drawing.
 */
export type MapTheme = "classic" | "blueprint";

export const BP = {
  paper: "#f4f7fb",
  sea: "#e6edf6",
  gridMinor: "#dde6f1",
  gridMajor: "#c9d6e6",
  ink: "#2f4257",
  inkSoft: "#7b8ea6",
  corridor: "#ffffff",
  corridorEdge: "#d3deeb",
  wall: 0.2,
  accent: "#2f5bea",
};

const NS = { vectorEffect: "non-scaling-stroke" } as const;
const WALL_FILL_OPACITY = 0.92;

export function BpDefs() {
  return (
    <>
      <pattern id="bpGrid1" width={1} height={1} patternUnits="userSpaceOnUse">
        <path d="M1 0 L0 0 L0 1" fill="none" stroke={BP.gridMinor} strokeWidth={0.025} />
      </pattern>
      <pattern id="bpGrid5" width={5} height={5} patternUnits="userSpaceOnUse">
        <path d="M5 0 L0 0 L0 5" fill="none" stroke={BP.gridMajor} strokeWidth={0.045} />
      </pattern>
    </>
  );
}

/** The sheet of paper the floor is drawn on. */
export function BpPaper({ w, h, dim }: { w: number; h: number; dim: boolean }) {
  // (A fragment, not a <g>: the first <rect> child of the map group is the floor plate, which tests and tools measure.)
  return (
    <>
      <rect x={-0.4} y={-0.4} width={w + 0.8} height={h + 0.8} fill={BP.paper} fillOpacity={dim ? 0.35 : 1} />
      <rect x={-0.4} y={-0.4} width={w + 0.8} height={h + 0.8} fill="url(#bpGrid1)" style={{ pointerEvents: "none" }} />
      <rect x={-0.4} y={-0.4} width={w + 0.8} height={h + 0.8} fill="url(#bpGrid5)" style={{ pointerEvents: "none" }} />
      <rect x={-0.4} y={-0.4} width={w + 0.8} height={h + 0.8} fill="none" stroke={BP.inkSoft} strokeWidth={1.4} style={{ pointerEvents: "none" }} {...NS} />
    </>
  );
}

const outline = (r: Room): string => `M${roomPolygon(r).map((p) => `${p.x} ${p.y}`).join(" L")} Z`;

/** A corridor strip: a faint edge line under a white floor strip. */
export function BpCorridorStrip({ a, b, width, dim }: { a: { x: number; y: number }; b: { x: number; y: number }; width: number; dim: boolean }) {
  return (
    <>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={BP.corridorEdge} strokeWidth={width + 0.14} strokeLinecap="round" />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={BP.corridor} strokeOpacity={dim ? 0.5 : 1} strokeWidth={width} strokeLinecap="round" />
    </>
  );
}

interface RoomProps {
  room: Room;
  cat: CatInfo;
  selected: boolean;
  dim: boolean;
}

/** Room floor tint plus a real-thickness wall, and a hairline on top so it never vanishes when zoomed out. */
export function BpRoom({ room: r, cat, selected, dim }: RoomProps) {
  const poly = !!r.polygon && r.polygon.length >= 3;
  const common = { "data-type": "room", "data-id": r.id, style: { cursor: "pointer" } } as const;
  const d = poly ? outline(r) : "";
  return (
    <g>
      {poly ? (
        <path d={d} fill={cat.fill} fillOpacity={dim ? 0.6 : WALL_FILL_OPACITY} stroke={BP.ink} strokeWidth={BP.wall} strokeLinejoin="miter" {...common} />
      ) : (
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={cat.fill} fillOpacity={dim ? 0.6 : WALL_FILL_OPACITY} stroke={BP.ink} strokeWidth={BP.wall} strokeLinejoin="miter" {...common} />
      )}
      {poly ? (
        <path d={d} fill="none" stroke={selected ? BP.accent : BP.ink} strokeWidth={selected ? 3.5 : 1} style={{ pointerEvents: "none" }} {...NS} />
      ) : (
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke={selected ? BP.accent : BP.ink} strokeWidth={selected ? 3.5 : 1} style={{ pointerEvents: "none" }} {...NS} />
      )}
      {r.cat === "restricted" && (poly ? <path d={d} fill="url(#hatch)" style={{ pointerEvents: "none" }} /> : <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="url(#hatch)" style={{ pointerEvents: "none" }} />)}
    </g>
  );
}

/** Door openings: a gap cut in the wall and the leaf swung into the room with its quarter-circle arc. */
export function BpDoors({ room }: { room: Room }) {
  return (
    <>
      {roomDoors(room).map((d, i) => {
        const out = (doorOutward(d) * Math.PI) / 180;
        const n = { x: Math.sin(out), y: -Math.cos(out) }; // out of the room
        const t = { x: Math.cos(out), y: Math.sin(out) }; // along the wall
        const half = 0.45;
        const hinge = { x: d.x - t.x * half, y: d.y - t.y * half };
        const closed = { x: d.x + t.x * half, y: d.y + t.y * half };
        const tip = { x: hinge.x - n.x * half * 2, y: hinge.y - n.y * half * 2 };
        const cross = (tip.x - hinge.x) * (closed.y - hinge.y) - (tip.y - hinge.y) * (closed.x - hinge.x);
        return (
          <g key={i} style={{ pointerEvents: "none" }}>
            <line x1={hinge.x} y1={hinge.y} x2={closed.x} y2={closed.y} stroke={BP.corridor} strokeWidth={BP.wall + 0.06} />
            <line x1={hinge.x} y1={hinge.y} x2={tip.x} y2={tip.y} stroke={BP.ink} strokeWidth={0.05} strokeLinecap="round" />
            <path d={`M${tip.x} ${tip.y} A${half * 2} ${half * 2} 0 0 ${cross > 0 ? 1 : 0} ${closed.x} ${closed.y}`} fill="none" stroke={BP.inkSoft} strokeWidth={0.035} strokeDasharray="0.12 0.08" />
          </g>
        );
      })}
    </>
  );
}

/** Furniture as plan symbols (a bed with pillows, a toilet bowl, a basin...) in drafting ink. */
export function BpObject({ o, selected }: { o: MapObject; selected: boolean }) {
  const k = OBJECT_KINDS[o.kind] ?? OBJECT_KINDS.custom;
  const w = o.w;
  const h = o.h;
  const stroke = selected ? BP.accent : BP.ink;
  const sw = selected ? 3 : 1;
  const body = <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={Math.min(w, h) * 0.08} fill="#fff" fillOpacity={0.9} stroke={stroke} strokeWidth={sw} {...NS} />;
  const thin = { fill: "none", stroke: BP.inkSoft, strokeWidth: 0.9, ...NS } as const;
  let detail: JSX.Element | null = null;
  if (o.kind === "bed") {
    const pw = Math.min(w * 0.22, 0.5);
    detail = (
      <g {...thin}>
        <rect x={-w / 2 + 0.06} y={-h / 2 + 0.07} width={pw} height={h - 0.14} rx={0.05} />
        <line x1={-w / 2 + pw + 0.12} y1={-h / 2 + 0.07} x2={-w / 2 + pw + 0.12} y2={h / 2 - 0.07} />
      </g>
    );
  } else if (o.kind === "toilet") {
    detail = (
      <g {...thin}>
        <rect x={-w / 2 + 0.03} y={-h / 2 + 0.04} width={w * 0.28} height={h - 0.08} rx={0.03} />
        <ellipse cx={w * 0.12} cy={0} rx={w * 0.3} ry={h * 0.36} />
      </g>
    );
  } else if (o.kind === "sink") {
    detail = <ellipse cx={0} cy={0} rx={w * 0.34} ry={h * 0.32} {...thin} />;
  } else if (o.kind === "shower") {
    detail = (
      <g {...thin}>
        <line x1={-w / 2} y1={-h / 2} x2={w / 2} y2={h / 2} />
        <circle cx={0} cy={0} r={Math.min(w, h) * 0.14} />
      </g>
    );
  } else if (o.kind === "wardrobe" || o.kind === "shelf") {
    detail = <line x1={-w / 2} y1={-h / 2} x2={w / 2} y2={h / 2} {...thin} />;
  } else if (o.kind === "table" || o.kind === "desk") {
    detail = <rect x={-w / 2 + 0.07} y={-h / 2 + 0.07} width={w - 0.14} height={h - 0.14} rx={0.03} {...thin} />;
  } else if (o.kind === "sofa") {
    detail = (
      <g {...thin}>
        <rect x={-w / 2 + 0.05} y={-h / 2 + 0.05} width={w - 0.1} height={h * 0.28} rx={0.05} />
        <line x1={0} y1={-h / 2 + h * 0.33} x2={0} y2={h / 2 - 0.05} />
      </g>
    );
  } else if (o.kind === "chair") {
    detail = <path d={`M${-w / 2 + 0.05} ${-h / 2 + 0.06} L${w / 2 - 0.05} ${-h / 2 + 0.06}`} {...thin} />;
  }
  return (
    <g transform={`translate(${o.x},${o.y}) rotate(${o.rotation})`} data-type="object" data-id={o.id} style={{ cursor: "pointer" }}>
      <title>{o.label || k.label}</title>
      {body}
      {detail}
    </g>
  );
}

const NICE = [0.5, 1, 2, 5, 10, 20, 50, 100];

/** North arrow (follows the map rotation and the venue's true-north offset) and a scale bar. Pure overlay, never catches the pointer. */
export function MapDecor({ scale, rotation, northOffsetDeg = 0 }: { scale: number; rotation: number; northOffsetDeg?: number }) {
  const metres = NICE.find((m) => m * scale >= 44) ?? NICE[NICE.length - 1]!;
  const px = Math.round(metres * scale);
  const north = rotation - northOffsetDeg;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} data-testid="map-decor">
      <svg width={46} height={46} viewBox="-23 -23 46 46" style={{ position: "absolute", right: 10, bottom: 14, overflow: "visible", filter: "drop-shadow(0 1px 2px rgba(0,0,0,.25))" }} aria-label="North">
        <circle r={21} fill="rgba(255,255,255,.88)" stroke={BP.inkSoft} strokeWidth={1} />
        <g transform={`rotate(${north})`}>
          <path d="M0,-16 L5.5,3 L0,0 L-5.5,3 Z" fill={BP.ink} />
          <path d="M0,16 L5.5,3 L0,0 L-5.5,3 Z" fill="#fff" stroke={BP.ink} strokeWidth={1} />
          <text y={-17.5} textAnchor="middle" fontSize={9} fontWeight={800} fill={BP.ink} transform="translate(0,-4)" style={{ paintOrder: "stroke" }}>
            N
          </text>
        </g>
      </svg>
      <div style={{ position: "absolute", left: 12, bottom: 14, display: "flex", flexDirection: "column", gap: 2, font: "700 11px system-ui,sans-serif", color: BP.ink, textShadow: "0 0 3px #fff, 0 0 3px #fff" }}>
        <span>{metres} m</span>
        <span style={{ width: px, height: 6, borderLeft: `2px solid ${BP.ink}`, borderRight: `2px solid ${BP.ink}`, borderBottom: `2px solid ${BP.ink}`, boxSizing: "border-box" }} />
      </div>
    </div>
  );
}
