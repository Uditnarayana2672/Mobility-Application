import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CATS, OBJECT_KINDS, OBJECT_KIND_IDS, POI_KINDS, POI_KIND_IDS, type ObjectKind, type PoiKind } from "@/core/cats";
import type { Venue } from "@/core/schema";
import type { MapLayers, MapView } from "@/ui/map";
import type { SaveState } from "../useAutosave";
import type { Selection, ToolId } from "../store";
import { TOOL_LIST, bgHandles, selectionHandles, type Overlay } from "../tools";
import { Badge, Btn } from "./ui";

/* ------------------------------------------------------------------ sub bar */

export interface SubBarProps {
  venue: Venue;
  floorId: string;
  hasDraft: boolean;
  save: { state: SaveState; message: string };
  canUndo: boolean;
  canRedo: boolean;
  failCount: number;
  publishing: boolean;
  onFloor(id: string): void;
  onAddFloor(): void;
  onUndo(): void;
  onRedo(): void;
  onValidate(): void;
  onPublish(): void;
  onBlank(): void;
  onSample(): void;
}

export function SubBar(p: SubBarProps) {
  const { venue: v, save } = p;
  const [menu, setMenu] = useState(false);
  const saveText =
    save.state === "saving" ? "Saving…" : save.state === "error" ? `Save failed: ${save.message}` : save.state === "saved" ? "All changes saved to draft" : p.hasDraft ? "Draft loaded" : "Published version";
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
      <Link to="/" className="mr-1 text-sm font-bold text-blue-700">
        Indore Spaces
      </Link>
      <span className="text-base font-extrabold">{v.name}</span>
      <Badge kind={p.hasDraft ? "warn" : "ok"}>{p.hasDraft ? `v${v.version} + draft` : `v${v.version} published`}</Badge>
      <div className="ml-2 inline-flex overflow-hidden rounded border border-slate-300">
        {v.floors.map((f) => (
          <button key={f.id} onClick={() => p.onFloor(f.id)} className={`px-3 py-1 text-sm font-semibold ${f.id === p.floorId ? "bg-blue-600 text-white" : "bg-white hover:bg-slate-50"}`}>
            {f.name}
          </button>
        ))}
      </div>
      <Btn kind="ghost" onClick={p.onAddFloor} title="Add a floor">
        ＋ Floor
      </Btn>
      <span className={`ml-auto text-xs ${save.state === "error" ? "font-semibold text-red-600" : "text-slate-500"}`}>{saveText}</span>
      <Btn onClick={p.onUndo} disabled={!p.canUndo} title="Ctrl+Z">
        ↶ Undo
      </Btn>
      <Btn onClick={p.onRedo} disabled={!p.canRedo} title="Ctrl+Y">
        ↷ Redo
      </Btn>
      <div className="relative">
        <Btn onClick={() => setMenu((o) => !o)} aria-haspopup="menu" aria-expanded={menu}>
          ⋯
        </Btn>
        {menu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
            <div role="menu" className="absolute right-0 z-20 mt-1 w-56 rounded border border-slate-200 bg-white p-1 shadow-lg">
              <button
                role="menuitem"
                className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100"
                onClick={() => {
                  setMenu(false);
                  p.onBlank();
                }}
              >
                Start a blank venue
              </button>
              <button
                role="menuitem"
                className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100"
                onClick={() => {
                  setMenu(false);
                  p.onSample();
                }}
              >
                Reset to the sample office
              </button>
              <Link role="menuitem" className="block rounded px-2 py-1.5 text-sm hover:bg-slate-100" to="/markers?draft=1" target="_blank" onClick={() => setMenu(false)}>
                Open marker sheet
              </Link>
              <Link role="menuitem" className="block rounded px-2 py-1.5 text-sm hover:bg-slate-100" to="/legacy-editor" onClick={() => setMenu(false)}>
                Legacy Blueprint editor
              </Link>
            </div>
          </>
        )}
      </div>
      <Btn onClick={p.onValidate}>
        ✔ Validate{p.failCount > 0 && <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white">{p.failCount}</span>}
      </Btn>
      <Btn kind="primary" onClick={p.onPublish} disabled={p.publishing} title={p.failCount ? "Fix blocking issues first" : "Publish to the visitor app"}>
        {p.publishing ? "Publishing…" : "🚀 Publish"}
      </Btn>
    </div>
  );
}

/* ------------------------------------------------------------------ tools */

export function ToolPalette({ tool, onTool }: { tool: ToolId; onTool(t: ToolId): void }) {
  return (
    <div className="flex flex-col gap-1 border-r border-slate-200 bg-white p-1.5">
      {TOOL_LIST.map((t, i) => (
        <button
          key={t.id}
          onClick={() => onTool(t.id)}
          title={`${t.label} (${t.key.toUpperCase()})`}
          className={`flex flex-col items-center rounded px-1 py-1.5 text-center ${t.id === tool ? "bg-blue-600 text-white" : "hover:bg-slate-100"} ${i === 8 ? "mt-2 border-t border-slate-200 pt-2" : ""}`}
        >
          <span className="text-lg leading-none">{t.icon}</span>
          <small className="mt-0.5 text-[10px] font-semibold leading-tight">{t.label}</small>
        </button>
      ))}
    </div>
  );
}

