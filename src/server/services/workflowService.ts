import { getDb } from "../db";
import { AuthUser } from "../auth";
import { loadSettings } from "../settings";
import { getTodayShamsi, addDaysToShamsi } from "../../dateUtils";
import { notifyModuleResponsible } from "./notificationService";
import { expandDateFields } from "../dates";

/**
 * Workflow automation system.
 *
 * Processes workflow rules when specific events occur (triggers).
 * Rules can create tasks, send notifications, or perform other automated actions.
 */

export interface WorkflowRule {
  id: string;
  name: string;
  active: boolean;
  triggerType: string;
  /** Set on a time-based rule — see services/workflowSchedule.ts. */
  schedule?: { subject: string; days: number };
  conditions: Array<{
    field: string;
    operator: "equals" | "not_equals" | "greater_than" | "less_than";
    value: string | number;
  }>;
  actions: Array<{
    type: "create_task" | "send_notification";
    taskConfig?: {
      titleTemplate: string;
      descTemplate: string;
      assignedTo: string;
      priority: string;
      dueDaysOffset: number;
    };
    notificationConfig?: {
      module: string;
      titleTemplate: string;
      descTemplate: string;
    };
  }>;
}

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

        // Create task
        await db.task.create({
          data: {
            title:
              replaceTemplateVars(config.titleTemplate, enrichedPayload) ||
              `وظیفه خودکار: ${rule.name}`,
            description: replaceTemplateVars(config.descTemplate, enrichedPayload) || "",
            ...expandDateFields({ dueDate }, ["dueDate"]),
            priority: config.priority || "متوسط",
            status: "در انتظار",
            assignedToUserId: assignee.assignedToUserId,
            assignedToName: assignee.assignedToName,
            relatedToType: enrichedPayload.projectId ? "project" : null,
            relatedToId: enrichedPayload.projectId || null,
            relatedToName: enrichedPayload.projectName || null,
          },
        });
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

  // 5. Resolve Proforma Info
  if (enriched.proformaId) {
    const pf = await db.proforma.findUnique({
      where: { id: enriched.proformaId },
      select: { proformaNumber: true },
    });
    if (pf) {
      if (!enriched.proformaNumber) enriched.proformaNumber = pf.proformaNumber;
    }
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
