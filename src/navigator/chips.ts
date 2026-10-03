import type { Venue } from "@/core/schema";

/** [icon, label, search text] */
export type Chip = [string, string, string];

/** Categories that get their own quick-filter chip when the venue has such a place (so an airport shows Gates, an office shows Meeting rooms). */
const BY_CAT: [string, Chip][] = [
  ["meeting", ["👥", "Meeting rooms", "Meeting"]],
  ["gate", ["🛫", "Gates", "Gate"]],
  ["checkin", ["🧳", "Check-in", "Check-in"]],
  ["security", ["🛂", "Security", "Security"]],
  ["retail", ["🛍️", "Shops", "Shop"]],
  ["lounge", ["🛋️", "Lounges", "Lounge"]],
  ["baggage", ["🛄", "Baggage", "Baggage"]],
];

export function quickChips(v: Venue): Chip[] {
  const cats = new Set(v.rooms.map((r) => r.cat));
  const own = BY_CAT.filter(([cat]) => cats.has(cat as never)).map(([, chip]) => chip).slice(0, 4);
  return [["🍽️", "Food", "Food"], ["🚻", "Washrooms", "washroom"], ...own, ["🛗", "Lifts", "Lifts"], ["🪜", "Stairs", "Stairs"], ["🏃", "Exits", "exit"]];
}