const LAYERS: [keyof MapLayers, string][] = [
  ["underlay", "Floor photo"],
  ["grid", "Grid"],
  ["walknet", "Walk network"],
  ["objects", "Furniture"],
  ["markers", "Markers"],
  ["walls", "Ad walls"],
  ["labels", "Labels"],
];

export function LayerBar(p: {
  snapOn: boolean;
  onSnap(on: boolean): void;
  layers: MapLayers;
  tool: ToolId;
  poiKind: PoiKind;
  objectKind: ObjectKind;
  roomShape: "rect" | "polygon";
  onRoomShape(s: "rect" | "polygon"): void;
  verticalKind: "lift" | "stairs";
  onLayer(name: keyof MapLayers, on: boolean): void;
  onPoiKind(k: PoiKind): void;
  onObjectKind(k: ObjectKind): void;
  onVerticalKind(k: "lift" | "stairs"): void;
}) {
  return (
    <div className="absolute left-2 top-2 z-10 flex flex-wrap items-center gap-x-2 rounded-lg bg-white/90 px-2 py-1 text-xs shadow">
      <label className="inline-flex cursor-pointer items-center gap-1 font-bold text-blue-800" title="Key G">
        <input type="checkbox" checked={p.snapOn} onChange={(e) => p.onSnap(e.target.checked)} data-testid="snap-toggle" />
        Snap 0.5 m
      </label>
      {LAYERS.map(([k, label]) => (
        <label key={k} className="inline-flex cursor-pointer items-center gap-1 font-semibold">
          <input type="checkbox" checked={p.layers[k]} onChange={(e) => p.onLayer(k, e.target.checked)} />
          {label}
        </label>
      ))}
      {p.tool === "poi" && (
        <select className="rounded border border-slate-300 px-1 py-0.5" value={p.poiKind} onChange={(e) => p.onPoiKind(e.target.value as PoiKind)}>
          {POI_KIND_IDS.map((k) => (
            <option key={k} value={k}>
              {POI_KINDS[k].icon} {POI_KINDS[k].label}
            </option>
          ))}
        </select>
      )}
      {p.tool === "room" && (
        <span className="inline-flex overflow-hidden rounded border border-slate-300" data-testid="room-shape">
          {(["rect", "polygon"] as const).map((k) => (
            <button key={k} className={`px-2 py-0.5 font-semibold ${p.roomShape === k ? "bg-blue-600 text-white" : "bg-white"}`} onClick={() => p.onRoomShape(k)}>
              {k === "rect" ? "▭ Rectangle" : "⬠ Free shape"}
            </button>
          ))}
        </span>
      )}
      {p.tool === "object" && (
        <select className="rounded border border-slate-300 px-1 py-0.5" data-testid="object-kind" value={p.objectKind} onChange={(e) => p.onObjectKind(e.target.value as ObjectKind)}>
          {OBJECT_KIND_IDS.map((k) => (
            <option key={k} value={k}>
              {OBJECT_KINDS[k].icon} {OBJECT_KINDS[k].label}
            </option>
          ))}
        </select>
      )}
      {p.tool === "vertical" && (
        <span className="inline-flex overflow-hidden rounded border border-slate-300">
          {(["lift", "stairs"] as const).map((k) => (
            <button key={k} className={`px-2 py-0.5 font-semibold ${p.verticalKind === k ? "bg-blue-600 text-white" : "bg-white"}`} onClick={() => p.onVerticalKind(k)}>
              {k === "lift" ? "🛗 Lift" : "🪜 Stairs"}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

export function Legend() {
  return (
    <div className="absolute bottom-2 left-2 z-10 max-w-md rounded-lg bg-white/90 p-2 text-[11px] shadow">
      {Object.values(CATS).map((c) => (
        <span key={c.label} className="mr-2 inline-block whitespace-nowrap">
          <i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: c.fill, border: `1px solid ${c.stroke}` }} />
          {c.label}
        </span>
      ))}
    </div>
  );
}

export function HintBar({ hint, status, canFinish, onFinish, onCancel }: { hint: string; status: string; canFinish: boolean; onFinish(): void; onCancel(): void }) {
  return (
    <div className="absolute bottom-2 right-2 z-10 flex max-w-md items-start gap-2 rounded-lg bg-slate-800/90 p-2 text-xs text-white shadow">
      <div>
        <div>{hint}</div>
        {status && <div className="mt-1 font-semibold text-amber-300">{status}</div>}
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        {canFinish && (
          <button className="rounded bg-emerald-600 px-2 py-0.5 font-bold" onClick={onFinish}>
            Finish ⏎
          </button>
        )}
        <button className="rounded bg-slate-600 px-2 py-0.5" onClick={onCancel}>
          Esc
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ overlay drawn in world coordinates */

export function ToolOverlay({ view, overlay, tool, venue, floorId, selected }: { view: MapView; overlay: Overlay; tool: ToolId; venue: Venue; floorId: string; selected: Selection }) {
  const px = 1 / view.scale;
  const els: React.ReactNode[] = [];
  if (overlay?.kind === "rect") {
    els.push(
      <rect key="rect" x={Math.min(overlay.a.x, overlay.b.x)} y={Math.min(overlay.a.y, overlay.b.y)} width={Math.abs(overlay.b.x - overlay.a.x)} height={Math.abs(overlay.b.y - overlay.a.y)} fill="rgba(47,91,234,.18)" stroke="#2f5bea" strokeWidth={2} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />,
    );
  }
  if (overlay?.kind === "line") {
    els.push(<line key="line" x1={overlay.a.x} y1={overlay.a.y} x2={overlay.b.x} y2={overlay.b.y} stroke={overlay.color} strokeWidth={2.5} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />);
  }
  if (overlay?.kind === "poly") {
    const pts = overlay.cursor ? [...overlay.pts, overlay.cursor] : overlay.pts;
    els.push(
      <polyline key="poly" points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="rgba(47,91,234,.14)" stroke="#2f5bea" strokeWidth={2} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />,
      ...overlay.pts.map((p, i) => <circle key={`pv${i}`} cx={p.x} cy={p.y} r={(i === 0 ? 6 : 4) * px} fill={i === 0 ? "#fff" : "#2f5bea"} stroke="#2f5bea" strokeWidth={2} vectorEffect="non-scaling-stroke" />),
    );
  }
  if (overlay?.kind === "dot") els.push(<circle key="dot" cx={overlay.at.x} cy={overlay.at.y} r={4 * px} fill="none" stroke="#0f9d8a" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />);
  if (tool === "select") {
    for (const hd of selectionHandles(venue, selected, floorId)) {
      els.push(
        hd.kind === "rrotate" ? (
          <g key="h-rrot">
            <circle cx={hd.at.x} cy={hd.at.y} r={7 * px} fill="#e8890c" stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </g>
        ) : hd.kind === "vertex" ? (
          <circle key={`h-v${hd.index}`} cx={hd.at.x} cy={hd.at.y} r={6 * px} fill="#fff" stroke="#2f5bea" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
        ) : hd.kind === "midpoint" ? (
          <circle key={`h-m${hd.index}`} cx={hd.at.x} cy={hd.at.y} r={4 * px} fill="#2f5bea" fillOpacity={0.55} stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        ) : hd.kind === "orotate" ? (
          <circle key="h-orot" cx={hd.at.x} cy={hd.at.y} r={7 * px} fill="#e8890c" stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ) : hd.kind === "oresize" ? (
          <rect key={`h-o${hd.at.x}-${hd.at.y}`} x={hd.at.x - 4 * px} y={hd.at.y - 4 * px} width={8 * px} height={8 * px} fill="#fff" stroke="#2f5bea" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ) : hd.kind === "resize" ? (
          <rect key={`h-${hd.handle}`} x={hd.at.x - 4 * px} y={hd.at.y - 4 * px} width={8 * px} height={8 * px} fill="#fff" stroke="#2f5bea" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ) : (
          <circle key="h-bend" cx={hd.at.x} cy={hd.at.y} r={6 * px} fill="#fff" stroke="#2f5bea" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ),
      );
    }
  }
  if (tool === "background") {
    const hs = bgHandles(venue, floorId);
    if (hs) {
      els.push(
        <circle key="h-scale" cx={hs.scaleHandle.x} cy={hs.scaleHandle.y} r={8 * px} fill="#2f5bea" stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />,
        <circle key="h-rot" cx={hs.rotateHandle.x} cy={hs.rotateHandle.y} r={8 * px} fill="#e8890c" stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />,
        <circle key="h-origin" cx={hs.origin.x} cy={hs.origin.y} r={4 * px} fill="#14213d" />,
      );
    }
  }
  return <g style={{ pointerEvents: "none" }}>{els}</g>;
}

/* ------------------------------------------------------------------ scale modal */

export function ScaleModal({ drawnMetres, onCancel, onApply }: { drawnMetres: number; onCancel(): void; onApply(metres: number): void }) {
  const [value, setValue] = useState(drawnMetres.toFixed(2));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);
  const m = Number(value);
  const ok = Number.isFinite(m) && m > 0;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="w-[420px] rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-lg font-bold">Calibrate scale</h3>
        <p className="mt-2 text-sm text-slate-600">
          The line you drew measures <b>{drawnMetres.toFixed(2)} m</b> at the photo's current scale. How long is it in real life?
        </p>
        <label className="mt-3 block text-xs font-semibold text-slate-600">
          Real length (metres)
          <input
            ref={input}
            type="number"
            step={0.01}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ok) onApply(m);
              if (e.key === "Escape") onCancel();
              e.stopPropagation();
            }}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-base"
          />
        </label>
        <p className="mt-2 text-xs text-slate-500">Tip: use a laser distance meter on a long corridor. The longer the reference, the smaller the error. The photo is rescaled about the first point; rooms you already drew stay where they are.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={onCancel}>Cancel</Btn>
          <Btn kind="primary" disabled={!ok} onClick={() => onApply(m)}>
            Apply scale
          </Btn>
        </div>
      </div>
    </div>
  );
}
