import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Clock, Loader2, MessageSquare, Plus, RotateCcw,
  Send, Settings as SettingsIcon, Trash2, X, XCircle,
} from 'lucide-react';
import type { ERPSettings, User } from '../types';
import { ApiError } from '../api/client';
import {
  MessageRow, MessageTemplateRow, ProviderSummary, messagingApi,
} from '../api/messaging';
import {
  ALL_CHANNELS, CHANNELS, CHANNEL_LABELS, Channel, MESSAGE_STATUS, STATUS_LABELS,
  isChannel, smsLength, templateVariables,
} from '../utils/messaging';


/**
 * The messaging module: an outbox, the templates that fill it, and the
 * credentials that let it leave the building.
 *
 * There is no automation tab. Automated sending is a third kind of *action* on
 * the workflow engine that already exists — the rule editor in the settings
 * screen is where «when a purchase order reaches customs clearance, tell the
 * customer» is written, alongside every other rule, rather than in a second
 * place with a second set of triggers to keep in step.
 */

interface Props {
  settings: ERPSettings;
  currentUser?: User | null;
}

type Tab = 'outbox' | 'templates' | 'providers';

const STATUS_STYLE: Record<string, string> = {
  QUEUED: 'bg-sky-50 text-sky-700 border-sky-200',
  SENT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  FAILED: 'bg-rose-50 text-rose-700 border-rose-200',
  CANCELLED: 'bg-slate-100 text-slate-500 border-slate-200',
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  QUEUED: <Clock size={11} />,
  SENT: <CheckCircle2 size={11} />,
  FAILED: <XCircle size={11} />,
  CANCELLED: <X size={11} />,
};

/** The non-secret fields each channel needs, and how to label them. */
const PROVIDER_FIELDS: Record<Channel, { key: string; label: string; type?: string; hint?: string }[]> = {
  SMS: [
    { key: 'username', label: 'نام کاربری پنل' },
    { key: 'senderNumber', label: 'شماره فرستنده' },
    { key: 'apiUrl', label: 'آدرس سرویس (اختیاری)', hint: 'خالی بگذارید تا از ملی پیامک استفاده شود.' },
  ],
  BALE: [],
  EMAIL: [
    { key: 'host', label: 'آدرس سرور SMTP' },
    { key: 'port', label: 'پورت', type: 'number' },
    { key: 'user', label: 'نام کاربری' },
    { key: 'fromAddress', label: 'ایمیل فرستنده' },
    { key: 'fromName', label: 'نام فرستنده' },
  ],
};

const SECRET_LABELS: Record<string, string> = {
  password: 'رمز عبور',
  botToken: 'توکن ربات',
};

