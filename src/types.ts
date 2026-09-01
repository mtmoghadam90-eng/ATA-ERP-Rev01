/**
 * Types & Interfaces for Abzar Tamin Arshia ERP
 */

// The customer value rules live with the arithmetic that reads them, so the
// weights and the formula cannot drift apart.
export type { CustomerValueSettings, CustomerRank } from './utils/customerValue';
import type { CustomerValueSettings } from './utils/customerValue';
import type { CustomerValueMetricsRow } from './api/customers';
// Where a line's cost came from — the rules live with the arithmetic that reads
// them, so a source cannot be spelled one way here and another there.
import type { CostSource } from './utils/costOfGoods';
// A product's catalogue and datasheet files, with the rules that read them.
export type { ProductDocument, ProductDocumentKind } from './utils/productDocuments';
import type { ProductDocument } from './utils/productDocuments';

export interface ModuleNote {
  id: string;
  text: string;
  createdAt: string;
  author: string;
}

export interface InventoryTransaction {
  id: string;
  productId: string;
  variantId?: string;
  date: string;
  type: 'IN' | 'OUT';
  quantity: number;
  referenceId?: string; // proformaId, etc.
  referenceType?: 'PROFORMA' | 'MANUAL' | 'PURCHASE_ORDER' | 'PROJECT';
  notes?: string;
}

export interface Customer {
  id: string;
  customerType: 'حقیقی' | 'حقوقی';
  status: 'فعال' | 'غیرفعال';
  createdAt: string;
  phone: string;
  mobile: string;
  email: string;
  province: string;
  city?: string; // Optional for backward compatibility
  address: string;
  notes?: string;
  tags?: string;
  moduleAgreements?: {
    id: string;
    moduleName: string;
    text: string;
    createdAt: string;
    createdBy?: string;
  }[];

  // Legal customer fields (مشتری حقوقی)
  companyName: string; // Used for legal company name or computed individual full name for backward compatibility
  economicCode?: string;
  industry?: string;
  keyPerson?: string;

  // Individual customer fields (مشتری حقیقی)
  firstName?: string;
  lastName?: string;
  gender?: 'مرد' | 'زن' | '';
  position?: string;

  // Relationships (اتصال حقیقی و حقوقی)
  linkedCustomerIds?: string[];

  /**
   * The manual half of customer value — judgements no sales figure can answer.
   * The computed half arrives separately as `valueMetrics`.
   */
  potentialConsumption?: number | null;
  potentialCompanySize?: number | null;
  potentialProjects?: number | null;
  potentialPortfolioFit?: number | null;
  potentialRepeatPurchase?: number | null;
  potentialValueScore?: number | null;
  paymentBehaviour?: string | null;
  /** False while the value is still the migration's placeholder. */
  paymentReviewed?: boolean;
  costToServe?: string | null;
  costToServeReviewed?: boolean;
  /** The computed half, read-only. Null until a recalculation has run. */
  valueMetrics?: CustomerValueMetricsRow | null;

  /**
   * Asked us not to send them messages.
   *
   * Checked before every send, manual or automated. An opt-out on the contact a
   * project names stops the message rather than falling through to the
   * company's own number — falling through is how a business keeps texting
   * somebody who asked it to stop, through a different door.
   */
  doNotContact?: boolean;
  /** Their chat id on Bale, if they have given us one. */
  baleChatId?: string;

  // Custom Field values
  customValues?: Record<string, any>;

  // Special Agreements & Auto Reminders

  // Backward compatibility fields
  contactName?: string;
  contactLastName?: string;
}

export interface ProductFeatureOption {
  id: string;
  value: string;
  code?: string;
  price?: number;
  currency?: string;
}

export interface ProductFeature {
  id: string;
  name: string;
  code?: string;
  options: ProductFeatureOption[];
}

export interface ProductVariant {
  id: string;
  sku: string;
  attributes: Record<string, string>; // feature.name -> option.value
  stockLevel: number;
  minStockLevel: number;
  priceRIYAL?: number;
  priceForeign?: number;
  currencyForeign?: string;

  // Custom calculator values persisted on the variant
  calcPriceForeign?: number;
  calcExchangeRate?: number;
  calcRemittanceFee?: number;
  calcRemittancePct?: number;
  calcShippingCost?: number;
  calcCustomsDutyRIYAL?: number;
  calcOtherCostsForeign?: number;
  calcOtherCostsRIYAL?: number;
  calcProfitPct?: number;
  calcProfitRIYAL?: number;
  calcMarginType?: 'PERCENT' | 'FIXED';
  /**
   * How the two figures below were arrived at.
   *
   * BREAKDOWN — the default, and what every record written before this existed
   * has — computes them from the purchase price, freight, customs and margin.
   * MANUAL is for goods bought locally, quoted by a supplier all-in, or priced
   * by a rule nobody wants to model: the cost and the selling price are simply
   * stated, in the item's own currency.
   */
  calcMode?: 'BREAKDOWN' | 'MANUAL';
  /** MANUAL only: the stated landed cost, in `currencyForeign`. */
  calcManualLandedForeign?: number;
  /** MANUAL only: the stated selling price, in `currencyForeign`. */
  calcManualSellingForeign?: number;
  /**
   * What this item last actually cost to land, from a received purchase order.
   *
   * Read-only here: written only by a purchase-order receipt, never by the
   * product form. Deliberately separate from the price calculator, which holds
   * the *standard* cost the company quotes from — a line's share of an order's
   * landed total carries the freight and customs of that shipment, so a small
   * urgent delivery is not a fair basis for every future quotation.
   */
  lastPurchaseCostRial?: number | null;
  /** Units that purchase was for — the context that says how representative it is. */
  lastPurchaseQuantity?: number | null;
  lastPurchaseDate?: string | null;
  lastPurchaseOrderNumber?: string | null;

}

export interface ProductConfigRule {
  id: string;
  name?: string;
  active: boolean;
  conditions: {
    featureName: string;
    values: string[];
  }[];
  actions: {
    featureName: string;
    values: string[];
  }[];
}

