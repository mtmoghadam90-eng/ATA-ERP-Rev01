import { getDb } from "../db";
import { fromJsonColumn } from "../childSync";

/**
 * Every document attached to a project, grouped into the folders the UI shows.
 *
 * A project's paperwork is scattered across seven tables — its own attachments,
 * its proformas, supplier inquiries, purchase orders, packing lists, financial
 * transactions and after-sales records. The client used to assemble this by
 * holding all seven collections and filtering each one by project id.
 *
 * Here it is one call per project, and only when the documents tab is opened.
 * File *contents* are never touched: these are paths and names, which is all the
 * tab renders.
 */

export const DOCUMENT_FOLDERS = [
  { id: "customer_inquiry", name: "درخواست مشتری و استعلام اولیه" },
  { id: "sales_proforma", name: "پیش‌فاکتورها و مهندسی فروش" },
  { id: "supplier_inquiry", name: "استعلام قیمت تأمین‌کنندگان" },
  { id: "supplier_po", name: "سفارشات خرید تامین‌کنندگان" },
  { id: "packaging_delivery", name: "بسته‌بندی و تحویل کالا" },
  { id: "financial_transactions", name: "تراکنش‌های مالی و پرداخت‌ها" },
  { id: "after_sales", name: "خدمات پس از فروش" },
  { id: "manual_other", name: "سایر مدارک و فایل‌های دستی" },
] as const;

const MANUAL_FOLDER = "سایر مدارک و فایل‌های دستی";

export interface ProjectDocument {
  id: string;
  name: string;
  url: string;
  size: string;
  date: string;
  type: string;
  /**
   * Whether this is a record the app renders on demand rather than a file that
   * exists.
   *
   * It matters because the two are handled completely differently: a real file
   * is fetched and saved, a generated one is opened in its module's printable
   * view. The tab used to tell them apart by guessing from the id, with
   * prefixes that did not match what this builder emits — so the download
   * button fetched the application's own HTML shell and saved it under a .pdf
   * name. That is the "corrupt PDF" people were opening.
   */
  generated?: boolean;
}

export type ProjectDocuments = Record<string, ProjectDocument[]>;

interface Attachment { name?: string; url?: string; size?: string }

/** Reads an attachment array out of a JSON column, tolerating bad data. */
function attachmentsOf(raw: string | null): Attachment[] {
  const parsed = fromJsonColumn<unknown>(raw, []);
  return Array.isArray(parsed) ? (parsed as Attachment[]) : [];
}

