import { useCallback, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

export function useLog(max = 60) {
  const [lines, setLines] = useState<string[]>([]);
  const log = useCallback(
    (msg: string) => {
      const t = new Date().toLocaleTimeString();
      setLines((l) => [`${t} ${msg}`, ...l].slice(0, max));
    },
    [max],
  );
  return { lines, log };
}

export function Readout({ label, value, warn }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-neutral-400">{label}</div>
      <div className={`font-mono text-2xl font-bold ${warn ? "text-red-400" : "text-emerald-300"}`}>{value}</div>
    </div>
  );
}

export function Btn({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={`rounded-lg bg-sky-600 px-4 py-3 text-base font-semibold text-white active:bg-sky-700 disabled:opacity-40 ${p.className ?? ""}`}
    >
      {children}
    </button>
  );
}

interface ShellProps {
  name: string;
  title: string;
  /** Called on "Save results"; its return value is written to docs/spikes/<name>.json. */
  getResults: () => Record<string, unknown>;
  log: { lines: string[] };
  children: ReactNode;
}

export default function SpikeShell({ name, title, getResults, log, children }: ShellProps) {
  const [saveMsg, setSaveMsg] = useState("");
  const saving = useRef(false);

  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    try {
      const body = {
        spike: name,
        userAgent: navigator.userAgent,
        results: getResults(),
        log: log.lines,
      };
      const r = await fetch(`/api/spikes/${name}`, { method: "POST", body: JSON.stringify(body) });
      const j = (await r.json()) as { file?: string; error?: string };
      setSaveMsg(r.ok ? `Saved ${j.file}` : `Save failed: ${j.error}`);
    } catch (e) {
      setSaveMsg(`Save failed: ${String(e)}`);
    } finally {
      saving.current = false;
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 p-4 text-neutral-100">
      <div className="mx-auto max-w-xl space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">{title}</h1>
          <Link to="/spikes" className="text-sm text-sky-400 underline">
            all spikes
          </Link>
        </div>
        {children}
        <div className="flex items-center gap-3">
          <Btn onClick={save}>Save results</Btn>
          <span className="text-sm text-neutral-300">{saveMsg}</span>
        </div>
        <div className="max-h-64 overflow-auto rounded-lg border border-neutral-800 bg-black p-2 font-mono text-xs text-neutral-300">
          {log.lines.length === 0 ? "log is empty" : log.lines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>
    </div>
  );
}