export interface Product {
  id: string;
  name: string;
  displayName: string;
  code: string;
  category: string;
  brand: string;
  modelNumber: string;
  unit: string;
  basePriceRIYAL: number;
  description: string;
  stockLevel: number; // Current inventory
  minStockLevel: number; // Threshold for reordering
  supplyType?: 'INVENTORY' | 'ORDER';
  images?: string[]; // فایل های تصویر
  /**
   * The catalogue, the datasheet and the certificates.
   *
   * `images` answers «what does it look like»; this is the manufacturer's
   * literature a sales engineer actually reaches for when quoting, which used
   * to live on somebody's desktop. `src/utils/productDocuments.ts` is the rule.
   */
  documents?: ProductDocument[];
  customValues?: Record<string, any>;
  features?: ProductFeature[]; // ویژگی‌های قابل تنظیم
  hasVariants?: boolean;
  variants?: ProductVariant[];
  configRules?: ProductConfigRule[];

  // Simple product price details
  priceForeign?: number;
  currencyForeign?: string;
  calcPriceForeign?: number;
  calcExchangeRate?: number;
  calcRemittanceFee?: number;
  calcRemittancePct?: number;
  calcShippingCost?: number;
  calcCustomsDutyRIYAL?: number;
  calcOtherCostsForeign?: number;
  calcOtherCostsRIYAL?: number;
  calcProfitPct?: number;
  calcProfitRIYAL?: number;
  calcMarginType?: 'PERCENT' | 'FIXED';
  /**
   * How the two figures below were arrived at.
   *
   * BREAKDOWN — the default, and what every record written before this existed
   * has — computes them from the purchase price, freight, customs and margin.
   * MANUAL is for goods bought locally, quoted by a supplier all-in, or priced
   * by a rule nobody wants to model: the cost and the selling price are simply
   * stated, in the item's own currency.
   */
  calcMode?: 'BREAKDOWN' | 'MANUAL';
  /** MANUAL only: the stated landed cost, in `currencyForeign`. */
  calcManualLandedForeign?: number;
  /** MANUAL only: the stated selling price, in `currencyForeign`. */
  calcManualSellingForeign?: number;
  /**
   * What this item last actually cost to land, from a received purchase order.
   *
   * Read-only here: written only by a purchase-order receipt, never by the
   * product form. Deliberately separate from the price calculator, which holds
   * the *standard* cost the company quotes from — a line's share of an order's
   * landed total carries the freight and customs of that shipment, so a small
   * urgent delivery is not a fair basis for every future quotation.
   */
  lastPurchaseCostRial?: number | null;
  /** Units that purchase was for — the context that says how representative it is. */
  lastPurchaseQuantity?: number | null;
  lastPurchaseDate?: string | null;
  lastPurchaseOrderNumber?: string | null;

}

export interface Supplier {
  id: string;
  name: string;
  country: string;
  /** The city. Domestic suppliers are the majority and «ایران» says nothing. */
  city?: string;
  contactName: string;
  phone?: string;
  email?: string;
  website?: string;
  paymentTerms?: string;
  status: 'فعال' | 'غیرفعال';
  createdAt: string;
  customValues?: Record<string, any>;
  providedCategories?: string[];
  description?: string;
}

export interface ProformaItem {
  id: string;
  productId: string;
  variantId?: string;
  productName: string;
  productCode: string;
  brand: string;
  quantity: number;
  /** The unit this line is counted in, from settings.dropdownItems.units. */
  unit?: string;
  unitPriceRIYAL: number;
  totalPriceRIYAL: number;
  /**
   * What this line cost us, per unit, in the proforma's own currency — the same
   * currency `unitPriceRIYAL` is in, whose name is a historical accident.
   *
   * Snapshotted onto the line rather than looked up when a report needs it:
   * re-pricing the product next year must not rewrite last year's profit, and a
   * free-text line has no product to look anything up from.
   */
  unitCost?: number | null;
  costCurrency?: string | null;
  costSource?: CostSource | null;
  supplyMethod?: 'INVENTORY' | 'ORDER' | 'NONE';
  status?: 'جاری' | 'برنده' | 'بازنده' | 'لغو شده';
  lossReason?: string;
  techSpecs?: string;
  selectedFeatures?: Record<string, string>;
  selectedImage?: string;
  deliveryRange?: string;
  deliveryUnit?: 'روز' | 'هفته' | 'ماه';
  deliveryType?: 'کاری' | 'تقویمی';
  deliveryPostfix?: string;
  tagNumber?: string;
}

export interface Proforma {
  id: string;
  proformaNumber: string; // Auto-generated based on template
  proformaType?: 'FINANCIAL' | 'TECHNICAL' | 'AFTER_SALES';
  customerId: string;
  customerName: string;
  contactCustomerId?: string; // مخاطب انتخاب شده (مشتری حقیقی مرتبط)
  contactName?: string; // نام مخاطب جهت ثبت نهایی
  contactPrefix?: string; // پیشوند مخاطب یا مشتری حقیقی
  projectId?: string;
  projectName?: string;
  issueDate: string;
  expiryDate: string;
  deliveryDate?: string; // تاریخ تحویل پیش‌فاکتور تایید شده
  /** The stored workflow status: where the document is in its own lifecycle. */
  status: 'پیش‌نویس' | 'ارسال شده' | 'تأیید شده (برنده)' | 'لغو شده' | 'باخته' | 'نیمه برنده' | 'جاری';
  /**
   * The outcome derived from the line statuses — computed by the server, never
   * stored, and deliberately a separate field: conflating it with `status`
   * showed sent proformas as drafts and then saved that over the real value.
   */
  outcomeStatus?: 'پیش‌نویس' | 'ارسال شده' | 'تأیید شده (برنده)' | 'لغو شده' | 'باخته' | 'نیمه برنده' | 'جاری';
  isCancelled?: boolean;
  lossReason?: string; // e.g. "قیمت بالا", "زمان تحویل طولانی"
  currency?: 'دلار' | 'یورو' | 'درهم' | 'ریال' | 'یوان';
  items: ProformaItem[];
  totalAmount: number; // Sum of items
  discountPercent: number;
  discountAmount: number;
  taxPercent: number; // e.g., 10% VAT
  taxAmount: number;
  finalAmount: number;
  extraCosts?: number; // (Total - Discount) + Tax
  notes: string;
  creatorId?: string;
  historicalExchangeRate?: number; // نرخ تسعیر تاریخی فروش
  customValues?: Record<string, any>;
  moduleNotes?: ModuleNote[];
  sentMethod?: string;
  sentRecipients?: string[];
  /** The day it went to the customer — stamped when the status becomes «ارسال شده». */
  sentDate?: string;
  /**
   * Sales follow-up — a separate axis from `status` and `outcomeStatus` above.
   * OPEN | DEFERRED | NO_RESPONSE, and nothing that already exists there.
   */
  followUpState?: 'OPEN' | 'DEFERRED' | 'NO_RESPONSE';
  deferredUntil?: string;
  /** The document this one revises. Explicit; never inferred from the project. */
  previousVersionId?: string;
  previousVersionNumber?: string;
  /** The revision that superseded this one, when there is one. */
  nextVersionId?: string;
  nextVersionNumber?: string;
}

