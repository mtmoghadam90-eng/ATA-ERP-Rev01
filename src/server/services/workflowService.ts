import { getDb } from "../db";
import { AuthUser } from "../auth";
import { loadSettings } from "../settings";
import { getTodayShamsi, addDaysToShamsi } from "../../dateUtils";
import { notifyModuleResponsible } from "./notificationService";
import { expandDateFields } from "../dates";
import { isChannel, renderTemplate } from "../../utils/messaging";
import { messageVariables, queueForCustomer } from "./messaging/messageService";
import { FINISHED_TASK_STATUSES, normalizeTaskKind } from "../../utils/salesFollowUp";

/**
 * Workflow automation system.
 *
 * Processes workflow rules when specific events occur (triggers).
 * Rules can create tasks, send notifications, or perform other automated actions.
 */

/**
 * The rule shape, from `src/types.ts`.
 *
 * Re-exported rather than redeclared. This file used to carry its own copy, and
 * a copy is how an action type gets added to one and not the other: the editor
 * would offer «ارسال پیام» and the engine would silently skip it, because the
 * engine's own definition said no such action existed.
 */
export type { WorkflowRule } from "../../types";
import type { WorkflowRule } from "../../types";
import { TASK_TODO } from "../../utils/workBoard";


/**
 * Turns whatever a rule names an assignee into the pair the task table stores.
 *
 * Every source here is a **display name**, not an id: the rule editor's user
 * list is built with `value={u.fullName}`, `settings.moduleResponsibles` is
 * filled from the same kind of picker, and `project.salesExpert` is a plain
 * text column. The task table keeps `assignedToUserId` and `assignedToName`
 * side by side, so the name is always recorded and the id is attached whenever
 * the name matches a real account.
 *
 * Writing the name straight into `assignedToUserId` — which is what happened
 * before — left the id column holding a Persian name, `assignedToName` empty,
 * and the task therefore absent from the assignee's list.
 *
 * `admin` is matched on username as well, because it is the fallback the rules
 * carry and it is an account name rather than a person's name.
 */
async function resolveAssignee(
  name: string,
): Promise<{ assignedToUserId: string | null; assignedToName: string }> {
  const trimmed = (name || "").trim();
  if (!trimmed) return { assignedToUserId: null, assignedToName: "" };

  const match = await getDb().user.findFirst({
    where: { OR: [{ fullName: trimmed }, { username: trimmed }] },
    select: { id: true, fullName: true },
  });

  return {
    assignedToUserId: match?.id ?? null,
    assignedToName: match?.fullName || trimmed,
  };
}

/**
 * Processes workflow rules for a given trigger.
 *
 * @param triggerType - The type of event (e.g., 'customer_created', 'proforma_outcome_change')
 * @param payload - The event data
 * @param user - The user who triggered the event (for context)
 */
export async function processWorkflowRules(
  triggerType: string,
  payload: any,
  user?: AuthUser,
): Promise<void> {
  const settings = (await loadSettings()) as any;
  const workflows = settings?.workflows || [];
  const activeRules: WorkflowRule[] = workflows.filter(
    (r: WorkflowRule) => r.active && r.triggerType === triggerType
  );

  if (activeRules.length === 0) return;

  const db = getDb();
  const enrichedPayload = await enrichPayload(payload, triggerType, db);

  for (const rule of activeRules) {
    await executeRule(rule, enrichedPayload, user, settings);
  }
}

/** Template replacement, shared by both kinds of trigger. */
function replaceTemplateVars(template: string, data: any): string {
  if (!template) return "";
  return template.replace(/\{{1,2}([^{}]+)\}{1,2}/g, (match, key) => {
    const k = key.trim();
    return data[k] !== undefined ? String(data[k]) : match;
  });
}

/**
 * One rule against one already-enriched payload.
 *
 * Split out of the loop above so a **scheduled** rule can be run the same way:
 * the time-based sweep decides *which* record is due and hands it here, and
 * everything past that point — the conditions, the assignee resolution, the
 * task and the notification — is the one implementation both kinds share. See
 * services/workflowSchedule.ts.
 */
