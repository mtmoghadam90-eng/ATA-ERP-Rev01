import type { Project } from "../types";
import type { ProjectDetail, ProjectRow, ProjectWriteInput } from "./projects";

/**
 * Translation between the projects API and the `Project` shape the view was
 * written against — the same kind of seam as `customerAdapter`, and equally
 * temporary.
 *
 * The differences are all deliberate on the server side: the customer's name is
 * joined rather than denormalized onto the row, items are a child table rather
 * than an inline array, custom values are a JSON column, and the three contact
 * fields are real foreign keys where the client type holds bare strings.
 */

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    // One malformed record must not take out the grid.
    return fallback;
  }
}

/** A grid row, in the shape the existing table markup expects. */
export function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status as Project["status"],
    customerId: row.customerId,
    // The view reads this directly; on the server it is a join, not a column.
    customerName: row.customer?.companyName ?? "",
    creationDate: row.creationDateJalali ?? "",
    opportunityDate: row.opportunityDateJalali ?? undefined,
    expectedCloseDate: row.expectedCloseDateJalali ?? undefined,
    winningDate: row.winningDateJalali ?? undefined,
    agreedDeliveryDate: row.agreedDeliveryDateJalali ?? undefined,
    estimatedValueRIYAL: row.estimatedValueRial ? Number(row.estimatedValueRial) : undefined,
    probabilityPercent: row.probabilityPercent ?? undefined,
    marketingChannel: row.marketingChannel ?? undefined,
    leadQuality: row.leadQuality ?? undefined,
    salesExpert: row.salesExpert ?? undefined,
    description: "",
  } as Project;
}

/** The full record, for the detail and edit views. */
export function detailToProject(detail: ProjectDetail): Project {
  return {
    ...rowToProject(detail),
    description: detail.description ?? "",
    lossReason: detail.lossReason ?? undefined,
    closingDate: detail.closingDateJalali ?? undefined,
    communicationMethod: detail.communicationMethod ?? undefined,
    customerInquiryNumber: detail.customerInquiryNumber ?? undefined,
    referrerName: detail.referrerName ?? undefined,
    salesExpert: detail.salesExpert ?? undefined,
    // The view shows names; the record stores both string fields and FK ids
    endUser: detail.endUser ?? detail.endUserCustomer?.companyName ?? undefined,
    financialContact: detail.financialContact ?? detail.financialContactCustomer?.companyName ?? undefined,
    technicalContact: detail.technicalContact ?? detail.technicalContactCustomer?.companyName ?? undefined,
    itemsNeeded: detail.items.map((item) => ({
      productId: item.productId ?? "",
      variantId: item.variantId ?? undefined,
      name: item.name,
      quantity: Number(item.quantity),
      supplyMethod: (item.supplyMethod ?? undefined) as never,
      category: (item.category ?? undefined) as never,
      equipmentType: item.equipmentType ?? undefined,
      size: item.size ?? undefined,
      tagNumber: item.tagNumber ?? undefined,
    })),
    milestones: detail.milestones.map((m) => ({
      id: m.id,
      name: m.name,
      isCompleted: m.isCompleted,
      completedAt: m.completedAtJalali ?? undefined,
      dueDate: m.dueDateJalali ?? undefined,
      notes: m.notes ?? undefined,
      triggerType: (m.triggerType ?? undefined) as never,
      triggerCategoryName: m.triggerCategoryName ?? undefined,
    })),
    attachments: parseJson(detail.attachments, [] as Project["attachments"]),
    manualDocuments: parseJson(detail.manualDocuments, [] as Project["manualDocuments"]),
    milestoneRules: parseJson(detail.milestoneRules, [] as Project["milestoneRules"]),
    customValues: parseJson(detail.customValues, {} as Record<string, unknown>),
  } as Project;
}

/**
 * A form's state, as the write endpoint wants it.
 *
 * The three contact fields are ids here. The view holds them as ids too — it
 * only ever rendered them as names — so the caller passes them through directly
 * rather than this guessing from a display string.
 */
export function projectToWriteInput(
  project: Partial<Project> & {
    endUserCustomerId?: string | null;
    financialContactId?: string | null;
    technicalContactId?: string | null;
    ownerUserId?: string | null;
  },
): ProjectWriteInput {
  return {
    code: project.code,
    name: project.name,
    customerId: project.customerId,
    status: project.status,
    lossReason: project.lossReason ?? null,
    description: project.description ?? null,
    estimatedValueRial: project.estimatedValueRIYAL ?? null,
    probabilityPercent: project.probabilityPercent ?? null,
    marketingChannel: project.marketingChannel ?? null,
    leadQuality: project.leadQuality ?? null,
    referrerName: project.referrerName ?? null,
    communicationMethod: project.communicationMethod ?? null,
    customerInquiryNumber: project.customerInquiryNumber ?? null,
    salesExpert: project.salesExpert ?? null,
    financialContact: project.financialContact ?? null,
    technicalContact: project.technicalContact ?? null,
    endUser: project.endUser ?? null,
    ownerUserId: project.ownerUserId ?? null,
    endUserCustomerId: project.endUserCustomerId ?? null,
    financialContactId: project.financialContactId ?? null,
    technicalContactId: project.technicalContactId ?? null,
    // Default creationDate to opportunityDate if not set (for new projects)
    creationDate: project.creationDate ?? project.opportunityDate ?? null,
    opportunityDate: project.opportunityDate ?? null,
    expectedCloseDate: project.expectedCloseDate ?? null,
    winningDate: project.winningDate ?? null,
    agreedDeliveryDate: project.agreedDeliveryDate ?? null,
    closingDate: project.closingDate ?? null,
    attachments: project.attachments,
    manualDocuments: project.manualDocuments,
    milestoneRules: project.milestoneRules,
    customValues: project.customValues,
    items: (project.itemsNeeded ?? []).map((item) => ({
      productId: item.productId || null,
      variantId: item.variantId || null,
      name: item.name,
      quantity: item.quantity,
      supplyMethod: item.supplyMethod ?? null,
      category: item.category ?? null,
      equipmentType: item.equipmentType ?? null,
      size: item.size ?? null,
      tagNumber: item.tagNumber ?? null,
    })),
    milestones: (project.milestones ?? []).map((m) => ({
      name: m.name,
      isCompleted: m.isCompleted,
      completedAt: m.completedAt ?? null,
      dueDate: m.dueDate ?? null,
      notes: m.notes ?? null,
      triggerType: m.triggerType ?? null,
      triggerCategoryName: m.triggerCategoryName ?? null,
    })),
  };
}