export interface PurchaseOrderItem {
  id: string;
  productId: string;
  variantId?: string;
  productName: string;
  productCode: string;
  brand: string;
  quantity: number;
  unitPriceForeignCurrency: number;
  totalPriceForeignCurrency: number;
  proformaItemId?: string; // شناسه ردیف پیش‌فاکتور مرتبط
  proformaItemName?: string; // نام/عنوان ردیف پیش‌فاکتور مرتبط
  tagNumber?: string;
  supplierNotes?: string; // یادداشت تأمین‌کننده (مثل زمان تحویل) از استعلام برنده
}

export interface PurchaseOrder {
  id: string;
  poNumber: string; // PO-{PROJECT}-{SEQ:3}
  supplierId: string;
  supplierName: string;
  projectId?: string;
  projectName?: string;
  /** کد پروژه، برای ارجاع سریع روی کارت سفارش. */
  projectCode?: string;
  proformaId?: string; // پیش‌فاکتور مرتبط
  proformaNumber?: string; // شماره پیش‌فاکتور مرتبط
  orderDate: string;
  expectedDeliveryDate: string;
  currency: 'دلار' | 'یورو' | 'درهم' | 'ریال' | 'یوان';
  exchangeRate: number; // Rate to IRR at order time
  items: PurchaseOrderItem[];
  totalForeignAmount: number; // Sum of foreign currency items
  shippingCostRIYAL: number; // Cost of freight (هزینه حمل)
  customsDutyRIYAL: number; // Cost of customs clearances (هزینه ترخیص)
  remittanceFeeRIYAL: number; // Cost of money transfer/remittance (هزینه حواله پول)
  shippingCostForeign?: number; // هزینه حمل به ارز
  remittanceFeeForeign?: number; // هزینه حواله صرافی به ارز
  calculatedLandedCostRIYAL: number; // (TotalForeign * ExchangeRate) + remittance + shipping + customs
  calculatedLandedCostForeign?: number; // بهای تمام شده به ارز فاکتور
  paymentDate?: string; // تاریخ پرداخت به تامین‌کننده و جاری شدن سفارش
  goodsReadyDate?: string; // تاریخ آماده شدن کالا
  shipmentDate?: string; // تاریخ حمل کالا
  clearanceDate?: string; // تاریخ ترخیص کالا
  receivedDate?: string; // تاریخ دریافت کالا در انبار
  status: 'پیش‌نویس' | 'پرداخت و سفارش به سازنده' | 'در حال آماده‌سازی سازنده' | 'حمل و ترانزیت' | 'ترخیص گمرک' | 'در حال حمل به انبار' | 'تحویل شده (رسید انبار)';
  createdAt: string;
  notes?: string;
  customValues?: Record<string, any>;
  moduleNotes?: ModuleNote[];
}

export interface Project {
  id: string;
  code: string; // ATA-YYYY-SEQ
  name: string;
  customerId: string;
  customerName: string;
  campaignId?: string;
  campaignName?: string;
  creationDate: string; // This is used as opportunityDate/creationDate (تاریخ ایجاد فرصت)
  expectedCloseDate?: string; // Expected closing date (optional)
  estimatedValueRIYAL?: number; // Optional/legacy
  probabilityPercent?: number; // Optional/legacy
  status: 'جدید' | 'در حال مذاکره' | 'ارائه پیش‌فاکتور' | 'برنده (موفق)' | 'باخته' | 'لغو شده' | 'نیمه برنده';
  itemsNeeded?: {
    productId: string;
  variantId?: string; // can be 'generic' if not matching a specific warehouse product
    name: string;
    quantity: number;
    supplyMethod?: 'INVENTORY' | 'ORDER' | 'NONE';
    category?: 'FLOW' | 'TEMPERATURE' | 'PRESSURE' | 'LEVEL';
    equipmentType?: string;
    size?: string;
    tagNumber?: string;
  }[];
  description: string;
  customValues?: Record<string, any>;
  /**
   * Why the job was lost — **one** value per project.
   *
   * Derived from the lines of the project's proformas once it has any
   * (`deriveProjectLossReason`), and typed on the project form only while it has
   * none. Two places to record it meant a loss-reason report found two answers
   * for one project; `proformaCount` below is what the form reads to know which
   * of the two it is looking at.
   */
  lossReason?: string;
  /** How many quotations this project carries. Derived, never written back. */
  proformaCount?: number;

  // New Requested Fields:
  salesExpert?: string;            // کارشناس فروش
  marketingChannel?: string;        // کانال بازاریابی
  leadQuality?: string;             // کیفیت لید
  referrerName?: string;            // نام معرف
  financialContact?: string;        // فرد کلیدی مالی
  technicalContact?: string;        // فرد کلیدی فنی
  communicationMethod?: string;     // روش ارتباط
  opportunityDate?: string;         // تاریخ ایجاد فرصت (same as creationDate or distinct)
  customerInquiryNumber?: string;   // شماره استعلام مشتری
  winningDate?: string;             // تاریخ برنده شدن
  agreedDeliveryDate?: string;      // تاریخ توافق‌شده تحویل
  endUser?: string;                 // مصرف‌کننده نهایی
  closingDate?: string;             // تاریخ بسته شدن
  
