import type { Bus, BusMessage, BusMeta, BusPayload, BusSnapshot, BusType, PosePayload, RoutePayload } from "./types";

export const CHANNEL = "indore-spaces";
/** Device id reported for everything that arrives over BroadcastChannel (one simulated phone). */
export const LOCAL_DEVICE = "local";
const LS_POSE = "is.live.pose";
const LS_ROUTE = "is.live.route";

interface Wire {
  id: string;
  /** Sender timestamp. */
  t: number;
  msg: BusMessage;
}

/** The slice of BroadcastChannel we use; lets tests inject a fake. */
export interface ChannelLike {
  postMessage(data: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  close(): void;
}

export interface BroadcastBusOptions {
  channel?: ChannelLike | null;
  /** Storage used to hydrate late joiners (default: window.localStorage when available). */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
}

function defaultStorage(): BroadcastBusOptions["storage"] {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function defaultChannel(): ChannelLike | null {
  try {
    return typeof BroadcastChannel === "undefined" ? null : (new BroadcastChannel(CHANNEL) as unknown as ChannelLike);
  } catch {
    return null;
  }
}

let counter = 0;
const newId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Same-browser bus for the laptop simulation (/nav tab -> /dashboard tab). Messages are de-duplicated by id and the last
 * pose/route are mirrored into localStorage (best effort) so a dashboard opened after the phone view still shows something.
 */
export class BroadcastChannelBus implements Bus {
  private readonly ch: ChannelLike | null;
  private readonly store: BroadcastBusOptions["storage"];
  private readonly listeners: { [K in BusType]: Set<(p: BusPayload<K>, meta: BusMeta) => void> } = { pose: new Set(), route: new Set(), event: new Set(), venue: new Set(), campaigns: new Set() };
  private readonly seen = new Set<string>();

  constructor(opts: BroadcastBusOptions = {}) {
    this.ch = opts.channel === undefined ? defaultChannel() : opts.channel;
    this.store = opts.storage === undefined ? defaultStorage() : opts.storage;
    if (this.ch) this.ch.onmessage = (e) => this.receive(e.data);
  }

  send<T extends BusType>(type: T, payload: BusPayload<T>): void {
    const wire: Wire = { id: newId(), t: Date.now(), msg: { type, payload } as BusMessage };
    this.seen.add(wire.id);
    try {
      this.ch?.postMessage(wire);
    } catch {
      /* channel closed */
    }
    this.mirror(wire.msg);
  }

  on<T extends BusType>(type: T, fn: (payload: BusPayload<T>, meta: BusMeta) => void): () => void {
    const set = this.listeners[type] as unknown as Set<(p: BusPayload<T>, meta: BusMeta) => void>;
    set.add(fn);
    return () => set.delete(fn);
  }

  close(): void {
    if (this.ch) {
      this.ch.onmessage = null;
      this.ch.close();
    }
    for (const k of Object.keys(this.listeners) as BusType[]) this.listeners[k].clear();
  }

  /** Last pose / route written by any tab (null when storage is unavailable or empty). */
  snapshot(): BusSnapshot {
    return { pose: this.read<PosePayload>(LS_POSE), route: this.read<RoutePayload>(LS_ROUTE) };
  }

  /** Forget the mirrored state (demo reset). */
  clearSnapshot(): void {
    try {
      this.store?.removeItem(LS_POSE);
      this.store?.removeItem(LS_ROUTE);
    } catch {
      /* ignore */
    }
  }

  private receive(data: unknown): void {
    const w = data as Wire | null;
    if (!w || typeof w.id !== "string" || !w.msg || this.seen.has(w.id)) return;
    this.seen.add(w.id);
    if (this.seen.size > 300) this.seen.delete(this.seen.values().next().value as string);
    const set = this.listeners[w.msg.type] as unknown as Set<(p: unknown, meta: BusMeta) => void> | undefined;
    if (!set) return;
    const meta: BusMeta = { deviceId: LOCAL_DEVICE, recvT: Date.now() };
    for (const fn of [...set]) {
      try {
        fn(w.msg.payload, meta);
      } catch (err) {
        console.error("bus listener failed", err);
      }
    }
  }

  private mirror(msg: BusMessage): void {
    if (!this.store || (msg.type !== "pose" && msg.type !== "route")) return;
    try {
      this.store.setItem(msg.type === "pose" ? LS_POSE : LS_ROUTE, JSON.stringify(msg.payload));
    } catch {
      /* quota / private mode */
    }
  }

  private read<T>(key: string): T | null {
    try {
      const raw = this.store?.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }
}
