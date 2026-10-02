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
