import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  BarChart3, Download, Edit3, Megaphone, Plus, Table2, Trash2, Upload, X,
} from 'lucide-react';
import type { ERPSettings } from '../types';
import { adCampaignsApi, type AdCampaignInput, type AdCampaignRow } from '../api/adCampaigns';
import { ApiError } from '../api/client';
import {
  AD_SHEET_COLUMNS, DEFAULT_AD_AUDIENCES, DEFAULT_AD_CHANNELS, adMetricsOf, adMonthOf,
  aggregateAdCampaigns, groupAdCampaigns, parseAdSheetRow, sheetNumber,
  type AdAggregate, type AdMetrics,
} from '../utils/adEffectiveness';
import { formatMoney } from '../numUtils';
import { toShamsiStr } from '../dateUtils';
import ShamsiDatePicker from './ShamsiDatePicker';

/**
 * «اثربخشی تبلیغات»: what each campaign cost and what came of it.
 *
 * Only the typed figures are entered; every rate, CPL, cost per sale, ROI and
 * ROAS is derived by `src/utils/adEffectiveness.ts`, weighted over the rows in
 * view. Running a campaign is not this screen's job — it records and reports.
 */

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(2)}%`);
const money = (v: number | null) => (v === null ? '—' : formatMoney(Math.round(v)));
const times = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)}×`);
const countText = (v: number | null) => (v === null ? '—' : formatMoney(v));

type GroupBy = 'channel' | 'audience' | 'month';
const GROUP_LABELS: Record<GroupBy, string> = {
  channel: 'به تفکیک کانال', audience: 'به تفکیک مخاطب', month: 'به تفکیک ماه',
};

interface FormState {
  code: string;
  runDate: string;
  channel: string;
  topic: string;
  audience: string;
  audienceSize: string;
  directCost: string;
  responses: string;
  leads: string;
  sales: string;
  revenue: string;
  quality: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  code: '', runDate: '', channel: '', topic: '', audience: '', audienceSize: '',
  directCost: '', responses: '', leads: '', sales: '', revenue: '', quality: '', notes: '',
};

const formOf = (c: AdCampaignRow): FormState => ({
  code: c.code,
  runDate: c.runDateJalali ?? '',
  channel: c.channel,
  topic: c.topic,
  audience: c.audience ?? '',
  audienceSize: String(c.audienceSize ?? ''),
  directCost: String(c.directCost ?? ''),
  responses: c.responses === null ? '' : String(c.responses),
  leads: c.leads === null ? '' : String(c.leads),
  sales: c.sales === null ? '' : String(c.sales),
  revenue: c.revenue === null ? '' : String(c.revenue),
  quality: c.quality === null ? '' : String(c.quality),
  notes: c.notes ?? '',
});

/** A blank box is «not recorded» — sent as null, never as zero. */
const inputOf = (f: FormState): AdCampaignInput => ({
  code: f.code.trim() || null,
  runDate: f.runDate || null,
  channel: f.channel,
  topic: f.topic,
  audience: f.audience || null,
  audienceSize: sheetNumber(f.audienceSize) ?? 0,
  directCost: sheetNumber(f.directCost) ?? 0,
  responses: sheetNumber(f.responses),
  leads: sheetNumber(f.leads),
  sales: sheetNumber(f.sales),
  revenue: sheetNumber(f.revenue),
  quality: sheetNumber(f.quality),
  notes: f.notes.trim() || null,
});

const withStored = (list: string[], stored: string) =>
  stored && !list.includes(stored) ? [...list, stored] : list;

interface Props {
  settings: ERPSettings;
}

