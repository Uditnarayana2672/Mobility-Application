import { useMemo, useRef, useState } from "react";
import { CAT_IDS, CATS, OBJECT_KINDS, OBJECT_KIND_IDS, POI_KINDS, POI_KIND_IDS, type ObjectKind, type PoiKind } from "@/core/cats";
import type { Floor, Room, ValidationResult, Venue } from "@/core/schema";
import { DICT_SIZE } from "@/core/aruco/dict";
import { roomDoors } from "@/core/doors";
import { CORRIDOR_W } from "@/core/geo";
import { unreachableRooms, validate } from "@/core/validate";
import * as ops from "../ops";
import { uploadImage } from "../api";
import type { Selection } from "../store";
import { Badge, Btn, CommitInput, Field, Grid2 } from "./ui";

export interface PanelProps {
  venue: Venue;
  floorId: string;
  selected: Selection;
  commit(v: Venue): void;
  select(s: Selection): void;
  notify(msg: string, kind?: "info" | "error"): void;
}

const DIRS: [number, string][] = [[0, "North"], [90, "East"], [180, "South"], [270, "West"]];
const floorName = (v: Venue, id: string): string => v.floors.find((f) => f.id === id)?.name ?? id;
const SIZE_PRESETS = [0.08, 0.1, 0.12, 0.16, 0.2];

function DeleteBtn({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <div className="mt-4">
      <Btn kind="danger" onClick={onClick}>
        🗑 {children}
      </Btn>
    </div>
  );
}

/* ------------------------------------------------------------------ properties */

export function PropertiesPanel(p: PanelProps) {
  const s = p.selected;
  if (!s || s.type === "floor") return <VenueSummary {...p} />;
  if (s.type === "room") return <RoomProps {...p} id={s.id} />;
  if (s.type === "marker") return <MarkerProps {...p} id={Number(s.id)} />;
  if (s.type === "wall") return <WallProps {...p} id={s.id} />;
  if (s.type === "poi") return <PoiProps {...p} id={s.id} />;
  if (s.type === "edge") return <EdgeProps {...p} id={s.id} />;
  if (s.type === "object") return <ObjectProps {...p} id={s.id} />;
  return <NodeProps {...p} id={s.id} />;
}

function VenueSummary(p: PanelProps) {
  const { venue: v, floorId, commit } = p;
  const floor = v.floors.find((f) => f.id === floorId) ?? v.floors[0]!;
  return (
    <div>
      <h3 className="text-lg font-bold">{v.name}</h3>
      <p className="text-sm text-slate-500">
        {v.type} · {v.floors.length} floor(s) · version {v.version}
      </p>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        {[
          [v.rooms.length, "rooms"],
          [v.markers.length, "markers"],
          [v.walls.length, "ad walls"],
          [v.nodes.length, "nodes"],
        ].map(([n, l]) => (
          <div key={l} className="rounded border border-slate-200 bg-white py-1.5">
            <div className="text-lg font-bold">{n}</div>
            <div className="text-[11px] text-slate-500">{l}</div>
          </div>
        ))}
      </div>
      <h4 className="mt-4 text-sm font-bold">Venue</h4>
      <Field label="Name">
        <CommitInput value={v.name} onCommit={(x) => commit(ops.updateVenueMeta(v, { name: String(x) }))} />
      </Field>
      <Grid2>
        <Field label="Type">
          <CommitInput value={v.type} onCommit={(x) => commit(ops.updateVenueMeta(v, { type: String(x) }))} />
        </Field>
        <Field label="City">
          <CommitInput value={v.city} onCommit={(x) => commit(ops.updateVenueMeta(v, { city: String(x) }))} />
        </Field>
      </Grid2>
      <Field label="Address">
        <CommitInput value={v.address} onCommit={(x) => commit(ops.updateVenueMeta(v, { address: String(x) }))} />
      </Field>
      <FloorSettings {...p} floor={floor} />
      <h4 className="mt-4 text-sm font-bold">How to map your office</h4>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs text-slate-600">
        <li>Upload the fire-plan photo under Floor settings, then calibrate with the Scale tool</li>
        <li>Walk path along each corridor centre-line</li>
        <li>Draw rooms; doors link to the corridor automatically</li>
        <li>Lift / stairs rooms, then link them across floors</li>
        <li>Markers (lift lobbies and stair doors first), ad walls, POIs</li>
        <li>Check the Checklist tab, then Publish</li>
      </ol>
    </div>
  );
}

