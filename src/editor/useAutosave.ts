import { useCallback, useEffect, useRef, useState } from "react";
import type { Venue } from "@/core/schema";
import { saveDraft } from "./api";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Debounced autosave of the draft to the server. Saves after `delayMs` of quiet following a committed change (`rev` bump);
 * flush() saves immediately (used before publishing). Failed saves stay dirty and retry on the next change or flush.
 */
export function useAutosave(venue: Venue | null, rev: number, delayMs = 800) {
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const latest = useRef(venue);
  latest.current = venue;
  const savedRev = useRef(0);
  const revRef = useRef(rev);
  revRef.current = rev;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void> | null>(null);

  const save = useCallback(async () => {
    const v = latest.current;
    const at = revRef.current;
    if (!v || at === savedRev.current) return;
    setState("saving");
    const run = (async () => {
      try {
        await saveDraft(v);
        savedRev.current = Math.max(savedRev.current, at);
        setState("saved");
        setMessage("");
      } catch (e) {
        setState("error");
        setMessage(e instanceof Error ? e.message : String(e));
      }
    })();
    inflight.current = run;
    await run;
  }, []);

  useEffect(() => {
    if (!venue || rev === savedRev.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), delayMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [venue, rev, delayMs, save]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    if (inflight.current) await inflight.current;
    await save();
  }, [save]);

  /** Treat everything up to `rev` as saved (after loading from the server or publishing). */
  const markSaved = useCallback((r: number) => {
    savedRev.current = r;
    setState("idle");
    setMessage("");
  }, []);

  return { state, message, flush, markSaved };
}
