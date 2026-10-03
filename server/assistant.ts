import { promises as fs } from "node:fs";
import path from "node:path";
import type { AssistantRequest, AssistantResponse, AssistantSuggestion } from "../src/core/assistant";
import type { Target } from "../src/core/intent";
import { getRoute, placeInfo, searchPlaces, whereAmI } from "../src/core/assistantTools";
import type { Venue } from "../src/core/schema";
import { OpenAiResponsesProvider, type AssistantProvider, type AssistantTool } from "./assistant-provider";
import { chooseTarget, type LocalSemanticRanker } from "./semantic";

const LANG_NAME = { en: "English", hi: "romanised Hinglish", te: "Telugu" } as const;
const FALLBACK = {
  en: (names: string) => names ? `Did you mean ${names}?` : "I couldn't find that. Try a place name.",
  hi: (names: string) => names ? `Kya aapka matlab ${names} tha?` : "Woh nahi mila. Kisi jagah ka naam boliye.",
  te: (names: string) => names ? `మీ ఉద్దేశం ${names}నా?` : "అది దొరకలేదు. స్థలం పేరు చెప్పండి.",
};

const TOOLS: AssistantTool[] = [
  { name: "search_places", description: "Search this venue for rooms and points of interest.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } },
  { name: "get_route", description: "Get the server-computed route to a known room or POI id.", parameters: { type: "object", properties: { type: { type: "string", enum: ["room", "poi"] }, id: { type: "string" } }, required: ["type", "id"], additionalProperties: false } },
  { name: "where_am_i", description: "Get the visitor's current surveyed pose and nearby place.", parameters: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "place_info", description: "Get factual information about a known room or POI id.", parameters: { type: "object", properties: { type: { type: "string", enum: ["room", "poi"] }, id: { type: "string" } }, required: ["type", "id"], additionalProperties: false } },
];

const asTarget = (type: unknown, id: unknown): Target | null => type === "room" && typeof id === "string" ? { room: id } : type === "poi" && typeof id === "string" ? { poi: id } : null;
const shortReply = (text: string): string => {
  const words = text.trim().split(/\s+/);
  return words.length <= 24 ? words.join(" ") : `${words.slice(0, 24).join(" ")}…`;
};

const GOING = {
  en: (n: string) => `Taking you to ${n}.`,
  hi: (n: string) => `${n} le chalte hain.`,
  te: (n: string) => `${n} కి తీసుకెళ్తున్నాను.`,
};

export class AssistantService {
  constructor(
    private readonly root: string,
    private readonly provider: AssistantProvider = new OpenAiResponsesProvider(),
    /** Local sentence-embedding ranker: answers when no cloud model is configured (or it fails). */
    private readonly semantic: Pick<LocalSemanticRanker, "rank" | "ready"> | null = null,
  ) {}

  /** A clear best match among this venue's places, from the local model. Never waits for the model to download. */
  private async local(v: Venue, req: AssistantRequest, suggestions: AssistantSuggestion[]): Promise<AssistantResponse | null> {
    if (!this.semantic?.ready()) return null;
    try {
      const ranked = await this.semantic.rank(v, req.text, 8);
      const choice = chooseTarget(v, ranked, req.from, req.prefs);
      const sugg = ranked.slice(0, 3).map((r) => ({ name: r.name, target: r.target }));
      if ("pick" in choice) return { reply: GOING[req.lang](choice.pick.name), action: { type: "goto", target: choice.pick.target, name: choice.pick.name }, suggestions: sugg, fallback: false };
      if (choice.ask.length) return { reply: FALLBACK[req.lang](choice.ask.join(" or ")), suggestions: sugg, fallback: true, reason: "disabled" };
    } catch { /* the local model must never break wayfinding */ }
    return null;
  }

  private suggestions(v: Venue, q: string): AssistantSuggestion[] {
    return searchPlaces(v, q).map(({ name, target }) => ({ name, target }));
  }

  private async log(row: Record<string, unknown>): Promise<void> {
    try {
      const dir = path.join(this.root, "data", "assistant");
      await fs.mkdir(dir, { recursive: true });
      await fs.appendFile(path.join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`), `${JSON.stringify(row)}\n`);
    } catch { /* logging must not break wayfinding */ }
  }

  async ask(v: Venue, req: AssistantRequest): Promise<AssistantResponse> {
    const suggestions = this.suggestions(v, req.text);
    const fallback = (reason: AssistantResponse["reason"]): AssistantResponse => ({ reply: FALLBACK[req.lang](suggestions.map((s) => s.name).join(" or ")), suggestions, fallback: true, reason });
    if (!this.provider.available()) {
      const out = (await this.local(v, req, suggestions)) ?? fallback("disabled");
      await this.log({ at: new Date().toISOString(), provider: this.provider.name, venue: v.id, lang: req.lang, text: req.text, ...out });
      return out;
    }

    let action: AssistantResponse["action"];
    const execute = async (name: AssistantTool["name"], args: Record<string, unknown>): Promise<unknown> => {
      if (name === "search_places") return searchPlaces(v, String(args.query ?? ""));
      if (name === "where_am_i") return whereAmI(v, req.from);
      const target = asTarget(args.type, args.id);
      if (!target) return { error: "invalid place" };
      const info = placeInfo(v, target);
      if ("error" in info) return info;
      if (name === "place_info") return info;
      const computed = getRoute(v, req.from, target, req.prefs);
      if ("error" in computed) return computed;
      action = { type: "goto", target, name: info.name };
      return computed;
    };

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    let out: AssistantResponse;
    try {
      const reply = shortReply(await this.provider.answer({ text: req.text, language: LANG_NAME[req.lang], tools: TOOLS, execute, signal: ctl.signal }));
      out = { reply, action, suggestions, fallback: false };
    } catch (err) {
      out = (await this.local(v, req, suggestions)) ?? fallback(ctl.signal.aborted ? "timeout" : err instanceof TypeError ? "offline" : "error");
    } finally {
      clearTimeout(timer);
    }
    await this.log({ at: new Date().toISOString(), provider: this.provider.name, venue: v.id, lang: req.lang, text: req.text, reply: out.reply, fallback: out.fallback, reason: out.reason, action: out.action?.type });
    return out;
  }
}