export default function MessagingView({ settings, currentUser = null }: Props) {
  const [tab, setTab] = useState<Tab>('outbox');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Provider credentials are administration, not day-to-day messaging work.
   *
   * The server gates them on `settings` regardless; this only decides whether
   * the tab is drawn, so nobody is offered a screen they cannot save.
   */
  const canConfigure = !!currentUser?.isSystemAdmin
    || currentUser?.permissions?.settings === true;

  const report = (err: unknown, fallback: string) => {
    setError(err instanceof ApiError ? err.message : fallback);
    if (!(err instanceof ApiError)) console.error(fallback, err);
  };

  const flash = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((n) => (n === text ? null : n)), 4000);
  };

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex items-center gap-2.5">
        <div className="p-2 bg-white border border-slate-200 rounded-xl text-sky-600">
          <MessageSquare size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-800">ارسال پیام</h2>
          <p className="text-[11px] text-slate-400 mt-0.5">
            پیامک، بله و ایمیل — به‌صورت دستی یا از طریق قواعد خودکار
          </p>
        </div>
      </div>

      {error && (
        <div className="border border-rose-100 bg-rose-50 rounded-xl p-3 text-[11px] text-rose-800 flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)}><X size={13} /></button>
        </div>
      )}
      {notice && (
        <div className="border border-emerald-100 bg-emerald-50 rounded-xl p-3 text-[11px] text-emerald-800">
          {notice}
        </div>
      )}

      <div className="flex border-b border-slate-200">
        {([
          ['outbox', 'صف و سوابق ارسال'],
          ['templates', 'قالب‌های پیام'],
          ...(canConfigure ? [['providers', 'تنظیمات درگاه‌ها'] as [Tab, string]] : []),
        ] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => { setTab(id); setError(null); }}
            className={`px-5 py-2.5 text-xs font-bold transition-colors ${
              tab === id
                ? 'text-sky-600 border-b-2 border-sky-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'outbox' && <Outbox onError={report} onNotice={flash} />}
      {tab === 'templates' && <Templates settings={settings} onError={report} onNotice={flash} />}
      {tab === 'providers' && canConfigure && <Providers onError={report} onNotice={flash} />}
    </div>
  );
}

/* --------------------------------- outbox --------------------------------- */

function Outbox({
  onError, onNotice,
}: { onError: (e: unknown, f: string) => void; onNotice: (t: string) => void }) {
  const [rows, setRows] = useState<MessageRow[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [status, setStatus] = useState('all');
  const [channel, setChannel] = useState('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [page, counts] = await Promise.all([
        messagingApi.list({ status, channel, pageSize: 50, sort: 'createdAt', order: 'desc' }),
        messagingApi.summary(),
      ]);
      setRows(page.rows);
      setSummary(counts);
    } catch (err) {
      onError(err, 'خواندن صف پیام‌ها با خطا مواجه شد.');
    } finally {
      setLoading(false);
    }
  }, [status, channel, onError]);

  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      onNotice(done);
      await load();
    } catch (err) {
      onError(err, 'انجام این عملیات ممکن نشد.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {(Object.keys(STATUS_LABELS) as (keyof typeof STATUS_LABELS)[]).map((key) => (
          <div key={key} className="border border-slate-150 rounded-xl p-3 bg-white">
            <div className="text-[10px] text-slate-500">{STATUS_LABELS[key]}</div>
            <div className="text-lg font-extrabold text-slate-800">
              {(summary[key] ?? 0).toLocaleString('fa-IR')}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white"
        >
          <option value="all">همه وضعیت‌ها</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white"
        >
          <option value="all">همه روش‌ها</option>
          {ALL_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
        </select>

        {/*
          The worker runs every minute on its own. This is for when somebody is
          standing there having just queued something and would rather not wait.
        */}
        <button
          type="button"
          onClick={() => act(() => messagingApi.runQueue(), 'صف ارسال اجرا شد.')}
          className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"
        >
          <Send size={13} />
          اجرای صف
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-400">
          <Loader2 size={20} className="animate-spin inline-block" />
        </div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-400 bg-slate-50/60 rounded-2xl border border-slate-150">
          هنوز پیامی ثبت نشده است.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="border border-slate-150 rounded-xl p-3 bg-white space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className={`px-2 py-0.5 rounded-full border font-bold flex items-center gap-1 ${
                  STATUS_STYLE[row.status] ?? STATUS_STYLE.CANCELLED
                }`}>
                  {STATUS_ICON[row.status]}
                  {STATUS_LABELS[row.status as keyof typeof STATUS_LABELS] ?? row.status}
                </span>
                <span className="text-slate-500">
                  {CHANNEL_LABELS[row.channel as Channel] ?? row.channel}
                </span>
                <span className="font-mono text-slate-700" dir="ltr">{row.recipient}</span>
                {row.recipientName && <span className="text-slate-400">({row.recipientName})</span>}
                {/* A dry run wrote the row and never called the provider. */}
                {row.dryRun && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100 font-bold">
                    آزمایشی
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{row.body}</p>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400">
                {row.customer && <span>{row.customer.companyName}</span>}
                {row.project && <span>پروژه {row.project.code}</span>}
                <span className="font-mono" dir="ltr">
                  {row.sentAtJalali || row.scheduledAtJalali || ''}
                </span>
                {row.workflowRuleName
                  ? <span>قاعده: {row.workflowRuleName}</span>
                  : row.createdByName && <span>{row.createdByName}</span>}
                {row.attempts > 0 && <span>{row.attempts.toLocaleString('fa-IR')} تلاش</span>}
              </div>

              {row.lastError && (
                <p className="text-[10px] text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-2 py-1">
                  {row.lastError}
                </p>
              )}

              <div className="flex gap-2">
                {row.status === MESSAGE_STATUS.QUEUED && (
                  <button
                    type="button"
                    onClick={() => act(() => messagingApi.cancel(row.id), 'پیام لغو شد.')}
                    className="px-2.5 py-1 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-600 hover:bg-slate-50"
                  >
                    لغو ارسال
                  </button>
                )}
                {row.status === MESSAGE_STATUS.FAILED && (
                  <button
                    type="button"
                    onClick={() => act(() => messagingApi.retry(row.id), 'پیام دوباره در صف قرار گرفت.')}
                    className="px-2.5 py-1 border border-sky-200 rounded-lg text-[10px] font-bold text-sky-700 hover:bg-sky-50 flex items-center gap-1"
                  >
                    <RotateCcw size={11} />
                    ارسال مجدد
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------- templates ------------------------------- */

function Templates({
  settings, onError, onNotice,
}: {
  settings: ERPSettings;
  onError: (e: unknown, f: string) => void;
  onNotice: (t: string) => void;
}) {
  const [rows, setRows] = useState<MessageTemplateRow[]>([]);
  const [editing, setEditing] = useState<Partial<MessageTemplateRow> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await messagingApi.templates());
    } catch (err) {
      onError(err, 'خواندن قالب‌ها با خطا مواجه شد.');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    if (!String(editing.body ?? '').trim()) {
      onError(new ApiError('متن قالب خالی است.', 400), '');
      return;
    }
    try {
      if (editing.id) await messagingApi.updateTemplate(editing.id, editing);
      else await messagingApi.createTemplate(editing);
      setEditing(null);
      onNotice('قالب ذخیره شد.');
      await load();
    } catch (err) {
      onError(err, 'ذخیره قالب با خطا مواجه شد.');
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('این قالب حذف شود؟')) return;
    try {
      await messagingApi.deleteTemplate(id);
      onNotice('قالب حذف شد.');
      await load();
    } catch (err) {
      onError(err, 'حذف قالب ممکن نشد.');
    }
  };

  const channel = isChannel(editing?.channel) ? editing.channel : CHANNELS.SMS;
  const length = smsLength(editing?.body);
  const used = templateVariables(editing?.body);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setEditing({ channel: CHANNELS.SMS, body: '', active: true })}
        className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
      >
        <Plus size={14} />
        قالب جدید
      </button>

      {loading ? (
        <div className="py-12 text-center text-slate-400">
          <Loader2 size={20} className="animate-spin inline-block" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((row) => (
            <div key={row.id} className="border border-slate-150 rounded-xl p-3 bg-white space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs text-slate-800">{row.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                    {CHANNEL_LABELS[row.channel as Channel] ?? row.channel}
                  </span>
                  {!row.active && (
                    <span className="text-[10px] text-slate-400">غیرفعال</span>
                  )}
                </div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => setEditing(row)} className="p-1 text-slate-500 hover:text-sky-600">
                    <SettingsIcon size={13} />
                  </button>
                  <button type="button" onClick={() => remove(row.id)} className="p-1 text-slate-400 hover:text-rose-600">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed whitespace-pre-wrap line-clamp-3">
                {row.body}
              </p>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4" dir="rtl">
          <div className="bg-white rounded-2xl w-full max-w-xl shadow-xl border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <h3 className="font-bold text-slate-800 text-sm">
                {editing.id ? 'ویرایش قالب پیام' : 'قالب پیام جدید'}
              </h3>
              <button type="button" onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600">
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-right">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600">نام قالب</label>
                  <input
                    type="text"
                    value={editing.name ?? ''}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600">روش ارسال</label>
                  <select
                    value={channel}
                    onChange={(e) => setEditing({ ...editing, channel: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-white"
                  >
                    {ALL_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
                  </select>
                </div>
              </div>

              {channel === CHANNELS.EMAIL && (
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600">موضوع ایمیل</label>
                  <input
                    type="text"
                    value={editing.subject ?? ''}
                    onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-600">متن پیام</label>
                <textarea
                  rows={6}
                  value={editing.body ?? ''}
                  onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                  placeholder="مثال: {{customerName}} عزیز، سفارش پروژه {{projectCode}} وارد مرحله ترخیص گمرک شد."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs leading-relaxed"
                />
              </div>

              {/*
                The part counter is money, not decoration: Persian goes as UCS-2,
                so 70 characters fit in one part and 67 in each after that. Three
                characters over the line doubles the bill on every single send.
              */}
              {channel === CHANNELS.SMS && (
                <div className={`text-[10px] font-mono rounded-lg px-2 py-1.5 ${
                  length.parts > 1
                    ? 'bg-amber-50 text-amber-800 border border-amber-100'
                    : 'bg-slate-50 text-slate-500 border border-slate-150'
                }`}>
                  {length.characters.toLocaleString('fa-IR')} کاراکتر ·{' '}
                  {length.parts.toLocaleString('fa-IR')} پیامک ·{' '}
                  {length.charactersLeft.toLocaleString('fa-IR')} کاراکتر تا بخش بعد
                  {length.parts > 1 && ' — هزینه‌ی ارسال چند برابر می‌شود.'}
                </div>
              )}

              <div className="text-[10px] text-slate-500 bg-slate-50 border border-slate-150 rounded-lg px-2 py-1.5 space-y-1">
                <div className="font-bold">متغیرهای در دسترس:</div>
                <div className="font-mono text-slate-600" dir="ltr">
                  customerName · contactName · projectCode · projectName · projectStatus · companyName · today
                </div>
                {used.length > 0 && (
                  <div>
                    این قالب استفاده می‌کند از:{' '}
                    <span className="font-mono text-sky-700" dir="ltr">{used.join(' · ')}</span>
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editing.active ?? true}
                  onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                  className="accent-sky-500"
                />
                فعال
              </label>
              {/* Settings are read for the module list only; nothing here needs them. */}
              <input type="hidden" value={settings?.customFields?.length ?? 0} readOnly />
            </div>

            <div className="px-5 py-3.5 border-t border-slate-100 flex justify-end gap-2 bg-slate-50">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={save}
                className="px-5 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold"
              >
                ذخیره
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- providers ------------------------------- */

function Providers({
  onError, onNotice,
}: { onError: (e: unknown, f: string) => void; onNotice: (t: string) => void }) {
  const [rows, setRows] = useState<ProviderSummary[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>({});
  const [testTo, setTestTo] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await messagingApi.providers());
    } catch (err) {
      onError(err, 'خواندن تنظیمات درگاه‌ها با خطا مواجه شد.');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => { void load(); }, [load]);

  const save = async (row: ProviderSummary, active: boolean) => {
    setBusy(row.channel);
    try {
      setRows(await messagingApi.saveProvider(row.channel, {
        active,
        config: drafts[row.channel] ?? {},
      }));
      setDrafts((d) => ({ ...d, [row.channel]: {} }));
      onNotice('تنظیمات ذخیره شد.');
    } catch (err) {
      onError(err, 'ذخیره تنظیمات ممکن نشد.');
    } finally {
      setBusy(null);
    }
  };

  const test = async (row: ProviderSummary) => {
    const to = (testTo[row.channel] ?? '').trim();
    if (!to) {
      onError(new ApiError('گیرنده پیام آزمایشی را وارد کنید.', 400), '');
      return;
    }
    setBusy(row.channel);
    try {
      const result = await messagingApi.testProvider(row.channel, to);
      if (result.ok) onNotice('پیام آزمایشی ارسال شد.');
      else onError(new ApiError(result.error ?? 'ارسال آزمایشی ناموفق بود.', 400), '');
      await load();
    } catch (err) {
      onError(err, 'ارسال آزمایشی ممکن نشد.');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-slate-400">
        <Loader2 size={20} className="animate-spin inline-block" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const draft = drafts[row.channel] ?? {};
        const setField = (key: string, value: unknown) =>
          setDrafts((d) => ({ ...d, [row.channel]: { ...(d[row.channel] ?? {}), [key]: value } }));

        return (
          <div key={row.channel} className="border border-slate-150 rounded-2xl p-4 bg-white space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-slate-800">{CHANNEL_LABELS[row.channel]}</h3>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${
                  row.active
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-100 text-slate-500 border-slate-200'
                }`}>
                  {row.active ? 'فعال' : 'غیرفعال'}
                </span>
              </div>
              <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={row.active}
                  onChange={(e) => void save(row, e.target.checked)}
                  className="accent-emerald-500"
                />
                فعال باشد
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {PROVIDER_FIELDS[row.channel].map((field) => (
                <div key={field.key} className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600">{field.label}</label>
                  <input
                    type={field.type ?? 'text'}
                    value={String(draft[field.key] ?? row.config[field.key] ?? '')}
                    onChange={(e) => setField(
                      field.key,
                      field.type === 'number' ? Number(e.target.value) || null : e.target.value,
                    )}
                    dir="ltr"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-left"
                  />
                  {field.hint && <p className="text-[10px] text-slate-400">{field.hint}</p>}
                </div>
              ))}

              {/*
                A secret is never sent back from the server, so the box starts
                empty and an empty box means "leave it as it is" — the same rule
                a password field follows, for the same reason.
              */}
              {Object.entries(row.secrets).map(([key, hint]) => (
                <div key={key} className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600">
                    {SECRET_LABELS[key] ?? key}
                  </label>
                  <input
                    type="password"
                    value={String(draft[key] ?? '')}
                    onChange={(e) => setField(key, e.target.value)}
                    placeholder={hint ? `ثبت شده: ${hint}` : 'ثبت نشده'}
                    dir="ltr"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-left"
                  />
                  <p className="text-[10px] text-slate-400">
                    خالی بگذارید تا مقدار فعلی حفظ شود.
                  </p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={busy === row.channel}
                onClick={() => void save(row, row.active)}
                className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold disabled:opacity-50"
              >
                ذخیره تنظیمات
              </button>

              <div className="flex-1 min-w-[180px] space-y-1">
                <label className="text-[10px] font-bold text-slate-500">گیرنده پیام آزمایشی</label>
                <input
                  type="text"
                  value={testTo[row.channel] ?? ''}
                  onChange={(e) => setTestTo((t) => ({ ...t, [row.channel]: e.target.value }))}
                  placeholder={row.channel === CHANNELS.EMAIL ? 'name@example.com' : '09121234567'}
                  dir="ltr"
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono text-left"
                />
              </div>
              <button
                type="button"
                disabled={busy === row.channel}
                onClick={() => void test(row)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5"
              >
                <Send size={13} />
                ارسال آزمایشی
              </button>
            </div>

            {row.lastTestAt && (
              <p className={`text-[10px] rounded-lg px-2 py-1.5 ${
                row.lastTestOk
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                  : 'bg-rose-50 text-rose-700 border border-rose-100'
              }`}>
                {row.lastTestOk
                  ? 'آخرین ارسال آزمایشی موفق بود.'
                  : `آخرین ارسال آزمایشی ناموفق: ${row.lastTestError ?? ''}`}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
