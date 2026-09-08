import type { WorkflowRule } from "../types";
import { TASK_PRIORITIES } from "./moduleStatuses";
import {
  SCHEDULE_MODEL_FIELDS, TriggerField, WORKFLOW_ASSIGNEE_TOKENS, WORKFLOW_TRIGGERS,
  isAssigneeToken, triggerFields,
} from "./workflowTriggers";
import { MESSAGE_VARIABLES } from "./messaging";
import { SCHEDULE_SUBJECTS } from "./workflowSchedule";

/**
 * Describing a workflow rule in Persian and getting the form filled in.
 *
 * Building one by hand means knowing which of twenty-four triggers reports the
 * event you mean, which of that trigger's fields the engine actually emits, and
 * which values that field can hold — and getting any of those wrong produces a
 * rule that saves cleanly, prints correctly on its card and **never fires**.
 * That is this module's whole reason for existing, and it is the same failure
 * the trigger catalogue was written to end: a rule that never fires looks
 * exactly like one waiting for its event.
 *
 * Two decisions hold it up.
 *
 * **It drafts into the form; it does not write the rule.** The assistant's
 * ordinary action path — propose, store the payload server-side, confirm — is
 * for records a person reads once. A workflow rule is *configuration that fires
 * for ever*, and the form is the only thing that explains it: which trigger,
 * which condition, who it lands on, how long they have. So the draft lands in
 * the editor the person already knows, they correct it, and the **existing**
 * save button is the only writer. There is no second write path and no second
 * copy of the save-time validation.
 *
 * **The catalogue decides, not the model.** Every trigger, field, value,
 * schedule subject, priority and assignee token is handed to the model in the
 * prompt *and* checked again here on the way back. Anything not in the
 * catalogue is dropped and reported in Persian rather than passed through — the
 * same rule the product adviser follows about ids: a model is if anything more
 * likely than a person to write «تأیید شده» into a column that has never held
 * it, because it is a plausible thing to write.
 */

/* ------------------------------ the catalogue ----------------------------- */

/**
 * How a field's permitted values are written into the prompt.
 *
 * The **hint** is the half that was missing, and its absence cost a real rule.
 * A list of values is not a definition: «مرحله پروژه: جدید | در حال مذاکره | …»
 * tells a reader what may be written and nothing about what any of it *means*,
 * so «۳ روز پس از ایجاد پروژه، اگر استعلام قیمت ثبت نشده باشد» — which is
 * exactly `stage = جدید` — was refused as inexpressible. The catalogue is the
 * authority here as everywhere, so the meaning belongs in the catalogue beside
 * the values rather than in a sentence written into this prompt.
 */
function describeField(field: TriggerField): string {
  const values = field.options?.length
    ? field.options.join(" | ")
    : "«هر مقدار» (عدد یا متن آزاد)";
  const line = `    ${field.value} — ${field.label}: ${values}`;
  return field.hint ? `${line}\n      ↳ ${field.hint}` : line;
}

/**
 * The whole of what a rule may say, as text for the prompt.
 *
 * Written from the catalogue on every request rather than kept as a string: a
 * trigger added to `workflowTriggers.ts` and not to a hand-written prompt is
 * a trigger the assistant would never propose, which is the drift in its
 * quietest form.
 */
