import React from 'react';
import { ERPSettings } from '../types';

export interface FieldConfig {
  key: string;
  label: string;
}

export interface ModuleConfig {
  key: string;
  name: string;
  fields: FieldConfig[];
}

export const REQUIRED_FIELDS_METADATA: ModuleConfig[] = [
  {
    key: 'customers',
    name: 'مشتریان',
    fields: [
      { key: 'companyName', label: 'نام شرکت (مشتری حقوقی)' },
      { key: 'firstName', label: 'نام (مشتری حقیقی)' },
      { key: 'lastName', label: 'نام خانوادگی (مشتری حقیقی)' },
      { key: 'gender', label: 'جنسیت (مشتری حقیقی)' },
      { key: 'phone', label: 'تلفن ثابت' },
      { key: 'mobile', label: 'تلفن همراه' },
      { key: 'email', label: 'ایمیل' },
      { key: 'province', label: 'استان' },
      { key: 'address', label: 'آدرس دقیق' },
      { key: 'industry', label: 'صنعت فعالیت (حقوقی)' },
      { key: 'economicCode', label: 'کد اقتصادی (حقوقی)' },
      { key: 'keyPerson', label: 'شخص کلیدی (حقوقی)' },
      { key: 'position', label: 'سمت (حقیقی)' },
    ]
  },
  {
    key: 'projects',
    name: 'پروژه‌ها (فرصت‌ها)',
    fields: [
      { key: 'name', label: 'عنوان پروژه' },
      { key: 'customerId', label: 'مشتری پروژه' },
      { key: 'status', label: 'وضعیت پروژه' },
      { key: 'salesExpert', label: 'کارشناس فروش' },
      { key: 'marketingChannel', label: 'کانال بازاریابی' },
      { key: 'leadQuality', label: 'کیفیت لید' },
      { key: 'referrerName', label: 'نام معرف' },
      { key: 'financialContact', label: 'فرد کلیدی مالی' },
      { key: 'technicalContact', label: 'فرد کلیدی فنی' },
      { key: 'communicationMethod', label: 'روش ارتباط' },
      { key: 'customerInquiryNumber', label: 'شماره استعلام مشتری' },
      { key: 'opportunityDate', label: 'تاریخ ایجاد فرصت' },
      { key: 'expectedCloseDate', label: 'تاریخ پیش‌بینی بسته شدن' },
      { key: 'agreedDeliveryDate', label: 'تاریخ توافق‌شده تحویل' },
      { key: 'winningDate', label: 'تاریخ برنده شدن' },
      { key: 'endUser', label: 'مصرف‌کننده نهایی' },
      { key: 'description', label: 'توضیحات پروژه' },
    ]
  },
  {
    key: 'products',
    name: 'کالا و انبار',
    fields: [
      { key: 'displayName', label: 'نام کالا' },
      { key: 'productCode', label: 'کد کالا' },
      { key: 'category', label: 'دسته‌بندی کالا' },
      { key: 'brand', label: 'برند/سازنده' },
      { key: 'currencyForeign', label: 'نوع ارز خرید' },
      { key: 'supplyType', label: 'نوع تامین' },
      { key: 'initialStock', label: 'موجودی اولیه در انبار' },
      { key: 'description', label: 'توضیحات' },
    ]
  },
  {
    key: 'suppliers',
    name: 'تأمین‌کنندگان',
    fields: [
      { key: 'name', label: 'نام کمپانی تأمین‌کننده' },
      { key: 'country', label: 'کشور مبدا' },
      { key: 'city', label: 'شهر' },
      { key: 'contactName', label: 'نام کارشناس/مخاطب' },
      { key: 'phone', label: 'تلفن تماس' },
      { key: 'email', label: 'ایمیل مکاتبه' },
      { key: 'status', label: 'وضعیت تأمین‌کننده' },
      { key: 'providedCategories', label: 'دسته‌بندی‌های قابل تأمین' },
      { key: 'description', label: 'توضیحات' },
    ]
  },
  {
    key: 'proformas',
    name: 'پیش‌فاکتورها',
    fields: [
      { key: 'customerId', label: 'مشتری' },
      { key: 'contactCustomerId', label: 'مخاطب پیش‌فاکتور' },
      { key: 'contactPrefix', label: 'پیشوند مخاطب' },
      { key: 'projectId', label: 'پروژه مرتبط' },
      { key: 'issueDate', label: 'تاریخ صدور' },
      { key: 'expiryDate', label: 'تاریخ اعتبار' },
      { key: 'currency', label: 'ارز پیش‌فاکتور' },
      { key: 'notes', label: 'توضیحات و شرایط' },
    ]
  },
  {
    key: 'tasks',
    name: 'وظایف و پیگیری',
    fields: [
      { key: 'title', label: 'عنوان پیگیری' },
      { key: 'description', label: 'توضیحات وظیفه' },
      { key: 'assignedTo', label: 'منتسب به' },
      { key: 'dueDate', label: 'تاریخ سررسید' },
      { key: 'priority', label: 'اولویت' },
    ]
  },
  {
    key: 'supplierInquiries',
    name: 'استعلام قیمت تأمین‌کنندگان',
    fields: [
      { key: 'projectId', label: 'پروژه مرتبط' },
      { key: 'supplierId', label: 'تأمین‌کننده' },
    ]
  },
  {
    key: 'purchaseOrders',
    name: 'سفارشات خرید خارجی',
    fields: [
      { key: 'supplierId', label: 'تأمین‌کننده' },
      { key: 'projectId', label: 'پروژه مرتبط' },
      { key: 'proformaId', label: 'پیش‌فاکتور مرتبط' },
      { key: 'orderDate', label: 'تاریخ سفارش' },
      { key: 'expectedDeliveryDate', label: 'تاریخ پیش‌بینی تحویل' },
      { key: 'currency', label: 'ارز فاکتور' },
      { key: 'exchangeRateInput', label: 'نرخ تسعیر ارز' },
    ]
  },
  {
    key: 'packagingDelivery',
    name: 'بسته‌بندی و تحویل کالا',
    fields: [
      { key: 'projectId', label: 'پروژه مرتبط' },
      { key: 'deliveryDate', label: 'تاریخ پکینگ لیست' },
      { key: 'shippingMethod', label: 'نحوه ارسال کالا' },
    ]
  },
  {
    key: 'afterSalesServices',
    name: 'خدمات پس از فروش',
    fields: [
      { key: 'projectId', label: 'پروژه مرتبط' },
      { key: 'itemName', label: 'نام تجهیز' },
      { key: 'issueDescription', label: 'شرح مشکل' },
      { key: 'actionsTaken', label: 'اقدامات انجام شده' },
      { key: 'startDate', label: 'تاریخ شروع' },
    ]
  },
  {
    key: 'transactions',
    name: 'دریافت و پرداخت ریالی',
    fields: [
      { key: 'type', label: 'نوع تراکنش' },
      { key: 'receiptType', label: 'بابت' },
      { key: 'documentNumber', label: 'شماره سند' },
      { key: 'amountRIYAL', label: 'مبلغ ریالی' },
      { key: 'date', label: 'تاریخ ثبت' },
      { key: 'paymentType', label: 'روش پرداخت' },
      { key: 'referenceNumber', label: 'شماره پیگیری/چک' },
    ]
  }
];

