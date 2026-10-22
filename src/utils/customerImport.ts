/**
 * «ورود مشتری از اکسل» — the pure half.
 *
 * Asked for as loading a list of prospects from a spreadsheet so they can be
 * rung through «ساخت وظیفهٔ تماس گروهی». Two answers decided its shape:
 *
 * - **A row is a new customer unless it is one we already have**, and «already
 *   have» is the identifying fields, in order of how much they prove: the
 *   economic code (the one hard duplicate the database itself refuses), the
 *   mobile (folded the way `mobileNormalized` is), then the email. A name alone
 *   matches nothing — two «شرکت نمونه»s are routine here, and merging them on
 *   a name would write one company's number onto another.
 * - **An existing customer is only ever filled in, never corrected.** A sheet
 *   is somebody's list from somewhere, and the record on the system is what
 *   the sales desk has been working from; so a field already holding a value
 *   keeps it, and only a blank takes the sheet's (`fillBlanks`).
 *
 * The parsing is here rather than in the browser so the server — the authority
 * — runs the same rules on whatever it is sent, and `test:rules` can hold them.
 */
import { canonicalizeProvince } from "./iranProvinces";
import { getContactInfoError } from "./customerValidation";

/** How many rows one import may carry. */
export const MAX_CUSTOMER_IMPORT_ROWS = 500;

export const CUSTOMER_TYPE_COMPANY = "حقوقی";
export const CUSTOMER_TYPE_PERSON = "حقیقی";

/** The fields an import may write — a subset of the customer form's. */
export type ImportField =
  | "customerType" | "companyName" | "firstName" | "lastName" | "position"
  | "mobile" | "phone" | "email" | "province" | "city" | "industry"
  | "keyPerson" | "economicCode" | "address" | "tags" | "notes";

/**
 * The sheet's columns, in the order the template lays them out. The header is
 * matched after folding (`headerKey`), so «نام‌خانوادگی» and «نام خانوادگی»
 * are one column; `aliases` are the other spellings people actually write.
 */
export const CUSTOMER_IMPORT_COLUMNS: { field: ImportField; header: string; aliases?: string[]; sample: string }[] = [
  { field: "customerType", header: "نوع مشتری", aliases: ["نوع"], sample: CUSTOMER_TYPE_COMPANY },
  { field: "companyName", header: "نام شرکت", aliases: ["شرکت", "نام سازمان"], sample: "شرکت نمونه" },
  { field: "firstName", header: "نام", sample: "علی" },
  { field: "lastName", header: "نام خانوادگی", aliases: ["فامیلی"], sample: "رضایی" },
  { field: "position", header: "سمت", sample: "مدیر خرید" },
  { field: "mobile", header: "موبایل", aliases: ["شماره موبایل", "تلفن همراه", "همراه"], sample: "09121234567" },
  { field: "phone", header: "تلفن", aliases: ["تلفن ثابت", "شماره تلفن"], sample: "02188776655" },
  { field: "email", header: "ایمیل", aliases: ["پست الکترونیک", "email"], sample: "info@example.com" },
  { field: "province", header: "استان", sample: "تهران" },
  { field: "city", header: "شهر", sample: "تهران" },
  { field: "industry", header: "حوزه فعالیت", aliases: ["صنعت"], sample: "پتروشیمی" },
  { field: "keyPerson", header: "شخص کلیدی", aliases: ["رابط", "مخاطب"], sample: "" },
  { field: "economicCode", header: "کد اقتصادی", aliases: ["شناسه ملی"], sample: "" },
  { field: "address", header: "آدرس", aliases: ["نشانی"], sample: "" },
  { field: "tags", header: "برچسب‌ها", aliases: ["برچسب"], sample: "" },
  { field: "notes", header: "توضیحات", aliases: ["یادداشت"], sample: "" },
];

/** A header folded to what it says: spacing, ZWNJ and ی/ي, ک/ك removed. */
export function headerKey(value: unknown): string {
  return String(value ?? "")
    .replace(/[‌‏‎]/g, "")
    .replace(/ي/g, "ی").replace(/ك/g, "ک")
    .replace(/[\s_\-*:]+/g, "")
    .toLowerCase();
}

const HEADER_TO_FIELD: Map<string, ImportField> = (() => {
  const map = new Map<string, ImportField>();
  for (const col of CUSTOMER_IMPORT_COLUMNS) {
    for (const h of [col.header, ...(col.aliases ?? [])]) map.set(headerKey(h), col.field);
  }
  return map;
})();

