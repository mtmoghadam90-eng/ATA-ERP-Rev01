import {
  Customer, Project, Proforma, Transaction, Task,
  SupplierInquiry, PurchaseOrder, PackagingDelivery, AfterSalesService,
} from '../types';
import { getCustomerName } from './customerLabel';

/**
 * Reassigning a customer's history to a replacement customer before deletion.
 *
 * Deleting a customer used to silently orphan every project, proforma, transaction
 * and task that referenced it. These helpers count what points at a customer and
 * rewrite those references onto a replacement, so nothing is left dangling.
 *
 * Records that link to a customer only *through* a project (supplier inquiries,
 * purchase orders, packing lists, after-sales services, activity groups) need no
 * field changes — the project keeps its identity and simply changes owner. They
 * are still counted so the user sees the full blast radius.
 */

export interface CustomerCollections {
  projects: Project[];
  proformas: Proforma[];
  transactions: Transaction[];
  tasks: Task[];
  customers: Customer[];
  supplierInquiries?: SupplierInquiry[];
  purchaseOrders?: PurchaseOrder[];
  packagingDeliveries?: PackagingDelivery[];
  afterSalesServices?: AfterSalesService[];
}

export interface CustomerReferenceCounts {
  /** Owner of the project (project.customerId). */
  projects: number;
  /** Referenced as end-user / financial contact / technical contact on a project. */
  projectRoles: number;
  proformas: number;
  /** Referenced as the contact person on a proforma. */
  proformaContacts: number;
  transactions: number;
  tasks: number;
  /** Other customers that list this one in linkedCustomerIds. */
  linkedCustomers: number;
  // Indirect (follow the project automatically):
  supplierInquiries: number;
  purchaseOrders: number;
  packagingDeliveries: number;
  afterSalesServices: number;
  /** Total number of records that reference this customer in any way. */
  total: number;
}

const EMPTY_COUNTS: CustomerReferenceCounts = {
  projects: 0, projectRoles: 0, proformas: 0, proformaContacts: 0,
  transactions: 0, tasks: 0, linkedCustomers: 0,
  supplierInquiries: 0, purchaseOrders: 0, packagingDeliveries: 0, afterSalesServices: 0,
  total: 0,
};

/** Human-readable label for each countable reference kind. */
export const REFERENCE_LABELS: Record<keyof Omit<CustomerReferenceCounts, 'total'>, string> = {
  projects: 'پروژه',
  projectRoles: 'نقش در پروژه (مصرف‌کننده/فرد کلیدی)',
  proformas: 'پیش‌فاکتور',
  proformaContacts: 'مخاطب پیش‌فاکتور',
  transactions: 'تراکنش مالی',
  tasks: 'وظیفه',
  linkedCustomers: 'ارتباط با مشتری دیگر',
  supplierInquiries: 'استعلام تأمین‌کننده',
  purchaseOrders: 'سفارش خرید',
  packagingDeliveries: 'بسته‌بندی و تحویل',
  afterSalesServices: 'خدمات پس از فروش',
};

