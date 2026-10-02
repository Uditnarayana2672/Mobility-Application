import type { ChannelLike } from "@/bus";

/** In-memory BroadcastChannel: a posted message reaches every *other* channel on the same hub. */
export class FakeHub {
  readonly channels = new Set<FakeChannel>();
  create(): FakeChannel {
    return new FakeChannel(this);
  }
}

export class FakeChannel implements ChannelLike {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  closed = false;
  constructor(private readonly hub: FakeHub) {
    hub.channels.add(this);
  }
  postMessage(data: unknown): void {
    for (const c of this.hub.channels) if (c !== this && !c.closed) c.onmessage?.({ data: structuredClone(data) });
  }
  close(): void {
    this.closed = true;
    this.hub.channels.delete(this);
  }
}

export class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}
