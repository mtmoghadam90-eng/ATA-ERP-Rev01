/**
 * The rules behind the dashboard assistant, with nothing that talks to a model.
 *
 * Everything here is pure so `test:rules` can hold it: what a configuration
 * means when half of it is missing, whether the assistant may run at all, and
 * how the instructions it is given are assembled. The part that calls a
 * provider lives in `src/server/services/assistant/`.
 */

/** What the settings screen stores. The API key is **not** here — see below. */
export interface AssistantConfig {
  enabled: boolean;
  /**
   * The provider's base URL, up to and including `/v1`.
   *
   * OpenAI-compatible: the assistant posts to `{baseUrl}/chat/completions`.
   * That covers OpenAI itself, OpenRouter, the Iranian gateways, and a model
   * running on this network — one setting instead of one integration each.
   */
  baseUrl: string;
  model: string;
  /**
   * Added to the built-in instructions rather than replacing them.
   *
   * The built-in half explains the system, the calendar and how to use the
   * tools, and getting that wrong makes the assistant confidently useless. This
   * is where house rules go: which figures to quote, how formal to be, what to
   * refuse.
   */
  systemPrompt: string;
  /** 0 is repeatable and right for questions about figures. */
  temperature: number;
  maxTokens: number;
  /**
   * How many rounds of tool calls one question may take.
   *
   * A question like «میانگین زمان انجام هر فعالیت چقدر است» legitimately needs
   * several: find the categories, then read each one's activities. The cap is
   * what stops a confused model from reading the whole database one row at a
   * time.
   */
  maxToolCalls: number;
  /** Seconds before a provider that has stopped answering is given up on. */
  timeoutSeconds: number;
  /**
   * Whether the assistant may propose actions that change data.
   *
   * Off by default, and even on it only ever *proposes*: nothing is written
   * until somebody presses the confirm button. See `assistantActions.ts`.
   */
  allowActions: boolean;
}

export const DEFAULT_ASSISTANT_CONFIG: AssistantConfig = {
  enabled: false,
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  systemPrompt: "",
  temperature: 0,
  maxTokens: 2000,
  maxToolCalls: 12,
  timeoutSeconds: 60,
  allowActions: false,
};

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/**
 * A stored configuration filled in with the defaults.
 *
 * Every field is bounded here rather than at the call site: a `maxToolCalls` of
 * 500 typed into the settings screen is a bill, not a preference.
 */
export function resolveAssistantConfig(
  stored: Partial<AssistantConfig> | null | undefined,
): AssistantConfig {
  const raw = stored ?? {};
  return {
    enabled: raw.enabled === true,
    baseUrl: String(raw.baseUrl ?? "").trim().replace(/\/+$/, "")
      || DEFAULT_ASSISTANT_CONFIG.baseUrl,
    model: String(raw.model ?? "").trim() || DEFAULT_ASSISTANT_CONFIG.model,
    systemPrompt: String(raw.systemPrompt ?? ""),
    temperature: clamp(raw.temperature, 0, 2, DEFAULT_ASSISTANT_CONFIG.temperature),
    maxTokens: clamp(raw.maxTokens, 256, 32000, DEFAULT_ASSISTANT_CONFIG.maxTokens),
    maxToolCalls: clamp(raw.maxToolCalls, 1, 30, DEFAULT_ASSISTANT_CONFIG.maxToolCalls),
    timeoutSeconds: clamp(raw.timeoutSeconds, 5, 300, DEFAULT_ASSISTANT_CONFIG.timeoutSeconds),
    allowActions: raw.allowActions === true,
  };
}

/** Why the assistant cannot answer, or null when it can. */
export function assistantUnavailableReason(
  config: AssistantConfig,
  hasApiKey: boolean,
): string | null {
  if (!config.enabled) return "دستیار هوش مصنوعی فعال نیست. آن را در تنظیمات روشن کنید.";
  if (!config.baseUrl) return "آدرس پایه سرویس هوش مصنوعی ثبت نشده است.";
  if (!config.model) return "مدل سرویس هوش مصنوعی ثبت نشده است.";
  if (!hasApiKey) return "کلید API سرویس هوش مصنوعی ثبت نشده است.";
  return null;
}

/**
 * The instructions the model is given before it sees a question.
 *
 * Written out here, in one place, because most of what makes an assistant over
 * a business system useful or useless is in this text rather than in the code:
 * it has to know that the calendar is Shamsi, that money is rial, that it must
 * read rather than guess, and that «سود» means something specific here.
 */
export function buildSystemPrompt(input: {
  companyName: string;
  todayJalali: string;
  userName: string;
  canSeeCosts: boolean;
  actionsAllowed: boolean;
  extra: string;
}): string {
  const lines: string[] = [
    `تو دستیار داخلی سامانه ERP شرکت «${input.companyName}» هستی.`,
    `امروز ${input.todayJalali} است (تقویم شمسی).`,
    `کاربری که با تو صحبت می‌کند «${input.userName}» است.`,
    "",
    "قواعد کار:",
    "- همیشه به فارسی و کوتاه و دقیق جواب بده.",
    "- هیچ عددی را حدس نزن. هر رقمی که می‌گویی باید از خروجی ابزارها آمده باشد.",
    "- اگر داده‌ای برای پاسخ کافی نیست، صریح بگو چه چیزی کم است.",
    "- تاریخ‌ها شمسی و به شکل YYYY/MM/DD هستند. مبالغ ریالی‌اند مگر خلافش گفته شود.",
    "- مبالغ را با رقم لاتین و جداکننده هزارگان بنویس (مثال: 12,500,000).",
    "- برای هر سوالی که به داده نیاز دارد، اول ابزار مناسب را صدا بزن؛ از حافظه جواب نده.",
    "- وقتی چند رکورد را خلاصه می‌کنی، تعداد کل و بازه‌ی زمانی را هم بگو.",
  ];

  if (!input.canSeeCosts) {
    lines.push(
      "- این کاربر اجازه دیدن بهای تمام‌شده و سود را ندارد. اگر چنین سوالی پرسید،"
      + " بگو دسترسی ندارد؛ خودت هم این ارقام را در اختیار نداری.",
    );
  }

  lines.push(
    input.actionsAllowed
      ? "- برای کارهایی که داده را تغییر می‌دهند، فقط پیشنهاد ثبت می‌دهی؛ چیزی تا"
        + " تایید کاربر نوشته نمی‌شود. پیش از پیشنهاد، جزئیات را کامل بپرس."
      : "- تو فقط می‌توانی اطلاعات را بخوانی و تحلیل کنی. اگر کاربر خواست چیزی ثبت"
        + " کنی، بگو این قابلیت در تنظیمات فعال نشده است.",
  );

  const extra = input.extra.trim();
  if (extra) lines.push("", "دستورالعمل اختصاصی این شرکت:", extra);

  return lines.join("\n");
}
