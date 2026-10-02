import type { Bus, BusMeta, BusPayload, BusType } from "./types";

export type WsStatus = "connecting" | "open" | "closed";

/** The slice of WebSocket we use; lets tests inject a fake. */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
}

export interface WebSocketBusOptions {
  room: string;
  /** "device" = a phone (its messages go to viewers only); "viewer" = a dashboard (gets a replay of every device's last state). */
  role?: "device" | "viewer";
  deviceId?: string;
  /** Full ws(s) URL without query; default: same origin /ws. */
  url?: string;
  socketFactory?: (url: string) => SocketLike;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Test hooks. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  random?: () => number;
  /** Max events held while offline. */
  maxQueuedEvents?: number;
  /** Message types this bus may send (default: all). `[]` = listen only (a simulated phone that still wants server notices). */
  sendTypes?: BusType[];
}

const OPEN = 1;

interface Wire {
  type: BusType;
  payload: unknown;
  deviceId: string;
  t: number;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** A stable id for this browser: survives reloads so the dashboard keeps one entry per phone. */
export function getDeviceId(storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): string {
  const key = "is.deviceId";
  try {
    const have = storage?.getItem(key);
    if (have) return have;
  } catch {
    /* ignore */
  }
  const id = `ph-${Math.random().toString(36).slice(2, 8)}`;
  try {
    storage?.setItem(key, id);
  } catch {
    /* ignore */
  }
  return id;
}

/**
 * Bus over the server's /ws relay (same origin, same cert). The phone publishes pose (~10 Hz), route and events; dashboards listen.
 * Reconnects with exponential backoff + jitter; while offline it keeps only the latest pose and route (plus a few events) and flushes on reconnect.
 */
export class WebSocketBus implements Bus {
  private sock: SocketLike | null = null;
  private attempt = 0;
  private timer: unknown = null;
  private closed = false;
  private st: WsStatus = "connecting";
  readonly deviceId: string;
  private readonly listeners: { [K in BusType]: Set<(p: BusPayload<K>, meta: BusMeta) => void> } = { pose: new Set(), route: new Set(), event: new Set(), venue: new Set(), campaigns: new Set(), reset: new Set() };
  private readonly statusListeners = new Set<(s: WsStatus) => void>();
  private pendingPose: Wire | null = null;
  private pendingRoute: Wire | null = null;
  private pendingEvents: Wire[] = [];
  private readonly o: WebSocketBusOptions & { role: "device" | "viewer"; baseDelayMs: number; maxDelayMs: number; maxQueuedEvents: number };

  constructor(opts: WebSocketBusOptions) {
    this.o = { role: "device", baseDelayMs: 500, maxDelayMs: 15000, maxQueuedEvents: 50, ...opts };
    this.deviceId = opts.deviceId ?? getDeviceId();
    this.connect();
  }

