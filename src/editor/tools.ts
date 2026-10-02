import type { PoiKind } from "@/core/cats";
import { POI_KINDS } from "@/core/cats";
import type { Venue } from "@/core/schema";
import type { MapItem, PointerPhase } from "@/ui/map";
import * as ops from "./ops";
import type { Pt } from "./ops";
import type { Selection, ToolId } from "./store";

/**
 * Editor tools as small state machines. They never touch React: they read and change the venue only through `Host`,
 * so they can be unit-tested with a fake host. Every committed change is one undo step; drags use preview + commitPending.
 */
export type Overlay =
  | { kind: "rect"; a: Pt; b: Pt }
  | { kind: "line"; a: Pt; b: Pt; color: string }
  | { kind: "dot"; at: Pt }
  | null;

export interface Host {
  venue(): Venue;
  floorId(): string;
  selected(): Selection;
  poiKind(): PoiKind;
  verticalKind(): "lift" | "stairs";
  commit(v: Venue): void;
  preview(v: Venue): void;
  commitPending(): void;
  select(s: Selection): void;
  setOverlay(o: Overlay): void;
  /** One-line status shown in the hint bar. */
  status(msg: string): void;
  toast(msg: string, kind?: "info" | "error"): void;
  /** Pixels per metre, for pixel-sized hit radii. */
  scale(): number;
  /** Ask the UI for the real length of a line drawn on a floor photo. */
  requestScale(req: { floorId: string; a: Pt; b: Pt }): void;
}

export interface PointerEventLike {
  target: EventTarget | null;
}

export interface Tool {
  id: ToolId;
  hint: string;
  onPointer(phase: PointerPhase, pt: Pt, ev: PointerEventLike, h: Host): boolean;
  onSelect(item: MapItem | null, pt: Pt, h: Host): void;
  /** Esc, tool switch or floor change. */
  cancel(h: Host): void;
  /** Enter / "Finish" button. */
  finish?(h: Host): void;
}

const err = (r: unknown): string | null => (r && typeof r === "object" && "error" in r ? String((r as { error: unknown }).error) : null);

export function itemFromEvent(ev: PointerEventLike): MapItem | null {
  const el = (ev.target as Element | null)?.closest?.("[data-id]") ?? null;
  const type = el?.getAttribute("data-type");
  if (!el || !type || !["room", "marker", "wall", "poi", "node"].includes(type)) return null;
  return { type: type as MapItem["type"], id: el.getAttribute("data-id") ?? "" };
}

const noopPointer = (): boolean => false;

/* ------------------------------------------------------------------ select / move */

function selectTool(): Tool {
  let drag: { item: MapItem; base: Venue; start: Pt; moved: boolean } | null = null;
  return {
    id: "select",
    hint: "Click an item to edit it. Drag markers, ad walls, POIs and walk nodes to move them; select a room first to drag it. Drag the background to pan, scroll to zoom.",
    onPointer(phase, pt, ev, h) {
      if (phase === "down") {
        const item = itemFromEvent(ev);
        if (!item) return false;
        const sel = h.selected();
        const movable = item.type === "marker" || item.type === "wall" || item.type === "poi" || item.type === "node" || (item.type === "room" && sel?.type === "room" && sel.id === item.id);
        if (!movable) return false;
        drag = { item, base: h.venue(), start: pt, moved: false };
        h.select(item);
        return true;
      }
      if (phase === "move" && drag) {
        const dist = Math.hypot(pt.x - drag.start.x, pt.y - drag.start.y);
        if (!drag.moved && dist * h.scale() < 3) return true; // ignore jitter
        drag.moved = true;
        const { item, base } = drag;
        const next =
          item.type === "room"
            ? ops.moveRoom(base, item.id, pt.x - drag.start.x, pt.y - drag.start.y)
            : item.type === "node"
              ? ops.moveNode(base, item.id, pt)
              : ops.moveItem(base, item.type as "marker" | "wall" | "poi", item.id, pt);
        h.preview(next);
        return true;
      }
      if (phase === "up" && drag) {
        if (drag.moved) h.commitPending();
        drag = null;
        return true;
      }
      return false;
    },
    onSelect(item, _pt, h) {
      h.select(item);
    },
    cancel() {
      drag = null;
    },
  };
}

/* ------------------------------------------------------------------ room */

