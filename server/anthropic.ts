import type { Target } from "../src/core/intent";
import type { Venue } from "../src/core/schema";

/**
 * Anthropic (Claude) on the server only: the key (ANTHROPIC_API_KEY) never reaches a browser. Two jobs, both "structured answers over this
 * venue's own list of places", so the model can choose and describe but never invent a place or compute a route:
 *   - interpretJourney: "I am near the lift lobby and I want to go to the pantry" -> a start place and a destination;
 *   - look: a camera picture -> which known place the camera is nearest to, and which known places are ahead / left / right.
 */
const API = "https://api.anthropic.com/v1/messages";
const VERSION = "2023-06-01";

export interface AnthropicOptions {
  apiKey?: string;
  /** Vision model (the picture). */
  model?: string;
  /** Fast model for reading a sentence. */
  fastModel?: string;
  fetchFn?: typeof fetch;
}

export type Confidence = "none" | "low" | "medium" | "high";
export interface JourneyAnswer {
  from: { target: Target; name: string } | null;
  to: { target: Target; name: string } | null;
}
export interface LookAnswer {
  nearest: { target: Target; name: string } | null;
  confidence: Confidence;
  saw: string;
  visible: { target: Target; name: string; direction: "ahead" | "left" | "right" | "behind" }[];
}

interface Place {
  id: string;
  target: Target;
  name: string;
  line: string;
}

function places(v: Venue): Place[] {
  const floor = (id: string) => v.floors.find((f) => f.id === id)?.name ?? id;
  const out: Place[] = [];
  for (const r of v.rooms) {
    if (r.access === "staff") continue;
    out.push({ id: r.id, target: { room: r.id }, name: r.name, line: `${r.id} | ${r.name} | ${r.cat} | ${floor(r.floor)}${r.aliases.length > 1 ? ` | also: ${r.aliases.filter((a) => a !== r.name.toLowerCase()).slice(0, 4).join(", ")}` : ""}` });
  }
  for (const p of v.pois) out.push({ id: p.id, target: { poi: p.id }, name: p.name, line: `${p.id} | ${p.name} | ${p.kind} point | ${floor(p.floor)}` });
  return out;
}

type Block = { type: string; name?: string; input?: Record<string, unknown>; text?: string };

export class AnthropicClient {
  private readonly key: string;
  private readonly model: string;
  private readonly fast: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: AnthropicOptions = {}) {
    this.key = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.model = opts.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
    this.fast = opts.fastModel ?? process.env.ANTHROPIC_FAST_MODEL ?? "claude-haiku-4-5-20251001";
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  available(): boolean {
    return this.key.length > 0;
  }
  get models(): { vision: string; text: string } {
    return { vision: this.model, text: this.fast };
  }

  private async call(body: Record<string, unknown>, signal: AbortSignal): Promise<Block[]> {
    const res = await this.fetchFn(API, {
      method: "POST",
      headers: { "x-api-key": this.key, "anthropic-version": VERSION, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`Anthropic API returned ${res.status}`);
    const j = (await res.json()) as { content?: Block[] };
    return j.content ?? [];
  }

  /** A start place and a destination from a free-form sentence. Ids the model returns are checked against the venue. */
  async interpretJourney(v: Venue, text: string, signal: AbortSignal): Promise<JourneyAnswer> {
    const list = places(v);
    const blocks = await this.call(
      {
        model: this.fast,
        max_tokens: 300,
        system:
          "You read what a visitor says inside a building and pick places from the venue's list. Use ONLY ids from the list, exactly as written. " +
          "from_id: where the visitor says they ARE (near / at / in / beside ...); empty string if they do not say. " +
          "to_id: where they want to GO; if they describe a need (coffee, toilet, water, a meeting) pick the best matching place from the list; empty string if no destination. " +
          "The visitor may speak English, Hindi (romanised) or Telugu. Never invent an id.",
        messages: [{ role: "user", content: `Places (id | name | kind | floor | also):\n${list.map((p) => p.line).join("\n")}\n\nVisitor said: "${text}"` }],
        tools: [
          {
            name: "plan_journey",
            description: "Report the start place and the destination the visitor named.",
            input_schema: { type: "object", properties: { from_id: { type: "string" }, to_id: { type: "string" } }, required: ["from_id", "to_id"] },
          },
        ],
        tool_choice: { type: "tool", name: "plan_journey" },
      },
      signal,
    );
    const input = blocks.find((b) => b.type === "tool_use" && b.name === "plan_journey")?.input ?? {};
    const pick = (id: unknown) => {
      const p = typeof id === "string" ? list.find((x) => x.id === id) : undefined;
      return p ? { target: p.target, name: p.name } : null;
    };
    const from = pick(input.from_id);
    const to = pick(input.to_id);
    return { from, to: to && from && JSON.stringify(to.target) === JSON.stringify(from.target) ? null : to };
  }

  /** A camera picture (JPEG) -> where the camera is. Only ids of this venue come back. */
  async look(v: Venue, jpeg: Buffer, hint: { floor?: string } | undefined, signal: AbortSignal): Promise<LookAnswer> {
    const list = places(v);
    const blocks = await this.call(
      {
        model: this.model,
        max_tokens: 500,
        system:
          "You are the eyes of an indoor wayfinding app. The picture is from a phone camera held at chest height. The venue's places are listed with ids. " +
          "Read every sign, door label, poster and printed text you can see and notice distinctive things (counters, lifts, doors, desks, kitchens). " +
          "Report which listed place the camera is NEAREST to, and which listed places you can actually see or read, with their direction relative to the camera (ahead, left, right, behind). " +
          "Only report what the picture supports. If it shows too little (blank wall, blur, dark), set confidence to none and nearest_id to an empty string. Never guess from the list alone. Use ONLY ids from the list.",
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } },
              { type: "text", text: `Places (id | name | kind | floor | also):\n${list.map((p) => p.line).join("\n")}${hint?.floor ? `\n\nThe visitor believes they are on floor ${v.floors.find((f) => f.id === hint.floor)?.name ?? hint.floor}.` : ""}` },
            ],
          },
        ],
        tools: [
          {
            name: "report_view",
            description: "Report what the camera sees and where that places the visitor.",
            input_schema: {
              type: "object",
              properties: {
                nearest_id: { type: "string" },
                confidence: { type: "string", enum: ["none", "low", "medium", "high"] },
                saw: { type: "string", description: "One short sentence: the text and things you used." },
                visible: {
                  type: "array",
                  items: { type: "object", properties: { id: { type: "string" }, direction: { type: "string", enum: ["ahead", "left", "right", "behind"] } }, required: ["id", "direction"] },
                },
              },
              required: ["nearest_id", "confidence", "saw", "visible"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "report_view" },
      },
      signal,
    );
    const input = blocks.find((b) => b.type === "tool_use" && b.name === "report_view")?.input ?? {};
    const find = (id: unknown) => (typeof id === "string" ? list.find((x) => x.id === id) : undefined);
    const conf = (["none", "low", "medium", "high"] as const).find((c) => c === input.confidence) ?? "none";
    const near = find(input.nearest_id);
    const visible = (Array.isArray(input.visible) ? input.visible : [])
      .map((x) => {
        const o = x as { id?: unknown; direction?: unknown };
        const p = find(o.id);
        const d = (["ahead", "left", "right", "behind"] as const).find((k) => k === o.direction);
        return p && d ? { target: p.target, name: p.name, direction: d } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return { nearest: near && conf !== "none" ? { target: near.target, name: near.name } : null, confidence: near ? conf : "none", saw: typeof input.saw === "string" ? input.saw.slice(0, 240) : "", visible };
  }
}
