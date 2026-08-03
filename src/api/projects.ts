import { ListResponse, api } from "./client";

/**
 * Project endpoints.
 *
 * List rows carry a `summary`: the derived figures the grid shows — pipeline
 * value, prepayment date, the agreed-versus-actual delivery schedule. Those are
 * computed server-side for the whole page, because deriving them in the browser
 * meant holding proformas, transactions and packing lists in memory and scanning
 * all three once per visible row.
 */

export interface DeliveryLine {
  id: string;
  productName: string;
  deliveryText: string;
  calculatedDate: string | null;
}

export interface ActualDeliveryLine {
  id: string;
  productName: string;
  actualDate: string;
  boxNumber: string | null;
}

/** A won line, with how it will be supplied — resolved server-side. */
export interface WonItem {
  id: string;
  productName: string;
  productCode: string;
  brand: string;
  quantity: string;
  supplyMethod: string;
  proformaId: string;
  proformaNumber: string;
  proformaStatus: string;
}

export interface ProjectSummary {
  wonItems: WonItem[];
  pipelineValue: string;
  pipelineCurrency: string;
  prepaymentDate: string | null;
  approvedDeliveryDate: string | null;
  actualDeliveryDate: string | null;
  agreedItems: DeliveryLine[];
  actualItems: ActualDeliveryLine[];
  singleActualDate: string | null;
  counts: { proformas: number; deliveries: number; receipts: number };
}

/** One entry in the documents tab. Paths and names only — never file contents. */
export interface ProjectDocument {
  id: string;
  name: string;
  url: string;
  size: string;
  date: string;
  type: string;
}

export interface ProjectRow {
  id: string;
  code: string;
  name: string;
  status: string;
  customerId: string;
  creationDate: string | null;
  creationDateJalali: string | null;
  expectedCloseDate: string | null;
  expectedCloseDateJalali: string | null;
  winningDateJalali: string | null;
  opportunityDateJalali: string | null;
  agreedDeliveryDateJalali: string | null;
  estimatedValueRial: string | null;
  probabilityPercent: number | null;
  marketingChannel: string | null;
  leadQuality: string | null;
  ownerUserId: string | null;
  createdAt: string;
  customer: { id: string; companyName: string } | null;
  owner: { id: string; fullName: string } | null;
  // `categoryGroups` counts only the in-progress ones (the grid's activity pulse).
  _count: { items: number; proformas: number; categoryGroups: number };
  summary: ProjectSummary | null;
}

export interface ProjectItemRow {
  id: string;
  lineNo: number;
  productId: string | null;
  variantId: string | null;
  name: string;
  quantity: string;
  supplyMethod: string | null;
  category: string | null;
  equipmentType: string | null;
  size: string | null;
  tagNumber: string | null;
}

export interface ProjectMilestoneRow {
  id: string;
  lineNo: number;
  name: string;
  isCompleted: boolean;
  completedAtJalali: string | null;
  dueDateJalali: string | null;
  notes: string | null;
  triggerType: string | null;
  triggerCategoryName: string | null;
}

export interface ProjectDetail extends ProjectRow {
  lossReason: string | null;
  description: string | null;
  communicationMethod: string | null;
  customerInquiryNumber: string | null;
  referrerName: string | null;
  closingDateJalali: string | null;
  endUserCustomerId: string | null;
  financialContactId: string | null;
  technicalContactId: string | null;
  attachments: string | null;
  manualDocuments: string | null;
  milestoneRules: string | null;
  customValues: string | null;
  endUser: { id: string; companyName: string } | null;
  financialContact: { id: string; companyName: string } | null;
  technicalContact: { id: string; companyName: string } | null;
  items: ProjectItemRow[];
  milestones: ProjectMilestoneRow[];
  categoryGroups: unknown[];
}

/** What blocks deleting a project. */
export interface ProjectReferences {
  proformas: number;
  purchaseOrders: number;
  transactions: number;
  inquiries: number;
  deliveries: number;
  services: number;
  total: number;
}

export interface ProjectWriteInput {
  code?: string;
  name?: string;
  customerId?: string;
  status?: string;
  lossReason?: string | null;
  description?: string | null;
  estimatedValueRial?: unknown;
  probabilityPercent?: unknown;
  marketingChannel?: string | null;
  leadQuality?: string | null;
  referrerName?: string | null;
  communicationMethod?: string | null;
  customerInquiryNumber?: string | null;
  ownerUserId?: string | null;
  endUserCustomerId?: string | null;
  financialContactId?: string | null;
  technicalContactId?: string | null;
  attachments?: unknown;
  manualDocuments?: unknown;
  milestoneRules?: unknown;
  customValues?: unknown;
  creationDate?: string | null;
  opportunityDate?: string | null;
  expectedCloseDate?: string | null;
  winningDate?: string | null;
  agreedDeliveryDate?: string | null;
  closingDate?: string | null;
  items?: Record<string, unknown>[];
  milestones?: Record<string, unknown>[];
}

/* ---------------------- category groups & activities --------------------- */

