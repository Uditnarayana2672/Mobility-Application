import type { Lang } from "@/core/instructions";
import { intent, matchIntent, type Intent } from "@/core/intent";
import type { AssistantResponse } from "@/core/assistant";
import type { RouteFrom, RoutePrefs } from "@/core/route";
import type { Venue } from "@/core/schema";

export interface ResolveContext {
  venue: Venue;
  from: RouteFrom | null;
  prefs: Partial<RoutePrefs>;
  lang: Lang;
}

/**
 * Turns what the visitor said or typed into one of the deterministic intents. Rules first (below); an LLM-backed resolver
 * (Phase 5, server-side key) can replace or wrap this without touching the UI, because the UI only sees `Intent`.
 */
export interface IntentResolver {
  resolve(text: string, ctx: ResolveContext): Promise<Intent>;
}

export class RuleIntentResolver implements IntentResolver {
  async resolve(text: string, ctx: ResolveContext): Promise<Intent> {
    return intent(ctx.venue, text, { from: ctx.from ?? undefined, prefs: ctx.prefs });
  }
}

/** Rules first; the server-side assistant is contacted only below the confidence threshold. */
export class HybridIntentResolver implements IntentResolver {
  constructor(private readonly fetchFn: typeof fetch = fetch.bind(globalThis), private readonly threshold = 0.65) {}

  async resolve(text: string, ctx: ResolveContext): Promise<Intent> {
    const matched = matchIntent(ctx.venue, text, { from: ctx.from ?? undefined, prefs: ctx.prefs });
    if (matched.confidence >= this.threshold && matched.intent.type !== "unknown") return matched.intent;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6500);
    try {
      const res = await this.fetchFn("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueId: ctx.venue.id, text, lang: ctx.lang, from: ctx.from, prefs: ctx.prefs }),
        signal: ctl.signal,
      });
      if (!res.ok) return matched.intent;
      const out = await res.json() as AssistantResponse;
      if (out.action && out.action.type !== "unknown") return out.action;
      if (typeof out.reply === "string" && out.reply.trim()) return { type: "answer", text: out.reply.trim(), suggestions: out.suggestions?.map((s) => s.target) };
    } catch {
      // Network failure never affects deterministic commands or the rest of navigation.
    } finally {
      clearTimeout(timer);
    }
    return matched.intent;
  }
}
