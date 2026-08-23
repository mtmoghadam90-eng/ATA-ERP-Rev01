import { getDb } from "../../db";
import { AuthUser, canSeeCosts } from "../../auth";
import { loadSettings } from "../../settings";
import { getTodayShamsi } from "../../../dateUtils";
import {
  AssistantConfig, DEFAULT_ASSISTANT_CONFIG, assistantUnavailableReason,
  buildSystemPrompt, resolveAssistantConfig,
} from "../../../utils/assistant";
import { ChatMessage, chat } from "./provider";
import { AssistantTool, assistantTools, toolDefinitions } from "./tools";

/**
 * The assistant: configuration, credentials, and the loop that turns a question
 * into an answer.
 *
 * The loop is deliberately here rather than in the browser. Everything it reads
 * goes through the same services the REST API uses, so record-level visibility
 * and cost redaction hold — and the API key never leaves this process, which is
 * the whole reason the credential is a row in its own table rather than a field
 * on the settings document every browser loads.
 */

const CREDENTIAL_ID = "default";

/* ------------------------------ credentials ------------------------------ */

export async function loadApiKey(): Promise<string | null> {
  const row = await getDb().assistantCredentials.findUnique({ where: { id: CREDENTIAL_ID } });
  return row?.apiKey?.trim() || null;
}

/**
 * Stores a key. A blank value means "leave what is there" — the same rule the
 * messaging providers and the password fields follow, because the screen never
 * receives the stored value and so cannot send it back.
 */
export async function saveApiKey(apiKey: string | null | undefined): Promise<void> {
  const value = String(apiKey ?? "").trim();
  if (!value) return;
  const db = getDb();
  await db.assistantCredentials.upsert({
    where: { id: CREDENTIAL_ID },
    create: { id: CREDENTIAL_ID, apiKey: value },
    update: { apiKey: value, updatedAt: new Date() },
  });
}

export async function clearApiKey(): Promise<void> {
  const db = getDb();
  await db.assistantCredentials.upsert({
    where: { id: CREDENTIAL_ID },
    create: { id: CREDENTIAL_ID, apiKey: null },
    update: { apiKey: null, updatedAt: new Date() },
  });
}

