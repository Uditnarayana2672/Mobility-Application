import type { Lang } from "./instructions";
import type { Intent, Target } from "./intent";
import type { RouteFrom, RoutePrefs } from "./route";

export interface AssistantRequest {
  venueId: string;
  text: string;
  lang: Lang;
  from: RouteFrom | null;
  prefs: Partial<RoutePrefs>;
}

export interface AssistantSuggestion {
  name: string;
  target: Target;
}

export interface AssistantResponse {
  reply: string;
  action?: Intent;
  suggestions: AssistantSuggestion[];
  fallback: boolean;
  reason?: "disabled" | "timeout" | "offline" | "error";
}