export async function executeRule(
  rule: WorkflowRule,
  enrichedPayload: any,
  user?: AuthUser,
  loadedSettings?: any,
): Promise<void> {
  const db = getDb();
  const settings = loadedSettings ?? ((await loadSettings()) as any);

  {
    // Check conditions
    let match = true;
    for (const cond of rule.conditions ?? []) {
      const actualValue = enrichedPayload[cond.field];
      if (cond.operator === "equals" && String(actualValue) !== String(cond.value))
        match = false;
      if (cond.operator === "not_equals" && String(actualValue) === String(cond.value))
        match = false;
      if (cond.operator === "greater_than" && Number(actualValue) <= Number(cond.value))
        match = false;
      if (cond.operator === "less_than" && Number(actualValue) >= Number(cond.value))
        match = false;
    }

    if (!match) return;

    // Execute actions
    for (const action of rule.actions) {
      if (action.type === "create_task" && action.taskConfig) {
        const config = action.taskConfig;

        // Resolve assignee
        let finalAssignedTo = config.assignedTo || "admin";
        if (finalAssignedTo.startsWith("MODULE_RESPONSIBLE_")) {
          const mod = finalAssignedTo.replace("MODULE_RESPONSIBLE_", "");
          finalAssignedTo = settings?.moduleResponsibles?.[mod] || "admin";
        } else if (finalAssignedTo === "SALES_EXPERT") {
          if (enrichedPayload.projectId) {
            // The project's sales expert — a name held in its own column. This
            // read `ownerUserId`, which is a different thing: the account that
            // owns the record for visibility purposes, not the person selling.
            const proj = await db.project.findUnique({
              where: { id: enrichedPayload.projectId },
              select: { salesExpert: true },
            });
            finalAssignedTo = proj?.salesExpert || enrichedPayload.salesExpert || "admin";
          } else {
            finalAssignedTo = enrichedPayload.salesExpert || "admin";
          }
        }

        // Both date columns, through the one place that maps between the two
        // calendars. Only the Jalali half was written, so every automatic task
        // had a NULL `dueDate` and fell out of every due-date sort and filter.
        const dueDate = addDaysToShamsi(getTodayShamsi(), config.dueDaysOffset || 0);
        const assignee = await resolveAssignee(finalAssignedTo);
        const taskKind = normalizeTaskKind(config.taskKind);

        /*
         * What the task is *about*, which is not always the project.
         *
         * A payload naming a proforma attaches the task to that proforma: a
         * follow-up on «کدام پیش‌فاکتور» is the question the sales desk asks,
         * and a task pointing at the project cannot answer it when the project
         * carries three open quotations. The assignee is still resolved through
         * the project — SALES_EXPERT above — so the task is on the document and
         * on the right person's desk, which are two different questions.
         */
        const related = enrichedPayload.proformaId
          ? {
              relatedToType: "proforma",
              relatedToId: String(enrichedPayload.proformaId),
              relatedToName: enrichedPayload.proformaNumber
                ? String(enrichedPayload.proformaNumber)
                : null,
            }
          : {
              relatedToType: enrichedPayload.projectId ? "project" : null,
              relatedToId: enrichedPayload.projectId || null,
              relatedToName: enrichedPayload.projectName || null,
            };

        /*
         * Don't raise a second one while the first is still open.
         *
         * The trigger fires on every qualifying event — a quotation re-sent, a
         * status nudged back and forth — and without this each firing lands
         * another follow-up on a document somebody is already chasing. Checked
         * here rather than in the caller because the caller is the workflow
         * engine for every rule, and because the answer has to be read at the
         * moment of writing to be worth anything.
         */
        if (config.skipIfOpenSameKind && related.relatedToId) {
          const open = await db.task.findFirst({
            where: {
              taskKind,
              relatedToType: related.relatedToType,
              relatedToId: related.relatedToId,
              status: { notIn: [...FINISHED_TASK_STATUSES] },
            },
            select: { id: true },
          });
          if (open) continue;
        }

        // Create task
        await db.task.create({
          data: {
            title:
              replaceTemplateVars(config.titleTemplate, enrichedPayload) ||
              `وظیفه خودکار: ${rule.name}`,
            description: replaceTemplateVars(config.descTemplate, enrichedPayload) || "",
            ...expandDateFields({ dueDate }, ["dueDate"]),
            priority: config.priority || "متوسط",
            status: TASK_TODO,
            taskKind,
            assignedToUserId: assignee.assignedToUserId,
            assignedToName: assignee.assignedToName,
            ...related,
          },
        });
      } else if (action.type === "send_message" && action.messageConfig) {
        const config = action.messageConfig;

        /*
         * The template is read here, not in the rule.
         *
         * A rule stores the template's id so that editing the wording in one
         * place changes every rule that uses it — which is the entire reason
         * templates exist. A body written into the rule itself is the fallback
         * for a one-off.
         */
        const template = config.templateId
          ? await db.messageTemplate.findUnique({ where: { id: config.templateId } })
          : null;

        /*
         * The trigger's own values, over the ones any message can use.
         *
         * A rule's payload knows what just happened — the new status, the
         * proforma number — and knows nothing about how the customer is
         * addressed. Without the merge, a template written on the messaging
         * screen and attached to a rule ships «{namePrefix}» to the customer:
         * `renderTemplate` leaves a placeholder standing when no key backs it,
         * which is right, and there was no key. The payload wins where the two
         * overlap, since it is closer to the event.
         */
        const values: Record<string, unknown> = await messageVariables(
          enrichedPayload.customerId ?? null,
          enrichedPayload.projectId ?? null,
        );
        // Only what the payload actually has. A plain spread would let a key
        // present-but-empty on the payload blank out the resolved value, and
        // `renderTemplate` substitutes a present key however empty it is.
        for (const [key, value] of Object.entries(enrichedPayload)) {
          if (value !== undefined && value !== null && value !== "") values[key] = value;
        }

        /*
         * The template wins over anything written into the rule.
         *
         * It used to be the other way round, from when a rule could only carry
         * its own text. Templates are now written in one place — the messaging
         * module — and picked here, so a rule that still carries the older
         * inline text falls back to it and a rule that names a template gets
         * the wording whoever edits that template decides on. Two editable
         * copies of the same message is how the two come to disagree.
         */
        const body = renderTemplate(
          template?.body || config.bodyTemplate || "",
          values,
        ).trim();

        if (body) {
          /*
           * When it should arrive.
           *
           * `delayDays` moves the day and `sendAtTime` sets the hour on
           * whichever day it lands, so "three days before the expiry, at nine
           * in the morning" is two fields rather than a cron expression. Quiet
           * hours are applied after this by the queue, so a rule that asks for
           * an unsociable hour is held rather than obeyed.
           */
          const when = new Date();
          if (Number(config.delayDays) > 0) {
            when.setDate(when.getDate() + Number(config.delayDays));
          }
          const at = /^(\d{1,2}):(\d{2})$/.exec(String(config.sendAtTime ?? "").trim());
          if (at) when.setHours(Number(at[1]), Number(at[2]), 0, 0);

          const outcome = await queueForCustomer({
            customerId: enrichedPayload.customerId ?? null,
            projectId: enrichedPayload.projectId ?? null,
            channel: isChannel(config.channel) ? config.channel : null,
            subject: renderTemplate(
              template?.subject || config.subjectTemplate || "",
              values,
            ) || null,
            body,
            scheduledAt: when,
            templateId: template?.id ?? null,
            workflowRuleId: rule.id,
            workflowRuleName: rule.name,
            entityType: enrichedPayload.entityType ?? null,
            entityId: enrichedPayload.entityId ?? enrichedPayload.id ?? null,
            createdByName: `اتوماسیون: ${rule.name}`,
          });

          /*
           * A rule that cannot reach anybody is worth knowing about.
           *
           * "This customer has no mobile number" or "they opted out" is a fact
           * about the data, and a rule that silently does nothing is the kind
           * of automation people stop trusting. It goes to whoever is
           * responsible for the module rather than to a log nobody reads.
           */
          // `suppressed` is somebody having deliberately exempted this project,
          // which is not news — telling the module owner about it every time
          // would train them to ignore the notices that matter.
          if (!outcome.queued && outcome.reason && !outcome.suppressed) {
            await notifyModuleResponsible(
              "پیام‌ها",
              `پیام خودکار ارسال نشد: ${rule.name}`,
              outcome.reason,
              user,
              enrichedPayload.projectId || null,
            );
          }
        }
      } else if (action.type === "send_notification" && action.notificationConfig) {
        const config = action.notificationConfig;

        // Routed through the same helper every other notice uses, which finds
        // the module's responsible and falls back to the admins who asked to
        // hear about it. Resolving the responsible here directly meant that
        // when no account matched the configured name — including the default
        // "سیستم", which is nobody — the notice was dropped without a trace.
        await notifyModuleResponsible(
          config.module || "سیستم",
          replaceTemplateVars(config.titleTemplate, enrichedPayload) || rule.name,
          replaceTemplateVars(config.descTemplate, enrichedPayload) || "",
          user,
          enrichedPayload.projectId || null,
        );
      }
    }
  }
}