/** Counts every record referencing the given customer, directly or via its projects. */
export function countCustomerReferences(
  customerId: string,
  col: CustomerCollections,
): CustomerReferenceCounts {
  if (!customerId) return { ...EMPTY_COUNTS };

  const counts: CustomerReferenceCounts = { ...EMPTY_COUNTS };

  const ownedProjects = (col.projects || []).filter((p) => p.customerId === customerId);
  counts.projects = ownedProjects.length;

  counts.projectRoles = (col.projects || []).filter(
    (p) =>
      p.customerId !== customerId &&
      (p.endUser === customerId ||
        p.financialContact === customerId ||
        p.technicalContact === customerId),
  ).length;

  counts.proformas = (col.proformas || []).filter((pf) => pf.customerId === customerId).length;
  counts.proformaContacts = (col.proformas || []).filter(
    (pf) => pf.customerId !== customerId && pf.contactCustomerId === customerId,
  ).length;

  counts.transactions = (col.transactions || []).filter((t) => t.customerId === customerId).length;

  counts.tasks = (col.tasks || []).filter(
    (t) => t.relatedToType === 'مشتری' && t.relatedToId === customerId,
  ).length;

  counts.linkedCustomers = (col.customers || []).filter(
    (c) => c.id !== customerId && (c.linkedCustomerIds || []).includes(customerId),
  ).length;

  // Indirect: anything attached to one of this customer's projects.
  const projectIds = new Set(ownedProjects.map((p) => p.id));
  if (projectIds.size > 0) {
    counts.supplierInquiries = (col.supplierInquiries || []).filter((x) => projectIds.has(x.projectId)).length;
    counts.purchaseOrders = (col.purchaseOrders || []).filter((x) => x.projectId && projectIds.has(x.projectId)).length;
    counts.packagingDeliveries = (col.packagingDeliveries || []).filter((x) => projectIds.has(x.projectId)).length;
    counts.afterSalesServices = (col.afterSalesServices || []).filter((x) => projectIds.has(x.projectId)).length;
  }

  counts.total =
    counts.projects + counts.projectRoles + counts.proformas + counts.proformaContacts +
    counts.transactions + counts.tasks + counts.linkedCustomers +
    counts.supplierInquiries + counts.purchaseOrders + counts.packagingDeliveries +
    counts.afterSalesServices;

  return counts;
}

export function hasCustomerReferences(counts: CustomerReferenceCounts): boolean {
  return counts.total > 0;
}

/** Returns only the non-zero counts, as {label, count} pairs for display. */
export function summarizeReferences(
  counts: CustomerReferenceCounts,
): { label: string; count: number }[] {
  return (Object.keys(REFERENCE_LABELS) as (keyof typeof REFERENCE_LABELS)[])
    .filter((k) => counts[k] > 0)
    .map((k) => ({ label: REFERENCE_LABELS[k], count: counts[k] }));
}

export interface MigrationResult {
  projects: Project[];
  proformas: Proforma[];
  transactions: Transaction[];
  tasks: Task[];
  /** Customers with links rewritten — the deleted customer is NOT removed here. */
  customers: Customer[];
}

/**
 * Rewrites every reference from `fromId` onto `replacement`.
 * Returns new arrays; the caller persists them and then removes the old customer.
 */
export function migrateCustomerReferences(
  fromId: string,
  replacement: Customer,
  col: CustomerCollections,
): MigrationResult {
  const toId = replacement.id;
  const toName = replacement.companyName || getCustomerName(replacement);

  const projects = (col.projects || []).map((p) => {
    let next = p;
    if (p.customerId === fromId) {
      next = { ...next, customerId: toId, customerName: toName };
    }
    if (p.endUser === fromId) next = { ...next, endUser: toId };
    if (p.financialContact === fromId) next = { ...next, financialContact: toId };
    if (p.technicalContact === fromId) next = { ...next, technicalContact: toId };
    return next;
  });

  const proformas = (col.proformas || []).map((pf) => {
    let next = pf;
    if (pf.customerId === fromId) {
      next = { ...next, customerId: toId, customerName: toName };
    }
    if (pf.contactCustomerId === fromId) {
      next = { ...next, contactCustomerId: toId, contactName: getCustomerName(replacement) };
    }
    return next;
  });

  const transactions = (col.transactions || []).map((t) =>
    t.customerId === fromId ? { ...t, customerId: toId, customerName: toName } : t,
  );

  const tasks = (col.tasks || []).map((t) =>
    t.relatedToType === 'مشتری' && t.relatedToId === fromId
      ? { ...t, relatedToId: toId, relatedToName: toName }
      : t,
  );

  // Rewrite links on other customers, avoiding duplicates and self-links.
  const customers = (col.customers || []).map((c) => {
    const links = c.linkedCustomerIds || [];
    if (!links.includes(fromId)) return c;
    const rewritten = links.filter((id) => id !== fromId);
    if (c.id !== toId && !rewritten.includes(toId)) rewritten.push(toId);
    return { ...c, linkedCustomerIds: rewritten };
  });

  return { projects, proformas, transactions, tasks, customers };
}
