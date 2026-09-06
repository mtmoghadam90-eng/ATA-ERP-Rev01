import { getDb } from "../../db";
import { AuthUser, hasPermission } from "../../auth";
import { ChatMessage, chat } from "./provider";
import { loadApiKey, loadAssistantConfig } from "./assistantService";
import {
  DraftResult, buildWorkflowDraftPrompt, sanitizeDraftedRule,
} from "../../../utils/workflowDraft";

/**
 * «قانونی که می‌خواهم این است…» → a filled-in workflow rule form.
 *
 * One round, no tools: there is nothing to look up iteratively, because the
 * whole of what a rule may say — every trigger, every condition field, every
 * value each field can hold — fits in the prompt and is built from the
 * catalogue rather than typed into it.
 *
 * **Nothing here writes.** The answer is sanitised against that same catalogue
 * and handed back for the editor to display; the person corrects it and presses
 * the save button that has always been there. That is a deliberate departure
 * from the assistant's propose-and-confirm path, and a more conservative one: a
 * workflow rule is configuration that fires for ever, and a Persian summary
 * beside a confirm button explains it far worse than the form does.
 */

export interface WorkflowDraftAnswer extends DraftResult {
  ok: boolean;
  error?: string;
}

/** Models wrap JSON in prose and code fences however firmly they are asked not to. */
function parseJsonAnswer(content: string): unknown {
  const trimmed = content.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const body = fenced ? fenced[1] : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

const EMPTY: DraftResult = { rule: null, warnings: [], refusal: null, summary: "" };

export async function draftWorkflowRule(
  description: string,
  user: AuthUser,
): Promise<WorkflowDraftAnswer> {
  /*
   * Two permissions, both required. The assistant flag decides whether this
   * user may ask a model anything at all; `settings` decides whether they may
   * be in the rule editor in the first place. Drafting a rule for somebody who
   * could not save it would be a form they cannot use.
   */
  if (!hasPermission(user, "settings")) {
    return { ok: false, error: "ویرایش قوانین گردش‌کار نیاز به دسترسی «تنظیمات» دارد.", ...EMPTY };
  }

  const wanted = String(description ?? "").trim().slice(0, 4000);
  if (!wanted) {
    return { ok: false, error: "توضیحی برای ساخت قانون فرستاده نشد.", ...EMPTY };
  }

  const config = await loadAssistantConfig();
  const apiKey = await loadApiKey();
  if (!config.enabled) return { ok: false, error: "دستیار هوشمند در تنظیمات فعال نیست.", ...EMPTY };
  if (!apiKey) return { ok: false, error: "کلید API سرویس هوش مصنوعی ثبت نشده است.", ...EMPTY };

  // The company's own templates, so a «send_message» action can name a real
  // one. A model cannot invent an id that exists, and one that does not is
  // dropped by the sanitiser.
  const templates = await getDb().messageTemplate.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 100,
  });

  const messages: ChatMessage[] = [
    { role: "system", content: buildWorkflowDraftPrompt(templates) },
    { role: "user", content: wanted },
  ];

  const result = await chat({
    baseUrl: config.baseUrl,
    apiKey,
    model: config.model,
    messages,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    timeoutSeconds: config.timeoutSeconds,
  });

  if (!result.ok) return { ok: false, error: result.error, ...EMPTY };

  const parsed = parseJsonAnswer(result.content ?? "");
  if (!parsed) {
    return {
      ok: false,
      error: "پاسخ سرویس هوش مصنوعی قابل خواندن نبود. یک بار دیگر تلاش کنید.",
      ...EMPTY,
    };
  }

  return {
    ok: true,
    ...sanitizeDraftedRule(parsed, {
      templateIds: templates.map((t) => t.id),
      fallbackName: wanted,
    }),
  };
}
