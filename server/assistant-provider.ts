export interface AssistantTool {
  name: "search_places" | "get_route" | "where_am_i" | "place_info";
  description: string;
  parameters: Record<string, unknown>;
}

export interface AssistantProvider {
  readonly name: string;
  available(): boolean;
  answer(input: { text: string; language: string; tools: AssistantTool[]; execute(name: AssistantTool["name"], args: Record<string, unknown>): Promise<unknown>; signal: AbortSignal }): Promise<string>;
}

type OutputItem = { type?: string; name?: string; arguments?: string; call_id?: string; content?: Array<{ type?: string; text?: string }> };
type ResponsesBody = { id?: string; output?: OutputItem[]; output_text?: string };

/** Server-only OpenAI Responses implementation. No credential or provider request crosses into browser code. */
export class OpenAiResponsesProvider implements AssistantProvider {
  readonly name = "openai";
  constructor(private readonly apiKey = process.env.OPENAI_API_KEY ?? "", private readonly model = process.env.OPENAI_MODEL ?? "gpt-5.4-mini", private readonly fetchFn: typeof fetch = fetch) {}

  available(): boolean {
    return this.apiKey.length > 0;
  }

  private async request(body: Record<string, unknown>, signal: AbortSignal): Promise<ResponsesBody> {
    const res = await this.fetchFn("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`OpenAI Responses API returned ${res.status}`);
    return (await res.json()) as ResponsesBody;
  }

  async answer(input: { text: string; language: string; tools: AssistantTool[]; execute(name: AssistantTool["name"], args: Record<string, unknown>): Promise<unknown>; signal: AbortSignal }): Promise<string> {
    const instructions = `You are an indoor wayfinding assistant. Reply in ${input.language}. Keep the spoken reply under 24 words. Use only the supplied tools for venue facts, places, routes, and position. Never calculate a route or position yourself. If information is unavailable, say so briefly.`;
    const tools = input.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: true }));
    let response = await this.request({ model: this.model, instructions, input: input.text, tools, parallel_tool_calls: false, store: false }, input.signal);
    const calls = (response.output ?? []).filter((o) => o.type === "function_call" && o.name && o.call_id);
    if (calls.length) {
      const outputs: Record<string, unknown>[] = [];
      for (const call of calls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.arguments ?? "{}") as Record<string, unknown>; } catch { /* strict tools should not reach this */ }
        const result = await input.execute(call.name as AssistantTool["name"], args);
        outputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
      }
      response = await this.request({ model: this.model, instructions, input: [...(response.output ?? []), ...outputs], tools, parallel_tool_calls: false, store: false }, input.signal);
    }
    if (response.output_text?.trim()) return response.output_text.trim();
    for (const item of response.output ?? []) for (const c of item.content ?? []) if (c.type === "output_text" && c.text?.trim()) return c.text.trim();
    throw new Error("assistant returned no text");
  }
}