  get status(): WsStatus {
    return this.st;
  }
  /** Reconnect attempts since the last successful open. */
  get attempts(): number {
    return this.attempt;
  }
  onStatus(fn: (s: WsStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }
  private setStatus(s: WsStatus): void {
    if (this.st === s) return;
    this.st = s;
    for (const fn of [...this.statusListeners]) fn(s);
  }

  private url(): string {
    let base = this.o.url;
    if (!base) {
      const loc = typeof location !== "undefined" ? location : { protocol: "https:", host: "localhost" };
      base = `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/ws`;
    }
    return `${base}?room=${encodeURIComponent(this.o.room)}&role=${this.o.role}&device=${encodeURIComponent(this.deviceId)}`;
  }

  private connect(): void {
    if (this.closed) return;
    this.setStatus("connecting");
    const factory = this.o.socketFactory ?? ((u: string) => new WebSocket(u) as unknown as SocketLike);
    let s: SocketLike;
    try {
      s = factory(this.url());
    } catch {
      this.setStatus("closed");
      this.scheduleReconnect();
      return;
    }
    this.sock = s;
    s.onopen = () => {
      if (this.sock !== s) return;
      this.attempt = 0;
      this.setStatus("open");
      this.flush();
    };
    s.onmessage = (e) => this.receive(e.data);
    s.onclose = () => {
      if (this.sock !== s) return;
      this.sock = null;
      this.setStatus("closed");
      this.scheduleReconnect();
    };
    s.onerror = () => {
      /* a close always follows */
    };
  }

  /** Exponential backoff with jitter: base * 2^n, capped, scaled by 0.5..1. */
  nextDelay(): number {
    const raw = Math.min(this.o.maxDelayMs, this.o.baseDelayMs * 2 ** this.attempt);
    return Math.round(raw * (0.5 + 0.5 * (this.o.random ?? Math.random)()));
  }

  private scheduleReconnect(): void {
    if (this.closed || this.timer !== null) return;
    const ms = this.nextDelay();
    this.attempt++;
    const set = this.o.setTimer ?? ((fn: () => void, d: number) => setTimeout(fn, d));
    this.timer = set(() => {
      this.timer = null;
      this.connect();
    }, ms);
  }

  send<T extends BusType>(type: T, payload: BusPayload<T>): void {
    if (this.closed || (this.o.sendTypes && !this.o.sendTypes.includes(type))) return;
    const wire: Wire = { type, payload, deviceId: this.deviceId, t: Date.now() };
    if (this.sock && this.sock.readyState === OPEN) {
      try {
        this.sock.send(JSON.stringify(wire));
        return;
      } catch {
        /* fall through to the offline queue */
      }
    }
    if (type === "pose") this.pendingPose = wire;
    else if (type === "route") this.pendingRoute = wire;
    else if (type === "event") {
      this.pendingEvents.push(wire);
      if (this.pendingEvents.length > this.o.maxQueuedEvents) this.pendingEvents.shift();
    }
  }

  private flush(): void {
    const s = this.sock;
    if (!s || s.readyState !== OPEN) return;
    const out = [this.pendingRoute, ...this.pendingEvents, this.pendingPose].filter((w): w is Wire => w !== null);
    this.pendingRoute = null;
    this.pendingPose = null;
    this.pendingEvents = [];
    for (const w of out) s.send(JSON.stringify(w));
  }

  on<T extends BusType>(type: T, fn: (payload: BusPayload<T>, meta: BusMeta) => void): () => void {
    const set = this.listeners[type] as unknown as Set<(p: BusPayload<T>, meta: BusMeta) => void>;
    set.add(fn);
    return () => set.delete(fn);
  }

  private receive(data: unknown): void {
    let w: Wire | null = null;
    try {
      w = JSON.parse(typeof data === "string" ? data : String(data)) as Wire;
    } catch {
      return;
    }
    if (!w || typeof w.type !== "string") return;
    const set = this.listeners[w.type] as unknown as Set<(p: unknown, meta: BusMeta) => void> | undefined;
    if (!set) return;
    const meta: BusMeta = { deviceId: typeof w.deviceId === "string" ? w.deviceId : "server", recvT: Date.now() };
    for (const fn of [...set]) {
      try {
        fn(w.payload, meta);
      } catch (err) {
        console.error("bus listener failed", err);
      }
    }
  }

  close(): void {
    this.closed = true;
    if (this.timer !== null) (this.o.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
    const s = this.sock;
    this.sock = null;
    if (s) {
      s.onclose = null;
      s.onopen = null;
      s.onmessage = null;
      try {
        s.close();
      } catch {
        /* ignore */
      }
    }
    for (const k of Object.keys(this.listeners) as BusType[]) this.listeners[k].clear();
    this.setStatus("closed");
  }
}

/** Send to several buses, listen on all (BroadcastChannel for the laptop demo + WebSocket for a remote dashboard). */
export class CompositeBus implements Bus {
  constructor(private readonly buses: Bus[]) {}
  send<T extends BusType>(type: T, payload: BusPayload<T>): void {
    for (const b of this.buses) b.send(type, payload);
  }
  on<T extends BusType>(type: T, fn: (payload: BusPayload<T>, meta: BusMeta) => void): () => void {
    const offs = this.buses.map((b) => b.on(type, fn));
    return () => offs.forEach((o) => o());
  }
  close(): void {
    for (const b of this.buses) b.close();
  }
}
