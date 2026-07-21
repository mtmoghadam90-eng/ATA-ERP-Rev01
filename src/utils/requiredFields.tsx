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
      { key: 'phone', label: 'تلفن ثابت' },
      { key: 'mobile', label: 'تلفن همراه' },
      { key: 'email', label: 'ایمیل' },
      { key: 'province', label: 'استان' },
      { key: 'city', label: 'شهر' },
      { key: 'address', label: 'آدرس دقیق' },
      { key: 'industry', label: 'صنعت فعالیت (حقوقی)' },
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
      { key: 'salesExpert', label: 'کارشناس فروش' },
      { key: 'marketingChannel', label: 'کانال بازاریابی' },
      { key: 'leadQuality', label: 'کیفیت لید' },
      { key: 'referrerName', label: 'نام معرف' },
      { key: 'financialContact', label: 'فرد کلیدی مالی' },
      { key: 'technicalContact', label: 'فرد کلیدی فنی' },
      { key: 'customerInquiryNumber', label: 'شماره استعلام مشتری' },
      { key: 'expectedCloseDate', label: 'تاریخ پیش‌بینی بسته شدن' },
      { key: 'endUser', label: 'مصرف‌کننده نهایی' },
      { key: 'description', label: 'توضیحات پروژه' },
    ]
  },
  {
    key: 'products',
    name: 'کالا و انبار',
    fields: [
      { key: 'displayName', label: 'نام کالا' },
      { key: 'category', label: 'دسته‌بندی کالا' },
      { key: 'brand', label: 'برند/سازنده' },
      { key: 'modelNumber', label: 'مدل' },
      { key: 'unit', label: 'واحد' },
      { key: 'basePriceRIYAL', label: 'قیمت پایه ریالی' },
      { key: 'supplyType', label: 'نوع تامین' },
      { key: 'description', label: 'توضیحات' },
    ]
  },
  {
    key: 'suppliers',
    name: 'تأمین‌کنندگان',
    fields: [
      { key: 'name', label: 'نام کمپانی تأمین‌کننده' },
      { key: 'country', label: 'کشور مبدا' },
      { key: 'contactName', label: 'نام کارشناس/مخاطب' },
      { key: 'phone', label: 'تلفن تماس' },
      { key: 'email', label: 'ایمیل مکاتبه' },
      { key: 'website', label: 'وب‌سایت' },
      { key: 'paymentTerms', label: 'شرایط پرداخت' },
      { key: 'description', label: 'توضیحات' },
    ]
  },
  {
    key: 'proformas',
    name: 'پیش‌فاکتورها',
    fields: [
      { key: 'customerId', label: 'مشتری' },
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
      { key: 'creationDate', label: 'تاریخ ثبت' },
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
    phone: false,
    mobile: false,
    email: false,
    province: false,
    city: false,
    address: false,
    industry: false,
    keyPerson: false,
    position: false,
  },
  projects: {
    name: true,
    customerId: true,
    salesExpert: false,
    marketingChannel: false,
    leadQuality: false,
    referrerName: false,
    financialContact: false,
    technicalContact: false,
    customerInquiryNumber: false,
    expectedCloseDate: false,
    endUser: false,
    description: false,
  },
  products: {
    displayName: true,
    category: false,
    brand: false,
    modelNumber: false,
    unit: false,
    basePriceRIYAL: false,
    supplyType: false,
    description: false,
  },
  suppliers: {
    name: true,
    country: true,
    contactName: true,
    phone: false,
    email: false,
    website: false,
    paymentTerms: false,
    description: false,
  },
  proformas: {
    customerId: true,
    projectId: false,
    issueDate: true,
    expiryDate: false,
    currency: false,
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
    projectId: true,
    supplierId: true,
    creationDate: false,
  },
  purchaseOrders: {
    supplierId: true,
    projectId: false,
    proformaId: false,
    orderDate: false,
    expectedDeliveryDate: false,
    currency: false,
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
    receiptType: false,
    documentNumber: false,
    amountRIYAL: true,
    date: false,
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
  // If requiredFields structure is missing, return standard default fallback
  const fields = settings.requiredFields || DEFAULT_REQUIRED_FIELDS;
  if (!fields[moduleKey]) return false;
  return !!fields[moduleKey][fieldKey];
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
