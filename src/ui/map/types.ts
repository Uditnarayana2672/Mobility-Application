export interface MapLayers {
  /** Per-floor background photo (fire-plan underlay). */
  underlay: boolean;
  grid: boolean;
  doors: boolean;
  labels: boolean;
  pois: boolean;
  markers: boolean;
  walls: boolean;
  walknet: boolean;
}

export const DEFAULT_LAYERS: MapLayers = { underlay: false, grid: false, doors: true, labels: true, pois: true, markers: false, walls: false, walknet: false };

export type ItemType = "room" | "marker" | "wall" | "poi" | "node";

export interface MapItem {
  type: ItemType;
  id: string;
}

export interface UserPose {
  floor: string;
  x: number;
  y: number;
  /** Bearing, degrees clockwise from north. */
  heading: number;
  /** Accuracy radius in metres. */
  acc?: number;
  /** Greyed out when the fix is old. */
  stale?: boolean;
}

export type PointerPhase = "down" | "move" | "up" | "hover";

export interface MapHandle {
  fit(): void;
  zoomBy(k: number): void;
  centerOn(x: number, y: number, scale?: number): void;
  screenToWorld(px: number, py: number): { x: number; y: number };
}