function roomTool(): Tool {
  let start: Pt | null = null;
  return {
    id: "room",
    hint: "Drag a rectangle to draw a room (0.5 m snap). Its door goes on the side facing the nearest corridor and is linked to the walk network automatically.",
    onPointer(phase, pt, _ev, h) {
      if (phase === "down") {
        start = pt;
        return true;
      }
      if (phase === "move" && start) {
        h.setOverlay({ kind: "rect", a: start, b: pt });
        return true;
      }
      if (phase === "up" && start) {
        const a = start;
        start = null;
        h.setOverlay(null);
        const r = ops.addRoom(h.venue(), h.floorId(), a, pt);
        const e = err(r);
        if (e) h.toast(e, "error");
        else {
          const ok = r as { venue: Venue; id: string };
          h.commit(ok.venue);
          h.select({ type: "room", id: ok.id });
        }
        return true;
      }
      return false;
    },
    onSelect: () => undefined,
    cancel(h) {
      start = null;
      h.setOverlay(null);
    },
  };
}

/* ------------------------------------------------------------------ door */

function doorTool(): Tool {
  return {
    id: "door",
    hint: "Click a room (or its edge) to move its door to the nearest point on that room's wall. The door re-links to the corridor.",
    onPointer: noopPointer,
    onSelect(item, pt, h) {
      const v = h.venue();
      const sel = h.selected();
      let roomId: string | null = item?.type === "room" ? item.id : null;
      if (!roomId && sel?.type === "room") roomId = sel.id;
      if (!roomId) roomId = ops.nearestRoomEdge(v, h.floorId(), pt, 2)?.room.id ?? null;
      if (!roomId) return h.toast("Click on a room first", "error");
      const r = ops.setDoor(v, roomId, pt);
      const e = err(r);
      if (e) return h.toast(e, "error");
      h.commit(r as Venue);
      h.select({ type: "room", id: roomId });
    },
    cancel() {},
  };
}

/* ------------------------------------------------------------------ walk path */

function walkTool(): Tool {
  let chain: string | null = null;
  const snapPreview = (h: Host, pt: Pt): Pt => {
    const n = ops.nearestNode(h.venue(), h.floorId(), pt, ops.NODE_SNAP, ["corridor", "door"]);
    return n ? { x: n.x, y: n.y } : { x: ops.snap(pt.x), y: ops.snap(pt.y) };
  };
  return {
    id: "walk",
    hint: "Click along the corridor centre-line to lay walk nodes (0.5 m snap). Click an existing node to join it; clicking the last node again, Esc or Enter ends the chain. Nodes next to a door link to it automatically.",
    onPointer(phase, pt, _ev, h) {
      if (phase === "hover") {
        const a = chain ? h.venue().nodes.find((n) => n.id === chain) : null;
        const p = snapPreview(h, pt);
        h.setOverlay(a ? { kind: "line", a, b: p, color: "#0f9d8a" } : { kind: "dot", at: p });
      }
      return false;
    },
    onSelect(_item, pt, h) {
      const r = ops.walkClick(h.venue(), h.floorId(), chain, pt);
      if (r.nodeId === chain) {
        chain = null; // clicked the end node again: finish this chain
        h.status("Chain ended. Click to start a new one.");
        return;
      }
      h.commit(r.venue);
      chain = r.nodeId;
      h.status("Click the next point, or press Esc to end the chain.");
    },
    cancel(h) {
      chain = null;
      h.setOverlay(null);
    },
    finish(h) {
      chain = null;
      h.setOverlay(null);
      h.status("Chain ended.");
    },
  };
}

/* ------------------------------------------------------------------ vertical link */

