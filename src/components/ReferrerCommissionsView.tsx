import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, FileSpreadsheet, Gift, HandCoins, Loader2, Settings2, Trash2, X } from 'lucide-react';
import { referrerCommissionsApi, type PayoutRow, type ReferredProjectRow, type ReferrerRow } from '../api/referrerCommissions';
import { ApiError } from '../api/client';
import ShamsiDatePicker from './ShamsiDatePicker';
import NumberField from './NumberField';
import { formatMoney } from '../numUtils';
import { getTodayShamsi } from '../dateUtils';
import {
  COMMISSION_BASES, COMMISSION_BASIS_LABELS, COMMISSION_STATE_LABELS, PAYOUT_KINDS, PAYOUT_KIND_LABELS,
  type CommissionBasis, type CommissionState, type CommissionTerms, type PayoutKind,
} from '../utils/referralCommission';

/**
 * «معرف‌ها و پورسانت» — who brought which jobs, what each made us and what the
 * referrer is owed. Every figure is computed on the server
 * (`referrerCommissionService.ts`); this screen draws them, edits a referrer's
 * terms and records payouts and gifts.
 */

const STATE_STYLE: Record<CommissionState, string> = {
  NO_TERMS: 'bg-slate-100 text-slate-600',
  NOT_WON: 'bg-slate-100 text-slate-500',
  AWAITING_PAYMENT: 'bg-amber-50 text-amber-700',
  PAYABLE: 'bg-sky-50 text-sky-700',
  PAID: 'bg-emerald-50 text-emerald-700',
};

const termsText = (t: CommissionTerms | { basis?: string | null; rate?: number | null } | null): string => {
  const basis = (t as CommissionTerms | null)?.basis ?? null;
  const rate = (t as CommissionTerms | null)?.rate;
  if (!basis) return 'تعیین نشده';
  if (basis === 'FIXED') return `${formatMoney(rate ?? 0)} ریال برای هر پروژه`;
  return `${rate ?? 0}٪ ${basis === 'PROFIT_PERCENT' ? 'از سود' : 'از فروش'}`;
};