  attachments?: { name: string; url: string; }[]; // فایل‌های درخواست
  /**
   * Documents uploaded by hand into the project's folders.
   *
   * `kind` marks a document filed for a particular purpose. The only one so far
   * is the customer's written confirmation that the project was awarded, which
   * the app asks for once and must then stop asking for.
   */
  manualDocuments?: { id: string; folderName: string; name: string; url: string; createdAt: string; size?: string; kind?: 'projectConfirmation'; }[];

  // Project Milestone & Automations
  milestones?: {
    id: string;
    name: string;
    isCompleted: boolean;
    completedAt?: string;
    dueDate?: string;
    notes?: string;
    triggerType?: 'manual' | 'category_start' | 'category_complete';
    triggerCategoryName?: string;
  }[];
  moduleNotes?: ModuleNote[];
  milestoneRules?: {
    id: string;
    triggerMilestoneId: string;
    actionType: 'create_task' | 'send_notification';
    taskTitle: string;
    taskDesc: string;
    assignedTo: string;
    priority: 'پایین' | 'متوسط' | 'بالا' | 'فوری';
    dueDaysOffset?: number;
  }[];
  /** Who to write to about this job, and how — see the messaging module. */
  messagingContactId?: string;
  messagingChannel?: 'SMS' | 'BALE' | 'EMAIL';
  /**
   * Automation leaves this job alone.
   *
   * The workflow rules are written once for the whole company, and a job
   * now and then has to sit outside them. Manual sends still go out: this
   * exempts one project from the rules, it does not silence it. The
   * customer's own `doNotContact` is the other thing and stops everything,
   * on every project.
   */
  suppressAutoMessages?: boolean;

}

export interface Transaction {
  id: string;
  type: 'دریافت' | 'پرداخت';
  receiptType?: string; // بابت پیش‌پرداخت، میاندوره، تسویه و غیره
  documentNumber: string; // receipt or payment voucher ID
  customerId?: string;
  customerName?: string;
  supplierId?: string;
  supplierName?: string;
  /**
   * The other side of the entry, as stored. The server resolves it from the
   * linked customer or supplier, and holds it outright when the party was typed
   * by hand — so this, not customerName/supplierName, is what the grid and the
   * printed voucher read.
   */
  partyName?: string;
  projectId?: string;
  projectName?: string;
  purchaseOrderId?: string;
  amountRIYAL: number;
  date: string;
  paymentType: 'حواله بانکی' | 'چک' | 'نقدی' | 'کارت به کارت';
  referenceNumber: string; // reference/check number
  notes: string;
  customValues?: Record<string, any>;
  proformaId?: string; // پیش‌فاکتور مرتبط
  /**
   * The linked proforma's number and currency, joined by the server.
   *
   * The grid used to look these up in whatever the proforma picker happened to
   * be holding, so a document showed «پ.ف: ناشناس» unless its proforma was in
   * the picker's current matches — which meant only the one just saved.
   */
  proformaNumber?: string;
  proformaCurrency?: string;
  exchangeRate?: number; // نرخ تسویه یا نرخ توافقی برای این دریافت
  amountForeign?: number; // مقدار ارز اصلی تسویه‌شده یا دریافت‌شده
  isDirectForeign?: boolean; // آیا دریافت مستقیم ارز بوده است؟
  status?: 'تأیید شده' | 'پیش‌نویس' | 'لغو شده' | 'برگشت شده';
  reversalOfTransactionId?: string; // شناسه تراکنش اصلی جهت برگشت وجه
  partyType?: string; // نوع طرف حساب: مشتری/تامین‌کننده/دستی
  partyNameManual?: string; // نام طرف حساب وقتی رکورد مشتری/تامین‌کننده ندارد
  bankName?: string; // نام بانک یا صرافی
}

export interface ModuleNotification {
  id: string;
  module: string;
  title: string;
  description: string;
  timestamp: number;
  read: boolean;
  responsibleName: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  relatedToType: 'مشتری' | 'پروژه' | 'پیش‌فاکتور' | 'سفارش خرید' | 'عمومی' | 'خدمات پس از فروش' | 'بسته‌بندی و تحویل' | 'استعلام تامین‌کننده';
  /** Who raised it, kept beside the id so history survives a deactivated account. */
  createdByName?: string;
  /**
   * When the work was picked up, in Shamsi. Null until the card leaves «برای
   * انجام»; stamped once and never cleared, because the day work began is a
   * fact and a task pushed back and picked up again did not start twice.
   */
  startedAt?: string;
  /** When it closed, in Shamsi. Cleared if the card is moved back out of «انجام شده». */
  completedAt?: string;
  /** GENERAL | SALES_FOLLOW_UP — what pressing the card does. */
  taskKind?: string;
  /**
   * A closed sales follow-up's answer: what the customer said, and the note
   * about the call. Written only by `completeFollowUp`; the ordinary task
   * editor never touches either, which is why neither is in `WRITABLE`.
   */
  followUpResult?: string;
  completionNote?: string;
  /** When it was raised. What «تاریخ ارجاع» sorts the board by. */
  createdAt?: string;
  /** The job behind the task — code, name and customer — joined by the server. */
  relatedProject?: {
    id: string; code: string; name: string; customerName: string | null;
  };
  relatedToId?: string;
  relatedToName?: string;
  priority: 'پایین' | 'متوسط' | 'بالا' | 'فوری';
  dueDate: string;
  /** The assignee's display name. */
  assignedTo: string;
  /**
   * The assignee's account, kept beside the name. Both are stored: the board
   * and the "my tasks" filters key off the id, so a round trip that carries
   * only the name silently detaches the task from whoever it belongs to.
   */
  assignedToUserId?: string;
  /**
   * «برای انجام» is the newest and is what a task created from the board
   * carries; everything written before the board existed carries «در حال
   * انجام» and sits in the middle column, which is what it has always meant.
   * `taskLane` in `src/utils/workBoard.ts` maps this onto a column.
   */
  status: 'برای انجام' | 'در حال انجام' | 'انجام شده' | 'کنسل شده';
  customValues?: Record<string, any>;
  reminderEnabled?: boolean;
  reminderDate?: string;
  reminderTime?: string;
}