/** Persian/Arabic digits to Latin, leaving everything else. */
export function latinDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)));
}

/** A cell as text: numbers keep their digits, blanks become "". */
function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value).replace(/\s+/g, " ").trim();
}

/**
 * A phone number as it was typed, with one repair: a spreadsheet stores
 * «09121234567» as the number 9121234567 and drops the leading zero, so an
 * Iranian mobile that arrives as ten digits starting with 9 gets it back.
 */
function phoneText(value: unknown): string {
  const text = latinDigits(cellText(value)).replace(/[^\d+]/g, "");
  if (/^9\d{9}$/.test(text)) return `0${text}`;
  return text;
}

export type ImportedCustomer = Partial<Record<ImportField, string>> & {
  customerType: string;
  companyName: string;
};

export interface ParsedImportRow {
  /** The row's number as the sheet shows it (header is row 1). */
  rowNumber: number;
  customer: ImportedCustomer | null;
  /** Why the row cannot be imported; null when it can. */
  error: string | null;
  /** Things changed or dropped on the way, the row still imported. */
  warnings: string[];
}

/** The type a row says, else the one its name implies. */
function typeOf(raw: string, companyName: string): string {
  const k = headerKey(raw);
  if (k.includes("حقوقی") || k === "شرکت" || k === "company") return CUSTOMER_TYPE_COMPANY;
  if (k.includes("حقیقی") || k === "شخص" || k === "person") return CUSTOMER_TYPE_PERSON;
  return companyName ? CUSTOMER_TYPE_COMPANY : CUSTOMER_TYPE_PERSON;
}

/**
 * One sheet row (as `sheet_to_json` hands it, keyed by header) to a customer.
 *
 * A company row takes its name from «نام شرکت» and keeps the person on it as
 * `keyPerson` when the sheet named nobody else — throwing that name away loses
 * the one detail needed to ring back. A person's row is named by first and
 * last name, which is how every customer form names one.
 */
export function parseImportRow(row: Record<string, unknown>, rowNumber: number): ParsedImportRow {
  const values: Partial<Record<ImportField, string>> = {};
  for (const [header, value] of Object.entries(row ?? {})) {
    const field = HEADER_TO_FIELD.get(headerKey(header));
    if (!field) continue;
    const text = field === "mobile" || field === "phone" ? phoneText(value)
      : field === "economicCode" ? latinDigits(cellText(value)).replace(/\s/g, "")
      : field === "email" ? cellText(value).toLowerCase()
      : cellText(value);
    if (text) values[field] = text;
  }

  const warnings: string[] = [];
  if (Object.keys(values).length === 0) {
    return { rowNumber, customer: null, error: null, warnings };
  }

  const company = values.companyName ?? "";
  const person = `${values.firstName ?? ""} ${values.lastName ?? ""}`.trim();
  const customerType = typeOf(values.customerType ?? "", company);
  const companyName = customerType === CUSTOMER_TYPE_COMPANY ? company : person;
  if (!companyName) {
    return {
      rowNumber, customer: null, warnings,
      error: customerType === CUSTOMER_TYPE_COMPANY ? "نام شرکت خالی است." : "نام و نام خانوادگی خالی است.",
    };
  }

  if (values.province) {
    const canonical = canonicalizeProvince(values.province);
    if (canonical) values.province = canonical;
    else {
      warnings.push(`استان «${values.province}» شناخته نشد و ثبت نشد.`);
      delete values.province;
    }
  }
  if (values.mobile && !/^(\+?98|0)?9\d{9}$/.test(values.mobile)) {
    warnings.push(`«${values.mobile}» شمارهٔ موبایل معتبری نیست؛ در تلفن ثبت شد.`);
    if (!values.phone) values.phone = values.mobile;
    delete values.mobile;
  }
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    warnings.push(`ایمیل «${values.email}» معتبر نیست و ثبت نشد.`);
    delete values.email;
  }

  const contactError = getContactInfoError({
    mobile: values.mobile, phone: values.phone, email: values.email, province: values.province,
  });
  if (contactError) return { rowNumber, customer: null, warnings, error: contactError };

  const customer: ImportedCustomer = { ...values, customerType, companyName };
  if (customerType === CUSTOMER_TYPE_COMPANY) {
    // A company has no first and last name of its own; the person written
    // beside it is who to ask for.
    if (person && !customer.keyPerson) customer.keyPerson = person;
    delete customer.firstName;
    delete customer.lastName;
  }
  return { rowNumber, customer, error: null, warnings };
}