function FloorSettings({ venue: v, commit, notify, floor }: PanelProps & { floor: Floor }) {
  const bg = floor.background;
  const fileRef = useRef<HTMLInputElement>(null);
  const [opacity, setOpacity] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const img = await uploadImage(file);
      commit(ops.setBackground(v, floor.id, img));
      notify("Photo added. Now calibrate it with the Scale tool.");
    } catch (e) {
      notify(`Upload failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };
  const num = (f: keyof Floor) => (x: string | number) => commit(ops.updateFloor(v, floor.id, { [f]: Number(x) } as Partial<Floor>));
  return (
    <div className="mt-4 rounded border border-slate-200 bg-white p-2">
      <h4 className="text-sm font-bold">Floor settings: {floor.name}</h4>
      <Grid2>
        <Field label="Name">
          <CommitInput value={floor.name} onCommit={(x) => commit(ops.updateFloor(v, floor.id, { name: String(x) }))} />
        </Field>
        <Field label="Elevation (m)">
          <CommitInput type="number" step={0.1} value={floor.elevation} onCommit={num("elevation")} />
        </Field>
        <Field label="Floor height (m)">
          <CommitInput type="number" step={0.1} min={1} value={floor.height} onCommit={num("height")} />
        </Field>
        <Field label="Plate W × H (m)">
          <div className="flex gap-1">
            <CommitInput type="number" min={5} value={floor.w} onCommit={num("w")} />
            <CommitInput type="number" min={5} value={floor.h} onCommit={num("h")} />
          </div>
        </Field>
      </Grid2>
      <h5 className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-500">Floor-plan photo</h5>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
      {!bg ? (
        <div className="mt-1">
          <Btn kind="primary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "Uploading…" : "Upload photo"}
          </Btn>
          <p className="mt-1 text-xs text-slate-500">Photo of the fire-evacuation plan, taken straight-on. PNG / JPEG / WebP, up to 10 MB.</p>
        </div>
      ) : (
        <div>
          <div className="mt-1 flex items-center gap-2">
            {bg.calibrated ? <Badge kind="ok">✔ calibrated</Badge> : <Badge kind="warn">not calibrated: use the Scale tool</Badge>}
          </div>
          {bg.reference && <p className="text-xs text-slate-500">{bg.reference}</p>}
          <Field label={`Opacity ${Math.round((opacity ?? bg.opacity) * 100)}%`}>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={opacity ?? bg.opacity}
              className="w-full"
              onChange={(e) => setOpacity(Number(e.target.value))}
              onPointerUp={() => opacity !== null && (commit(ops.updateBackground(v, floor.id, { opacity })), setOpacity(null))}
              onKeyUp={() => opacity !== null && (commit(ops.updateBackground(v, floor.id, { opacity })), setOpacity(null))}
              onBlur={() => opacity !== null && (commit(ops.updateBackground(v, floor.id, { opacity })), setOpacity(null))}
            />
          </Field>
          <Grid2>
            <Field label="Left edge x (m)">
              <CommitInput type="number" step={0.1} value={bg.transform.x} onCommit={(x) => commit(ops.updateBackground(v, floor.id, { transform: { x: Number(x) } }))} />
            </Field>
            <Field label="Top edge y (m)">
              <CommitInput type="number" step={0.1} value={bg.transform.y} onCommit={(x) => commit(ops.updateBackground(v, floor.id, { transform: { y: Number(x) } }))} />
            </Field>
            <Field label="Metres per pixel" hint="Editing this by hand clears the calibration.">
              <CommitInput type="number" step={0.001} min={0.0005} value={bg.transform.scale} onCommit={(x) => commit(ops.updateBackground(v, floor.id, { transform: { scale: Number(x) } }))} />
            </Field>
            <Field label="Rotation (°)">
              <CommitInput type="number" step={0.1} value={bg.transform.rotationDeg} onCommit={(x) => commit(ops.updateBackground(v, floor.id, { transform: { rotationDeg: Number(x) } }))} />
            </Field>
          </Grid2>
          <p className="mt-1 text-xs text-slate-500">
            Image {bg.widthPx} × {bg.heightPx} px = {(bg.widthPx * bg.transform.scale).toFixed(1)} × {(bg.heightPx * bg.transform.scale).toFixed(1)} m
          </p>
          <div className="mt-2 flex gap-2">
            <Btn onClick={() => fileRef.current?.click()}>Replace…</Btn>
            <Btn kind="danger" onClick={() => commit(ops.removeBackground(v, floor.id))}>
              Remove photo
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ room */

function RoomProps({ venue: v, id, commit, select }: PanelProps & { id: string }) {
  const r = v.rooms.find((x) => x.id === id);
  const unreachable = useMemo(() => unreachableRooms(v).some((x) => x.id === id), [v, id]);
  if (!r) return <p className="text-sm text-slate-500">Room not found.</p>;
  const set = (patch: Partial<Room>) => commit(ops.updateRoom(v, id, patch));
  const connect = () => {
    const res = ops.connectRoom(v, id);
    if ("error" in res) return alert(res.error);
    commit(res);
  };
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-2xl">{r.icon ?? CATS[r.cat].icon}</span>
        <h3 className="text-lg font-bold">{r.name || "(unnamed)"}</h3>
      </div>
      <p className="text-xs text-slate-500">
        {floorName(v, r.floor)} · {r.w}×{r.h} m · id {r.id} · {roomDoors(r).length} door(s)
      </p>
      <div className="mt-2 flex items-center gap-2">
        {unreachable ? (
          <>
            <Badge kind="fail">✖ not reachable</Badge>
            <Btn kind="teal" onClick={connect}>
              Connect to corridor
            </Btn>
          </>
        ) : (
          <Badge kind="ok">✔ connected to walk network</Badge>
        )}
      </div>
      <div className="mt-2 rounded border border-slate-200 bg-white p-2" data-testid="doors-panel">
        <h4 className="text-xs font-bold text-slate-600">Doors ({roomDoors(r).length})</h4>
        {roomDoors(r).map((d, i) => (
          <div key={i} className="mt-1 flex items-center gap-2 text-xs">
            <span>
              Door {i + 1}
              {d.side ? ` · ${d.side} wall` : ""} · ({d.x}, {d.y})
            </span>
            {roomDoors(r).length > 1 && (
              <button
                className="text-red-600 underline"
                onClick={() => {
                  const res = ops.deleteDoor(v, id, i);
                  if ("error" in res) return alert(res.error);
                  commit(res);
                }}
              >
                remove
              </button>
            )}
          </div>
        ))}
        <p className="mt-1 text-[11px] text-slate-500">Door tool (D): click a wall to add a door, click a door to remove it, Shift+click to move the nearest door.</p>
        <label className="mt-1 flex items-center gap-1 text-xs">
          <input type="checkbox" checked={!!r.passThrough} onChange={(e) => set({ passThrough: e.target.checked })} /> People may walk through this room between its doors (a passage)
        </label>
      </div>
      <Field label="Name">
        <CommitInput value={r.name} onCommit={(x) => set({ name: String(x) })} />
      </Field>
      <Field label="Short label on map">
        <CommitInput value={r.short ?? ""} onCommit={(x) => set({ short: String(x) || null })} />
      </Field>
      <Grid2>
        <Field label="Category">
          <select className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm" value={r.cat} onChange={(e) => set({ cat: e.target.value as Room["cat"] })}>
            {CAT_IDS.map((k) => (
              <option key={k} value={k}>
                {CATS[k].icon} {CATS[k].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Room type">
          <select
            className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            value={r.kind ?? ""}
            onChange={(e) => {
              const k = e.target.value;
              if (k) set({ kind: k as "lift" | "stairs" });
              else {
                const next = ops.updateRoom(v, id, {});
                const room = next.rooms.find((x) => x.id === id)!;
                delete room.kind;
                commit(next);
              }
            }}
          >
            <option value="">Normal room</option>
            <option value="lift">Lift lobby</option>
            <option value="stairs">Staircase</option>
          </select>
        </Field>
        <Field label="Opening hours">
          <CommitInput value={r.hours} onCommit={(x) => set({ hours: String(x) })} />
        </Field>
        <Field label="Access">
          <select className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm" value={r.access} onChange={(e) => set({ access: e.target.value as Room["access"] })}>
            <option value="public">Public</option>
            <option value="staff">Staff only</option>
          </select>
        </Field>
      </Grid2>
      <Field label="Search aliases (comma-separated; Hinglish / Telugu welcome)">
        <CommitInput value={r.aliases.join(", ")} onCommit={(x) => set({ aliases: String(x).split(",").map((a) => a.trim()).filter(Boolean) })} />
      </Field>
      <h4 className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-500">Position and size (m)</h4>
      <div className="grid grid-cols-4 gap-1">
        {(["x", "y", "w", "h"] as const).map((k) => (
          <Field key={k} label={k.toUpperCase()}>
            <CommitInput type="number" step={0.5} value={r[k]} min={k === "w" || k === "h" ? 1.5 : undefined} onCommit={(x) => set({ [k]: Number(x) } as Partial<Room>)} />
          </Field>
        ))}
      </div>
      <DeleteBtn
        onClick={() => {
          commit(ops.deleteItem(v, { type: "room", id }));
          select(null);
        }}
      >
        Delete room
      </DeleteBtn>
    </div>
  );
}

/* ------------------------------------------------------------------ marker */

function MarkerProps({ venue: v, id, commit, select }: PanelProps & { id: number }) {
  const m = v.markers.find((x) => x.id === id);
  if (!m) return <p className="text-sm text-slate-500">Marker not found.</p>;
  const used = new Set(v.markers.map((x) => x.id));
  const free = Array.from({ length: DICT_SIZE }, (_, i) => i).filter((i) => i === id || !used.has(i));
  const set = (patch: Partial<typeof m>) => commit(ops.updateMarker(v, id, patch));
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-2xl">▣</span>
        <h3 className="text-lg font-bold">Marker {m.id}</h3>
      </div>
      <p className="text-xs text-slate-500">{floorName(v, m.floor)} · printed ArUco code, black square {Math.round(m.sizeM * 1000)} mm</p>
      <Field label="Name / location">
        <CommitInput value={m.name} onCommit={(x) => set({ name: String(x) })} />
      </Field>
      <Grid2>
        <Field label="ArUco ID" hint="Printed code. Changing it means reprinting.">
          <select
            className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            value={m.id}
            onChange={(e) => {
              const nid = Number(e.target.value);
              set({ id: nid });
              select({ type: "marker", id: String(nid) });
            }}
          >
            {free.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Black square (m)" hint="Must match the printed size.">
          <CommitInput type="number" step={0.01} min={0.03} value={m.sizeM} onCommit={(x) => set({ sizeM: Number(x) })} />
        </Field>
      </Grid2>
      <div className="mt-1 flex flex-wrap gap-1">
        {SIZE_PRESETS.map((sz) => (
          <button key={sz} className={`rounded border px-1.5 text-xs ${sz === m.sizeM ? "border-blue-600 bg-blue-50" : "border-slate-300 bg-white"}`} onClick={() => set({ sizeM: sz })}>
            {sz * 1000} mm
          </button>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1">
        <Field label="X (m)">
          <CommitInput type="number" step={0.5} value={m.x} onCommit={(x) => set({ x: Number(x) })} />
        </Field>
        <Field label="Y (m)">
          <CommitInput type="number" step={0.5} value={m.y} onCommit={(x) => set({ y: Number(x) })} />
        </Field>
        <Field label="Height (m)">
          <CommitInput type="number" step={0.1} value={m.z} onCommit={(x) => set({ z: Number(x) })} />
        </Field>
      </div>
      <Field label={`Faces (bearing ${m.normal}°, 0 = north, clockwise)`}>
        <div className="flex gap-1">
          {DIRS.map(([deg, label]) => (
            <button key={deg} className={`flex-1 rounded border px-1 py-1 text-xs ${deg === m.normal ? "border-blue-600 bg-blue-50 font-bold" : "border-slate-300 bg-white"}`} onClick={() => set({ normal: deg })}>
              {label}
            </button>
          ))}
          <div className="w-16">
            <CommitInput type="number" min={0} max={359} value={m.normal} onCommit={(x) => set({ normal: ((Number(x) % 360) + 360) % 360 })} />
          </div>
        </div>
      </Field>
      <Field label="Placement note for the installer">
        <CommitInput value={m.note} onCommit={(x) => set({ note: String(x) })} />
      </Field>
      <p className="mt-2 text-xs text-slate-500">
        Visitors who scan this get: floor <b>{floorName(v, m.floor)}</b>, position ±0.3 m and the direction they face.
      </p>
      <div className="mt-3 flex gap-2">
        <a className="rounded border border-slate-300 bg-white px-2.5 py-1 text-sm font-medium hover:bg-slate-50" href={`/markers?id=${m.id}&draft=1`} target="_blank" rel="noreferrer">
          🖨 Print this marker
        </a>
      </div>
      <DeleteBtn
        onClick={() => {
          commit(ops.deleteItem(v, { type: "marker", id: String(m.id) }));
          select(null);
        }}
      >
        Delete marker
      </DeleteBtn>
    </div>
  );
}

/* ------------------------------------------------------------------ ad wall */

function WallProps({ venue: v, id, commit, select }: PanelProps & { id: string }) {
  const w = v.walls.find((x) => x.id === id);
  if (!w) return <p className="text-sm text-slate-500">Ad wall not found.</p>;
  const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
  const set = (patch: Partial<typeof w>) => commit(ops.updateWall(v, id, patch));
  const setWidth = (width: number) => {
    const cx = (w.x1 + w.x2) / 2;
    const cy = (w.y1 + w.y2) / 2;
    const ux = len > 0 ? (w.x2 - w.x1) / len : 1;
    const uy = len > 0 ? (w.y2 - w.y1) / len : 0;
    const r = (n: number) => Math.round(n * 100) / 100;
    set({ x1: r(cx - (ux * width) / 2), y1: r(cy - (uy * width) / 2), x2: r(cx + (ux * width) / 2), y2: r(cy + (uy * width) / 2) });
  };
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-2xl">🖼️</span>
        <h3 className="text-lg font-bold">Ad wall {w.id}</h3>
      </div>
      <p className="text-xs text-slate-500">
        {floorName(v, w.floor)} · {len.toFixed(1)} m wide × {w.height} m high
      </p>
      <Field label="Label">
        <CommitInput value={w.label} onCommit={(x) => set({ label: String(x) })} />
      </Field>
      <Grid2>
        <Field label="Width (m)">
          <CommitInput type="number" step={0.1} min={0.5} value={Math.round(len * 10) / 10} onCommit={(x) => setWidth(Number(x))} />
        </Field>
        <Field label="Height (m)">
          <CommitInput type="number" step={0.1} min={0.3} value={w.height} onCommit={(x) => set({ height: Number(x) })} />
        </Field>
        <Field label="Bottom edge above floor (m)">
          <CommitInput type="number" step={0.1} value={w.bottom} onCommit={(x) => set({ bottom: Number(x) })} />
        </Field>
        <Field label="Faces">
          <select className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm" value={w.normal} onChange={(e) => set({ normal: Number(e.target.value) })}>
            {DIRS.map(([deg, label]) => (
              <option key={deg} value={deg}>
                {label}
              </option>
            ))}
            {!DIRS.some(([d]) => d === w.normal) && <option value={w.normal}>{w.normal}°</option>}
          </select>
        </Field>
      </Grid2>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={w.approved} onChange={(e) => set({ approved: e.target.checked })} />
        Venue owner approved this wall for ads
      </label>
      <DeleteBtn
        onClick={() => {
          commit(ops.deleteItem(v, { type: "wall", id }));
          select(null);
        }}
      >
        Delete ad wall
      </DeleteBtn>
    </div>
  );
}

/* ------------------------------------------------------------------ poi / node */

function PoiProps({ venue: v, id, commit, select }: PanelProps & { id: string }) {
  const p = v.pois.find((x) => x.id === id);
  if (!p) return <p className="text-sm text-slate-500">POI not found.</p>;
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-2xl">{POI_KINDS[p.kind].icon}</span>
        <h3 className="text-lg font-bold">{p.name}</h3>
      </div>
      <p className="text-xs text-slate-500">
        {floorName(v, p.floor)} · ({p.x}, {p.y})
      </p>
      <Field label="Name">
        <CommitInput value={p.name} onCommit={(x) => commit(ops.updatePoi(v, id, { name: String(x) }))} />
      </Field>
      <Field label="Kind">
        <select className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm" value={p.kind} onChange={(e) => commit(ops.updatePoi(v, id, { kind: e.target.value as PoiKind }))}>
          {POI_KIND_IDS.map((k) => (
            <option key={k} value={k}>
              {POI_KINDS[k].icon} {POI_KINDS[k].label}
            </option>
          ))}
        </select>
      </Field>
      <DeleteBtn
        onClick={() => {
          commit(ops.deleteItem(v, { type: "poi", id }));
          select(null);
        }}
      >
        Delete POI
      </DeleteBtn>
    </div>
  );
}

function ObjectProps({ venue: v, id, commit, select }: PanelProps & { id: string }) {
  const o = v.objects.find((x) => x.id === id);
  if (!o) return <p className="text-sm text-slate-500">Item not found.</p>;
  const k = OBJECT_KINDS[o.kind];
  const set = (patch: Partial<typeof o>) => commit(ops.updateObject(v, id, patch));
  return (
    <div data-testid="object-panel">
      <div className="flex items-center gap-2">
        <span className="text-2xl">{k.icon}</span>
        <h3 className="text-lg font-bold">{o.label || k.label}</h3>
      </div>
      <p className="text-xs text-slate-500">
        {floorName(v, o.floor)} · {o.w}×{o.h} m · id {o.id}. Furniture is only drawn on the map; routes ignore it.
      </p>
      <Field label="Kind">
        <select className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm" value={o.kind} onChange={(e) => set({ kind: e.target.value as ObjectKind })}>
          {OBJECT_KIND_IDS.map((x) => (
            <option key={x} value={x}>
              {OBJECT_KINDS[x].icon} {OBJECT_KINDS[x].label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Label (shown when you hover it)">
        <CommitInput value={o.label} placeholder="e.g. Bed A" onCommit={(x) => set({ label: String(x) })} />
      </Field>
      <Grid2>
        <Field label="Width (m)">
          <CommitInput type="number" step={0.1} min={0.2} value={o.w} onCommit={(x) => set({ w: Math.max(0.2, Number(x)) })} />
        </Field>
        <Field label="Depth (m)">
          <CommitInput type="number" step={0.1} min={0.2} value={o.h} onCommit={(x) => set({ h: Math.max(0.2, Number(x)) })} />
        </Field>
        <Field label="Rotation (°)">
          <CommitInput type="number" step={1} value={o.rotation} onCommit={(x) => set({ rotation: ((Number(x) % 360) + 360) % 360 })} />
        </Field>
        <Field label="Centre x, y (m)">
          <div className="flex gap-1">
            <CommitInput type="number" step={0.1} value={o.x} onCommit={(x) => set({ x: Number(x) })} />
            <CommitInput type="number" step={0.1} value={o.y} onCommit={(x) => set({ y: Number(x) })} />
          </div>
        </Field>
      </Grid2>
      <DeleteBtn
        onClick={() => {
          commit(ops.deleteItem(v, { type: "object", id }));
          select(null);
        }}
      >
        Delete item
      </DeleteBtn>
    </div>
  );
}

function EdgeProps({ venue: v, id, commit, select }: PanelProps & { id: string }) {
  const e = ops.findEdge(v, id);
  const a = e && ops.findNode(v, e.a);
  const b = e && ops.findNode(v, e.b);
  if (!e || !a || !b) return <p className="text-sm text-slate-500">Corridor line not found.</p>;
  const len = Math.hypot(a.x - b.x, a.y - b.y);
  return (
    <div>
      <h3 className="text-lg font-bold">Corridor line</h3>
      <p className="text-xs text-slate-500">
        {floorName(v, a.floor)} · {len.toFixed(1)} m · from ({a.x}, {a.y}) to ({b.x}, {b.y})
      </p>
      <Field label="Width (m)" hint={`Drawn on the map and used by step counting. Empty = default ${CORRIDOR_W} m.`}>
        <CommitInput type="number" step={0.1} min={0.5} value={e.width ?? CORRIDOR_W} onCommit={(x) => commit(ops.setEdgeWidth(v, id, Number(x)))} />
      </Field>
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn
          onClick={() => {
            const r = ops.insertNodeOnEdge(v, id);
            if ("error" in r) return;
            commit(r.venue);
            select({ type: "node", id: r.nodeId });
          }}
        >
          ➕ Add a bend in the middle
        </Btn>
      </div>
      <p className="mt-2 text-xs text-slate-500">Drag the white dot to bend the line. Alt+drag moves the whole connected corridor.</p>
      <DeleteBtn
        onClick={() => {
          commit(ops.deleteItem(v, { type: "edge", id }));
          select(null);
        }}
      >
        Delete this line
      </DeleteBtn>
    </div>
  );
}

function NodeProps({ venue: v, id, commit, select }: PanelProps & { id: string }) {
  const n = v.nodes.find((x) => x.id === id);
  if (!n) return <p className="text-sm text-slate-500">Node not found.</p>;
  const links = v.edges.filter((e) => e.a === id || e.b === id);
  return (
    <div>
      <h3 className="text-lg font-bold">Walk node</h3>
      <p className="text-xs text-slate-500">
        {n.kind} · {floorName(v, n.floor)} · ({n.x}, {n.y}) · {links.length} link(s)
      </p>
      <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
        {links.map((e, i) => (
          <li key={i}>
            {e.type}: {e.a === id ? e.b : e.a}
            <button className="ml-2 text-red-600 underline" onClick={() => commit({ ...v, edges: v.edges.filter((x) => x !== e) })}>
              unlink
            </button>
          </li>
        ))}
      </ul>
      <DeleteBtn
        onClick={() => {
          commit(ops.deleteItem(v, { type: "node", id }));
          select(null);
        }}
      >
        Delete node
      </DeleteBtn>
    </div>
  );
}

/* ------------------------------------------------------------------ checklist + json */

const DOT: Record<ValidationResult["level"], string> = { pass: "bg-emerald-500", warn: "bg-amber-500", fail: "bg-red-500" };
const MARK: Record<ValidationResult["level"], string> = { pass: "✓", warn: "!", fail: "✕" };

export function ChecklistPanel({ venue, serverResults }: { venue: Venue; serverResults: ValidationResult[] | null }) {
  const results = useMemo(() => validate(venue), [venue]);
  const fails = results.filter((r) => r.level === "fail").length;
  const warns = results.filter((r) => r.level === "warn").length;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Badge kind={fails ? "fail" : "ok"}>{fails ? `${fails} blocking` : "Ready to publish"}</Badge>
        {warns > 0 && <Badge kind="warn">{warns} warning(s)</Badge>}
      </div>
      {serverResults && serverResults.length > 0 && (
        <div className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
          <b>The server refused the last publish:</b>
          <ul className="mt-1 list-disc pl-4">
            {serverResults.filter((r) => r.level === "fail").map((r, i) => (
              <li key={i}>{r.title}</li>
            ))}
          </ul>
        </div>
      )}
      {results.map((r, i) => (
        <div key={i} className="flex gap-2 border-b border-slate-100 py-1.5">
          <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${DOT[r.level]}`}>{MARK[r.level]}</div>
          <div>
            <div className="text-sm font-semibold">{r.title}</div>
            <div className="text-xs text-slate-500">{r.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function JsonPanel({ venue }: { venue: Venue }) {
  const text = useMemo(() => JSON.stringify(venue, null, 1), [venue]);
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(venue, null, 2)], { type: "application/json" }));
    a.download = `${venue.id}-v${venue.version}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Btn onClick={download}>⬇ Download</Btn>
        <span className="text-xs text-slate-500">The venue package the phone loads.</span>
      </div>
      <textarea readOnly value={text} className="h-[60vh] w-full rounded border border-slate-300 bg-white p-2 font-mono text-[11px]" />
    </div>
  );
}