export interface ExchangeRate {
  id: string;
  currency: 'USD' | 'EUR' | 'AED' | 'CNY';
  name: string;
  rateToRIYAL: number;
  lastUpdated: string;
}

export interface CustomField {
  id: string;
  module: 'customers' | 'projects' | 'products' | 'proformas' | 'suppliers' | 'purchaseOrders' | 'transactions' | 'tasks' | 'packagingDelivery' | 'afterSalesServices';
  name: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'date' | 'file' | 'boolean';
  options?: string[];
  required?: boolean;
  useSeparator?: boolean;
}

export interface DocumentFormat {
  projectPrefix: string;
  projectFormat: string; // ATA-{YYYY}-{SEQ:3}
  projectStartSeq?: number; // e.g. 1000
  proformaPrefix: string;
  proformaFormat: string; // QT-{PROJECT}-{SEQ:2}
  proformaTechnicalFormat?: string; // e.g. QT-TECH-{PROJECT}-{SEQ:2}
  proformaAfterSalesFormat?: string; // e.g. QT-SERV-{PROJECT}-{SEQ:2}
  proformaStartSeq?: number; // e.g. 1000
  poPrefix: string;
  poFormat: string; // PO-{PROJECT}-{SEQ:3}
  poStartSeq?: number; // e.g. 1000
  transactionFormat?: string; // TR-{TYPE}-{YYYY}{MM}-{SEQ:3}
  transactionStartSeq?: number; // e.g. 1000
  productFormat?: string; // EQ-{RAND:5}
  productStartSeq?: number; // e.g. 1000
  packingListFormat?: string; // PL-{PROJECT}-{SEQ:3}
  packingListStartSeq?: number; // e.g. 1000
}

export interface ProformaTemplate {
  name: string;
  companyName: string;
  registrationNumber: string;
  nationalCode: string;
  economicCode: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  logoUrl?: string;
  companySealUrl?: string;
  titleColor: string;
  documentTitle: string;
  headerText: string;
  termsAndConditions: string;
  footerText: string;
  signatureLabel1: string;
  signatureLabel2: string;
  showLogo: boolean;
  showTerms: boolean;
  showSignatures: boolean;
  showTotals: boolean;
}

export interface ERPSettings {
  /**
   * The dashboard assistant.
   *
   * Everything except the API key, which is a row in `assistant_credentials`
   * and never reaches a browser — the settings document is loaded whole by
   * every signed-in user. `resolveAssistantConfig` in `src/utils/assistant.ts`
   * fills in and bounds every field.
   */
  assistant?: {
    enabled?: boolean;
    /** Base URL up to and including `/v1`; OpenAI-compatible. */
    baseUrl?: string;
    model?: string;
    /** House instructions, added to the built-in ones rather than replacing them. */
    systemPrompt?: string;
    /** null (or absent) leaves it to the model, which some models insist on. */
    temperature?: number | null;
    maxTokens?: number;
    /** Rounds of tool calls one question may take. */
    maxToolCalls?: number;
    timeoutSeconds?: number;
    /** Whether it may propose actions that change data. Nothing is written unconfirmed. */
    allowActions?: boolean;
  };
  /**
   * How the messaging module behaves, as opposed to which providers it uses.
   *
   * Provider credentials are rows in `message_providers` and never leave the
   * server; these three are ordinary settings and are edited on the same tab.
   * The server reads them through `loadMessagingSettings`.
   */
  messaging?: {
    /**
     * A window messages are not delivered in, "HH:MM" to "HH:MM". It may wrap
     * midnight (22:00–08:00 is the useful case). A message due inside it is
     * held until the window opens, never dropped.
     */
    quietHours?: { from?: string | null; to?: string | null };
    /**
     * Queue every message and show it in the outbox, but never call a
     * provider. For trying a new rule out without texting a customer.
     */
    dryRun?: boolean;
    /** Attempts before a message is given up on. */
    maxAttempts?: number;
  };
  showProductBrandInDocuments?: boolean;
  customFields: CustomField[];
  proformaTemplates: ProformaTemplate[];
  activeTemplateId: string;
  documentFormats: DocumentFormat;
  requiredFields?: Record<string, Record<string, boolean>>;
  /**
   * Project fields whose blankness is worth a badge on the project card.
   *
   * Deliberately **not** `requiredFields.projects`: a required field is
   * enforced on save, so turning one on says nothing about the projects
   * already on the system and makes them unsavable the next time somebody
   * opens one to fix a typo. Absent means the default list; an empty array
   * means "warn about nothing", which is a real answer.
   */
  projectDataGapFields?: string[];
  /**
   * Where a year's official holidays are fetched from.
   *
   * `{YEAR}` is replaced with the Shamsi year. Absent means the built-in
   * source (`DEFAULT_HOLIDAY_SOURCE_URL`); it is a setting because the list is
   * published by third parties whose addresses outlive no deployment, and
   * because this network may only be able to reach one of them.
   */
  holidaySourceUrl?: string;
  /**
   * How far a year's lunar holidays sit from where the calendar source put
   * them, in whole days, keyed by Shamsi year.
   *
   * Iran announces the start of each hijri month by sighting the moon; every
   * calendar a server can reach computes it instead, and they can be a day
   * apart — usually a day early. Solar holidays are fixed dates and are never
   * affected. Stored per year because a sighting is a fact about one year, and
   * remembered so re-importing does not silently undo the correction.
   */
  hijriHolidayShift?: Record<string, number>;
  dropdownItems: {
    industries: string[];
    customerTypes: string[];
    customerStatuses: string[];
    categories: string[];
    units: string[];
    currencies: string[];
    paymentTerms: string[];
    paymentTypes: string[];
    projectStatuses: string[];
    salesExperts: string[];
    marketingChannels: string[];
    leadQualities: string[];
    communicationMethods: string[];
    taskPriorities: string[];
    taskStatuses: string[];
    proformaStatuses: string[];
    purchaseOrderStatuses: string[];
    positions?: string[];
    receiptTypes?: string[];
    shippingMethods?: string[];
    packageTypes?: string[];
    returnReasons?: string[];
    equipmentTypes?: string[];
    supplierInquirySteps?: string[];
    proformaSentMethods?: string[];
    /**
     * What the customer said on a sales follow-up.
     *
     * Not a loss reason — `settings.lossReasons` stays exactly where it is —
     * and not a commercial outcome. «خرید به تعویق افتاد» is a follow-up state,
     * not a lost sale.
     */
    followUpResults?: string[];
  };
  /**
   * Why a project or a proforma line was lost.
   *
   * Note this is *not* `dropdownItems.followUpResults`: what the customer said
   * on a call and why a job was lost are different lists and always have been.
   */
  lossReasons: string[];
  /**
   * Named additions this document has already been given — see
   * `src/utils/settingsPatches.ts`.
   *
   * The list is what makes a patch a one-off: an entry a rule needs by name is
   * added once to a database seeded before it existed, and removing it
   * afterwards sticks rather than being forced back every restart.
   */
  appliedPatches?: string[];
  activityCategories: { id: string; name: string; module: string; responsibleUserId?: string }[];
  sidebarModuleOrder?: string[];
  moduleResponsibles?: Record<string, string>;
  adminNotificationPreferences?: Record<string, {
    receiveAll: boolean;
    importantProjectIds: string[];
  }>;
  deliveryChecklistTemplate?: string[];
  workflows?: WorkflowRule[];
  /**
   * Customer value ranking: evaluation period, thresholds, weights and the
   * recency bands. Editing these changes nobody's rank until a recalculation
   * runs — the scores are stored so the grid can sort, filter and page on them.
   */
  customerValue?: CustomerValueSettings;
}