export async function listProjectDocuments(projectId: string): Promise<ProjectDocuments> {
  const db = getDb();

  const folders: ProjectDocuments = {};
  for (const folder of DOCUMENT_FOLDERS) folders[folder.name] = [];

  const [project, proformas, inquiries, purchaseOrders, deliveries, transactions, services] =
    await Promise.all([
      db.project.findUnique({
        where: { id: projectId },
        select: { id: true, creationDateJalali: true, attachments: true, manualDocuments: true },
      }),
      db.proforma.findMany({
        where: { projectId },
        select: { id: true, proformaNumber: true, issueDateJalali: true, customer: { select: { companyName: true } } },
      }),
      db.supplierInquiry.findMany({
        where: { projectId },
        select: {
          id: true, creationDateJalali: true, technicalOfferUrl: true, financialOfferUrl: true,
          supplier: { select: { name: true } },
        },
      }),
      db.purchaseOrder.findMany({
        where: { projectId },
        select: { id: true, poNumber: true, orderDateJalali: true, supplier: { select: { name: true } } },
      }),
      db.packagingDelivery.findMany({
        where: { projectId },
        select: { id: true, packingListNumber: true, deliveryDateJalali: true, photos: true },
      }),
      db.transaction.findMany({
        where: { projectId },
        select: { id: true, documentNumber: true, type: true, occurredAtJalali: true },
      }),
      db.afterSalesService.findMany({
        where: { projectId },
        select: { id: true, itemName: true, status: true, startDateJalali: true },
      }),
    ]);

  if (!project) return folders;

  const fallbackDate = project.creationDateJalali ?? "مشخص نشده";

  // 1. The project's own request attachments.
  attachmentsOf(project.attachments).forEach((att, index) => {
    if (!att?.url) return;
    folders["درخواست مشتری و استعلام اولیه"].push({
      id: `attachment-${index}`,
      name: att.name || `فایل درخواست ${index + 1}`,
      url: att.url,
      size: att.size || "پیوست پروژه",
      date: fallbackDate,
      type: "attachment",
    });
  });

  // 2..7 are generated documents rather than uploaded files: the tab links to
  // the printable view of each, which is why they carry a route, not a path.
  for (const pf of proformas) {
    folders["پیش‌فاکتورها و مهندسی فروش"].push({
      id: `proforma-${pf.id}`,
      name: `پیش‌فاکتور ${pf.proformaNumber} - مشتری: ${pf.customer?.companyName ?? "—"}`,
      url: `?printModule=proformas&printId=${pf.id}`,
      size: "سند سیستمی",
      date: pf.issueDateJalali ?? fallbackDate,
      type: "proforma",
      generated: true,
    });
  }

  for (const inq of inquiries) {
    // An inquiry carries up to two real uploaded offers.
    if (inq.technicalOfferUrl) {
      folders["استعلام قیمت تأمین‌کنندگان"].push({
        id: `inquiry-tech-${inq.id}`,
        name: `آفر فنی - ${inq.supplier?.name ?? "تأمین‌کننده"}`,
        url: inq.technicalOfferUrl,
        size: "آفر فنی",
        date: inq.creationDateJalali ?? fallbackDate,
        type: "inquiry",
      });
    }
    if (inq.financialOfferUrl) {
      folders["استعلام قیمت تأمین‌کنندگان"].push({
        id: `inquiry-fin-${inq.id}`,
        name: `آفر مالی - ${inq.supplier?.name ?? "تأمین‌کننده"}`,
        url: inq.financialOfferUrl,
        size: "آفر مالی",
        date: inq.creationDateJalali ?? fallbackDate,
        type: "inquiry",
      });
    }
  }

  for (const po of purchaseOrders) {
    folders["سفارشات خرید تامین‌کنندگان"].push({
      id: `po-${po.id}`,
      name: `سفارش خرید ${po.poNumber} - ${po.supplier?.name ?? "تأمین‌کننده"}`,
      url: `?printModule=purchaseOrders&printId=${po.id}`,
      size: "سند سیستمی",
      date: po.orderDateJalali ?? fallbackDate,
      type: "purchaseOrder",
      generated: true,
    });
  }

  for (const del of deliveries) {
    folders["بسته‌بندی و تحویل کالا"].push({
      id: `delivery-${del.id}`,
      name: `پکینگ لیست ${del.packingListNumber}`,
      url: `?printModule=packagingDelivery&printId=${del.id}`,
      size: "سند سیستمی",
      date: del.deliveryDateJalali ?? fallbackDate,
      type: "delivery",
      generated: true,
    });
    attachmentsOf(del.photos).forEach((photo, index) => {
      if (!photo?.url) return;
      folders["بسته‌بندی و تحویل کالا"].push({
        id: `delivery-photo-${del.id}-${index}`,
        name: photo.name || `عکس بسته‌بندی ${index + 1}`,
        url: photo.url,
        size: photo.size || "تصویر",
        date: del.deliveryDateJalali ?? fallbackDate,
        type: "photo",
      });
    });
  }

  for (const tx of transactions) {
    folders["تراکنش‌های مالی و پرداخت‌ها"].push({
      id: `transaction-${tx.id}`,
      name: `${tx.type} - سند ${tx.documentNumber}`,
      url: `?printModule=transactions&printId=${tx.id}`,
      size: "سند مالی",
      date: tx.occurredAtJalali ?? fallbackDate,
      type: "transaction",
      generated: true,
    });
  }

  for (const service of services) {
    folders["خدمات پس از فروش"].push({
      id: `service-${service.id}`,
      name: `خدمات ${service.itemName} - ${service.status}`,
      url: `?printModule=afterSalesServices&printId=${service.id}`,
      size: "سند خدمات",
      date: service.startDateJalali ?? fallbackDate,
      type: "service",
      generated: true,
    });
  }

  // 8. Manually uploaded documents, filed where the user put them.
  const manual = fromJsonColumn<{ id?: string; folderName?: string; name?: string; url?: string; size?: string; createdAt?: string }[]>(
    project.manualDocuments, []);
  if (Array.isArray(manual)) {
    for (const doc of manual) {
      if (!doc?.url) continue;
      const target = doc.folderName && folders[doc.folderName] ? doc.folderName : MANUAL_FOLDER;
      // A manual entry pointing at a file already listed would show it twice.
      if (folders[target].some((f) => f.url === doc.url)) continue;
      folders[target].push({
        id: doc.id ?? `manual-${folders[target].length}`,
        name: doc.name ?? "سند",
        url: doc.url,
        size: doc.size || "بارگذاری دستی",
        date: doc.createdAt ?? fallbackDate,
        type: "manual",
      });
    }
  }

  return folders;
}