/** One reply in a referral thread, as the server stores it. */
export interface ActivityReferralMessageRow {
  id: string;
  text: string;
  responderUserId: string | null;
  responderName: string | null;
  attachmentName: string | null;
  attachmentSize: string | null;
  attachmentUrl: string | null;
  createdAt: string;
}

/** The referral raised alongside an activity, addressed to one colleague. */
export interface ActivityReferralRow {
  id: string;
  activityId: string;
  status: string;
  actionRequired: string | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  assignedByUserId: string | null;
  assignedByName: string | null;
  createdAt: string;
  messages: ActivityReferralMessageRow[];
}

/** One activity in a category's feed. */
export interface ActivityRow {
  id: string;
  groupId: string;
  text: string;
  authorUserId: string | null;
  authorName: string | null;
  attachmentName: string | null;
  attachmentSize: string | null;
  attachmentUrl: string | null;
  createdAt: string;
  referral: ActivityReferralRow | null;
}

/** An activity category activated on a project, with its feed. */
export interface CategoryGroupRow {
  id: string;
  projectId: string;
  categoryId: string;
  categoryName: string;
  status: string;
  startDate: string | null;
  startDateJalali: string | null;
  endDate: string | null;
  endDateJalali: string | null;
  createdAt: string;
  activities: ActivityRow[];
}

export const projectsApi = {
  list: (query: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    api.get<ListResponse<ProjectRow>>("/api/projects", query, signal),

  get: (id: string) =>
    api.get<{ project: ProjectDetail }>(`/api/projects/${id}`).then((r) => r.project),

  references: (id: string) =>
    api.get<{ references: ProjectReferences }>(`/api/projects/${id}/references`)
      .then((r) => r.references),

  /** Status counts and value totals, aggregated in SQL for the dashboard. */
  summary: () =>
    api.get<{ summary: { total: number; totalEstimatedValueRial: string; byStatus: { status: string; count: number; estimatedValueRial: string }[] } }>(
      "/api/projects/summary").then((r) => r.summary),

  create: (input: ProjectWriteInput) =>
    api.post<{ project: ProjectDetail }>("/api/projects", input).then((r) => r.project),

  update: (id: string, input: ProjectWriteInput) =>
    api.put<{ project: ProjectDetail }>(`/api/projects/${id}`, input).then((r) => r.project),

  remove: (id: string) => api.delete<Record<string, never>>(`/api/projects/${id}`),

  /**
   * Every project matching a query, for export only. The server caps a page at
   * 200, so a large export is several round trips.
   */
  listAll: async (
    query: Record<string, string | number | undefined>,
    options: { limit?: number; onProgress?: (loaded: number, total: number) => void } = {},
  ): Promise<ProjectRow[]> => {
    const { limit = 20_000, onProgress } = options;
    const rows: ProjectRow[] = [];
    let page = 1;

    for (;;) {
      const batch = await api.get<ListResponse<ProjectRow>>("/api/projects", {
        ...query, page, pageSize: 200,
      });
      rows.push(...batch.rows);
      onProgress?.(rows.length, batch.total);

      if (rows.length >= Math.min(batch.total, limit)) break;
      if (batch.rows.length === 0 || page >= batch.totalPages) break;
      page++;
    }
    return rows.slice(0, limit);
  },

  /**
   * The documents tab's contents, grouped by folder.
   *
   * Separate from `get` because it touches seven tables — the project's own
   * attachments plus its proformas, inquiries, orders, packing lists,
   * transactions and services. Fetched when the tab is opened, not before.
   */
  documents: (projectId: string) =>
    api.get<{ folders: { id: string; name: string }[]; documents: Record<string, ProjectDocument[]> }>(
      `/api/projects/${projectId}/documents`).then((r) => r.documents),

  /* ------------------------ activity & referrals ------------------------ */

  categoryGroups: (projectId: string) =>
    api.get<{ groups: CategoryGroupRow[] }>(`/api/projects/${projectId}/category-groups`)
      .then((r) => r.groups),

  upsertCategoryGroup: (
    projectId: string,
    body: { categoryId: string; categoryName: string; status?: string; startDate?: string; endDate?: string },
  ) => api.put<{ group: CategoryGroupRow }>(`/api/projects/${projectId}/category-groups`, body).then((r) => r.group),

  deleteCategoryGroup: (id: string) =>
    api.delete<Record<string, never>>(`/api/category-groups/${id}`),

  addActivity: (body: {
    groupId: string;
    text: string;
    attachmentName?: string | null;
    attachmentSize?: string | null;
    attachmentUrl?: string | null;
    referral?: { assignedToUserId?: string | null; assignedToName?: string | null; actionRequired?: string };
  }) => api.post<{ activity: ActivityRow }>("/api/activities", body).then((r) => r.activity),

  updateActivity: (id: string, text: string) =>
    api.put<{ activity: ActivityRow }>(`/api/activities/${id}`, { text }).then((r) => r.activity),

  deleteActivity: (id: string) => api.delete<Record<string, never>>(`/api/activities/${id}`),
};
