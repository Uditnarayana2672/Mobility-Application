import { useMemo, useState } from "react";
import type { Venue } from "@/core/schema";
import { drawingSizeM, guessPxPerMetre, importBlueprint, readBlueprint, type BpFile, type ImportIssue } from "../blueprintImport";
import { Btn } from "./ui";

const LEVEL_STYLE: Record<ImportIssue["level"], string> = {
  fail: "border-red-300 bg-red-50 text-red-800",
  warn: "border-amber-300 bg-amber-50 text-amber-900",
  info: "border-slate-200 bg-slate-50 text-slate-700",
};

/** "Import Blueprint file": pick the export of the old Blueprint editor, confirm the scale, review what was understood, replace the drawing. */
export function ImportBlueprintDialog({ current, onApply, onClose }: { current: Venue; onApply(v: Venue): void; onClose(): void }) {
  const [file, setFile] = useState<BpFile | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [scale, setScale] = useState(50);

  const load = async (f: File | undefined) => {
    if (!f) return;
    setError("");
    try {
      const parsed = readBlueprint(JSON.parse(await f.text()));
      if (!parsed.ok) {
        setFile(null);
        setError(parsed.error);
        return;
      }
      setFile(parsed.file);
      setFileName(f.name);
      setScale(guessPxPerMetre(parsed.file));
    } catch {
      setFile(null);
      setError("That file is not valid JSON.");
    }
  };

  const result = useMemo(() => (file && scale > 0 ? importBlueprint(file, { id: current.id, name: current.name, type: current.type, city: current.city, address: current.address, pxPerMetre: scale }) : null), [file, scale, current]);
  const size = file && scale > 0 ? drawingSizeM(file, scale) : null;
  const fails = result?.issues.filter((i) => i.level === "fail" && !/no markers/i.test(i.title)).length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-label="Import a Blueprint file" data-testid="import-dialog">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base font-extrabold">Import a Blueprint file</h2>
          <button className="text-xl leading-none text-slate-500" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="space-y-3 overflow-auto p-4 text-sm">
          <p className="text-slate-600">
            Choose the <b>.json</b> you exported from the Blueprint editor. Rooms, hallways, entries (doors), lifts and points of interest are turned into this map’s rooms, walk paths with width, doors and entrances. Your current drawing is replaced (you can undo).
          </p>
          <input type="file" accept="application/json,.json" data-testid="import-file" onChange={(e) => void load(e.target.files?.[0])} />
          {error && <div className="rounded border border-red-300 bg-red-50 p-2 text-red-800">{error}</div>}
          {file && result && size && (
            <>
              <div className="rounded border border-slate-200 p-3">
                <div className="font-bold">{fileName}</div>
                <div className="text-slate-600">
                  {file.floors.length} floor(s), {file.elements.length} items
                </div>
                <label className="mt-2 flex flex-wrap items-center gap-2">
                  <b>Scale:</b>
                  <input type="number" min={5} max={500} step={1} value={scale} data-testid="import-scale" onChange={(e) => setScale(Number(e.target.value))} className="w-24 rounded border border-slate-300 px-2 py-1" />
                  <span>Blueprint pixels per real metre</span>
                </label>
                <div className="mt-1 text-slate-700" data-testid="import-size">
                  At this scale the drawing is <b>{size.w} m × {size.h} m</b>. Does that match the real place? If not, change the scale (a door is about 1 m wide).
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center" data-testid="import-stats">
                {[
                  ["Rooms", result.stats.rooms],
                  ["Corridors", result.stats.corridors],
                  ["Doors", result.stats.doors],
                  ["Entrances", result.stats.entrances],
                  ["Lift links", result.stats.lifts],
                  ["Skipped", result.stats.skipped],
                ].map(([k, n]) => (
                  <div key={k} className="rounded border border-slate-200 p-2">
                    <div className="text-lg font-extrabold">{n}</div>
                    <div className="text-xs text-slate-500">{k}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-1" data-testid="import-issues">
                {result.issues.length === 0 && <div className="rounded border border-emerald-300 bg-emerald-50 p-2 text-emerald-800">Everything was understood.</div>}
                {result.issues.map((i, n) => (
                  <div key={n} className={`rounded border p-2 ${LEVEL_STYLE[i.level]}`}>
                    <b>{i.title}</b>
                    <div className="text-xs">{i.detail}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn
            kind="primary"
            disabled={!result || fails > 0}
            title={fails > 0 ? "Fix the blocking problems in the Blueprint file first" : "Replace the drawing with this import"}
            onClick={() => {
              if (result && window.confirm("Replace the current drawing with this import? You can undo this.")) onApply(result.venue);
            }}
          >
            Import and replace
          </Btn>
        </div>
      </div>
    </div>
  );
}