/** The keys a row can be matched on, in the order they decide. */
export interface MatchKeys {
  economicCode: string | null;
  mobile: string | null;
  email: string | null;
}

/** Ascii digits, no +98/0 prefix — `normalizeMobile`'s rule. */
export function mobileKey(value: string | null | undefined): string | null {
  let d = latinDigits(String(value ?? "")).replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("0098")) d = d.slice(4);
  else if (d.startsWith("98") && d.length === 12) d = d.slice(2);
  d = d.replace(/^0+/, "");
  return d || null;
}

export function matchKeys(c: Partial<Record<ImportField, string | null>>): MatchKeys {
  const code = latinDigits(String(c.economicCode ?? "")).replace(/\s/g, "");
  const email = String(c.email ?? "").trim().toLowerCase();
  return { economicCode: code || null, mobile: mobileKey(c.mobile), email: email || null };
}

/**
 * Rows of one sheet that are the same customer as an earlier row, by the
 * same keys an existing customer is matched on. The later row is refused and
 * names the earlier one, so nobody has to wonder why a list of fifty created
 * forty-nine.
 */
export function markDuplicateRows(rows: ParsedImportRow[]): ParsedImportRow[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    if (!row.customer) return row;
    const keys = matchKeys(row.customer);
    const tags = [
      keys.economicCode && `code:${keys.economicCode}`,
      keys.mobile && `mobile:${keys.mobile}`,
      keys.email && `email:${keys.email}`,
    ].filter((t): t is string => !!t);
    const earlier = tags.map((t) => seen.get(t)).find((n) => n != null);
    if (earlier != null) {
      return { ...row, customer: null, error: `تکراری است؛ همان مشتری ردیف ${earlier.toLocaleString("fa-IR")}.` };
    }
    for (const t of tags) seen.set(t, row.rowNumber);
    return row;
  });
}

/** The whole sheet: every non-empty row parsed, duplicates within it marked. */
export function parseImportSheet(rows: Record<string, unknown>[]): ParsedImportRow[] {
  const parsed = rows
    .map((row, i) => parseImportRow(row, i + 2))
    .filter((r) => r.customer || r.error);
  return markDuplicateRows(parsed);
}

/** The sheet's headers that name no column — reported, never guessed at. */
export function unknownHeaders(rows: Record<string, unknown>[]): string[] {
  const out = new Set<string>();
  for (const row of rows.slice(0, 50)) {
    for (const header of Object.keys(row ?? {})) {
      if (header.startsWith("__EMPTY")) continue;
      if (!HEADER_TO_FIELD.has(headerKey(header))) out.add(header);
    }
  }
  return [...out];
}

const FILLABLE: ImportField[] = [
  "position", "mobile", "phone", "email", "province", "city", "industry",
  "keyPerson", "economicCode", "address", "tags", "notes", "firstName", "lastName",
];

/**
 * What an existing customer takes from the sheet: only the fields it has no
 * value in. The type and the name are never in it — they identify the record,
 * and a sheet is not where a customer is renamed.
 */
export function fillBlanks(
  existing: Partial<Record<ImportField, string | null | undefined>>,
  incoming: ImportedCustomer,
): Partial<Record<ImportField, string>> {
  const patch: Partial<Record<ImportField, string>> = {};
  for (const field of FILLABLE) {
    const value = incoming[field];
    if (!value) continue;
    if (String(existing[field] ?? "").trim()) continue;
    patch[field] = value;
  }
  return patch;
}

/** One row of the server's answer. */
export interface CustomerImportRowResult {
  rowNumber: number;
  name: string;
  outcome: "created" | "updated" | "unchanged" | "hidden" | "error";
  customerId: string | null;
  /** The fields filled in on an existing customer. */
  filled?: string[];
  message?: string | null;
  warnings?: string[];
}

export interface CustomerImportResult {
  rows: CustomerImportRowResult[];
  created: number;
  updated: number;
  unchanged: number;
  hidden: number;
  errors: number;
}

export function summarizeImport(rows: CustomerImportRowResult[]): CustomerImportResult {
  const count = (o: CustomerImportRowResult["outcome"]) => rows.filter((r) => r.outcome === o).length;
  return {
    rows,
    created: count("created"),
    updated: count("updated"),
    unchanged: count("unchanged"),
    hidden: count("hidden"),
    errors: count("error"),
  };
}

/** The Persian label of a field, for «تکمیل شد: موبایل، شهر». */
export function importFieldLabel(field: string): string {
  return CUSTOMER_IMPORT_COLUMNS.find((c) => c.field === field)?.header ?? field;
}