/**
 * Enriches payload with resolved names from IDs.
 */
export async function enrichPayload(payload: any, triggerType: string, db: any = getDb()): Promise<any> {
  const enriched = { ...payload };

  /*
   * 0. The proforma first, because it names the project.
   *
   * The project and customer blocks below resolve names from ids, so an id this
   * step supplies has to be in the payload before they run. It used to sit
   * fifth, which meant a rule triggered on a proforma had no `projectName` for
   * its title and no project for SALES_EXPERT to read.
   */
  if (enriched.proformaId) {
    const pf = await db.proforma.findUnique({
      where: { id: enriched.proformaId },
      // The project comes down with it so a rule triggered on a proforma can
      // still resolve SALES_EXPERT: the follow-up belongs to the document and
      // its owner belongs to the job, and a payload carrying only the first
      // leaves the assignee falling back to «admin».
      select: { proformaNumber: true, projectId: true, customerId: true },
    });
    if (pf) {
      if (!enriched.proformaNumber) enriched.proformaNumber = pf.proformaNumber;
      if (!enriched.projectId && pf.projectId) enriched.projectId = pf.projectId;
      if (!enriched.customerId && pf.customerId) enriched.customerId = pf.customerId;
    }
  }

  // 1. Resolve Project Info
  if (enriched.projectId) {
    const proj = await db.project.findUnique({
      where: { id: enriched.projectId },
      select: { name: true, code: true },
    });
    if (proj) {
      if (!enriched.projectName) enriched.projectName = proj.name;
      if (!enriched.projectCode) enriched.projectCode = proj.code;
    }
  } else if (triggerType === "project_created" || triggerType === "project_status_change") {
    if (!enriched.projectName) enriched.projectName = enriched.name;
    if (!enriched.projectCode) enriched.projectCode = enriched.code;
  }

  // 2. Resolve Customer Info
  if (enriched.customerId) {
    const cust = await db.customer.findUnique({
      where: { id: enriched.customerId },
      select: { companyName: true, firstName: true, lastName: true },
    });
    if (cust) {
      if (!enriched.customerName)
        enriched.customerName =
          cust.companyName || `${cust.firstName || ""} ${cust.lastName || ""}`.trim();
    }
  } else if (triggerType === "customer_created" || triggerType === "customer_updated") {
    if (!enriched.customerName)
      enriched.customerName = enriched.companyName || enriched.name;
  }

  // 3. Resolve Supplier Info
  if (enriched.supplierId) {
    const supp = await db.supplier.findUnique({
      where: { id: enriched.supplierId },
      select: { companyName: true },
    });
    if (supp) {
      if (!enriched.supplierName) enriched.supplierName = supp.companyName;
    }
  } else if (triggerType === "supplier_created") {
    if (!enriched.supplierName) enriched.supplierName = enriched.companyName || enriched.name;
  }

  // 4. Resolve Product Info
  if (enriched.productId) {
    const prod = await db.product.findUnique({
      where: { id: enriched.productId },
      select: { name: true },
    });
    if (prod) {
      if (!enriched.productName) enriched.productName = prod.name;
    }
  } else if (triggerType === "product_created" || triggerType === "product_low_stock") {
    if (!enriched.productName) enriched.productName = enriched.name;
  }

  // 6. Resolve Purchase Order Info
  if (enriched.purchaseOrderId) {
    const po = await db.purchaseOrder.findUnique({
      where: { id: enriched.purchaseOrderId },
      select: { poNumber: true },
    });
    if (po) {
      if (!enriched.poNumber) enriched.poNumber = po.poNumber;
    }
  }

  // 7. Sync status fields
  if (enriched.newStatus === undefined && enriched.status !== undefined) {
    enriched.newStatus = enriched.status;
  }
  if (enriched.status === undefined && enriched.newStatus !== undefined) {
    enriched.status = enriched.newStatus;
  }

  // 8. Sync outcome fields
  if (enriched.newOutcome === undefined && enriched.outcome !== undefined) {
    enriched.newOutcome = enriched.outcome;
  }
  if (enriched.outcome === undefined && enriched.newOutcome !== undefined) {
    enriched.outcome = enriched.newOutcome;
  }

  return enriched;
}
