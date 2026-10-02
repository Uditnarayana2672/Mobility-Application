import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { validate } from "@/core/validate";
import type { ValidationResult, Venue } from "@/core/schema";
import { MapCanvas, type MapHandle, type MapItem } from "@/ui/map";
import { DEFAULT_VENUE_ID, fetchSample, loadVenue, publishVenue } from "./api";
import { HintBar, Legend, LayerBar, ScaleModal, SubBar, ToolOverlay, ToolPalette } from "./components/Chrome";
import { ChecklistPanel, JsonPanel, PropertiesPanel } from "./components/Panels";
import { Btn, Toasts, type ToastMsg } from "./components/ui";
import * as ops from "./ops";
import { initialState, reducer, type Action, type EditorState, type Selection } from "./store";
import { TOOL_LIST, createTool, type Host, type Overlay, type Tool } from "./tools";
import { useAutosave } from "./useAutosave";

type Boot = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; venue: Venue; hasDraft: boolean };
type Tab = "props" | "check" | "json";

/** /editor: loads the draft (or published) venue from the server, then hands over to the Editor. */
export default function EditorPage() {
  const venueId = useMemo(() => new URLSearchParams(window.location.search).get("venue") ?? DEFAULT_VENUE_ID, []);
  const [boot, setBoot] = useState<Boot>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setBoot({ status: "loading" });
    loadVenue(venueId).then(
      (r) => live && setBoot({ status: "ready", venue: r.venue, hasDraft: r.hasDraft }),
      (e: unknown) => live && setBoot({ status: "error", message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [venueId, attempt]);

  if (boot.status === "loading") return <div className="flex h-screen items-center justify-center text-slate-500">Loading venue…</div>;
  if (boot.status === "error")
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="max-w-lg text-red-700">{boot.message}</p>
        <Btn kind="primary" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </Btn>
      </div>
    );
  return <Editor initial={boot.venue} initialHasDraft={boot.hasDraft} />;
}

function Editor({ initial, initialHasDraft }: { initial: Venue; initialHasDraft: boolean }) {
  const [state, rawDispatch] = useReducer(reducer, initial, initialState);
  // The ref is updated synchronously by dispatch so tools see their own commits immediately.
  const stateRef = useRef<EditorState>(state);
  stateRef.current = state;
  const dispatch = useCallback((a: Action) => {
    stateRef.current = reducer(stateRef.current, a);
    rawDispatch(a);
  }, []);

  const [cleanRev, setCleanRev] = useState<number | null>(initialHasDraft ? null : 0);
  const [tab, setTab] = useState<Tab>("props");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [status, setStatus] = useState("");
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [scaleReq, setScaleReq] = useState<{ floorId: string; a: ops.Pt; b: ops.Pt } | null>(null);
  const [serverResults, setServerResults] = useState<ValidationResult[] | null>(null);
  const [publishing, setPublishing] = useState(false);
  const mapRef = useRef<MapHandle>(null);
  const toastId = useRef(0);

  const autosave = useAutosave(state.venue, state.rev);
  const hasDraft = cleanRev === null || state.rev > cleanRev;
  const results = useMemo(() => validate(state.venue), [state.venue]);
  const failCount = results.filter((r) => r.level === "fail").length;

  const notify = useCallback((text: string, kind: "info" | "error" = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, kind }]); // at most 3 on screen
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 5000 : 3000);
  }, []);

  const host = useMemo<Host>(
    () => ({
      venue: () => stateRef.current.venue,
      floorId: () => stateRef.current.floorId,
      selected: () => stateRef.current.selected,
      poiKind: () => stateRef.current.poiKind,
      verticalKind: () => stateRef.current.verticalKind,
      commit: (venue) => dispatch({ type: "commit", venue }),
      preview: (venue) => dispatch({ type: "preview", venue }),
      commitPending: () => dispatch({ type: "commitPending" }),
      select: (selection) => {
        dispatch({ type: "select", selection });
        if (selection) setTab("props");
      },
      setOverlay,
      status: setStatus,
      toast: notify,
      scale: () => mapRef.current?.getScale() ?? 8,
      requestScale: setScaleReq,
    }),
    [dispatch, notify],
  );

  /* ---- tool lifecycle ---- */
  const toolRef = useRef<Tool>(createTool("select"));
  useEffect(() => {
    toolRef.current.cancel(host);
    toolRef.current = createTool(state.tool);
    setOverlay(null);
    setStatus("");
    if (state.tool === "vertical") toolRef.current.cancel(host); // prints the first instruction
  }, [state.tool, host]);
  useEffect(() => {
    // Switching floors ends a half-drawn walk chain, but a lift/stairs link is picked across floors.
    if (stateRef.current.tool !== "vertical") toolRef.current.cancel(host);
  }, [state.floorId, host]);

  const deleteSelected = useCallback(() => {
    const s = stateRef.current.selected;
    if (!s || s.type === "floor") return;
    dispatch({ type: "commit", venue: ops.deleteItem(stateRef.current.venue, s) });
    dispatch({ type: "select", selection: null });
  }, [dispatch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
      } else if (e.key === "Escape") toolRef.current.cancel(host);
      else if (e.key === "Enter") toolRef.current.finish?.(host);
      else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
      else if (!mod) {
        const tool = TOOL_LIST.find((x) => x.key === e.key.toLowerCase());
        if (tool) dispatch({ type: "setTool", tool: tool.id });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, host, deleteSelected]);

  /* ---- actions ---- */
  const commit = useCallback((venue: Venue) => dispatch({ type: "commit", venue }), [dispatch]);
  const select = useCallback((selection: Selection) => dispatch({ type: "select", selection }), [dispatch]);

  const addFloor = () => {
    const r = ops.addFloor(state.venue);
    commit(r.venue);
    dispatch({ type: "setFloor", id: r.id });
    notify(`Added ${r.id}. Draw its walk path and rooms, then link it with a lift or stairs.`);
  };

  const startBlank = () => {
    if (!window.confirm("Replace everything with a blank one-floor venue? You can undo this.")) return;
    commit(ops.blankVenue(state.venue));
  };
  const loadSample = async () => {
    if (!window.confirm("Replace the venue with the sample office? You can undo this.")) return;
    try {
      commit({ ...(await fetchSample(state.venue.id)), status: "draft" });
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const publish = async () => {
    if (failCount) {
      setTab("check");
      notify(`Cannot publish: ${failCount} blocking issue(s)`, "error");
      return;
    }
    setPublishing(true);
    try {
      await autosave.flush();
      const r = await publishVenue(stateRef.current.venue);
      if (!r.ok) {
        setServerResults(r.results);
        setTab("check");
        notify(`Publish refused: ${r.error}`, "error");
        return;
      }
      setServerResults(null);
      const fresh = await loadVenue(stateRef.current.venue.id);
      dispatch({ type: "load", venue: fresh.venue });
      autosave.markSaved(0);
      setCleanRev(0);
      notify(`🚀 Published v${r.version}: the visitor app now uses this map`);
    } catch (e) {
      notify(`Publish failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setPublishing(false);
    }
  };

  const applyScale = (metres: number) => {
    if (!scaleReq) return;
    const r = ops.calibrateBackground(state.venue, scaleReq.floorId, scaleReq.a, scaleReq.b, metres);
    if ("error" in r) notify(r.error, "error");
    else {
      commit(r);
      notify(`Calibrated: the drawn line is now ${metres} m`);
    }
    setScaleReq(null);
    setOverlay(null);
  };

  const selectedItem: MapItem | null = state.selected && state.selected.type !== "floor" ? state.selected : null;
  const activeTool = TOOL_LIST.find((t) => t.id === state.tool)!;
  const hint = toolRef.current.id === state.tool ? toolRef.current.hint : createTool(state.tool).hint;

  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-900">
      <SubBar
        venue={state.venue}
        floorId={state.floorId}
        hasDraft={hasDraft}
        save={autosave}
        canUndo={state.past.length > 0 || !!state.pending}
        canRedo={state.future.length > 0}
        failCount={failCount}
        publishing={publishing}
        onFloor={(id) => dispatch({ type: "setFloor", id })}
        onAddFloor={addFloor}
        onUndo={() => dispatch({ type: "undo" })}
        onRedo={() => dispatch({ type: "redo" })}
        onValidate={() => setTab("check")}
        onPublish={() => void publish()}
        onBlank={startBlank}
        onSample={() => void loadSample()}
      />
      <div className="grid min-h-0 flex-1 grid-cols-[76px_minmax(0,1fr)_380px]">
        <ToolPalette tool={state.tool} onTool={(tool) => dispatch({ type: "setTool", tool })} />
        <div className="relative min-w-0">
          <MapCanvas
            ref={mapRef}
            venue={state.venue}
            floorId={state.floorId}
            layers={state.layers}
            selected={selectedItem}
            minScale={3}
            maxScale={60}
            cursor={state.tool === "select" ? undefined : "crosshair"}
            onPointer={(phase, pt, ev) => toolRef.current.onPointer(phase, pt, ev, host)}
            onSelect={(item, pt) => toolRef.current.onSelect(item, pt, host)}
          >
            {(view) => <ToolOverlay view={view} overlay={overlay} tool={state.tool} venue={state.venue} floorId={state.floorId} />}
          </MapCanvas>
          <LayerBar
            layers={state.layers}
            tool={state.tool}
            poiKind={state.poiKind}
            verticalKind={state.verticalKind}
            onLayer={(name, on) => dispatch({ type: "setLayer", name, on })}
            onPoiKind={(kind) => dispatch({ type: "setPoiKind", kind })}
            onVerticalKind={(kind) => {
              dispatch({ type: "setVerticalKind", kind });
              toolRef.current.cancel(host);
            }}
          />
          <HintBar
            hint={`${activeTool.icon} ${activeTool.label}: ${hint}`}
            status={status}
            canFinish={state.tool === "walk" || (state.tool === "vertical" && state.verticalKind === "lift")}
            onFinish={() => toolRef.current.finish?.(host)}
            onCancel={() => toolRef.current.cancel(host)}
          />
          <Legend />
        </div>
        <aside className="flex min-h-0 flex-col border-l border-slate-200 bg-slate-50">
          <div className="flex border-b border-slate-200 bg-white">
            {(
              [
                ["props", "Properties"],
                ["check", "Checklist"],
                ["json", "Venue JSON"],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} className={`flex-1 border-b-2 px-2 py-2.5 text-sm font-bold ${tab === k ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}>
                {label}
                {k === "check" && failCount > 0 && <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white">{failCount}</span>}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {tab === "props" && <PropertiesPanel venue={state.venue} floorId={state.floorId} selected={state.selected} commit={commit} select={select} notify={notify} />}
            {tab === "check" && <ChecklistPanel venue={state.venue} serverResults={serverResults} />}
            {tab === "json" && <JsonPanel venue={state.venue} />}
          </div>
        </aside>
      </div>
      {scaleReq && (
        <ScaleModal
          drawnMetres={Math.hypot(scaleReq.b.x - scaleReq.a.x, scaleReq.b.y - scaleReq.a.y)}
          onCancel={() => {
            setScaleReq(null);
            setOverlay(null);
          }}
          onApply={applyScale}
        />
      )}
      <Toasts items={toasts} />
    </div>
  );
}
