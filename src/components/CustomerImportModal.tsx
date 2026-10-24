import React, { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, PhoneCall, Upload, X } from 'lucide-react';
import { customersApi } from '../api/customers';
import {
  CUSTOMER_IMPORT_COLUMNS, MAX_CUSTOMER_IMPORT_ROWS, companyNameKey, parseImportSheet, unknownHeaders,
  type CustomerImportResult, type CustomerImportRowResult,
} from '../utils/customerImport';

/**
 * «ورود مشتری از اکسل».
 *
 * The browser reads the sheet into rows keyed by header and the server decides
 * everything — what is new, what we already have, which blanks to fill. The
 * preview runs the same `parseImportSheet` the server runs, so the count the
 * person confirms is the count that will be tried. Afterwards the customers the
 * sheet named (created or matched) can be put straight into the grid's
 * selection, which is what «ساخت وظیفهٔ تماس گروهی» reads.
 */
export interface CustomerImportModalProps {
  open: boolean;
  /** Offered only to somebody who can raise tasks. */
  canSelect: boolean;
  onClose: () => void;
  onSelect: (customers: { id: string; name: string }[]) => void;
}

const fa = (n: number): string => n.toLocaleString('fa-IR');

const OUTCOME_LABEL: Record<CustomerImportRowResult['outcome'], string> = {
  created: 'ثبت شد',
  updated: 'تکمیل شد',
  unchanged: 'از قبل بود',
  hidden: 'از قبل بود (بدون دسترسی)',
  error: 'ثبت نشد',
};

/** The empty sheet with the headers the importer reads, and one sample row. */
export async function downloadCustomerImportTemplate(): Promise<void> {
  const XLSX = await import('xlsx');
  const sample: Record<string, string> = {};
  for (const col of CUSTOMER_IMPORT_COLUMNS) sample[col.header] = col.sample;
  const ws = XLSX.utils.json_to_sheet([sample], { header: CUSTOMER_IMPORT_COLUMNS.map((c) => c.header) });
  // Phones stay text, so a leading zero survives somebody editing the sheet.
  ws['!cols'] = CUSTOMER_IMPORT_COLUMNS.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'مشتریان');
  XLSX.writeFile(wb, 'نمونه_ورود_مشتریان.xlsx');
}

