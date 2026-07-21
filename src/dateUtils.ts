export function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = (gy <= 1600) ? 0 : 979;
  gy -= (gy <= 1600) ? 621 : 1600;
  const gy2 = (gm > 2) ? (gy + 1) : gy;
  let days = (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) - 80 + gd + g_d_m[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  jy += Math.floor((days - 1) / 365);
  if (days > 365) days = (days - 1) % 365;
  const jm = (days < 186) ? (1 + Math.floor(days / 31)) : (7 + Math.floor((days - 186) / 30));
  const jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
  return [jy, jm, jd];
}

export function jalaliToGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  let gy = (jy <= 979) ? 0 : 1600;
  jy -= (jy <= 979) ? 0 : 979;
  const days = (365 * jy) + (Math.floor(jy / 33) * 8) + Math.floor(((jy % 33) + 3) / 4) + 78 + jd + ((jm < 7) ? ((jm - 1) * 31) : (((jm - 7) * 30) + 186));
  gy += 400 * Math.floor(days / 146097);
  let daysLeft = days % 146097;
  if (daysLeft > 36524) {
    daysLeft--;
    gy += 100 * Math.floor(daysLeft / 36524);
    daysLeft %= 36524;
    if (daysLeft >= 365) daysLeft++;
  }
  gy += 4 * Math.floor(daysLeft / 1461);
  daysLeft %= 1461;
  gy += Math.floor((daysLeft - 1) / 365);
  if (daysLeft > 365) daysLeft = (daysLeft - 1) % 365;
  let gd = daysLeft + 1;
  const sal_a = [0, 31, ((gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (let i = 1; i <= 12; i++) {
    if (gd <= sal_a[i]) {
      gm = i;
      break;
    }
    gd -= sal_a[i];
  }
  return [gy, gm, gd];
}

export function parseGregorianDate(dateStr: any): { y: number; m: number; d: number } | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const m = dateStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    return { y: parseInt(m[1]), m: parseInt(m[2]), d: parseInt(m[3]) };
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }
  return null;
}

export function toShamsiStr(dateInput: any): string {
  if (!dateInput) return '';
  if (dateInput instanceof Date) {
    if (isNaN(dateInput.getTime())) return '';
    const [jy, jm, jd] = gregorianToJalali(dateInput.getFullYear(), dateInput.getMonth() + 1, dateInput.getDate());
    return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
  }
  
  let dateStr = dateInput;
  if (typeof dateStr !== 'string') {
    dateStr = String(dateStr);
  }
  
  const trimmed = dateStr.trim();
  // If it already looks like a Shamsi date (e.g., starting with 13 or 14)
  if (/^(13|14)\d{2}[-/]\d{1,2}[-/]\d{1,2}/.test(trimmed)) {
    return trimmed.replace(/-/g, '/');
  }

  const parsed = parseGregorianDate(trimmed);
  if (parsed) {
    const [jy, jm, jd] = gregorianToJalali(parsed.y, parsed.m, parsed.d);
    return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
  }
  return trimmed;
}

export function getTodayShamsi(): string {
  return toShamsiStr(new Date());
}