function verticalTool(): Tool {
  let picks: string[] = [];
  const name = (h: Host, id: string) => h.venue().rooms.find((r) => r.id === id)?.name ?? id;
  const report = (h: Host) =>
    h.status(
      picks.length
        ? `Picked: ${picks.map((p) => name(h, p)).join(", ")}. Switch floor and click the matching ${h.verticalKind()} room${h.verticalKind() === "lift" ? ", then press Enter (or Finish) to link" : ""}.`
        : `Click a ${h.verticalKind()} room on one floor, switch floor, then click the same ${h.verticalKind()} on the other floor.`,
    );
  const complete = (h: Host) => {
    const r = ops.addVerticalLinks(h.venue(), h.verticalKind(), picks);
    const e = err(r);
    if (e) {
      h.toast(e, "error");
      return;
    }
    const ok = r as { venue: Venue; added: number };
    h.commit(ok.venue);
    h.toast(ok.added ? `Linked ${picks.length} floors by ${h.verticalKind()}` : "Those floors were already linked", "info");
    picks = [];
    report(h);
  };
  return {
    id: "vertical",
    hint: "Lift: pick the lift lobby on each floor it serves, then Enter. Stairs: pick the staircase on two adjacent floors. Use the floor switcher between clicks.",
    onPointer: noopPointer,
    onSelect(item, _pt, h) {
      if (item?.type !== "room") return h.toast("Click a lift or stairs room", "error");
      const room = h.venue().rooms.find((r) => r.id === item.id);
      if (!room) return;
      if (picks.includes(room.id)) {
        picks = picks.filter((p) => p !== room.id);
        return report(h);
      }
      const clash = picks.find((p) => h.venue().rooms.find((r) => r.id === p)?.floor === room.floor);
      if (clash) picks = picks.filter((p) => p !== clash); // replace the pick on this floor
      picks.push(room.id);
      if (h.verticalKind() === "stairs" && picks.length === 2) return complete(h);
      report(h);
    },
    cancel(h) {
      picks = [];
      report(h);
    },
    finish(h) {
      if (picks.length < 2) return h.toast("Pick the lift on at least two floors first", "error");
      complete(h);
    },
  };
}

/* ------------------------------------------------------------------ place markers / walls / POIs */

function placeTool(id: "marker" | "wall" | "poi", hint: string): Tool {
  return {
    id,
    hint,
    onPointer: noopPointer,
    onSelect(_item, pt, h) {
      const v = h.venue();
      const f = h.floorId();
      if (id === "marker") {
        const r = ops.addMarker(v, f, pt);
        const e = err(r);
        if (e) return h.toast(e, "error");
        const ok = r as { venue: Venue; id: number };
        h.commit(ok.venue);
        h.select({ type: "marker", id: String(ok.id) });
        h.toast(`Marker ${ok.id} placed. Print it from /markers.`, "info");
      } else if (id === "wall") {
        const ok = ops.addWall(v, f, pt);
        h.commit(ok.venue);
        h.select({ type: "wall", id: ok.id });
      } else {
        const kind = h.poiKind();
        const ok = ops.addPoi(v, f, pt, kind, POI_KINDS[kind].label);
        h.commit(ok.venue);
        h.select({ type: "poi", id: ok.id });
      }
    },
    cancel() {},
  };
}

/* ------------------------------------------------------------------ scale calibration */

function scaleTool(): Tool {
  let a: Pt | null = null;
  return {
    id: "scale",
    hint: "Needs a floor photo. Click two points on something you measured in real life (a corridor, a door width), then enter its true length in metres.",
    onPointer(phase, pt, _ev, h) {
      if (phase === "hover" && a) h.setOverlay({ kind: "line", a, b: pt, color: "#d93a3a" });
      return false;
    },
    onSelect(_item, pt, h) {
      const f = h.venue().floors.find((x) => x.id === h.floorId());
      if (!f?.background) return h.toast("Upload a photo for this floor first (Floor settings in the side panel)", "error");
      if (!a) {
        a = pt;
        h.status("Now click the second point.");
        return;
      }
      const first = a;
      a = null;
      h.setOverlay({ kind: "line", a: first, b: pt, color: "#d93a3a" });
      h.requestScale({ floorId: f.id, a: first, b: pt });
    },
    cancel(h) {
      a = null;
      h.setOverlay(null);
    },
  };
}

/* ------------------------------------------------------------------ background photo move / scale / rotate */

export interface BgHandles {
  origin: Pt;
  scaleHandle: Pt;
  rotateHandle: Pt;
}

export function bgHandles(v: Venue, floorId: string): BgHandles | null {
  const bg = v.floors.find((f) => f.id === floorId)?.background;
  if (!bg) return null;
  const t = bg.transform;
  const a = (t.rotationDeg * Math.PI) / 180;
  const at = (px: number, py: number): Pt => ({ x: t.x + (px * Math.cos(a) - py * Math.sin(a)) * t.scale, y: t.y + (px * Math.sin(a) + py * Math.cos(a)) * t.scale });
  return { origin: { x: t.x, y: t.y }, scaleHandle: at(bg.widthPx, bg.heightPx), rotateHandle: at(bg.widthPx, 0) };
}