export default function AdEffectivenessView({ settings }: Props) {
  const channels = settings.dropdownItems?.adChannels ?? DEFAULT_AD_CHANNELS;
  const audiences = settings.dropdownItems?.adAudiences ?? DEFAULT_AD_AUDIENCES;

  const [tab, setTab] = useState<'reports' | 'data'>('reports');
  const [groupBy, setGroupBy] = useState<GroupBy>('channel');
  const [filters, setFilters] = useState({ from: '', to: '', channel: '', audience: '' });
  const [rows, setRows] = useState<AdCampaignRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdCampaignRow | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adCampaignsApi.list(filters);
      setRows(result.campaigns);
      setTruncated(result.truncated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خواندن کمپین‌ها با خطا مواجه شد.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { void load(); }, [load]);

  const total: AdAggregate = useMemo(() => aggregateAdCampaigns(rows), [rows]);
  const groups = useMemo(() => groupAdCampaigns(rows, (c) =>
    groupBy === 'channel' ? c.channel : groupBy === 'audience' ? (c.audience ?? '') : adMonthOf(c.runDateJalali),
  ), [rows, groupBy]);

  const openNew = () => { setForm(EMPTY_FORM); setEditing('new'); };
  const openEdit = (c: AdCampaignRow) => { setForm(formOf(c)); setEditing(c); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing === 'new') await adCampaignsApi.create(inputOf(form));
      else if (editing) await adCampaignsApi.update(editing.id, inputOf(form));
      setEditing(null);
      setNotice('کمپین ذخیره شد.');
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'ذخیره کمپین با خطا مواجه شد.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: AdCampaignRow) => {
    if (!window.confirm(`کمپین ${c.code} «${c.topic}» حذف شود؟`)) return;
    try {
      await adCampaignsApi.remove(c.id);
      setNotice('کمپین حذف شد.');
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'حذف کمپین با خطا مواجه شد.');
    }
  };

  const importFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      // The campaigns sheet by its own name, or the first sheet that has a
      // «نوع کانال» column — never the settings sheet beside it.
      const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === 'activities')
        ?? wb.SheetNames.find((n) => {
          const head = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[n], { header: 1 })[0] ?? [];
          return head.includes(AD_SHEET_COLUMNS.channel) && head.includes(AD_SHEET_COLUMNS.topic);
        });
      if (!sheetName) { alert('در این فایل برگه‌ای با ستون‌های «نوع کانال» و «موضوع» پیدا نشد.'); return; }
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: null });
      const parsed = raw.map((r) => parseAdSheetRow(r, (d) => toShamsiStr(d))).filter(Boolean);
      if (parsed.length === 0) { alert('ردیفی برای ورود پیدا نشد.'); return; }
      const result = await adCampaignsApi.importRows(parsed as AdCampaignInput[]);
      const skipped = result.skipped.length
        ? ` — ${result.skipped.length} ردیف رد شد: ${result.skipped.slice(0, 3).map((s) => `ردیف ${s.row} (${s.reason})`).join('، ')}`
        : '';
      setNotice(`${result.created} کمپین جدید و ${result.updated} به‌روزرسانی از اکسل ثبت شد${skipped}.`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'خواندن فایل اکسل با خطا مواجه شد.');
    }
  };

  const exportFile = () => {
    const data = rows.map((c) => {
      const m = adMetricsOf(c);
      const round = (v: number | null, d = 4) => (v === null ? '' : Number(v.toFixed(d)));
      return {
        [AD_SHEET_COLUMNS.code]: c.code,
        [AD_SHEET_COLUMNS.runDate]: c.runDateJalali ?? '',
        [AD_SHEET_COLUMNS.channel]: c.channel,
        [AD_SHEET_COLUMNS.topic]: c.topic,
        [AD_SHEET_COLUMNS.audience]: c.audience ?? '',
        [AD_SHEET_COLUMNS.audienceSize]: c.audienceSize,
        [AD_SHEET_COLUMNS.directCost]: c.directCost,
        [AD_SHEET_COLUMNS.responses]: c.responses ?? '',
        [AD_SHEET_COLUMNS.leads]: c.leads ?? '',
        [AD_SHEET_COLUMNS.sales]: c.sales ?? '',
        [AD_SHEET_COLUMNS.revenue]: c.revenue ?? '',
        'نرخ تبدیل به بازخورد اولیه': round(m.responseRate),
        'نرخ تبدیل به سرنخ': round(m.leadRate),
        'نرخ تبدیل به فروش': round(m.saleRate),
        'نرخ تبدیل سرنخ به فروش': round(m.leadToSaleRate),
        'هزینه جذب هر سرنخ (CPL)': round(m.costPerLead, 0),
        'هزینه هر فروش': round(m.costPerSale, 0),
        'نرخ بازگشت سرمایه': round(m.roi),
        'ROAS': round(m.roas),
        [AD_SHEET_COLUMNS.quality]: c.quality ?? '',
        [AD_SHEET_COLUMNS.notes]: c.notes ?? '',
      };
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!views'] = [{ RTL: true }] as never;
    XLSX.utils.book_append_sheet(wb, ws, 'Activities');
    XLSX.writeFile(wb, 'اثربخشی_تبلیغات.xlsx');
  };

  const hasFilters = !!(filters.from || filters.to || filters.channel || filters.audience);

  return (
    <div className="space-y-5" dir="rtl" id="ad-effectiveness">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Megaphone size={22} className="text-sky-500" />
          <div>
            <h2 className="text-lg font-bold text-slate-800">اثربخشی تبلیغات</h2>
            <p className="text-xs text-slate-500">ثبت هزینه و نتیجه هر کمپین؛ نرخ‌ها، CPL و بازگشت سرمایه خودکار محاسبه می‌شوند.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={openNew} id="ad-new"
            className="px-3 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold flex items-center gap-1.5">
            <Plus size={14} /> کمپین جدید
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} id="ad-import"
            className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5">
            <Upload size={14} /> ورود از اکسل
          </button>
          <button type="button" onClick={exportFile} id="ad-export" disabled={rows.length === 0}
            className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 disabled:opacity-40">
            <Download size={14} /> خروجی اکسل
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={importFile} />
        </div>
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-2.5 text-xs">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)}><X size={14} /></button>
        </div>
      )}

      {/* Filters apply to both tabs: the reports are always about the rows in view. */}
      <div className="bg-white border border-slate-150 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
        <ShamsiDatePicker label="از تاریخ" value={filters.from} onChange={(v) => setFilters((f) => ({ ...f, from: v }))} compact />
        <ShamsiDatePicker label="تا تاریخ" value={filters.to} onChange={(v) => setFilters((f) => ({ ...f, to: v }))} compact />
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-slate-500">نوع کانال</label>
          <select value={filters.channel} onChange={(e) => setFilters((f) => ({ ...f, channel: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white">
            <option value="">همه کانال‌ها</option>
            {channels.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-slate-500">مخاطب</label>
          <select value={filters.audience} onChange={(e) => setFilters((f) => ({ ...f, audience: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white">
            <option value="">همه مخاطبان</option>
            {audiences.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <button type="button" disabled={!hasFilters}
          onClick={() => setFilters({ from: '', to: '', channel: '', audience: '' })}
          className="px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">
          پاک کردن فیلترها
        </button>
      </div>

      <div className="flex gap-2 border-b border-slate-150">
        {([['reports', 'گزارش‌ها', BarChart3], ['data', 'ثبت داده‌ها', Table2]] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" onClick={() => setTab(id)} id={`ad-tab-${id}`}
            className={`px-4 py-2 text-xs font-bold flex items-center gap-1.5 border-b-2 -mb-px ${
              tab === id ? 'border-sky-500 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-rose-600">{error}</p>}
      {truncated && (
        <p className="text-xs text-amber-600 font-bold">
          تعداد کمپین‌ها از حد نمایش بیشتر است؛ بازه تاریخ را کوتاه‌تر کنید تا گزارش کامل باشد.
        </p>
      )}
      {loading && <p className="text-xs text-slate-400">در حال بارگذاری…</p>}

      {!loading && tab === 'reports' && (
        rows.length === 0 ? (
          <p className="text-sm text-slate-500 bg-white border border-slate-150 rounded-2xl p-8 text-center">
            {hasFilters ? 'کمپینی با این فیلترها ثبت نشده است.' : 'هنوز کمپینی ثبت نشده است. از «کمپین جدید» یا «ورود از اکسل» شروع کنید.'}
          </p>
        ) : (
          <ReportPanel total={total} groups={groups} groupBy={groupBy} onGroupBy={setGroupBy} />
        )
      )}

      {!loading && tab === 'data' && (
        <div className="bg-white border border-slate-150 rounded-2xl overflow-x-auto">
          <table className="w-full text-xs text-right min-w-[1100px]" id="ad-campaigns-table">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                {['کد', 'تاریخ', 'کانال', 'موضوع', 'مخاطب', 'تعداد مخاطب', 'هزینه (ریال)', 'بازخورد', 'سرنخ', 'فروش', 'درآمد (ریال)',
                  'نرخ سرنخ', 'CPL', 'ROI', 'پروژه‌های مرتبط', 'کیفیت', ''].map((h) => (
                  <th key={h} className="px-3 py-2.5 font-bold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr><td colSpan={17} className="px-3 py-6 text-center text-slate-400">کمپینی ثبت نشده است.</td></tr>
              )}
              {rows.map((c) => {
                const m = adMetricsOf(c);
                return (
                  <tr key={c.id} className="hover:bg-slate-50/60" data-ad-campaign={c.code}>
                    <td className="px-3 py-2 font-mono font-bold">{c.code}</td>
                    <td className="px-3 py-2 font-mono">{c.runDateJalali ?? '—'}</td>
                    <td className="px-3 py-2">{c.channel}</td>
                    <td className="px-3 py-2 max-w-[220px] break-words">{c.topic}</td>
                    <td className="px-3 py-2 max-w-[180px] break-words">{c.audience ?? '—'}</td>
                    <td className="px-3 py-2 font-mono">{formatMoney(c.audienceSize)}</td>
                    <td className="px-3 py-2 font-mono">{formatMoney(c.directCost)}</td>
                    <td className="px-3 py-2 font-mono">{countText(c.responses)}</td>
                    <td className="px-3 py-2 font-mono">{countText(c.leads)}</td>
                    <td className="px-3 py-2 font-mono">{countText(c.sales)}</td>
                    <td className="px-3 py-2 font-mono">{money(c.revenue)}</td>
                    <td className="px-3 py-2 font-mono">{pct(m.leadRate)}</td>
                    <td className="px-3 py-2 font-mono">{money(m.costPerLead)}</td>
                    <td className={`px-3 py-2 font-mono ${m.roi !== null && m.roi < 0 ? 'text-rose-600' : ''}`}>{pct(m.roi)}</td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap" data-ad-linked={c.code}>
                      {c.linkedProjects > 0 ? `${c.linkedProjects} (برنده ${c.linkedWon})` : '—'}
                    </td>
                    <td className="px-3 py-2">{c.quality ? '★'.repeat(c.quality) : '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button type="button" onClick={() => openEdit(c)} title="ویرایش" className="p-1 text-slate-400 hover:text-sky-600"><Edit3 size={14} /></button>
                        <button type="button" onClick={() => void remove(c)} title="حذف" className="p-1 text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-[80] bg-slate-900/50 flex items-center justify-center p-4" dir="rtl">
          <form onSubmit={save} className="bg-white rounded-2xl w-full max-w-3xl shadow-xl flex flex-col max-h-[92vh]" id="ad-campaign-form">
            <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-800">
                {editing === 'new' ? 'ثبت کمپین جدید' : `ویرایش کمپین ${editing.code}`}
              </h3>
              <button type="button" onClick={() => setEditing(null)} className="p-1 text-slate-400"><X size={16} /></button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="کد کمپین" hint="خالی = خودکار">
                  <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} dir="ltr"
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono" />
                </Field>
                <ShamsiDatePicker label="تاریخ اجرا" value={form.runDate} onChange={(v) => setForm({ ...form, runDate: v })} compact />
                <Field label="نوع کانال *">
                  <select required value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white">
                    <option value="">-- انتخاب --</option>
                    {withStored(channels, form.channel).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="موضوع *" wide>
                  <input required value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" />
                </Field>
                <Field label="مخاطب">
                  <select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white">
                    <option value="">-- انتخاب --</option>
                    {withStored(audiences, form.audience).map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <NumBox label="تعداد مخاطب" value={form.audienceSize} onChange={(v) => setForm({ ...form, audienceSize: v })} />
                <NumBox label="هزینه مستقیم (ریال)" value={form.directCost} onChange={(v) => setForm({ ...form, directCost: v })} />
                <NumBox label="بازخورد اولیه" value={form.responses} onChange={(v) => setForm({ ...form, responses: v })} />
                <NumBox label="سرنخ واقعی" value={form.leads} onChange={(v) => setForm({ ...form, leads: v })} />
                <NumBox label="فروش نهایی" value={form.sales} onChange={(v) => setForm({ ...form, sales: v })} />
                <NumBox label="درآمد حاصله (ریال)" value={form.revenue} onChange={(v) => setForm({ ...form, revenue: v })} />
                <Field label="کیفیت کانال">
                  <select value={form.quality} onChange={(e) => setForm({ ...form, quality: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white">
                    <option value="">امتیاز نداده</option>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{'★'.repeat(n)} ({n})</option>)}
                  </select>
                </Field>
              </div>
              {editing !== 'new' && (
                <div className="flex flex-wrap items-center justify-between gap-2 bg-sky-50 border border-sky-100 rounded-xl px-3 py-2 text-[11px] text-sky-800" id="ad-linked-summary">
                  <span>
                    از صفحه پروژه‌ها: <b>{editing.linkedProjects}</b> پروژه به این کمپین وصل شده و <b>{editing.linkedWon}</b> تا برنده شده‌اند.
                  </span>
                  {editing.linkedProjects > 0 && (
                    <button type="button" id="ad-fill-from-projects"
                      onClick={() => setForm({ ...form, leads: String(editing.linkedProjects), sales: String(editing.linkedWon) })}
                      className="px-2.5 py-1 bg-white border border-sky-200 rounded-lg font-bold hover:bg-sky-100">
                      پر کردن سرنخ و فروش از پروژه‌ها
                    </button>
                  )}
                </div>
              )}
              <p className="text-[11px] text-slate-500 leading-5">
                خانه‌ای که هنوز نتیجه‌اش معلوم نیست را خالی بگذارید، نه صفر: کمپینی که سرنخش هنوز ثبت نشده
                در محاسبه CPL کانال وارد نمی‌شود، ولی «صفر» یعنی واقعاً هیچ سرنخی نیامده.
              </p>
              <Field label="توضیحات کیفی / درس آموخته" wide>
                <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" />
              </Field>
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-xs text-slate-600">انصراف</button>
              <button type="submit" disabled={saving}
                className="px-5 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold disabled:opacity-50">
                {saving ? 'در حال ذخیره…' : 'ذخیره کمپین'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`space-y-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <label className="block text-xs font-semibold text-slate-500">
        {label} {hint && <span className="text-[10px] text-slate-400 font-normal">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

function NumBox({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} dir="ltr"
        placeholder="—" className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono text-left" />
    </Field>
  );
}

function ReportPanel({ total, groups, groupBy, onGroupBy }: {
  total: AdAggregate;
  groups: (AdAggregate & { key: string })[];
  groupBy: GroupBy;
  onGroupBy: (g: GroupBy) => void;
}) {
  const m = total.metrics;
  const tiles: [string, string][] = [
    ['تعداد کمپین', formatMoney(total.campaigns)],
    ['هزینه کل (ریال)', formatMoney(total.directCost)],
    ['درآمد کل (ریال)', formatMoney(total.revenue)],
    ['هزینه هر سرنخ (CPL)', money(m.costPerLead)],
    ['هزینه هر فروش', money(m.costPerSale)],
    ['بازگشت سرمایه (ROI)', pct(m.roi)],
    ['ROAS', times(m.roas)],
    ['نرخ تبدیل سرنخ به فروش', pct(m.leadToSaleRate)],
    ['پروژه‌های مرتبط (برنده)', `${formatMoney(total.linkedProjects)} (${formatMoney(total.linkedWon)})`],
  ];
  const funnel: [string, number][] = [
    ['مخاطب', total.audienceSize],
    ['بازخورد اولیه', total.responses],
    ['سرنخ واقعی', total.leads],
    ['فروش نهایی', total.sales],
  ];
  const top = Math.max(1, funnel[0][1]);
  const maxCost = Math.max(1, ...groups.map((g) => g.directCost));

  return (
    <div className="space-y-5" id="ad-reports">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map(([label, value]) => (
          <div key={label} className="bg-white border border-slate-150 rounded-2xl p-4">
            <div className="text-[11px] text-slate-500">{label}</div>
            <div className="text-base font-bold text-slate-800 font-mono mt-1" dir="ltr">{value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-150 rounded-2xl p-4 space-y-2">
        <h3 className="text-sm font-bold text-slate-700">قیف تبدیل</h3>
        {funnel.map(([label, value], i) => (
          <div key={label} className="flex items-center gap-3 text-xs">
            <span className="w-24 shrink-0 text-slate-600">{label}</span>
            <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
              <div className="h-full bg-sky-500/80 rounded-full" style={{ width: `${Math.max(1, (value / top) * 100)}%` }} />
            </div>
            <span className="w-32 shrink-0 font-mono text-left" dir="ltr">
              {formatMoney(value)}{i > 0 && funnel[i - 1][1] > 0 ? ` (${((value / funnel[i - 1][1]) * 100).toFixed(1)}%)` : ''}
            </span>
          </div>
        ))}
        <p className="text-[10px] text-slate-400">درصد هر پله نسبت به پلهٔ قبل است.</p>
      </div>

      <div className="bg-white border border-slate-150 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-700">مقایسه</h3>
          <div className="flex gap-1">
            {(Object.keys(GROUP_LABELS) as GroupBy[]).map((g) => (
              <button key={g} type="button" onClick={() => onGroupBy(g)} data-ad-group={g}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border ${
                  groupBy === g ? 'bg-sky-500 text-white border-sky-500' : 'bg-white text-slate-600 border-slate-200'
                }`}>{GROUP_LABELS[g]}</button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right min-w-[980px]" id="ad-group-table">
            <thead className="text-slate-500 bg-slate-50">
              <tr>
                {['', 'کمپین', 'هزینه (ریال)', 'مخاطب', 'بازخورد', 'سرنخ', 'فروش', 'درآمد',
                  'نرخ بازخورد', 'نرخ سرنخ', 'سرنخ به فروش', 'CPL', 'هزینه هر فروش', 'ROI', 'ROAS', 'پروژه (برنده)'].map((h, i) => (
                  <th key={`${h}-${i}`} className="px-2 py-2 font-bold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groups.map((g) => (
                <GroupRow key={g.key} g={g} maxCost={maxCost} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-slate-400 leading-5">
          نرخ‌ها وزنی‌اند (جمع صورت ÷ جمع مخرج)، نه میانگین نرخ کمپین‌ها؛ و هر نرخ فقط روی کمپین‌هایی
          حساب می‌شود که هر دو عددش ثبت شده. «—» یعنی هنوز داده‌ای برای آن ثبت نشده.
        </p>
      </div>
    </div>
  );
}

function GroupRow({ g, maxCost }: { g: AdAggregate & { key: string }; maxCost: number }) {
  const m: AdMetrics = g.metrics;
  return (
    <tr data-ad-group-row={g.key}>
      <td className="px-2 py-2 min-w-[160px]">
        <div className="font-bold text-slate-700 break-words">{g.key}</div>
        <div className="h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
          <div className="h-full bg-amber-400 rounded-full" style={{ width: `${(g.directCost / maxCost) * 100}%` }} />
        </div>
      </td>
      <td className="px-2 py-2 font-mono">{g.campaigns}</td>
      <td className="px-2 py-2 font-mono">{formatMoney(g.directCost)}</td>
      <td className="px-2 py-2 font-mono">{formatMoney(g.audienceSize)}</td>
      <td className="px-2 py-2 font-mono">{formatMoney(g.responses)}</td>
      <td className="px-2 py-2 font-mono">{formatMoney(g.leads)}</td>
      <td className="px-2 py-2 font-mono">{formatMoney(g.sales)}</td>
      <td className="px-2 py-2 font-mono">{formatMoney(g.revenue)}</td>
      <td className="px-2 py-2 font-mono">{pct(m.responseRate)}</td>
      <td className="px-2 py-2 font-mono">{pct(m.leadRate)}</td>
      <td className="px-2 py-2 font-mono">{pct(m.leadToSaleRate)}</td>
      <td className="px-2 py-2 font-mono">{money(m.costPerLead)}</td>
      <td className="px-2 py-2 font-mono">{money(m.costPerSale)}</td>
      <td className={`px-2 py-2 font-mono ${m.roi !== null && m.roi < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{pct(m.roi)}</td>
      <td className="px-2 py-2 font-mono">{times(m.roas)}</td>
      <td className="px-2 py-2 font-mono whitespace-nowrap">{g.linkedProjects > 0 ? `${g.linkedProjects} (${g.linkedWon})` : '—'}</td>
    </tr>
  );
}
