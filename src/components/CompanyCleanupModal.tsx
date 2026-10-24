import React, { useEffect, useState } from 'react';
import { Building2, X } from 'lucide-react';
import { customersApi } from '../api/customers';
import type { CompanyCleanupGroup, CompanyCleanupResult } from '../utils/customerCleanup';
import { formatDateTimeToShamsi } from '../dateUtils';

/**
 * «اصلاح شرکت‌های تکراری» — repairs what the first Excel import wrote: one
 * company per row, each holding one person in «شخص کلیدی». Each group becomes
 * one company with its people as linked «حقیقی» customers; the plan is the
 * server's (`planCompanyCleanup`) and nothing is written until the button.
 * A group is ticked by default when it really is a duplicate or every record
 * of it came from an Excel import; a single company somebody typed with a key
 * person is listed unticked, for a person to decide.
 */
interface Props {
  open: boolean;
  onClose: () => void;
}

const fa = (n: number) => n.toLocaleString('fa-IR');

export default function CompanyCleanupModal({ open, onClose }: Props): React.ReactElement | null {
  const [groups, setGroups] = useState<CompanyCleanupGroup[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompanyCleanupResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setGroups(null); setError(null); setResult(null); setBusy(false);
    let cancelled = false;
    customersApi.companyCleanupPreview()
      .then((g) => {
        if (cancelled) return;
        setGroups(g);
        setSelected(new Set(g.filter((x) => x.defaultSelected).map((x) => x.key)));
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'فهرست خوانده نشد.'); });
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  const toggle = (key: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const allTicked = !!groups && groups.length > 0 && groups.every((g) => selected.has(g.key));

  const apply = async () => {
    if (selected.size === 0) return;
    setBusy(true); setError(null);
    try {
      setResult(await customersApi.applyCompanyCleanup([...selected]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'اصلاح با خطا مواجه شد.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" data-company-cleanup-modal>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl border border-slate-200 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-hairline shrink-0">
          <h3 className="font-bold text-sm text-slate-800 inline-flex items-center gap-2">
            <Building2 size={16} /> اصلاح شرکت‌های تکراری
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" title="بستن">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          {!result && (
            <p className="text-xs text-secondary leading-6">
              شرکت‌هایی که با یک نام چند بار ثبت شده‌اند، یا هنوز نام یک شخص را در «شخص کلیدی» دارند. با اصلاح، هر گروه یک مشتری حقوقی می‌شود و هر شخص یک مشتری حقیقیِ متصل به آن، با موبایل و ایمیل خودش. پروژه‌ها، پیش‌فاکتورها و تراکنش‌ها روی شرکت می‌مانند و وظیفه‌های تماس روی همان شخص.
            </p>
          )}

          {!result && groups === null && !error && <p className="text-xs text-muted">در حال خواندن…</p>}
          {!result && groups && groups.length === 0 && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">موردی برای اصلاح پیدا نشد.</p>
          )}

          {!result && groups && groups.length > 0 && (
            <div className="space-y-1.5" data-company-cleanup-list>
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <input type="checkbox" checked={allTicked}
                  onChange={() => setSelected(allTicked ? new Set() : new Set(groups.map((g) => g.key)))} />
                انتخاب همه ({fa(groups.length)} گروه)
              </label>
              {groups.map((g) => (
                <label key={g.key} className="flex items-start gap-2 text-xs border border-slate-200 rounded-lg px-3 py-2 cursor-pointer hover:bg-slate-50"
                  data-company-cleanup-group={g.key}>
                  <input type="checkbox" className="mt-0.5" checked={selected.has(g.key)} onChange={() => toggle(g.key)} />
                  <span className="flex-1 min-w-0">
                    <span className="font-bold text-slate-800">{g.name}</span>
                    <span className="text-muted"> — {fa(g.size)} رکورد فعلی → {g.summary}</span>
                    {g.people.length > 0 && <span className="block text-secondary mt-0.5">اشخاص: {g.people.join('، ')}</span>}
                    {g.createdAt && <span className="block text-faint mt-0.5">ثبت: {formatDateTimeToShamsi(g.createdAt)}</span>}
                  </span>
                </label>
              ))}
            </div>
          )}

          {result && (
            <div className="text-xs space-y-1.5 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2" data-company-cleanup-result>
              <p className="font-medium text-emerald-800">
                {fa(result.groups)} شرکت اصلاح شد: {fa(result.people)} شخص حقیقی متصل شد و {fa(result.merged)} رکورد تکراری ادغام شد.
              </p>
              {result.failed.length > 0 && (
                <ul className="list-disc pr-5 text-red-700">
                  {result.failed.map((f) => <li key={f.name}>{f.name}: {f.message}</li>)}
                </ul>
              )}
            </div>
          )}

          {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-hairline shrink-0">
          {result ? (
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 text-slate-600 hover:bg-slate-50">بستن</button>
          ) : (
            <>
              <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 text-slate-600 hover:bg-slate-50">انصراف</button>
              <button type="button" id="btn-company-cleanup-apply" onClick={() => void apply()} disabled={busy || selected.size === 0}
                className="px-3 py-1.5 rounded-lg text-xs bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60">
                {busy ? 'در حال اصلاح…' : `اصلاح ${fa(selected.size)} گروه`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