export function toGregorianStr(shamsiStr: any): string {
  if (!shamsiStr || typeof shamsiStr !== 'string') return '';
  const m = shamsiStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const jy = parseInt(m[1]);
    const jm = parseInt(m[2]);
    const jd = parseInt(m[3]);
    const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
    return `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
  }
  return shamsiStr;
}

export function addDaysToShamsi(shamsiStr: string, days: number): string {
  if (!shamsiStr) return '';
  const gStr = toGregorianStr(shamsiStr);
  const d = new Date(gStr);
  d.setDate(d.getDate() + days);
  return toShamsiStr(d);
}

export function getShamsiDaysDifference(dateA: string, dateB: string): number {
  if (!dateA || !dateB) return 0;
  const gStrA = toGregorianStr(dateA);
  const gStrB = toGregorianStr(dateB);
  const dA = new Date(gStrA);
  const dB = new Date(gStrB);
  if (isNaN(dA.getTime()) || isNaN(dB.getTime())) return 0;
  const diffTime = dB.getTime() - dA.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

const FIXED_HOLIDAYS = new Set([
  '01/01',
  '01/02',
  '01/03',
  '01/04',
  '01/12',
  '01/13',
  '03/14',
  '03/15',
  '11/22',
  '12/29',
]);

const HOLIDAYS_1405 = new Set([
  '01/10', // Martyrdom of Imam Ali
  '01/22', // Martyrdom of Imam Sadiq
  '03/06', // Eid al-Adha
  '05/02', // Tasu'a
  '05/03', // Ashura
  '06/12', // Arba'een
  '06/20', // Demise of Prophet
  '06/22', // Martyrdom of Imam Reza
  '06/29', // Martyrdom of Imam Askari
  '07/07', // Birthday of Prophet
  '09/02', // Martyrdom of Fatima
  '11/02', // Birthday of Imam Ali
  '11/16', // Mab'ath of Prophet
  '12/03', // Birthday of Imam Mahdi
]);

const HOLIDAYS_1406 = new Set([
  '01/11', // Martyrdom of Imam Sadiq
  '02/25', // Eid al-Adha
  '03/03', // Eid al-Ghadir
  '04/22', // Tasu'a
  '04/23', // Ashura
  '06/01', // Arba'een
  '06/09', // Demise of Prophet
  '06/11', // Martyrdom of Imam Reza
  '06/18', // Martyrdom of Imam Askari
  '06/26', // Birthday of Prophet
  '08/21', // Martyrdom of Fatima
  '10/21', // Birthday of Imam Ali
  '11/05', // Mab'ath of Prophet
  '11/21', // Birthday of Imam Mahdi
]);

export function isOfficialHoliday(shamsiStr: any): boolean {
  if (!shamsiStr || typeof shamsiStr !== 'string') return false;
  const normalized = shamsiStr.replace(/-/g, '/').trim();
  const parts = normalized.split('/');
  if (parts.length !== 3) return false;
  const year = parseInt(parts[0], 10);
  const month = parts[1].padStart(2, '0');
  const day = parts[2].padStart(2, '0');
  const md = `${month}/${day}`;

  // 1. Check fixed holidays
  if (FIXED_HOLIDAYS.has(md)) return true;

  // 2. Check year-specific lunar holidays
  if (year === 1405 && HOLIDAYS_1405.has(md)) return true;
  if (year === 1406 && HOLIDAYS_1406.has(md)) return true;

  // 3. Check Friday (weekend in Iran)
  const gStr = toGregorianStr(normalized);
  if (gStr) {
    const d = new Date(gStr);
    if (!isNaN(d.getTime())) {
      // 5 is Friday in JS (Sunday is 0, Monday is 1, ..., Friday is 5, Saturday is 6)
      if (d.getDay() === 5) {
        return true;
      }
    }
  }

  return false;
}

export function addWorkingDaysToShamsi(shamsiStr: string, workingDays: number): string {
  if (!shamsiStr) return '';
  let currentDate = shamsiStr;
  let count = 0;
  // If we need 0 working days, return current date
  if (workingDays <= 0) return currentDate;
  
  while (count < workingDays) {
    currentDate = addDaysToShamsi(currentDate, 1);
    if (!isOfficialHoliday(currentDate)) {
      count++;
    }
  }
  return currentDate;
}


export function parsePersianDate(shamsiStr: string): Date {
  const gStr = toGregorianStr(shamsiStr);
  return new Date(gStr);
}

export function formatDateTimeToShamsi(dateInput: any): string {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) {
    if (typeof dateInput === 'string' && /^(13|14)\d{2}/.test(dateInput)) {
      return dateInput;
    }
    return String(dateInput);
  }
  const shamsiDate = toShamsiStr(d);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${shamsiDate} ساعت ${hours}:${minutes}:${seconds}`;
}
