/**
 * Talking to the model.
 *
 * OpenAI-compatible `/chat/completions` with tool calling, chosen because the
 * setting the user asked for is a **base URL**: one client reaches OpenAI,
 * OpenRouter, the Iranian gateways and a model running on this network, instead
 * of one integration per provider.
 *
 * Nothing here knows what the tools do — the loop in `run.ts` owns that. This
 * only turns a request into an answer, or into a Persian sentence explaining
 * why there isn't one. A provider being unreachable is an ordinary outcome for
 * a company behind a filtered connection, not an exception.
 */

import { DroppableParameter, unsupportedParameterFrom } from "../../../utils/assistant";

export interface ChatToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
}

export interface ChatToolCall {
  id: string;
  name: string;
  /** Raw JSON text, as the model produced it. Parsed by the caller. */
  arguments: string;
}

/**
 * A user message may carry pictures alongside its text.
 *
 * The OpenAI-compatible shape for that is an array of parts rather than a
 * string, and only a vision model accepts it — one that does not answers 400,
 * which `describeFailure` reports as the provider's own refusal rather than as
 * a fault here.
 */
export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ChatContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

export interface ChatResult {
  ok: boolean;
  content?: string;
  toolCalls?: ChatToolCall[];
  error?: string;
  usage?: { promptTokens: number; completionTokens: number };
}

interface WireToolCall {
  id?: unknown;
  function?: { name?: unknown; arguments?: unknown };
}

/** Our shape -> the wire shape. */
function toWire(message: ChatMessage): Record<string, unknown> {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content ?? "",
      ...(message.tool_calls?.length
        ? {
            tool_calls: message.tool_calls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.arguments },
            })),
          }
        : {}),
    };
  }
  if (message.role === "tool") {
    return { role: "tool", content: message.content, tool_call_id: message.tool_call_id };
  }
  return { role: message.role, content: message.content };
}

/**
 * The provider's own words, as something the reader can act on.
 *
 * The status code is what separates the three things that actually go wrong: a
 * key that is not accepted, a model name that does not exist at this provider,
 * and a provider that is simply not reachable from here.
 */
function describeFailure(status: number, body: string): string {
  const detail = body.slice(0, 300);
  if (status === 401 || status === 403) {
    return "کلید API پذیرفته نشد. کلید و آدرس پایه سرویس را بررسی کنید.";
  }
  if (status === 404) {
    return `سرویس این آدرس یا این مدل را نمی‌شناسد. آدرس پایه و نام مدل را بررسی کنید. (${detail})`;
  }
  if (status === 429) {
    return "سرویس هوش مصنوعی فعلاً درخواست بیشتری نمی‌پذیرد (محدودیت تعداد یا اعتبار).";
  }
  if (status >= 500) {
    return `سرویس هوش مصنوعی خطای داخلی داد (${status}).`;
  }
  return `سرویس هوش مصنوعی درخواست را نپذیرفت (${status}): ${detail}`;
}

export interface ChatRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: ChatToolDefinition[];
  /** null leaves it to the model — see `AssistantConfig.temperature`. */
  temperature?: number | null;
  maxTokens: number;
  timeoutSeconds: number;
}

/**
 * The request body, minus whatever the provider has already refused.
 *
 * `temperature` is left out when it is null, and `max_tokens` is sent under the
 * name the o-series models renamed it to once they have said they do not know
 * the old one. Dropping the cap altogether is deliberately not an option: it is
 * the only thing standing between a confused model and a bill.
 */
function buildBody(request: ChatRequest, dropped: Set<DroppableParameter>): string {
  const sendTemperature = typeof request.temperature === "number"
    && !dropped.has("temperature");
  const renamedTokenCap = dropped.has("max_tokens");

  return JSON.stringify({
    model: request.model,
    ...(sendTemperature ? { temperature: request.temperature } : {}),
    ...(renamedTokenCap
      ? { max_completion_tokens: request.maxTokens }
      : { max_tokens: request.maxTokens }),
    messages: request.messages.map(toWire),
    ...(request.tools?.length
      ? {
          tools: request.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
          tool_choice: "auto",
        }
      : {}),
  });
}

export async function chat(request: ChatRequest): Promise<ChatResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutSeconds * 1000);

  /*
   * What this provider has told us it will not accept.
   *
   * A model that refuses an explicit temperature, or that has renamed the token
   * cap, answers 400 with a message naming the field. Sending the request again
   * without it is a far better answer than handing the user a provider error
   * about a setting they had no way to guess at. Each field is dropped at most
   * once, so a provider that keeps refusing is reported rather than retried
   * forever.
   */
  const dropped = new Set<DroppableParameter>();

  try {
    let response = await fetch(`${request.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.apiKey}`,
      },
      signal: controller.signal,
      body: buildBody(request, dropped),
    });

    let text = await response.text();

    while (!response.ok) {
      const refused = unsupportedParameterFrom(response.status, text);
      if (!refused || dropped.has(refused)) {
        return { ok: false, error: describeFailure(response.status, text) };
      }
      dropped.add(refused);
      response = await fetch(`${request.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${request.apiKey}`,
        },
        signal: controller.signal,
        body: buildBody(request, dropped),
      });
      text = await response.text();
    }

    let payload: {
      choices?: { message?: { content?: unknown; tool_calls?: WireToolCall[] } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };
    try {
      payload = JSON.parse(text);
    } catch {
      return { ok: false, error: `پاسخ سرویس قابل خواندن نبود: ${text.slice(0, 200)}` };
    }

    // Some gateways answer 200 with an error object rather than a status code.
    if (payload.error?.message) {
      return { ok: false, error: `سرویس هوش مصنوعی: ${payload.error.message}` };
    }

    const message = payload.choices?.[0]?.message;
    if (!message) return { ok: false, error: "سرویس هوش مصنوعی پاسخی برنگرداند." };

    const toolCalls = (message.tool_calls ?? [])
      .map((call) => ({
        id: String(call.id ?? ""),
        name: String(call.function?.name ?? ""),
        arguments: String(call.function?.arguments ?? "{}"),
      }))
      .filter((call) => call.name);

    return {
      ok: true,
      content: typeof message.content === "string" ? message.content : "",
      toolCalls,
      usage: {
        promptTokens: Number(payload.usage?.prompt_tokens ?? 0),
        completionTokens: Number(payload.usage?.completion_tokens ?? 0),
      },
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return {
        ok: false,
        error: `سرویس هوش مصنوعی در ${request.timeoutSeconds} ثانیه پاسخ نداد.`,
      };
    }
    return {
      ok: false,
      error: `اتصال به سرویس هوش مصنوعی برقرار نشد: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  } finally {
    clearTimeout(timer);
  }
}