/** The first sheet of a workbook as rows keyed by header. */
export async function readSheetRows(file: File): Promise<Record<string, unknown>[]> {
  const XLSX = await import('xlsx');
  const data = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(data, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
}

export default function CustomerImportModal({
  open, canSelect, onClose, onSelect,
}: CustomerImportModalProps): React.ReactElement | null {
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CustomerImportResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setFileName(''); setRows(null); setError(null); setBusy(false); setResult(null);
  }, [open]);

  if (!open) return null;

  const preview = rows ? parseImportSheet(rows) : [];
  const readable = preview.filter((r) => r.customer).length;
  const refused = preview.filter((r) => !r.customer);
  const splitRows = preview.filter((r) => r.customer && r.contact).length;
  const companyCount = new Set(preview.filter((r) => r.customer && r.contact).map((r) => companyNameKey(r.customer!.companyName))).size;
  const strange = rows ? unknownHeaders(rows) : [];

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null); setResult(null); setFileName(file.name);
    try {
      const read = await readSheetRows(file);
      if (read.length > MAX_CUSTOMER_IMPORT_ROWS) {
        setRows(null);
        setError(`فایل ${fa(read.length)} ردیف دارد؛ در هر بار حداکثر ${fa(MAX_CUSTOMER_IMPORT_ROWS)} ردیف را می‌توان وارد کرد.`);
        return;
      }
      setRows(read);
    } catch {
      setRows(null);
      setError('فایل خوانده نشد. یک فایل اکسل (xlsx) انتخاب کنید.');
    }
  };

  const submit = async () => {
    if (!rows || readable === 0) return;
    setBusy(true); setError(null);
    try {
      setResult(await customersApi.importRows(rows));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ورود مشتریان با خطا مواجه شد.');
    } finally {
      setBusy(false);
    }
  };

  const named = result
    ? result.rows.filter((r) => r.customerId && r.outcome !== 'hidden').map((r) => ({ id: r.customerId!, name: r.name }))
    : [];
  const problems = result ? result.rows.filter((r) => r.outcome === 'error' || r.outcome === 'hidden' || (r.warnings?.length ?? 0) > 0) : [];

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" data-customer-import-modal>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl border border-slate-200 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-hairline shrink-0">
          <h3 className="font-bold text-sm text-slate-800 inline-flex items-center gap-2">
            <FileSpreadsheet size={16} /> ورود مشتری از اکسل
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" title="بستن">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          {!result && (
            <>
              <p className="text-xs text-secondary leading-6">
                ردیفی که هم نام شرکت و هم نام شخص دارد دو مشتری می‌سازد: شرکت (حقوقی) و آن شخص (حقیقی) که به شرکت متصل می‌شود. چند ردیفِ یک شرکت، یک شرکت می‌سازند. اگر مشتری با همان کد اقتصادی، موبایل یا ایمیل — یا شرکت با همان نام — از قبل در سیستم باشد، دوباره ساخته نمی‌شود و فقط فیلدهای خالی‌اش از فایل پر می‌شود. ستون‌ها باید همان عنوان‌های فایل نمونه را داشته باشند.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void downloadCustomerImportTemplate()} id="btn-customer-import-template"
                  className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5">
                  <Download size={14} /> دانلود فایل نمونه
                </button>
                <label className="px-3 py-1.5 rounded-lg text-xs bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1.5 cursor-pointer">
                  <Upload size={14} /> انتخاب فایل
                  <input type="file" accept=".xlsx,.xls,.csv" className="hidden" data-customer-import-file
                    onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
                {fileName && <span className="text-xs text-muted">{fileName}</span>}
              </div>

              {rows && (
                <div className="text-xs space-y-1.5 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2" data-customer-import-preview>
                  <p className="text-slate-800 font-medium">{fa(readable)} ردیف آمادهٔ ورود است.</p>
                  {splitRows > 0 && (
                    <p className="text-secondary" data-customer-import-split>
                      {fa(splitRows)} ردیف شرکت و شخص را با هم دارد؛ برای {fa(companyCount)} شرکت، شرکت یک بار و هر شخص به‌صورت مشتری حقیقیِ متصل ثبت می‌شود.
                    </p>
                  )}
                  {refused.length > 0 && (
                    <div className="text-red-700">
                      <p>{fa(refused.length)} ردیف وارد نمی‌شود:</p>
                      <ul className="list-disc pr-5">
                        {refused.slice(0, 20).map((r) => <li key={r.rowNumber}>ردیف {fa(r.rowNumber)}: {r.error}</li>)}
                      </ul>
                    </div>
                  )}
                  {strange.length > 0 && (
                    <p className="text-amber-700">این ستون‌ها شناخته نشدند و خوانده نمی‌شوند: {strange.join('، ')}</p>
                  )}
                </div>
              )}
            </>
          )}

          {result && (
            <div className="space-y-3" data-customer-import-result>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 py-2"><div className="text-lg font-bold text-emerald-700">{fa(result.created)}</div>مشتری جدید</div>
                <div className="rounded-lg border border-sky-200 bg-sky-50 py-2"><div className="text-lg font-bold text-sky-700">{fa(result.updated)}</div>تکمیل شد</div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 py-2"><div className="text-lg font-bold text-slate-700">{fa(result.unchanged + result.hidden)}</div>از قبل بود</div>
                <div className="rounded-lg border border-red-200 bg-red-50 py-2"><div className="text-lg font-bold text-red-700">{fa(result.errors)}</div>ثبت نشد</div>
              </div>
              {problems.length > 0 && (
                <table className="w-full text-xs">
                  <thead><tr className="text-muted"><th className="text-right py-1 px-2">ردیف</th><th className="text-right py-1 px-2">مشتری</th><th className="text-right py-1 px-2">نتیجه</th><th className="text-right py-1 px-2">توضیح</th></tr></thead>
                  <tbody>
                    {problems.map((r) => (
                      <tr key={r.rowNumber} className="border-t border-slate-100 align-top">
                        <td className="py-1 px-2">{fa(r.rowNumber)}</td>
                        <td className="py-1 px-2">{r.name || '—'}{r.companyName ? ` (${r.companyName})` : ''}</td>
                        <td className="py-1 px-2 whitespace-nowrap">{OUTCOME_LABEL[r.outcome]}</td>
                        <td className="py-1 px-2">{[r.message, ...(r.warnings ?? [])].filter(Boolean).join(' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {result.rows.some((r) => r.outcome === 'updated') && (
                <p className="text-xs text-muted">«تکمیل شد» یعنی مشتری از قبل بود و فقط فیلدهای خالی‌اش پر شد؛ چیزی که از قبل ثبت شده بود تغییر نکرد.</p>
              )}
            </div>
          )}

          {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-hairline shrink-0">
          {result ? (
            <>
              {canSelect && named.length > 0 && (
                <button type="button" id="btn-customer-import-select" onClick={() => onSelect(named)}
                  className="px-3 py-1.5 rounded-lg text-xs bg-sky-600 text-white hover:bg-sky-700 inline-flex items-center gap-1.5">
                  <PhoneCall size={14} /> انتخاب {fa(named.length)} مشتری برای تماس گروهی
                </button>
              )}
              <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 text-slate-600 hover:bg-slate-50">بستن</button>
            </>
          ) : (
            <>
              <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 text-slate-600 hover:bg-slate-50">انصراف</button>
              <button type="button" id="btn-customer-import-submit" onClick={() => void submit()} disabled={busy || readable === 0}
                className="px-3 py-1.5 rounded-lg text-xs bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60">
                {busy ? 'در حال ورود…' : `ورود ${fa(readable)} ردیف`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
