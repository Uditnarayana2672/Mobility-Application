/** Room categories and POI kinds. Copied from the mock (docs/mock-ui/js/data.js IS.CATS / IS.POI_KINDS). */
export interface CatInfo {
  label: string;
  fill: string;
  stroke: string;
  icon: string;
}

export const CATS = {
  reception: { label: "Reception", fill: "#dbe7fd", stroke: "#7aa2f0", icon: "🛎️" },
  meeting: { label: "Meeting room", fill: "#d5eedd", stroke: "#6fbf8b", icon: "👥" },
  workspace: { label: "Workspace", fill: "#eceff3", stroke: "#a9b4c2", icon: "💻" },
  food: { label: "Food & drink", fill: "#fde4cf", stroke: "#f0a35e", icon: "🍽️" },
  washroom: { label: "Washroom", fill: "#d0edf3", stroke: "#59b8cc", icon: "🚻" },
  vertical: { label: "Lift & stairs", fill: "#e5dcf6", stroke: "#9b82d6", icon: "🛗" },
  restricted: { label: "Restricted", fill: "#f8d7da", stroke: "#d9707a", icon: "🔒" },
  training: { label: "Training", fill: "#fff0c4", stroke: "#e3bd4c", icon: "🎓" },
  admin: { label: "Admin", fill: "#e0e4f7", stroke: "#8d98d8", icon: "🗂️" },
  wellness: { label: "Wellness", fill: "#d9f0e0", stroke: "#69b98a", icon: "🧘" },
  // Airports and other transport buildings
  checkin: { label: "Check-in", fill: "#dbe7fd", stroke: "#7aa2f0", icon: "🧳" },
  security: { label: "Security & immigration", fill: "#fbe3d3", stroke: "#e08a55", icon: "🛂" },
  gate: { label: "Boarding gate", fill: "#d5eedd", stroke: "#6fbf8b", icon: "🛫" },
  retail: { label: "Shop", fill: "#f6e3f3", stroke: "#c779bb", icon: "🛍️" },
  lounge: { label: "Lounge", fill: "#e8e0f7", stroke: "#9b82d6", icon: "🛋️" },
  baggage: { label: "Baggage reclaim", fill: "#e6e9ee", stroke: "#8c98a8", icon: "🛄" },
  // Malls and bus stations
  entertainment: { label: "Entertainment", fill: "#fde2e8", stroke: "#e07a93", icon: "🎬" },
  platform: { label: "Bus platform", fill: "#d9ecf9", stroke: "#5fa6d6", icon: "🚌" },
  ticket: { label: "Tickets & passes", fill: "#fff0c4", stroke: "#e3bd4c", icon: "🎟️" },
} as const satisfies Record<string, CatInfo>;

export type CatId = keyof typeof CATS;
export const CAT_IDS = Object.keys(CATS) as [CatId, ...CatId[]];

export const POI_KINDS = {
  entrance: { icon: "🚪", label: "Main entrance" },
  exit: { icon: "🏃", label: "Fire exit" },
  water: { icon: "💧", label: "Drinking water" },
  printer: { icon: "🖨️", label: "Printer" },
  coffee: { icon: "☕", label: "Coffee counter" },
  firstaid: { icon: "🩺", label: "First aid" },
  atm: { icon: "🏧", label: "ATM" },
  info: { icon: "ℹ️", label: "Information desk" },
  currency: { icon: "💱", label: "Currency exchange" },
  trolley: { icon: "🛒", label: "Trolley bay" },
  babycare: { icon: "🍼", label: "Baby care room" },
  charging: { icon: "🔌", label: "Charging station" },
  prayer: { icon: "🙏", label: "Prayer room" },
  taxi: { icon: "🚕", label: "Taxi / cab desk" },
} as const satisfies Record<string, { icon: string; label: string }>;

export type PoiKind = keyof typeof POI_KINDS;
export const POI_KIND_IDS = Object.keys(POI_KINDS) as [PoiKind, ...PoiKind[]];

/** Look up a category by an unvalidated key (falls back to undefined). */
export function catOf(id: string): CatInfo | undefined {
  return (CATS as Record<string, CatInfo>)[id];
}
export function poiKindOf(id: string): { icon: string; label: string } | undefined {
  return (POI_KINDS as Record<string, { icon: string; label: string }>)[id];
}

/** Furniture and fixtures: drawn on the map, never used for routing or positioning. Sizes are the default footprint in metres. */
export const OBJECT_KINDS = {
  bed: { icon: "🛏️", label: "Bed", w: 2, h: 1, fill: "#e6ddf5", stroke: "#8f7bc4" },
  table: { icon: "▦", label: "Table", w: 1.6, h: 0.9, fill: "#f3e2cc", stroke: "#b98b52" },
  chair: { icon: "🪑", label: "Chair", w: 0.5, h: 0.5, fill: "#f3e2cc", stroke: "#b98b52" },
  desk: { icon: "🖥️", label: "Desk", w: 1.4, h: 0.7, fill: "#e3e8ef", stroke: "#8794a8" },
  sofa: { icon: "🛋️", label: "Sofa", w: 2, h: 0.9, fill: "#e6ddf5", stroke: "#8f7bc4" },
  wardrobe: { icon: "🗄️", label: "Wardrobe", w: 1.2, h: 0.6, fill: "#eadfd3", stroke: "#a98a68" },
  toilet: { icon: "🚽", label: "Toilet", w: 0.7, h: 0.5, fill: "#d9eef3", stroke: "#59b8cc" },
  sink: { icon: "🚰", label: "Sink", w: 0.6, h: 0.5, fill: "#d9eef3", stroke: "#59b8cc" },
  shower: { icon: "🚿", label: "Shower", w: 0.9, h: 0.9, fill: "#d9eef3", stroke: "#59b8cc" },
  shelf: { icon: "📚", label: "Shelf", w: 1.2, h: 0.4, fill: "#eadfd3", stroke: "#a98a68" },
  custom: { icon: "◻️", label: "Other item", w: 1, h: 1, fill: "#eceff3", stroke: "#a9b4c2" },
} as const satisfies Record<string, { icon: string; label: string; w: number; h: number; fill: string; stroke: string }>;

export type ObjectKind = keyof typeof OBJECT_KINDS;
export const OBJECT_KIND_IDS = Object.keys(OBJECT_KINDS) as [ObjectKind, ...ObjectKind[]];