import type { ActivityAttachment } from './utils/attachments';

export interface ProjectReferralResponse {
  id?: string;
  text: string;
  responder: string;
  /** Which side of the thread it sits on. A name is a label, not an identity. */
  responderUserId?: string | null;
  createdAt: string;
  attachment?: { name: string; size: string; content?: string } | null;
}

export interface ProjectReferral {
  id: string;
  assignedTo: string;
  actionRequired: string;
  assignedBy: string;
  /** The two accounts, which decide who may answer, close or reopen. */
  assignedToUserId?: string | null;
  assignedByUserId?: string | null;
  createdAt: string;
  /** «در حال اقدام» is new: with two states the board's middle column could not be said. */
  status: 'در انتظار اقدام' | 'در حال اقدام' | 'انجام شده';
  response: ProjectReferralResponse | null;
  messages?: ProjectReferralResponse[];
}

export interface ProjectActivity {
  id: string;
  text: string;
  createdAt: string;
  createdBy?: string;
  /** The first attachment, kept so older markup and readers still work. */
  attachment: { name: string; size: string; content?: string } | null;
  /** Every attachment on the entry, in the order they were added. */
  attachments: ActivityAttachment[];
  /**
   * Everyone this message named, one request each.
   *
   * Was a single optional referral, from when it was a checkbox on the form
   * addressed to exactly one colleague. Naming somebody in the text *is* the
   * referral now, and one sentence can name two people.
   */
  referrals: ProjectReferral[];
  /** The message this one answers, enough of it to quote a line. */
  replyToId?: string | null;
  replyTo?: {
    id: string; text: string; authorName?: string | null; createdAt?: string;
  } | null;
  /**
   * The one-press answers, one row per person per emoji.
   *
   * Carried with the feed because a chip row is drawn for every message on
   * screen; `summarizeReactions` turns these into the chips.
   */
  reactions: { emoji: string; userId: string; userName?: string | null }[];
  /**
   * How many people have seen it — never *who*.
   *
   * The names are one request away (`activitiesApi.readers`) and are fetched
   * when the eye is pressed: every reader of every message would be the largest
   * thing in a feed response, and nobody looks at more than one at a time.
   */
  readCount: number;
}

export interface ProjectCategoryGroup {
  id: string;
  projectId: string;
  categoryId: string;
  categoryName: string;
  status: 'جاری' | 'اتمام کار';
  startDate: string;
  endDate: string | null;
  /**
   * Who follows this conversation and is notified of every message in it.
   *
   * Per project **and** per category — «خرید» on one job involves different
   * people from «خرید» on the next. Distinct from
   * `settings.activityCategories[].responsibleUserId`, which answers who owns
   * this kind of work in the company and is untouched by this.
   */
  memberUserIds: string[];
  activities: ProjectActivity[];
}

export interface User {
  id: string;
  username: string;
  /** Never returned by the server; present only while a form is filling one in. */
  password?: string;
  fullName: string;
  role: 'admin' | 'user';
  isSystemAdmin?: boolean;
  position?: string;
  signatureImage?: string;
  /**
   * An account that owns records is deactivated rather than deleted, so this is
   * how a former colleague's history stays readable while their access is gone.
   */
  isActive?: boolean;
  permissions: {
    dashboard: boolean;
    customers: boolean;
    projects: boolean;
    proformas: boolean;
    products: boolean;
    suppliers: boolean;
    purchaseOrders: boolean;
    transactions: boolean;
    tasks: boolean;
    /**
     * @deprecated Never read any more.
     *
     * «کارتابل ارجاعات» was a module of its own; it is a tab of «وظایف و
     * پیگیری» now and its endpoints are gated by `tasks` (see `erp_referrals`
     * in `src/server/auth.ts`). The key is kept on the type because it is
     * present on every stored account and removing it would make each of those
     * documents fail to type — the value is simply never consulted.
     */
    referrals: boolean;
    settings: boolean;
    users: boolean;
    packagingDelivery?: boolean;
    /** The messaging module: templates, the outbox, and sending by hand. */
    messaging?: boolean;
    /**
     * The assistant on the dashboard.
     *
     * Its own flag, and read **strictly** — an absent value denies, unlike every
     * other key here. The assistant can read every figure its user is allowed to
     * see, all at once and in one place, and that is not the same decision as
     * «may open the front page»: somebody can have the dashboard and not this.
     * A system administrator always has it.
     */
    assistant?: boolean;
    /**
     * Not a screen — the only flag here that is not.
     *
     * Governs what the company *pays*: the product price calculator, purchase
     * order costs and supplier offers, inside modules the user already has.
     * Enforced server-side in `src/server/costs.ts`; the screens hide the same
     * fields so nobody is shown empty boxes.
     */
    costs?: boolean;
    /**
     * Seeing the whole company's tasks rather than one's own.
     *
     * Read **strictly** — an absent value denies, like `costs` and `assistant`
     * and unlike every module flag above. The board used to show everybody
     * everything precisely because an absent module key reads as granted, and
     * every account has `tasks` since everybody needs their own work; a flag
     * inheriting that default would reproduce the fault on the day it shipped.
     */
    tasksAll?: boolean;
  };
}