/** Enough of the key to recognise it, and not enough to use it. */
export function maskKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}${"•".repeat(6)}${key.slice(-4)}`;
}

/* -------------------------------- config --------------------------------- */

export async function loadAssistantConfig(): Promise<AssistantConfig> {
  const settings = await loadSettings() as { assistant?: Partial<AssistantConfig> } | undefined;
  return resolveAssistantConfig(settings?.assistant ?? DEFAULT_ASSISTANT_CONFIG);
}

/* --------------------------------- run ----------------------------------- */

export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantAnswer {
  ok: boolean;
  reply?: string;
  error?: string;
  /** Which tools ran, in order — shown under the answer so it can be checked. */
  steps?: { tool: string; arguments: string; ok: boolean }[];
  usage?: { promptTokens: number; completionTokens: number };
}

/** A tool result, trimmed to something a context window can hold. */
function serialiseResult(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value ?? null);
  } catch {
    text = String(value);
  }
  const LIMIT = 24_000;
  if (text.length <= LIMIT) return text;
  /*
   * Truncated with a note rather than silently.
   *
   * A model handed a JSON string cut off mid-object will either fail to parse
   * it or, worse, read the fragment as the whole answer and report a total that
   * is missing half its rows.
   */
  return `${text.slice(0, LIMIT)}\n…[خروجی طولانی بود و بریده شد. با فیلتر دقیق‌تر یا صفحه‌بندی دوباره بپرس.]`;
}

export async function askAssistant(
  history: AssistantTurn[],
  user: AuthUser,
): Promise<AssistantAnswer> {
  const config = await loadAssistantConfig();
  const apiKey = await loadApiKey();

  const unavailable = assistantUnavailableReason(config, !!apiKey);
  if (unavailable) return { ok: false, error: unavailable };

  const settings = await loadSettings() as { companyInfo?: { name?: string } } | undefined;
  const tools = assistantTools();
  const byName = new Map<string, AssistantTool>(tools.map((t) => [t.definition.name, t]));

  const todayJalali = getTodayShamsi();
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt({
        companyName: settings?.companyInfo?.name || "ابزار تامین آرشیا",
        todayJalali,
        userName: user.fullName || user.username || "کاربر",
        canSeeCosts: canSeeCosts(user),
        actionsAllowed: config.allowActions,
        extra: config.systemPrompt,
      }),
    },
    ...history.slice(-20).map((turn) => ({
      role: turn.role,
      content: String(turn.content ?? ""),
    }) as ChatMessage),
  ];

  const steps: { tool: string; arguments: string; ok: boolean }[] = [];
  let promptTokens = 0;
  let completionTokens = 0;

  for (let round = 0; round < config.maxToolCalls; round++) {
    const result = await chat({
      baseUrl: config.baseUrl,
      apiKey: apiKey!,
      model: config.model,
      messages,
      tools: toolDefinitions(tools),
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      timeoutSeconds: config.timeoutSeconds,
    });

    if (!result.ok) return { ok: false, error: result.error, steps };
    promptTokens += result.usage?.promptTokens ?? 0;
    completionTokens += result.usage?.completionTokens ?? 0;

    const calls = result.toolCalls ?? [];
    if (calls.length === 0) {
      return {
        ok: true,
        reply: result.content?.trim() || "پاسخی تولید نشد.",
        steps,
        usage: { promptTokens, completionTokens },
      };
    }

    messages.push({ role: "assistant", content: result.content ?? "", tool_calls: calls });

    for (const call of calls) {
      const tool = byName.get(call.name);
      if (!tool) {
        steps.push({ tool: call.name, arguments: call.arguments, ok: false });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ error: `ابزاری به نام ${call.name} وجود ندارد.` }),
        });
        continue;
      }

      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
      } catch {
        // Malformed arguments are the model's mistake to correct, not ours to
        // guess at — it gets told and tries again.
        steps.push({ tool: call.name, arguments: call.arguments, ok: false });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ error: "آرگومان‌ها JSON معتبر نبودند." }),
        });
        continue;
      }

      try {
        const value = await tool.run(parsed, { user, todayJalali });
        steps.push({ tool: call.name, arguments: call.arguments, ok: true });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: serialiseResult(value),
        });
      } catch (err) {
        /*
         * A failing tool is reported to the model rather than to the user.
         *
         * It can often recover — ask for a smaller page, use a different tool —
         * and a question that ends in a stack trace helps nobody.
         */
        steps.push({ tool: call.name, arguments: call.arguments, ok: false });
        console.error(`assistant tool ${call.name} failed`, err);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            error: `اجرای ابزار با خطا مواجه شد: ${err instanceof Error ? err.message : String(err)}`,
          }),
        });
      }
    }
  }

  return {
    ok: false,
    error: `پاسخ در ${config.maxToolCalls} مرحله جمع نشد. سوال را کوچک‌تر بپرسید یا سقف مراحل را در تنظیمات بالا ببرید.`,
    steps,
  };
}

/** Proves the credentials work, without touching any of the tools. */
export async function testAssistant(): Promise<{ ok: boolean; error?: string; reply?: string }> {
  const config = await loadAssistantConfig();
  const apiKey = await loadApiKey();
  if (!apiKey) return { ok: false, error: "کلید API ثبت نشده است." };
  if (!config.baseUrl || !config.model) {
    return { ok: false, error: "آدرس پایه و نام مدل را کامل کنید." };
  }

  const result = await chat({
    baseUrl: config.baseUrl,
    apiKey,
    model: config.model,
    messages: [{ role: "user", content: "بگو: اتصال برقرار است." }],
    temperature: 0,
    maxTokens: 32,
    timeoutSeconds: Math.min(config.timeoutSeconds, 30),
  });

  return result.ok
    ? { ok: true, reply: result.content?.trim() || "" }
    : { ok: false, error: result.error };
}
