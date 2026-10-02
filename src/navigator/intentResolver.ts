import type { Lang } from "@/core/instructions";
import { intent, type Intent } from "@/core/intent";
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
