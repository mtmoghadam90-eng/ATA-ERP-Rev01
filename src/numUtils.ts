import { gregorianToJalali } from './dateUtils';

export function toPersianDigits(str: string | number): string {
  if (str === undefined || str === null) return '';
  const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return str.toString().replace(/[0-9]/g, (match) => persianDigits[parseInt(match, 10)]);
}

/**
 * Advanced Document and Code Generator for Abzar Tamin Arshia ERP
 * Parses dynamic templates with multiple custom placeholders to construct professional coding systems.
 */
export function formatERPNumber(
  template: string,
  context: {
    seq: number;
    projectCode?: string;
    customerCode?: string;
    customerName?: string;
    supplierCode?: string;
    supplierName?: string;
    category?: string;
    transactionType?: 'دریافت' | 'پرداخت';
  }
): string {
  if (!template) return '';

  const today = new Date();
  const [jy, jm, jd] = gregorianToJalali(today.getFullYear(), today.getMonth() + 1, today.getDate());
  
  let result = template;

  // 1. Jalali (Persian) Dates
  result = result.replace(/{YYYY}/g, String(jy));
  result = result.replace(/{YY}/g, String(jy).slice(-2));
  result = result.replace(/{MM}/g, String(jm).padStart(2, '0'));
  result = result.replace(/{DD}/g, String(jd).padStart(2, '0'));
  
  // 2. Gregorian Dates
  result = result.replace(/{G:YYYY}/g, String(today.getFullYear()));
  result = result.replace(/{G:YY}/g, String(today.getFullYear()).slice(-2));
  result = result.replace(/{G:MM}/g, String(today.getMonth() + 1).padStart(2, '0'));
  result = result.replace(/{G:DD}/g, String(today.getDate()).padStart(2, '0'));

  // 3. Dynamic Sequential Counter (e.g. {SEQ:3} -> '001', {SEQ:4} -> '0001')
  const seqRegex = /{SEQ:(\d+)}/g;
  result = result.replace(seqRegex, (_, paddingStr) => {
    const padding = parseInt(paddingStr, 10) || 3;
    return String(context.seq).padStart(padding, '0');
  });
  result = result.replace(/{SEQ}/g, String(context.seq));

  // 4. Project Reference Code
  if (context.projectCode) {
    result = result.replace(/{PROJECT_CODE}/g, context.projectCode);
    result = result.replace(/{PROJECT}/g, context.projectCode);
  } else {
    result = result.replace(/{PROJECT_CODE}/g, 'GEN');
    result = result.replace(/{PROJECT}/g, 'GEN');
  }

  // 5. Customer Reference Initials
  if (context.customerName) {
    const nameClean = context.customerName.replace(/[^a-zA-Z0-9آ-ی]/g, '');
    const initial = nameClean.charAt(0) || 'C';
    result = result.replace(/{CUSTOMER_INITIALS}/g, initial);
    result = result.replace(/{CUSTOMER}/g, initial);
  } else {
    result = result.replace(/{CUSTOMER_INITIALS}/g, 'C');
    result = result.replace(/{CUSTOMER}/g, 'C');
  }

  // 6. Supplier Reference Initials
  if (context.supplierName) {
    const nameClean = context.supplierName.replace(/[^a-zA-Z0-9آ-ی]/g, '');
    const initial = nameClean.charAt(0) || 'S';
    result = result.replace(/{SUPPLIER_INITIALS}/g, initial);
    result = result.replace(/{SUPPLIER}/g, initial);
  } else {
    result = result.replace(/{SUPPLIER_INITIALS}/g, 'S');
    result = result.replace(/{SUPPLIER}/g, 'S');
  }

  // 7. Category Initials
  if (context.category) {
    const catClean = context.category.substring(0, 3).toUpperCase();
    result = result.replace(/{CATEGORY}/g, catClean);
  } else {
    result = result.replace(/{CATEGORY}/g, 'GEN');
  }

  // 8. Transaction Type Code (دریافت -> RC / پرداخت -> PV)
  if (context.transactionType) {
    const typeCode = context.transactionType === 'دریافت' ? 'RC' : 'PV';
    result = result.replace(/{TYPE}/g, typeCode);
  } else {
    result = result.replace(/{TYPE}/g, 'TR');
  }

  // 9. Random Number Generator (e.g. {RAND:5} -> '48291')
  const randRegex = /{RAND:(\d+)}/g;
  result = result.replace(randRegex, (_, lenStr) => {
    const len = parseInt(lenStr, 10) || 5;
    const min = Math.pow(10, len - 1);
    const max = Math.pow(10, len) - 1;
    return String(Math.floor(min + Math.random() * (max - min)));
  });

  return result;
}
