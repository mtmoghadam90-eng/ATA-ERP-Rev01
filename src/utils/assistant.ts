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
  /**
   * 0 is repeatable and right for questions about figures — where the model
   * lets it be set at all.
   *
   * `null` means «leave it to the model», and the field is then not sent. That
   * is not a nicety: the reasoning models (o-series, gpt-5 and what the Iranian
   * gateways proxy of them) reject *any* explicit temperature — «does not
   * support 0 with this model. Only the default (1) value is supported» — so a
   * setting that could only ever be a number made those models unusable.
   */
  temperature: number | null;
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
  // Absent means the model's own default, which is the setting that works
  // everywhere. A stored 0 is still honoured; see `resolveAssistantConfig`.
  temperature: null,
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
 * The stored temperature, or null for «let the model decide».
 *
 * Anything that is not a usable figure — absent, null, a corrupt value — comes
 * back as null rather than as 0. Those are different instructions, and reading
 * one as the other is precisely what sends an explicit temperature to a model
 * that refuses to be given one.
 */
function temperatureOf(stored: unknown): number | null {
  if (stored === null || stored === undefined || stored === "") return null;
  const value = Number(stored);
  if (!Number.isFinite(value)) return null;
  return Math.min(2, Math.max(0, value));
}

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
    /*
     * Absent or null is «the model decides», which is different from 0 and has
     * to survive the round trip — reading a missing value as 0 is what sends an
     * explicit temperature to a model that refuses one.
     */
    temperature: temperatureOf(raw.temperature),
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
 * The request parameter a provider has just refused, or null.
 *
 * Some models accept only their own default temperature, and the o-series
 * family renamed `max_tokens` to `max_completion_tokens` — both answer 400 with
 * a message naming the field. Reading the name out of that message is what lets
 * the request be sent again without it rather than handing the user a provider
 * error and a setting they have no way to guess at.
 *
 * Matched narrowly on purpose: a 400 that merely mentions the word temperature
 * in passing is not permission to start dropping fields.
 */
export type DroppableParameter = "temperature" | "max_tokens";

export function unsupportedParameterFrom(
  status: number,
  body: string,
): DroppableParameter | null {
  if (status !== 400) return null;
  const text = String(body ?? "");

  if (/unsupported (value|parameter)[^\n]*'temperature'/i.test(text)
    || /'temperature'[^\n]*(is not supported|does not support|unsupported)/i.test(text)) {
    return "temperature";
  }
  if (/'?max_tokens'?[^\n]*(is not supported|unsupported|use '?max_completion_tokens)/i.test(text)) {
    return "max_tokens";
  }
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
  /**
   * What this user may actually be offered, by label.
   *
   * Empty with `actionsAllowed` on means the switch is on and this account has
   * no module it may write to — a different sentence from "the feature is off",
   * and telling the model the wrong one makes it promise something it cannot do.
   */
  actions: { name: string; label: string }[];
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
    /*
     * The rule the reported failure needed, and the one no tool can supply.
     *
     * Asked «بیشترین درخواست برای چه کالایی بوده», the assistant reached for
     * the only nearby number it had — `revenueByCategory`, which is won revenue
     * per category — and answered «فشار». Every instruction above was obeyed:
     * the figure came from a tool, nothing was guessed, it was in rial. What
     * was missing is that a *near* answer is a wrong answer, and that saying so
     * is a better outcome than a confident substitute nobody can tell apart
     * from the real thing.
     */
    "",
    "درباره‌ی «دقیقاً همان چیزی که پرسیده شده»:",
    "- اگر هیچ ابزاری دقیقاً همان چیزی را که پرسیده شده اندازه نمی‌گیرد، صریح بگو"
    + " که این عدد را نداریم و بگو نزدیک‌ترین چیزی که داری چیست. هرگز جواب یک"
    + " سوال نزدیک را به جای جواب سوال اصلی نده.",
    "- «تعداد» با «مبلغ» یکی نیست، «برنده‌شده» با «درخواست‌شده» یکی نیست، و"
    + " «دسته‌بندی» با «کالا» یکی نیست. اگر سوال درباره‌ی یک کالاست، در سطح کالا"
    + " جواب بده؛ اگر فقط داده‌ی سطح دسته‌بندی داری، همین را بگو.",
    "- در پاسخ بگو چه چیزی را شمرده‌ای و در چه بازه‌ای. اگر خروجی ابزار فیلدی به"
    + " نام measured داشت، همان را مبنای این جمله قرار بده.",
    "- برای سوال‌های «بیشترین/کمترین/پرتکرارترین/پرفروش‌ترین»، علاوه بر رتبه‌ی اول،"
    + " دو سه ردیف بعدی و عدد هرکدام را هم بیاور تا فاصله‌شان معلوم باشد.",
    "- اگر خروجی ابزار هشدار داد که داده‌ها ناقص یا بریده شده‌اند، همان هشدار را"
    + " به کاربر منتقل کن.",
  ];

  if (!input.canSeeCosts) {
    lines.push(
      "- این کاربر اجازه دیدن بهای تمام‌شده و سود را ندارد. اگر چنین سوالی پرسید،"
      + " بگو دسترسی ندارد؛ خودت هم این ارقام را در اختیار نداری.",
    );
  }

  if (!input.actionsAllowed) {
    lines.push(
      "- تو فقط می‌توانی اطلاعات را بخوانی و تحلیل کنی. اگر کاربر خواست چیزی ثبت"
      + " کنی، بگو این قابلیت در تنظیمات فعال نشده است.",
    );
  } else if (input.actions.length === 0) {
    lines.push(
      "- ثبت خودکار فعال است اما این کاربر به هیچ ماژول قابل‌نوشتنی دسترسی ندارد."
      + " اگر خواست چیزی ثبت کنی، بگو دسترسی لازم را ندارد.",
    );
  } else {
    lines.push(
      "",
      "ثبت اطلاعات:",
      `- می‌توانی این کارها را «پیشنهاد» بدهی: ${input.actions.map((a) => a.label).join("، ")}.`,
      "- تو هیچ‌وقت چیزی را مستقیم ثبت نمی‌کنی. ابزارهای ثبت فقط یک پیشنهاد آماده"
      + " می‌کنند و خلاصه‌اش برای تایید به کاربر نشان داده می‌شود؛ تا کاربر دکمه‌ی"
      + " تایید را نزند هیچ چیزی در سامانه ثبت نمی‌شود.",
      "- پیش از ساختن پیشنهاد، هر چیزی را که نمی‌دانی بپرس؛ هیچ مبلغ، تعداد، تاریخ"
      + " یا نامی را حدس نزن. شناسه‌ها را با ابزارهای جستجو پیدا کن، نساز.",
      "- بعد از ساختن پیشنهاد، فقط کوتاه بگو خلاصه آماده است و منتظر تایید بماند؛"
      + " همان ابزار را دوباره صدا نزن.",
    );
  }

  const extra = input.extra.trim();
  if (extra) lines.push("", "دستورالعمل اختصاصی این شرکت:", extra);

  return lines.join("\n");
}