export function workflowCatalogue(templates: readonly { id: string; name: string }[]): string {
  const triggers = Object.entries(WORKFLOW_TRIGGERS)
    .map(([id, spec]) => {
      const fields = spec.fields.map(describeField).join("\n");
      return `  ${id} — ${spec.label}\n${fields || "    (بدون شرط)"}`;
    })
    .join("\n");

  const subjects = Object.entries(SCHEDULE_SUBJECTS)
    .map(([id, s]) => `  ${id} — ${s.label}`)
    .join("\n");

  const scheduleFields = Object.entries(SCHEDULE_MODEL_FIELDS)
    .map(([model, fields]) => `  ${model}:\n${fields.map(describeField).join("\n")}`)
    .join("\n");

  const assignees = WORKFLOW_ASSIGNEE_TOKENS
    .map((t) => `  ${t.value} — ${t.label}`)
    .join("\n");

  const variables = MESSAGE_VARIABLES
    .map((v) => `  {${v.key}} — ${v.label}`)
    .join("\n");

  const templateList = templates.length
    ? templates.map((t) => `  ${t.id} — ${t.name}`).join("\n")
    : "  (هیچ قالبی ساخته نشده است — پس اقدام ارسال پیام قابل استفاده نیست)";

  return [
    "## رویدادها (triggerType) و شرط‌هایی که هرکدام می‌پذیرند",
    triggers,
    "",
    "## اگر triggerType برابر time_elapsed باشد، schedule لازم است",
    "  schedule.subject یکی از این‌هاست:",
    subjects,
    "  schedule.days: عدد صحیح نامنفی — schedule.direction: after یا before",
    // A repeat only became safe once the reminder could retire itself: without
    // `closeWhenResolved` the loop ends only at a counter, which is a guess.
    "  schedule.repeatEveryDays: عدد صحیح نامنفی — ۰ یا نیامده یعنی فقط یک بار؛",
    "    عددی بزرگ‌تر یعنی تا وقتی شرط برقرار است هر این تعداد روز دوباره اجرا شود.",
    "    برای «تا وقتی جواب ندادند پیگیری کن» لازم است و باید همراه با",
    "    closeWhenResolved: true باشد، وگرنه یادآوری بعد از حل شدن مشکل هم می‌ماند.",
    "  schedule.maxOccurrences: عدد صحیح نامنفی — ۰ یا نیامده یعنی بی‌نهایت.",
    "  شرط‌های یک قانون زمان‌بندی‌شده روی خودِ رکورد سنجیده می‌شوند:",
    scheduleFields,
    "",
    "## اپراتورهای شرط",
    "  equals | not_equals | greater_than | less_than",
    "",
    "## اقدام‌ها (actions[].type)",
    "  create_task — ساخت وظیفه. taskConfig: titleTemplate, descTemplate,",
    "    assignedTo, priority, dueDaysOffset, taskKind, skipIfOpenSameKind, closeWhenResolved,",
    "    escalateAfterOccurrences, escalatePriority, escalateAssignedTo",
    "  send_message — ارسال پیام به مشتری. messageConfig: templateId (اجباری),",
    "    channel (SMS | BALE | EMAIL یا نیامده = ترجیح پروژه), delayDays, sendAtTime",
    "  send_notification — اعلان داخلی. notificationConfig: titleTemplate,",
    "    descTemplate, module",
    "",
    "## مقادیر مجاز taskConfig",
    `  priority: ${TASK_PRIORITIES.join(" | ")}`,
    "  taskKind: GENERAL | SALES_FOLLOW_UP",
    "  dueDaysOffset: عدد صحیح نامنفی — چند روز بعد از اجرای قانون سررسید شود",
    "  skipIfOpenSameKind: true | false",
    // The reminder retires itself when the record stops matching. Worth the
    // model knowing about, because a rule that chases something is exactly
    // the rule that should not leave its own reminder behind.
    "  closeWhenResolved: true | false — برای یادآوری‌ها true، برای کاری که به‌هرحال باید انجام شود false",
    "  escalateAfterOccurrences: عدد صحیح نامنفی — فقط برای قانون تکرارشونده معنی دارد.",
    "    ۰ یا نیامده یعنی بدون تشدید. از تکرار بعد از این عدد به بعد اعمال می‌شود.",
    `  escalatePriority: ${TASK_PRIORITIES.join(" | ")} — اولویت پس از تشدید`,
    "  escalateAssignedTo: مسئول پس از تشدید، از همان فهرست assignedTo",
    "  assignedTo یکی از این نشانه‌ها یا نام کامل یک کاربر:",
    assignees,
    "",
    "## متغیرهای قابل استفاده در متن‌ها",
    variables,
    "  و بسته به رویداد: {proformaNumber} {projectName} {projectCode} {poNumber}",
    "  {newStatus} {newOutcome}",
    "",
    "## قالب‌های پیام موجود (برای send_message)",
    templateList,
  ].join("\n");
}

