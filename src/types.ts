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
  lossReason?: string;

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
  status: 'در حال انجام' | 'انجام شده' | 'کنسل شده';
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
  showProductBrandInDocuments?: boolean;
  customFields: CustomField[];
  proformaTemplates: ProformaTemplate[];
  activeTemplateId: string;
  documentFormats: DocumentFormat;
  requiredFields?: Record<string, Record<string, boolean>>;
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
  };
  lossReasons: string[];
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

export interface ProjectReferralResponse {
  id?: string;
  text: string;
  responder: string;
  createdAt: string;
  attachment?: { name: string; size: string; content?: string } | null;
}

export interface ProjectReferral {
  id: string;
  assignedTo: string;
  actionRequired: string;
  assignedBy: string;
  createdAt: string;
  status: 'در انتظار اقدام' | 'انجام شده';
  response: ProjectReferralResponse | null;
  messages?: ProjectReferralResponse[];
}

export interface ProjectActivity {
  id: string;
  text: string;
  createdAt: string;
  createdBy?: string;
  attachment: { name: string; size: string; content?: string } | null;
  referral: ProjectReferral | null;
}

export interface ProjectCategoryGroup {
  id: string;
  projectId: string;
  categoryId: string;
  categoryName: string;
  status: 'جاری' | 'اتمام کار';
  startDate: string;
  endDate: string | null;
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
    referrals: boolean;
    settings: boolean;
    users: boolean;
    packagingDelivery?: boolean;
    /**
     * Not a screen — the only flag here that is not.
     *
     * Governs what the company *pays*: the product price calculator, purchase
     * order costs and supplier offers, inside modules the user already has.
     * Enforced server-side in `src/server/costs.ts`; the screens hide the same
     * fields so nobody is shown empty boxes.
     */
    costs?: boolean;
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
    type: 'create_task' | 'send_notification';
    taskConfig?: {
      titleTemplate: string;
      descTemplate: string;
      assignedTo: string; // "MODULE_RESPONSIBLE_<moduleName>", "SALES_EXPERT", or a specific user full name
      priority: 'پایین' | 'متوسط' | 'بالا' | 'فوری';
      dueDaysOffset: number;
    };
    notificationConfig?: {
      titleTemplate: string;
      descTemplate: string;
      module: string;
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
  technicalOfferUrl?: string; // فایل پیشنهاد فنی
  financialOfferUrl?: string; // فایل پیشنهاد مالی
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


