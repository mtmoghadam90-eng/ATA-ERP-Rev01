import { getDb } from "../db";
import { AuthUser } from "../auth";
import { loadSettings } from "../settings";
import { getTodayShamsi, addDaysToShamsi } from "../../dateUtils";

/**
 * Workflow automation system.
 *
 * Processes workflow rules when specific events occur (triggers).
 * Rules can create tasks, send notifications, or perform other automated actions.
 */

interface WorkflowRule {
  id: string;
  name: string;
  active: boolean;
  triggerType: string;
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

  // Enrich payload with resolved names
  const enrichedPayload = await enrichPayload(payload, triggerType, db);

  // Template replacement helper
  const replaceTemplateVars = (template: string, data: any): string => {
    if (!template) return "";
    return template.replace(/\{{1,2}([^{}]+)\}{1,2}/g, (match, key) => {
      const k = key.trim();
      return data[k] !== undefined ? String(data[k]) : match;
    });
  };

  // Process each matching rule
  for (const rule of activeRules) {
    // Check conditions
    let match = true;
    for (const cond of rule.conditions) {
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

    if (!match) continue;

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
            const proj = await db.project.findUnique({
              where: { id: enrichedPayload.projectId },
              select: { ownerUserId: true },
            });
            finalAssignedTo = proj?.ownerUserId || enrichedPayload.salesExpert || "admin";
          } else {
            finalAssignedTo = enrichedPayload.salesExpert || "admin";
          }
        }

        const dueDateJalali = addDaysToShamsi(getTodayShamsi(), config.dueDaysOffset || 0);

        // Create task
        await db.task.create({
          data: {
            title:
              replaceTemplateVars(config.titleTemplate, enrichedPayload) ||
              `وظیفه خودکار: ${rule.name}`,
            description: replaceTemplateVars(config.descTemplate, enrichedPayload) || "",
            dueDateJalali,
            priority: config.priority || "متوسط",
            status: "در انتظار",
            assignedToUserId: finalAssignedTo,
            relatedToType: enrichedPayload.projectId ? "project" : null,
            relatedToId: enrichedPayload.projectId || null,
          },
        });
      } else if (action.type === "send_notification" && action.notificationConfig) {
        const config = action.notificationConfig;

        let responsible = "سیستم";
        if (settings?.moduleResponsibles?.[config.module]) {
          responsible = settings.moduleResponsibles[config.module];
        }

        // Find user by fullName
        const responsibleUser = await db.user.findFirst({
          where: { fullName: responsible },
          select: { id: true },
        });

        if (responsibleUser) {
          await db.moduleNotification.create({
            data: {
              userId: responsibleUser.id,
              module: config.module || "سیستم",
              title: replaceTemplateVars(config.titleTemplate, enrichedPayload) || rule.name,
              description: replaceTemplateVars(config.descTemplate, enrichedPayload) || "",
              projectId: enrichedPayload.projectId || null,
            },
          });
        }
      }
    }
  }
}

/**
 * Enriches payload with resolved names from IDs.
 */
async function enrichPayload(payload: any, triggerType: string, db: any): Promise<any> {
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