/** The instructions, with the catalogue under them. */
export function buildWorkflowDraftPrompt(
  templates: readonly { id: string; name: string }[],
): string {
  return [
    "تو دستیار پیکربندی «قوانین گردش‌کار» یک سیستم ERP فارسی هستی.",
    "کاربر به زبان خودش می‌گوید چه اتوماسیونی می‌خواهد و تو آن را به یک قانون",
    "تبدیل می‌کنی.",
    "",
    "قواعدی که هرگز نباید بشکنی:",
    "۱) فقط و فقط از رویدادها، فیلدها و مقادیر فهرست زیر استفاده کن. اگر مقداری",
    "   در فهرست نیست، آن را ننویس — قانونی که مقدار ناموجود دارد ذخیره می‌شود،",
    "   درست به نظر می‌رسد و هرگز اجرا نمی‌شود.",
    "۲) «وضعیت ثبت‌شده پیش‌فاکتور» (proforma_status_change) فقط «پیش‌نویس» و",
    "   «ارسال شده» را دارد؛ «برنده»، «باخته» و «لغو شده» وضعیت نهایی‌اند و به",
    "   proforma_outcome_change تعلق دارند. این دو را با هم اشتباه نگیر.",
    "۳) اگر خواسته‌ی کاربر با هیچ رویدادی در فهرست قابل بیان نیست، به‌جای انتخاب",
    "   نزدیک‌ترین گزینه، فیلد refusal را پر کن و بگو چه چیزی کم است.",
    // The other half of rule ۳, and the reason it is written out: refusing is
    // right for a request the system cannot express and wrong for one it can.
    // «فلان کار هنوز انجام نشده» has no event by construction — nothing
    // happened — and is answered by the *state* the record is in, which the
    // hints under each field spell out.
    "۳-الف) ولی پیش از refusal، حتماً یک بار دنبال فیلدِ «وضعیت/مرحله» بگرد.",
    "   «هنوز فلان کار انجام نشده» رویداد ندارد — چون هیچ اتفاقی نیفتاده — و",
    "   تقریباً همیشه با time_elapsed به‌علاوهٔ شرط روی همان فیلدِ محاسبه‌شده",
    "   گفته می‌شود. توضیح زیر هر فیلد (↳) می‌گوید هر مقدار یعنی چه؛ آن را بخوان.",
    "   مثال: «۳ روز از ایجاد پروژه گذشت و استعلام قیمتی ثبت نشد» یعنی",
    "   time_elapsed + subject=project_creation + days=3 + شرط stage برابر «جدید».",
    "   فقط وقتی refusal بده که حتی با این فیلدها هم نتوان خواسته را گفت.",
    "۴) برای «چند روز بعد از یک تاریخ» دو راه هست و هر دو درست‌اند: یا رویدادِ",
    "   همان لحظه با dueDaysOffset، یا time_elapsed. اگر رویدادی برای آن لحظه",
    "   وجود دارد آن را ترجیح بده، چون وظیفه از همان ابتدا روی تخته دیده می‌شود.",
    "۵) فقط JSON برگردان، بدون توضیح و بدون بلوک کد.",
    "",
    "شکل خروجی:",
    '{"name":"...","triggerType":"...","schedule":{"subject":"...","days":2,',
    '"direction":"after"},"conditions":[{"field":"...","operator":"equals",',
    '"value":"..."}],"actions":[{"type":"create_task","taskConfig":{...}}],',
    '"summary":"یک جمله فارسی که می‌گوید این قانون کِی و چه کار می‌کند",',
    '"refusal":null}',
    "",
    workflowCatalogue(templates),
  ].join("\n");
}

/* ------------------------------ the sanitiser ----------------------------- */

const OPERATORS = ["equals", "not_equals", "greater_than", "less_than"] as const;
const ACTION_TYPES = ["create_task", "send_message", "send_notification"] as const;
const TASK_KINDS = ["GENERAL", "SALES_FOLLOW_UP"] as const;
const CHANNELS = ["SMS", "BALE", "EMAIL"] as const;

export interface DraftContext {
  /** Template ids that actually exist — a `send_message` needs one of them. */
  templateIds: readonly string[];
  /** The rule's name when the model gives none: the user's own sentence. */
  fallbackName: string;
}

export interface DraftResult {
  rule: WorkflowRule | null;
  /** One Persian sentence per thing dropped or corrected. */
  warnings: string[];
  /** Set when nothing usable came back. `rule` is null. */
  refusal: string | null;
  /** The model's own one-line description, when it gave one. */
  summary: string;
}

const text = (value: unknown, max = 400): string =>
  String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** A non-negative whole number, or the fallback. Never negative, never NaN. */