/**
 * Screens with no permission flag of their own — access is decided by another
 * module's flag instead. Mirrors `KEY_PERMISSION` in `src/server/auth.ts`
 * (erp_after_sales_services -> packagingDelivery, erp_supplier_inquiries ->
 * suppliers), which is what actually gates the API. Without this, an admin
 * revoking `suppliers` or `packagingDelivery` for a user leaves these two menu
 * items visible while their data 403s.
 */
export const SCREEN_PERMISSION_ALIAS: Partial<Record<string, keyof User['permissions']>> = {
  afterSalesServices: 'packagingDelivery',
  supplierInquiries: 'suppliers',
};







export interface PackingItem {
  id: string;
  itemOrDocName: string;
  productId?: string;
  /** The exact SKU shipped. The stock ledger issues against it. */
  variantId?: string;
  quantity: number;
  /** The unit this line is counted in, from settings.dropdownItems.units. */
  unit?: string;
  packageType: string; // e.g. کارتن، جعبه چوبی، پالت، کیسه
  dimensions: string; // e.g. 50x40x30 سانتی‌متر
  weight: number; // وزن به کیلوگرم
  boxNumber?: string;
  actualDeliveryDate?: string; // تاریخ تحویل قطعی این ردیف کالا به مشتری
  tagNumber?: string;
}

export interface DeliveryChecklistItem {
  name: string;
  completed: boolean;
  completedAt?: string;
}

export interface PackagingDelivery {
  id: string;
  projectId: string;
  projectName: string;
  proformaId?: string; // پیش‌فاکتور تایید شده مرتبط
  proformaNumber?: string;
  packingListNumber: string; // شماره پکینگ لیست
  deliveryDate: string; // تاریخ صدور پکینگ لیست
  actualDeliveryDate?: string; // تاریخ تحویل به مشتری
  shippingMethod: string; // نحوه ارسال کالا
  preDeliveryTestNotes: string; // گزارش تست قبل از تحویل تجهیز
  /**
   * How the shipment can be traced.
   *
   * The save has always warned when a courier or freight delivery had none of
   * these; until now there was nowhere to put them, so it scanned the delivery
   * report for anything resembling a number.
   */
  waybillNumber?: string;
  driverName?: string;
  driverPhone?: string;
  vehiclePlate?: string;
  trackingCode?: string;
  checklist: DeliveryChecklistItem[]; // چک‌لیست تحویل تیک‌خورده
  items: PackingItem[]; // اقلام پکینگ لیست
  /**
   * How many lines and how many units the list holds.
   *
   * Carried separately because a grid row has the counts but not the lines —
   * the card printed both from `items.length`, which on a row is always zero.
   */
  itemCount?: number;
  totalQuantity?: number;
  photos: string[]; // تصاویر آپلود شده بسته‌بندی و ارسال (base64)
  createdAt: string;
  /** User-defined fields, keyed by field id — see `settings.customFields`. */
  customValues?: Record<string, any>;
  moduleNotes?: ModuleNote[];
}



export interface AfterSalesServiceItem {
  id: string;
  productId?: string;
  productName: string;
  issueDescription: string;
  actionsTaken?: string;
  startDate: string;
  endDate?: string;
  returnDate?: string;
  status: 'در حال بررسی' | 'در حال تعمیر/خدمات' | 'تکمیل شده' | 'تحویل داده شده';
}

export interface AfterSalesService {
  id: string;
  projectId: string;
  projectName: string;
  proformaNumber?: string;
  proformaItemName?: string;
  itemName: string;
  issueDescription: string;
  actionsTaken: string;
  startDate: string;
  endDate?: string;
  returnDate?: string;
  status: 'در حال بررسی' | 'در حال تعمیر/خدمات' | 'تکمیل شده' | 'تحویل داده شده';
  createdAt: string;
  createdBy: string;
  items?: AfterSalesServiceItem[];
  notes?: string; // توضیحات کلی خدمت (در گزارش چاپی نمایش داده می‌شود)
  /** User-defined fields, keyed by field id — see `settings.customFields`. */
  customValues?: Record<string, any>;
  moduleNotes?: ModuleNote[];
}

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  userFullName: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT';
  module: string;
  entityId: string;
  description: string;
  beforeState?: string; // LZW compressed
  afterState?: string;  // LZW compressed
}