function backgroundTool(): Tool {
  type Mode = "move" | "scale" | "rotate";
  let drag: { mode: Mode; base: Venue; start: Pt; moved: boolean } | null = null;
  return {
    id: "background",
    hint: "Drag the photo to move it. Drag the blue handle (bottom-right) to scale, the orange handle (top-right) to rotate. Then use the Scale tool to calibrate against a known length.",
    onPointer(phase, pt, _ev, h) {
      const v = h.venue();
      const f = h.floorId();
      const bg = v.floors.find((x) => x.id === f)?.background;
      if (!bg) return false;
      if (phase === "down") {
        const hs = bgHandles(v, f)!;
        const r = 14 / h.scale();
        const mode: Mode = Math.hypot(pt.x - hs.scaleHandle.x, pt.y - hs.scaleHandle.y) < r ? "scale" : Math.hypot(pt.x - hs.rotateHandle.x, pt.y - hs.rotateHandle.y) < r ? "rotate" : "move";
        drag = { mode, base: v, start: pt, moved: false };
        return true;
      }
      if (phase === "move" && drag) {
        drag.moved = true;
        const t0 = drag.base.floors.find((x) => x.id === f)!.background!.transform;
        const origin = { x: t0.x, y: t0.y };
        let next: Venue;
        if (drag.mode === "move") next = ops.updateBackground(drag.base, f, { transform: { x: ops.snap(t0.x + pt.x - drag.start.x, 0.05), y: ops.snap(t0.y + pt.y - drag.start.y, 0.05) } });
        else if (drag.mode === "scale") {
          const d0 = Math.hypot(drag.start.x - origin.x, drag.start.y - origin.y) || 1;
          const d1 = Math.hypot(pt.x - origin.x, pt.y - origin.y);
          next = ops.updateBackground(drag.base, f, { transform: { scale: Math.max(0.0005, Math.round(t0.scale * (d1 / d0) * 10000) / 10000) } });
        } else {
          const a0 = Math.atan2(drag.start.y - origin.y, drag.start.x - origin.x);
          const a1 = Math.atan2(pt.y - origin.y, pt.x - origin.x);
          next = ops.updateBackground(drag.base, f, { transform: { rotationDeg: Math.round((t0.rotationDeg + ((a1 - a0) * 180) / Math.PI) * 10) / 10 } });
        }
        h.preview(next);
        return true;
      }
      if (phase === "up" && drag) {
        if (drag.moved) h.commitPending();
        drag = null;
        return true;
      }
      return false;
    },
    onSelect: () => undefined,
    cancel() {
      drag = null;
    },
  };
}

/* ------------------------------------------------------------------ factory */

export function createTool(id: ToolId): Tool {
  switch (id) {
    case "select":
      return selectTool();
    case "room":
      return roomTool();
    case "door":
      return doorTool();
    case "walk":
      return walkTool();
    case "vertical":
      return verticalTool();
    case "marker":
      return placeTool("marker", "Click near a wall to place a printable ArUco marker. It snaps onto the nearest room wall, faces into the corridor and gets the lowest free ID.");
    case "wall":
      return placeTool("wall", "Click a blank wall to add a surveyed 3 m ad slot (never over doors, exits or signs).");
    case "poi":
      return placeTool("poi", "Click to drop a point of interest. Choose its kind in the bar above the map.");
    case "scale":
      return scaleTool();
    case "background":
      return backgroundTool();
  }
}

export const TOOL_LIST: { id: ToolId; label: string; icon: string; key: string }[] = [
  { id: "select", label: "Select", icon: "🖱️", key: "v" },
  { id: "room", label: "Room", icon: "▭", key: "r" },
  { id: "door", label: "Door", icon: "🚪", key: "d" },
  { id: "walk", label: "Walk path", icon: "〰️", key: "w" },
  { id: "vertical", label: "Lift / stairs", icon: "🛗", key: "l" },
  { id: "marker", label: "Marker", icon: "▣", key: "m" },
  { id: "wall", label: "Ad wall", icon: "🖼️", key: "a" },
  { id: "poi", label: "POI", icon: "📍", key: "p" },
  { id: "scale", label: "Scale", icon: "📏", key: "s" },
  { id: "background", label: "Photo", icon: "🗺️", key: "b" },
];
