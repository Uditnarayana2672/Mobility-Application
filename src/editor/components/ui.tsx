import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

/**
 * Text/number input that edits locally and COMMITS on blur or Enter, so typing a name is one undo step, not one per keystroke.
 */
export function CommitInput({
  value,
  onCommit,
  type = "text",
  step,
  min,
  max,
  className = "",
  placeholder,
  id,
}: {
  value: string | number;
  onCommit: (v: string | number) => void;
  type?: "text" | "number";
  step?: number;
  min?: number;
  max?: number;
  className?: string;
  placeholder?: string;
  id?: string;
}) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);
  const commit = () => {
    if (local === String(value)) return;
    if (type === "number") {
      const n = Number(local);
      if (local.trim() === "" || !Number.isFinite(n)) return setLocal(String(value));
      onCommit(n);
    } else onCommit(local);
  };
  return (
    <input
      id={id}
      type={type}
      step={step}
      min={min}
      max={max}
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setLocal(String(value));
        e.stopPropagation(); // keep editor shortcuts out of text fields
      }}
      className={`w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 ${className}`}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="mt-2 block text-xs font-semibold text-slate-600">
      {label}
      <div className="mt-0.5 font-normal">{children}</div>
      {hint && <div className="mt-0.5 text-[11px] font-normal text-slate-500">{hint}</div>}
    </label>
  );
}

export function Grid2({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-2">{children}</div>;
}

type BadgeKind = "ok" | "warn" | "fail" | "info" | "gray";
const BADGE: Record<BadgeKind, string> = {
  ok: "bg-emerald-100 text-emerald-800",
  warn: "bg-amber-100 text-amber-800",
  fail: "bg-red-100 text-red-800",
  info: "bg-sky-100 text-sky-800",
  gray: "bg-slate-200 text-slate-700",
};
export function Badge({ kind = "gray", children }: { kind?: BadgeKind; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE[kind]}`}>{children}</span>;
}

type BtnKind = "default" | "primary" | "danger" | "ghost" | "teal";
const BTN: Record<BtnKind, string> = {
  default: "border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
  primary: "border-blue-700 bg-blue-600 text-white hover:bg-blue-700",
  danger: "border-red-300 bg-white text-red-700 hover:bg-red-50",
  ghost: "border-transparent bg-transparent text-slate-700 hover:bg-slate-100",
  teal: "border-teal-700 bg-teal-600 text-white hover:bg-teal-700",
};
export function Btn({ kind = "default", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: BtnKind }) {
  return <button {...p} className={`rounded border px-2.5 py-1 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${BTN[kind]} ${className}`} />;
}

export interface ToastMsg {
  id: number;
  text: string;
  kind: "info" | "error";
}

export function Toasts({ items }: { items: ToastMsg[] }) {
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((t) => (
        <div key={t.id} className={`rounded-lg px-4 py-2 text-sm font-medium text-white shadow-lg ${t.kind === "error" ? "bg-red-600" : "bg-slate-800"}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