export interface WorkflowRule {
  id: string;
  name: string;
  active: boolean;
  triggerType: 
    | 'customer_created'
    | 'customer_updated'
    | 'project_created'
    | 'project_status_change'
    | 'proforma_created'
    | 'proforma_outcome_change'
    /**
     * The *stored* status moved — «پیش‌نویس» → «ارسال شده» and the like.
     *
     * Separate from `proforma_outcome_change`, which reports the **derived**
     * commercial result computed from the line statuses. Sending a quotation
     * changes the first and not the second, so the rule that raises a follow-up
     * two days after it goes out has nothing to hang on without this.
     */
    | 'proforma_status_change'
    | 'product_created'
    | 'product_low_stock'
    | 'supplier_created'
    | 'supplier_inquiry_created'
    | 'supplier_inquiry_status_change'
    | 'purchase_order_created'
    | 'purchase_order_status_change'
    | 'packaging_delivery_created'
    | 'packaging_delivery_status_change'
    | 'after_sales_service_created'
    | 'after_sales_service_status_change'
    | 'transaction_created'
    | 'task_created'
    | 'task_status_change'
    /**
     * A task reaching «انجام شده».
     *
     * `updateTask` has emitted this since the module was written and the rule
     * editor offered it nowhere, so the one task event people actually want to
     * automate on — «وقتی این کار تمام شد، کار بعدی را باز کن» — could not be
     * chosen. It is narrower than `task_status_change` on purpose: that one
     * fires on every move, including back out of the done column.
     */
    | 'task_completed'
    | 'referral_created'
    | 'referral_status_change'
    /**
     * No event at all: N days after a date the record already carries.
     * Configured in `schedule` and swept once a day — see
     * src/utils/workflowSchedule.ts.
     */
    | 'time_elapsed';
  /** Only for `time_elapsed` — see src/utils/workflowSchedule.ts. */
  schedule?: {
    /** A key of SCHEDULE_SUBJECTS: which date, on which kind of record. */
    subject: string;
    /** Never negative; the side is `direction`. */
    days: number;
    direction?: 'after' | 'before';
  };
  conditions: {
    field: string; // e.g. 'newOutcome', 'newStatus'
    operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than';
    value: string;
  }[];
  actions: {
    id: string;
    type: 'create_task' | 'send_notification' | 'send_message';
    taskConfig?: {
      titleTemplate: string;
      descTemplate: string;
      assignedTo: string; // "MODULE_RESPONSIBLE_<moduleName>", "SALES_EXPERT", or a specific user full name
      priority: 'پایین' | 'متوسط' | 'بالا' | 'فوری';
      dueDaysOffset: number;
      /**
       * What kind of task this raises. Absent means GENERAL, which is what
       * every rule written before this existed keeps meaning.
       */
      taskKind?: 'GENERAL' | 'SALES_FOLLOW_UP';
      /**
       * Skip the creation when an unfinished task of the same kind is already
       * attached to the same record.
       *
       * A rule fires whenever its trigger fires — re-sending a quotation, an
       * edit that moves the status back and forth — and without this each
       * firing raises another follow-up on a proforma somebody is already
       * chasing. Deliberately an option on the action rather than a rule
       * hardcoded in the engine: "one task for ever" is not true of every kind
       * of work an automation might raise.
       */
      skipIfOpenSameKind?: boolean;
    };
    notificationConfig?: {
      titleTemplate: string;
      descTemplate: string;
      module: string;
    };
    /**
     * Writes a message to the customer into the outbox.
     *
     * A third kind of *action* on the engine that already exists, not a second
     * engine: the twenty-one event triggers, the time-based one, the conditions
     * and the once-per-record firing log are all shared with the other two
     * action types, so «هر وقت وضعیت سفارش به ترخیص گمرک رسید به مشتری خبر بده»
     * is a rule rather than any new code.
     */
    messageConfig?: {
      /** A saved template, or a body written into the rule itself. */
      templateId?: string;
      bodyTemplate?: string;
      subjectTemplate?: string;
      /**
       * Absent means "whatever the project prefers" — which is the setting on
       * the project form, and the answer most rules want.
       */
      channel?: 'SMS' | 'BALE' | 'EMAIL';
      /** Days to wait before it goes out. Negative is not meaningful here. */
      delayDays?: number;
      /** "HH:MM" — the hour it should arrive at, on whichever day it lands. */
      sendAtTime?: string;
    };
  }[];
}

export interface InquiryStep {
  id: string;
  title: string;
  date: string;
  notes?: string;
  method?: string; // e.g. ایمیل/تلفن/واتساپ/حضوری
  recipientName?: string; // نام شخص گیرنده در سمت تامین‌کننده
  auto?: boolean; // ثبت خودکار توسط سیستم بر اساس اقدام کاربر
  autoKey?: string; // کلید منطقی مرحله خودکار (جهت جلوگیری از ثبت تکراری)
}

export interface SupplierInquiryItem {
  id: string;
  /**
   * The catalogue item this line prices, and its SKU.
   *
   * Optional: an inquiry is often the first time a part is mentioned, priced
   * before anyone decides to carry it. When it is set, the offer stays tied to
   * exactly what was quoted — which is what lets a winning offer become a
   * purchase-order line with a real product behind it.
   */
  productId?: string;
  variantId?: string;
  name: string;
  brand?: string;
  partNumber?: string;
  quantity: number;
  priceForeign: number; // قیمت آفر به ارز
  currency: 'دلار' | 'یورو' | 'درهم' | 'یوان' | 'ریال';
  priceRiyal: number; // معادل ریالی
  deliveryTime?: string; // زمان تحویل
  notes?: string;
  tagNumber?: string;
}

export interface SupplierInquiry {
  id: string;
  /** Null for a general/warehouse purchase inquiry — no job to attach to. */
  projectId: string | null;
  projectName?: string;
  supplierId: string;
  supplierName: string;
  items: SupplierInquiryItem[];
  /** The project's code, joined on the row. Codes are unique; names are not. */
  projectCode?: string;
  technicalOfferUrl?: string; // فایل پیشنهاد فنی — اولین فایل فهرست زیر
  financialOfferUrl?: string; // فایل پیشنهاد مالی — اولین فایل فهرست زیر
  /** Every technical file. A quotation is rarely one document. */
  technicalOfferFiles?: { name: string; size: string; url: string }[];
  financialOfferFiles?: { name: string; size: string; url: string }[];
  steps: InquiryStep[];
  isWinner: boolean;
  winnerDate?: string;
  creationDate: string;
  offerConfirmed?: boolean; // صحت آفر تأیید شده و آفر نهایی تلقی می‌شود
  offerConfirmedDate?: string;
  /** تخفیف کل آفر، به درصد. */
  discountPercent?: number;
  /** تخفیف مبلغی، به ارز خودِ آفر. پس از تخفیف درصدی اعمال می‌شود. */
  discountAmount?: number;
}


