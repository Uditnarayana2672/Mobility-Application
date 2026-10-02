/**
 * Steady timer for the laptop simulation. Background tabs throttle main-thread timers to 1 Hz (and rAF stops), which would freeze
 * the walk the moment you look at the dashboard tab. A Worker's setInterval is not throttled that way, so the tick comes from one;
 * if workers are unavailable it degrades to setInterval. The callback gets the wall-clock seconds since the previous tick (capped).
 */
export function startTicker(onTick: (dtSec: number, nowMs: number) => void, intervalMs = 50, maxDtSec = 1.5): () => void {
  let last = performance.now();
  let stopped = false;
  const fire = () => {
    if (stopped) return;
    const now = performance.now();
    const dt = Math.min(maxDtSec, (now - last) / 1000);
    last = now;
    try {
      onTick(dt, now);
    } catch (err) {
      console.error("tick failed", err); // one bad tick must not stop the walk
    }
  };

  let worker: Worker | null = null;
  let url: string | null = null;
  let fallback: ReturnType<typeof setInterval> | null = null;
  try {
    const src = `let id = setInterval(() => postMessage(0), ${Math.max(10, Math.round(intervalMs))}); onmessage = () => clearInterval(id);`;
    url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    worker = new Worker(url);
    worker.onmessage = fire;
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      if (!stopped && fallback === null) fallback = setInterval(fire, intervalMs);
    };
  } catch {
    fallback = setInterval(fire, intervalMs);
  }

  return () => {
    stopped = true;
    if (worker) {
      worker.postMessage(0);
      worker.terminate();
    }
    if (url) URL.revokeObjectURL(url);
    if (fallback !== null) clearInterval(fallback);
  };
}