function wholeNumber(value: unknown, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * The fields a condition may name, which depend on the trigger — and for a
 * scheduled rule on the *record* its date belongs to, not on the trigger.
 */
function fieldsFor(triggerType: string, subject: string | null): readonly TriggerField[] {
  if (triggerType !== "time_elapsed") return triggerFields(triggerType);
  const model = subject ? SCHEDULE_SUBJECTS[subject]?.model : null;
  return (model && SCHEDULE_MODEL_FIELDS[model]) || [];
}

/**
 * Turns whatever the model answered into a rule this application can run, or
 * into a refusal.
 *
 * Pure and clock-free: ids are placeholders the caller re-stamps, so the same
 * input always produces the same output and `test:rules` can hold it.
 */
export function sanitizeDraftedRule(raw: unknown, ctx: DraftContext): DraftResult {
  const warnings: string[] = [];
  const answer = (raw ?? {}) as Record<string, unknown>;
  const summary = text(answer.summary, 300);

  const refusal = text(answer.refusal, 300);
  if (refusal) return { rule: null, warnings, refusal, summary };

  /*
   * The trigger is the one thing with no sensible default: a rule pointed at an
   * event this application does not emit is a rule that never runs, and quietly
   * substituting a nearby one would be the very fault this module exists to
   * avoid.
   */
  const triggerType = text(answer.triggerType, 60);
  if (!(triggerType in WORKFLOW_TRIGGERS)) {
    return {
      rule: null,
      warnings,
      refusal: `رویداد «${triggerType || "نامشخص"}» در این سیستم وجود ندارد. لطفاً خواسته‌تان را کمی دقیق‌تر بنویسید.`,
      summary,
    };
  }

  let schedule: WorkflowRule["schedule"];
  if (triggerType === "time_elapsed") {
    const rawSchedule = (answer.schedule ?? {}) as Record<string, unknown>;
    const subject = text(rawSchedule.subject, 60);
    if (!SCHEDULE_SUBJECTS[subject]) {
      return {
        rule: null,
        warnings,
        refusal: `تاریخی که قانون باید از آن بشمارد («${subject || "نامشخص"}») شناخته نشد.`,
        summary,
      };
    }
    const direction = rawSchedule.direction === "before" ? "before" : "after";
    /*
     * The repeat is clamped rather than refused: an absurd number is a rule
     * that fires too often, which a person sees on the form and corrects, while
     * refusing the whole draft over it would throw away a rule that is
     * otherwise right. Zero — the value a model omits — is the old behaviour.
     */
    schedule = {
      subject,
      days: wholeNumber(rawSchedule.days, 0),
      direction,
      repeatEveryDays: wholeNumber(rawSchedule.repeatEveryDays, 0),
      maxOccurrences: wholeNumber(rawSchedule.maxOccurrences, 0),
    };
  }

  /* ------------------------------- conditions ----------------------------- */

  const allowed = fieldsFor(triggerType, schedule?.subject ?? null);
  const conditions: WorkflowRule["conditions"] = [];

  for (const entry of (Array.isArray(answer.conditions) ? answer.conditions : []).slice(0, 8)) {
    const cond = (entry ?? {}) as Record<string, unknown>;
    const field = text(cond.field, 60);
    const spec = allowed.find((f) => f.value === field);
    if (!spec) {
      warnings.push(`شرط روی «${field || "بدون نام"}» حذف شد: این رویداد چنین فیلدی ندارد.`);
      continue;
    }

    const value = text(cond.value, 200);
    // A field with a fixed list is exactly where an invented value hides: the
    // rule saves and matches nothing, for ever, with no error anywhere.
    if (spec.options?.length && !spec.options.includes(value)) {
      warnings.push(
        `شرط «${spec.label}» حذف شد: مقدار «${value}» جزو مقادیر مجاز آن نیست (${spec.options.join("، ")}).`,
      );
      continue;
    }
    if (!value) {
      warnings.push(`شرط «${spec.label}» حذف شد: مقداری برای مقایسه تعیین نشده بود.`);
      continue;
    }

    const operator = (OPERATORS as readonly string[]).includes(String(cond.operator))
      ? (cond.operator as WorkflowRule["conditions"][number]["operator"])
      : "equals";
    conditions.push({ field, operator, value });
  }

  /* -------------------------------- actions ------------------------------- */

  const actions: WorkflowRule["actions"] = [];

  for (const entry of (Array.isArray(answer.actions) ? answer.actions : []).slice(0, 5)) {
    const action = (entry ?? {}) as Record<string, unknown>;
    const type = text(action.type, 40);
    if (!(ACTION_TYPES as readonly string[]).includes(type)) {
      warnings.push(`اقدام «${type || "بدون نوع"}» حذف شد: چنین اقدامی وجود ندارد.`);
      continue;
    }

    const id = `act-${actions.length + 1}`;

    if (type === "create_task") {
      const config = (action.taskConfig ?? {}) as Record<string, unknown>;
      const titleTemplate = text(config.titleTemplate, 200);
      if (!titleTemplate) {
        warnings.push("اقدام ساخت وظیفه حذف شد: عنوان وظیفه خالی بود.");
        continue;
      }

      const priority = (TASK_PRIORITIES as readonly string[]).includes(String(config.priority))
        ? (config.priority as "پایین" | "متوسط" | "بالا" | "فوری")
        : "متوسط";

      const assignedTo = text(config.assignedTo, 120);
      if (!assignedTo) {
        warnings.push("مسئول وظیفه تعیین نشد؛ پیش از ذخیره آن را انتخاب کنید.");
      } else if (!isAssigneeToken(assignedTo)) {
        // A person's own name is legitimate — the engine looks it up in the
        // directory — so it is passed through with a note rather than dropped.
        warnings.push(`مسئول وظیفه به‌صورت نام («${assignedTo}») تعیین شد؛ بررسی کنید چنین کاربری وجود دارد.`);
      }

      const taskKind = (TASK_KINDS as readonly string[]).includes(String(config.taskKind))
        ? (config.taskKind as "GENERAL" | "SALES_FOLLOW_UP")
        : "GENERAL";

      actions.push({
        id,
        type: "create_task",
        taskConfig: {
          titleTemplate,
          descTemplate: text(config.descTemplate, 1000),
          assignedTo,
          priority,
          dueDaysOffset: wholeNumber(config.dueDaysOffset, 0),
          taskKind,
          skipIfOpenSameKind: config.skipIfOpenSameKind === true,
          closeWhenResolved: config.closeWhenResolved === true,
          escalateAfterOccurrences: wholeNumber(config.escalateAfterOccurrences, 0),
          /*
           * The priority is checked against the list, exactly as the ordinary
           * one is — an invented value here would save cleanly and escalate to
           * a word the board cannot order. Absent is «no change», which is why
           * it falls to undefined rather than to «متوسط».
           */
          escalatePriority: (TASK_PRIORITIES as readonly string[]).includes(String(config.escalatePriority))
            ? (config.escalatePriority as "پایین" | "متوسط" | "بالا" | "فوری")
            : undefined,
          escalateAssignedTo: text(config.escalateAssignedTo, 120) || undefined,
        },
      });
      continue;
    }

    if (type === "send_message") {
      const config = (action.messageConfig ?? {}) as Record<string, unknown>;
      const templateId = text(config.templateId, 60);
      /*
       * No template, no action. The engine renders an empty body and skips the
       * send without a word, and the save handler refuses it anyway — so
       * dropping it here is what turns a silent nothing into a sentence.
       */
      if (!ctx.templateIds.includes(templateId)) {
        warnings.push(
          "اقدام ارسال پیام حذف شد: قالب پیام مشخص نشد. قالب‌ها در ماژول «ارسال پیام» ساخته می‌شوند.",
        );
        continue;
      }
      const channel = (CHANNELS as readonly string[]).includes(String(config.channel))
        ? (config.channel as "SMS" | "BALE" | "EMAIL")
        : undefined;

      actions.push({
        id,
        type: "send_message",
        messageConfig: {
          templateId,
          ...(channel ? { channel } : {}),
          delayDays: wholeNumber(config.delayDays, 0),
          ...(/^\d{1,2}:\d{2}$/.test(String(config.sendAtTime ?? ""))
            ? { sendAtTime: String(config.sendAtTime) }
            : {}),
        },
      });
      continue;
    }

    const config = (action.notificationConfig ?? {}) as Record<string, unknown>;
    const titleTemplate = text(config.titleTemplate, 200);
    if (!titleTemplate) {
      warnings.push("اقدام اعلان حذف شد: عنوان اعلان خالی بود.");
      continue;
    }
    actions.push({
      id,
      type: "send_notification",
      notificationConfig: {
        titleTemplate,
        descTemplate: text(config.descTemplate, 1000),
        module: text(config.module, 60),
      },
    });
  }

  if (actions.length === 0) {
    return {
      rule: null,
      warnings,
      refusal: "هیچ اقدام قابل اجرایی از توضیح شما ساخته نشد. بنویسید پس از وقوع رویداد دقیقاً چه اتفاقی بیفتد.",
      summary,
    };
  }

  return {
    rule: {
      // Placeholders. The screen stamps real ones, so this stays clock-free.
      id: "new-draft",
      name: text(answer.name, 120) || ctx.fallbackName.slice(0, 120),
      // A rule somebody just asked for is a rule they want; the checkbox is
      // beside it and unticking is one press. Left off, the commonest way this
      // feature fails is a perfect rule that never runs.
      active: true,
      triggerType: triggerType as WorkflowRule["triggerType"],
      ...(schedule ? { schedule } : {}),
      conditions,
      actions,
    },
    warnings,
    refusal: null,
    summary,
  };
}
