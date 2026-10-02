import type { PoiKind } from "@/core/cats";
import type { Venue } from "@/core/schema";
import { DEFAULT_LAYERS, type MapItem, type MapLayers } from "@/ui/map";

export type ToolId = "select" | "room" | "door" | "walk" | "vertical" | "marker" | "wall" | "poi" | "scale" | "background";
export type Selection = MapItem | { type: "floor"; id: string } | null;
export const MAX_HISTORY = 80;

export interface EditorState {
  venue: Venue;
  /** Undo stack: one snapshot per COMMITTED action (never per mouse move). */
  past: Venue[];
  future: Venue[];
  /** Venue as it was before an in-progress drag/preview; becomes one undo step on commitPending. */
  pending: Venue | null;
  floorId: string;
  tool: ToolId;
  selected: Selection;
  layers: MapLayers;
  poiKind: PoiKind;
  verticalKind: "lift" | "stairs";
  /** Bumped by every committed change; autosave watches it. */
  rev: number;
}

export type Action =
  | { type: "load"; venue: Venue }
  | { type: "commit"; venue: Venue }
  | { type: "preview"; venue: Venue }
  | { type: "commitPending" }
  | { type: "cancelPending" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "setTool"; tool: ToolId }
  | { type: "setFloor"; id: string }
  | { type: "select"; selection: Selection }
  | { type: "setLayer"; name: keyof MapLayers; on: boolean }
  | { type: "setPoiKind"; kind: PoiKind }
  | { type: "setVerticalKind"; kind: "lift" | "stairs" };

/** Layers each tool needs to be usable (switched on when the tool is picked). */
export const TOOL_LAYERS: Partial<Record<ToolId, Partial<MapLayers>>> = {
  walk: { walknet: true },
  vertical: { labels: true },
  marker: { markers: true },
  wall: { walls: true },
  scale: { underlay: true },
  background: { underlay: true },
  poi: { pois: true },
};

export function initialState(venue: Venue): EditorState {
  return {
    venue,
    past: [],
    future: [],
    pending: null,
    floorId: venue.floors[0]?.id ?? "F1",
    tool: "select",
    selected: null,
    layers: { ...DEFAULT_LAYERS, underlay: true, grid: true, walknet: true, markers: true, walls: true },
    poiKind: "water",
    verticalKind: "lift",
    rev: 0,
  };
}

/** Does the selection still point at something in this venue? */
export function selectionExists(v: Venue, s: Selection): boolean {
  if (!s) return true;
  switch (s.type) {
    case "room":
      return v.rooms.some((r) => r.id === s.id);
    case "marker":
      return v.markers.some((m) => String(m.id) === s.id);
    case "wall":
      return v.walls.some((w) => w.id === s.id);
    case "poi":
      return v.pois.some((p) => p.id === s.id);
    case "node":
      return v.nodes.some((n) => n.id === s.id);
    case "floor":
      return v.floors.some((f) => f.id === s.id);
  }
}

const push = (stack: Venue[], v: Venue): Venue[] => [...stack, v].slice(-MAX_HISTORY);

export function reducer(s: EditorState, a: Action): EditorState {
  switch (a.type) {
    case "load": {
      const base = initialState(a.venue);
      return { ...base, layers: s.layers, poiKind: s.poiKind, tool: "select", floorId: a.venue.floors.some((f) => f.id === s.floorId) ? s.floorId : base.floorId };
    }
    case "commit": {
      if (a.venue === s.venue) return s;
      const floorOk = a.venue.floors.some((f) => f.id === s.floorId);
      return { ...s, past: push(s.past, s.pending ?? s.venue), future: [], pending: null, venue: a.venue, rev: s.rev + 1, floorId: floorOk ? s.floorId : (a.venue.floors[0]?.id ?? s.floorId) };
    }
    case "preview":
      return { ...s, pending: s.pending ?? s.venue, venue: a.venue };
    case "commitPending": {
      if (!s.pending) return s;
      return { ...s, past: push(s.past, s.pending), future: [], pending: null, rev: s.rev + 1 };
    }
    case "cancelPending":
      return s.pending ? { ...s, venue: s.pending, pending: null } : s;
    case "undo": {
      const base = s.pending ? { ...s, venue: s.pending, pending: null } : s;
      const prev = base.past[base.past.length - 1];
      if (!prev) return base;
      return { ...base, venue: prev, past: base.past.slice(0, -1), future: [base.venue, ...base.future], rev: base.rev + 1, selected: selectionExists(prev, base.selected) ? base.selected : null };
    }
    case "redo": {
      const next = s.future[0];
      if (!next || s.pending) return s;
      return { ...s, venue: next, future: s.future.slice(1), past: push(s.past, s.venue), rev: s.rev + 1, selected: selectionExists(next, s.selected) ? s.selected : null };
    }
    case "setTool":
      return { ...s, tool: a.tool, layers: { ...s.layers, ...TOOL_LAYERS[a.tool] } };
    case "setFloor":
      return s.venue.floors.some((f) => f.id === a.id) ? { ...s, floorId: a.id } : s;
    case "select":
      return { ...s, selected: a.selection };
    case "setLayer":
      return { ...s, layers: { ...s.layers, [a.name]: a.on } };
    case "setPoiKind":
      return { ...s, poiKind: a.kind };
    case "setVerticalKind":
      return { ...s, verticalKind: a.kind };
  }
}