export default function ReferrerCommissionsView() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<ReferrerRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [termsFor, setTermsFor] = useState<ReferrerRow | null>(null);
  const [payoutsFor, setPayoutsFor] = useState<ReferredProjectRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await referrerCommissionsApi.report({ from: from || undefined, to: to || undefined });
      setRows(result.referrers);
      setTruncated(result.truncated);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خواندن گزارش معرف‌ها ممکن نشد.');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const totals = rows.reduce((acc, r) => ({
    revenue: acc.revenue + r.revenueRial, profit: acc.profit + r.grossProfitRial,
    earned: acc.earned + r.earned, given: acc.given + r.given, due: acc.due + r.due,
  }), { revenue: 0, profit: 0, earned: 0, given: 0, due: 0 });

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const sheet = rows.flatMap((r) => r.projects.map((p) => ({
      'معرف': r.name,
      'کد پروژه': p.code,
      'نام پروژه': p.name,
      'کارفرما': p.customerName,
      'وضعیت': p.status,
      'تاریخ تایید': p.winningDateJalali ?? '',
      'فروش (ریال)': p.revenueRial,
      'سود ناخالص (ریال)': p.grossProfitRial,
      'حاشیه سود ٪': p.marginPercent ?? '',
      'پوشش بهای تمام‌شده ٪': p.costCoveragePercent,
      'وصول شده ٪': p.collectedPercent,
      'شرایط پورسانت': termsText(p.terms),
      'پورسانت کل': p.earned,
      'قابل پرداخت تاکنون': p.payable,
      'پرداخت‌شده و هدیه': p.given,
      'مانده': p.due,
      'وضعیت پورسانت': COMMISSION_STATE_LABELS[p.state],
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), 'معرف‌ها');
    XLSX.writeFile(wb, `referrers-${getTodayShamsi().replace(/\//g, '-')}.xlsx`);
  };

  return (
    <div className="space-y-5" dir="rtl" data-referrer-commissions>
      <div className="flex flex-wrap items-center gap-3">
        <div className="p-2 bg-white border border-slate-200 rounded-xl text-sky-600"><HandCoins size={20} /></div>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-slate-800">معرف‌ها و پورسانت</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            پروژه‌هایی که هر معرف آورده، سود ناخالص هر کدام و پورسانت او. پورسانت به نسبت پولی که مشتری پرداخت کرده قابل پرداخت می‌شود.
          </p>
        </div>
        <button type="button" onClick={() => { void exportExcel(); }} disabled={rows.length === 0}
          className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 flex items-center gap-1.5 disabled:opacity-50">
          <FileSpreadsheet size={14} /> خروجی اکسل
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-end gap-3">
        <div className="w-44"><ShamsiDatePicker label="از تاریخ" value={from} onChange={setFrom} /></div>
        <div className="w-44"><ShamsiDatePicker label="تا تاریخ" value={to} onChange={setTo} /></div>
        {(from || to) && (
          <button type="button" onClick={() => { setFrom(''); setTo(''); }} className="text-xs text-sky-700 hover:underline pb-2">همهٔ زمان‌ها</button>
        )}
        <p className="text-[10px] text-slate-500 pb-2">
          پروژهٔ برنده با تاریخ تایید (ابلاغ قرارداد) در بازه قرار می‌گیرد و پروژهٔ در جریان با تاریخ ایجادش.
        </p>
      </div>

      {error && <div className="border border-rose-100 bg-rose-50 rounded-xl p-3 text-xs text-rose-800">{error}</div>}
      {truncated && (
        <div className="border border-amber-100 bg-amber-50 rounded-xl p-3 text-xs text-amber-800">
          تعداد پروژه‌ها بیش از سقف گزارش است؛ بازهٔ زمانی را کوتاه‌تر کنید.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {[
          ['فروش پروژه‌های معرفی‌شده', totals.revenue],
          ['سود ناخالص', totals.profit],
          ['پورسانت کل', totals.earned],
          ['پرداخت‌شده و هدیه', totals.given],
          ['مانده قابل پرداخت', totals.due],
        ].map(([label, value]) => (
          <div key={label as string} className="border border-slate-200 rounded-xl p-3 bg-white">
            <div className="text-[10px] text-slate-500">{label}</div>
            <div className="text-sm font-extrabold text-slate-800 mt-1">{formatMoney(value as number)} <span className="text-[10px] font-normal text-slate-500">ریال</span></div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-400"><Loader2 size={20} className="animate-spin inline-block" /></div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-500 bg-white rounded-xl border border-slate-200">
          هنوز پروژه‌ای با معرف انتخاب‌شده از مخاطبین ثبت نشده است. در فرم پروژه، «معرف» را از فهرست مخاطبین انتخاب کنید.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.customerId} className="bg-white border border-slate-200 rounded-xl" data-referrer={r.customerId}>
              <div className="flex flex-wrap items-center gap-3 p-3">
                <button type="button" onClick={() => toggle(r.customerId)} className="flex items-center gap-1.5 font-bold text-slate-800 text-sm" data-referrer-toggle>
                  {open.has(r.customerId) ? <ChevronDown size={16} /> : <ChevronLeft size={16} />}
                  {r.name}
                </button>
                <span className="text-[11px] text-slate-500">{r.referred.toLocaleString('fa-IR')} پروژه، {r.won.toLocaleString('fa-IR')} برنده</span>
                <span className="text-[11px] text-slate-600">شرایط: {termsText({ basis: r.commissionBasis, rate: r.commissionRate } as never)}</span>
                {r.exists && (
                  <button type="button" onClick={() => setTermsFor(r)} className="text-[11px] text-sky-700 hover:underline flex items-center gap-1" data-referrer-terms>
                    <Settings2 size={12} /> تعیین شرایط پورسانت
                  </button>
                )}
                <div className="mr-auto flex flex-wrap gap-4 text-[11px]">
                  <span>سود: <b>{formatMoney(r.grossProfitRial)}</b></span>
                  <span>پورسانت: <b>{formatMoney(r.earned)}</b></span>
                  <span>پرداخت‌شده: <b>{formatMoney(r.given)}</b></span>
                  <span className={r.due > 0 ? 'text-sky-700' : ''}>مانده: <b>{formatMoney(r.due)}</b></span>
                </div>
              </div>
              {open.has(r.customerId) && (
                <div className="overflow-x-auto border-t border-slate-100">
                  <table className="w-full text-[11px] text-right min-w-[900px]">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="p-2">پروژه</th>
                        <th className="p-2">وضعیت</th>
                        <th className="p-2">فروش</th>
                        <th className="p-2">سود ناخالص</th>
                        <th className="p-2">وصول</th>
                        <th className="p-2">پورسانت</th>
                        <th className="p-2">قابل پرداخت</th>
                        <th className="p-2">پرداخت‌شده</th>
                        <th className="p-2">مانده</th>
                        <th className="p-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.projects.map((p) => (
                        <tr key={p.projectId} className="border-t border-slate-100" data-referred-project={p.projectId}>
                          <td className="p-2">
                            <div className="font-bold text-slate-800">{p.code} — {p.name}</div>
                            <div className="text-slate-500">{p.customerName}{p.winningDateJalali ? ` · تایید ${p.winningDateJalali}` : ''}</div>
                          </td>
                          <td className="p-2">
                            <div>{p.status}</div>
                            <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded ${STATE_STYLE[p.state]}`}>{COMMISSION_STATE_LABELS[p.state]}</span>
                          </td>
                          <td className="p-2 font-mono">{formatMoney(p.revenueRial)}</td>
                          <td className="p-2">
                            <div className="font-mono">{formatMoney(p.grossProfitRial)}</div>
                            <div className="text-slate-500">
                              {p.marginPercent !== null ? `${p.marginPercent}٪ حاشیه` : ''}
                              {p.won && p.costCoveragePercent < 100 && (
                                <span className="text-amber-700" title="بخشی از ردیف‌های فروخته‌شده بهای تمام‌شده ندارند و در سود حساب نشده‌اند."> · پوشش هزینه {p.costCoveragePercent}٪</span>
                              )}
                            </div>
                          </td>
                          <td className="p-2">{p.collectedPercent}٪</td>
                          <td className="p-2">
                            <div className="font-mono">{formatMoney(p.earned)}</div>
                            <div className="text-slate-500">{termsText(p.terms)}{p.terms?.source === 'PROJECT' ? ' (این پروژه)' : ''}</div>
                          </td>
                          <td className="p-2 font-mono">{formatMoney(p.payable)}</td>
                          <td className="p-2 font-mono">{formatMoney(p.given)}</td>
                          <td className="p-2 font-mono font-bold">{formatMoney(p.due)}</td>
                          <td className="p-2">
                            <button type="button" onClick={() => setPayoutsFor(p)} className="text-sky-700 hover:underline whitespace-nowrap flex items-center gap-1" data-project-payouts>
                              <Gift size={12} /> پرداخت و هدیه
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {termsFor && (
        <TermsModal referrer={termsFor} onClose={() => setTermsFor(null)} onSaved={async () => { setTermsFor(null); await load(); }} />
      )}
      {payoutsFor && (
        <PayoutsModal project={payoutsFor} onClose={() => setPayoutsFor(null)} onChanged={load} />
      )}
    </div>
  );
}

function TermsModal({ referrer, onClose, onSaved }: { referrer: ReferrerRow; onClose: () => void; onSaved: () => void }) {
  const [basis, setBasis] = useState<string>(referrer.commissionBasis ?? '');
  const [rate, setRate] = useState<number>(referrer.commissionRate ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    try {
      await referrerCommissionsApi.setTerms(referrer.customerId, basis || null, basis ? rate : null);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ذخیره ممکن نشد.');
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" dir="rtl" data-terms-modal>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-800">شرایط پورسانت «{referrer.name}»</h3>
          <button type="button" onClick={onClose} aria-label="بستن"><X size={18} /></button>
        </div>
        <p className="text-xs text-slate-600">این شرایط برای همهٔ پروژه‌های این معرف به کار می‌رود، مگر پروژه‌ای که شرایط خودش در فرم پروژه تعیین شده باشد.</p>
        <select value={basis} onChange={(e) => setBasis(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white" data-terms-basis>
          <option value="">بدون پورسانت (تعیین نشده)</option>
          {COMMISSION_BASES.map((b) => <option key={b} value={b}>{COMMISSION_BASIS_LABELS[b as CommissionBasis]}</option>)}
        </select>
        {basis && (
          <label className="block text-sm">
            <span className="text-slate-600">{basis === 'FIXED' ? 'مبلغ برای هر پروژهٔ برنده (ریال)' : 'درصد'}</span>
            <NumberField value={rate} onChange={setRate} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </label>
        )}
        {error && <div className="text-xs text-rose-700">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-200">انصراف</button>
          <button type="button" disabled={busy} onClick={() => { void save(); }} className="px-4 py-2 text-sm rounded-lg bg-sky-600 text-white font-bold disabled:opacity-50">ذخیره</button>
        </div>
      </div>
    </div>
  );
}

function PayoutsModal({ project, onClose, onChanged }: { project: ReferredProjectRow; onClose: () => void; onChanged: () => Promise<void> }) {
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [kind, setKind] = useState<PayoutKind>('CASH');
  const [amount, setAmount] = useState<number>(project.due > 0 ? project.due : 0);
  const [date, setDate] = useState(getTodayShamsi());
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setPayouts(await referrerCommissionsApi.payouts(project.projectId)); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'خواندن پرداخت‌ها ممکن نشد.'); }
  }, [project.projectId]);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!(amount > 0)) { setError(kind === 'GIFT' ? 'ارزش هدیه را وارد کنید.' : 'مبلغ را وارد کنید.'); return; }
    setBusy(true); setError(null);
    try {
      await referrerCommissionsApi.addPayout(project.projectId, { kind, amountRial: amount, payoutDate: date, description: description || undefined });
      setDescription('');
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ثبت ممکن نشد.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('این رکورد حذف شود؟')) return;
    try { await referrerCommissionsApi.deletePayout(id); await load(); await onChanged(); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'حذف ممکن نشد.'); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" dir="rtl" data-payouts-modal>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-800">پرداخت و هدیه — {project.code}</h3>
          <button type="button" onClick={onClose} aria-label="بستن"><X size={18} /></button>
        </div>
        <div className="text-xs text-slate-600 grid grid-cols-3 gap-2">
          <div>پورسانت کل: <b>{formatMoney(project.earned)}</b></div>
          <div>قابل پرداخت: <b>{formatMoney(project.payable)}</b></div>
          <div>مانده: <b>{formatMoney(project.due)}</b></div>
        </div>
        <ul className="space-y-1.5">
          {payouts.length === 0 && <li className="text-xs text-slate-500">هنوز پرداخت یا هدیه‌ای ثبت نشده است.</li>}
          {payouts.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-xs border border-slate-200 rounded-lg px-2 py-1.5" data-payout={p.id}>
              <span className={`px-1.5 py-0.5 rounded ${p.kind === 'GIFT' ? 'bg-violet-50 text-violet-700' : 'bg-emerald-50 text-emerald-700'}`}>{PAYOUT_KIND_LABELS[p.kind as PayoutKind] ?? p.kind}</span>
              <span className="font-mono">{formatMoney(p.amountRial)} ریال</span>
              <span className="text-slate-500">{p.payoutDateJalali}</span>
              <span className="text-slate-600 truncate flex-1">{p.description}</span>
              <button type="button" onClick={() => { void remove(p.id); }} className="text-slate-400 hover:text-rose-600" aria-label="حذف"><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
        <div className="border-t border-slate-100 pt-3 space-y-2">
          <div className="flex gap-2">
            {PAYOUT_KINDS.map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${kind === k ? 'bg-sky-600 text-white border-sky-600' : 'border-slate-200 text-slate-600'}`}>
                {PAYOUT_KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <label className="block text-xs">
            <span className="text-slate-600">{kind === 'GIFT' ? 'ارزش هدیه (ریال)' : 'مبلغ (ریال)'}</span>
            <NumberField value={amount} onChange={setAmount} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </label>
          <ShamsiDatePicker label="تاریخ" value={date} onChange={setDate} />
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder={kind === 'GIFT' ? 'چه هدیه‌ای؟ (مثلاً کارت هدیه)' : 'توضیح (اختیاری)'}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          {error && <div className="text-xs text-rose-700">{error}</div>}
          <div className="flex justify-end">
            <button type="button" disabled={busy} onClick={() => { void add(); }} className="px-4 py-2 text-sm rounded-lg bg-sky-600 text-white font-bold disabled:opacity-50" data-payout-add>
              ثبت {PAYOUT_KIND_LABELS[kind]}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