export const DEFAULT_REQUIRED_FIELDS: Record<string, Record<string, boolean>> = {
  customers: {
    companyName: true,
    firstName: true,
    lastName: true,
    gender: false,
    phone: false,
    mobile: false,
    email: false,
    province: false,
    address: false,
    industry: false,
    economicCode: false,
    keyPerson: false,
    position: false,
  },
  projects: {
    name: true,
    customerId: true,
    status: false,
    salesExpert: false,
    marketingChannel: false,
    leadQuality: false,
    referrerName: false,
    financialContact: false,
    technicalContact: false,
    communicationMethod: false,
    customerInquiryNumber: false,
    opportunityDate: false,
    expectedCloseDate: false,
    agreedDeliveryDate: false,
    winningDate: false,
    endUser: false,
    description: false,
  },
  products: {
    displayName: true,
    productCode: false,
    category: false,
    brand: false,
    currencyForeign: false,
    supplyType: false,
    initialStock: false,
    description: false,
  },
  suppliers: {
    name: true,
    country: true,
    city: false,
    contactName: true,
    phone: false,
    email: false,
    status: false,
    providedCategories: false,
    description: false,
  },
  proformas: {
    customerId: true,
    contactCustomerId: false,
    contactPrefix: false,
    projectId: true,
    issueDate: true,
    expiryDate: true,
    currency: true,
    notes: false,
  },
  tasks: {
    title: true,
    description: false,
    assignedTo: false,
    dueDate: true,
    priority: false,
  },
  supplierInquiries: {
    // A general/warehouse purchase inquiry has no project to attach to.
    projectId: false,
    supplierId: true,
  },
  purchaseOrders: {
    supplierId: true,
    projectId: false,
    proformaId: false,
    orderDate: true,
    expectedDeliveryDate: true,
    currency: false,
    exchangeRateInput: false,
  },
  packagingDelivery: {
    projectId: true,
    deliveryDate: false,
    shippingMethod: false,
  },
  afterSalesServices: {
    projectId: true,
    itemName: false,
    issueDescription: false,
    actionsTaken: false,
    startDate: false,
  },
  transactions: {
    type: false,
    receiptType: true,
    documentNumber: true,
    amountRIYAL: true,
    date: true,
    paymentType: false,
    referenceNumber: false,
  }
};

export const isFieldRequired = (
  settings: ERPSettings | undefined,
  moduleKey: string,
  fieldKey: string
): boolean => {
  if (!settings) return false;
  // A saved value (even `false`) always wins for that specific field.
  const savedModule = settings.requiredFields?.[moduleKey];
  if (savedModule && Object.prototype.hasOwnProperty.call(savedModule, fieldKey)) {
    return !!savedModule[fieldKey];
  }
  // Otherwise fall back to the built-in default so newly added fields still
  // honor their intended default even when older saved settings omit them.
  return !!DEFAULT_REQUIRED_FIELDS[moduleKey]?.[fieldKey];
};

export const getFieldAsterisk = (
  settings: ERPSettings | undefined,
  moduleKey: string,
  fieldKey: string
): string => {
  return isFieldRequired(settings, moduleKey, fieldKey) ? ' *' : '';
};

export const renderFieldLabelWithAsterisk = (
  settings: ERPSettings | undefined,
  moduleKey: string,
  fieldKey: string,
  labelText: string
): React.ReactNode => {
  const isReq = isFieldRequired(settings, moduleKey, fieldKey);
  return (
    <>
      {labelText}
      {isReq && <span className="text-red-500 mr-1">*</span>}
    </>
  );
};
