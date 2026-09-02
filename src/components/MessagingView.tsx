import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Clock, Copy, Loader2, MessageSquare, Plus, RotateCcw,
  Send, Settings as SettingsIcon, Trash2, Users, X, XCircle,
} from 'lucide-react';
import type { ERPSettings, User } from '../types';
import {
  STAFF_NOTIFICATION_KINDS, STAFF_NOTIFICATION_LABELS, STAFF_SAMPLE_VALUES,
  STAFF_VARIABLES, type StaffNotificationKind, staffTemplateFor,
} from '../utils/staffNotifications';
import { ApiError } from '../api/client';
import {
  BaleChatRow, MessageRow, MessageTemplateRow, ProviderSummary, messagingApi,
} from '../api/messaging';
import {
  ALL_CHANNELS, CHANNELS, CHANNEL_LABELS, Channel, MESSAGE_STATUS, MESSAGE_VARIABLES,
  SAMPLE_VARIABLE_VALUES, STATUS_LABELS, isChannel, renderTemplate, smsLength,
  templateVariables,
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
  /** Absent means the behaviour panel is read-only — nothing to save with. */
  onUpdateSettings?: (next: ERPSettings) => void;
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

/**
 * The non-secret fields each channel needs, and how to label them.
 *
 * `type: 'checkbox'` draws a switch rather than a box — the two TLS settings
 * are booleans and existed in the configuration from the start, but nothing
 * drew them, so the only way to reach them was a hand-written database row.
 * That is what left a company on shared hosting stuck: their mail server
 * answers on their own domain while the certificate belongs to the host's, and
 * the one switch that gets past it was unreachable.
 */
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
    {
      key: 'secure',
      label: 'اتصال امن مستقیم (SSL)',
      type: 'checkbox',
      hint: 'برای پورت ۴۶۵. اگر تیک نخورده باشد و پورت ۴۶۵ باشد، خودکار فعال می‌شود؛ پورت ۵۸۷ اتصال را بعداً ارتقا می‌دهد و به این گزینه نیاز ندارد.',
    },
    {
      key: 'allowSelfSigned',
      label: 'پذیرش گواهی نامعتبر سرور',
      type: 'checkbox',
      hint: 'وقتی نام سرور با گواهی امنیتی آن هم‌خوانی ندارد (میزبانی اشتراکی) یا گواهی خودامضاست. فقط برای سروری که به آن اطمینان دارید.',
    },
  ],
};

const SECRET_LABELS: Record<string, string> = {
  password: 'رمز عبور',
  botToken: 'توکن ربات',
};

export default function MessagingView({ settings, onUpdateSettings, currentUser = null }: Props) {
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

  /*
   * Stable identities, and this is load-bearing rather than tidiness.
   *
   * Both are handed to the tabs below, which list them among the dependencies
   * of the `useCallback` that loads their data — so a new function on every
   * render meant a new `load` on every render, and the `useEffect` watching
   * `load` fired again. One failed request then set the error banner, which
   * re-rendered this component, which rebuilt these, which reloaded, which
   * failed: the screen refetched in a loop and jumped back to the top each
   * time, which is exactly what it looked like from the outside.
   *
   * `useCallback` with no dependencies is correct here because the only things
   * they close over are state setters, whose identities React guarantees.
   */
  const report = useCallback((err: unknown, fallback: string) => {
    setError(err instanceof ApiError ? err.message : fallback);
    if (!(err instanceof ApiError)) console.error(fallback, err);
  }, []);

  const flash = useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((n) => (n === text ? null : n)), 4000);
  }, []);

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
      {tab === 'providers' && canConfigure && (
        <>
          <SendingBehaviour
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            onNotice={flash}
          />
          <StaffNotifications
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            onNotice={flash}
          />
          <Providers onError={report} onNotice={flash} />
        </>
      )}
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
  const used = templateVariables(editing?.body);

  /*
   * The message as the customer will read it.
   *
   * Rendered against the sample values, which is also what the part counter
   * measures — counting the template instead misprices every send, and always
   * downwards where it matters: «{{customerName}}» is eighteen characters and
   * «شرکت پتروشیمی نمونه» is nineteen, so the template that looked like one SMS
   * goes out as two.
   */
  const bodyPreview = renderTemplate(editing?.body, SAMPLE_VARIABLE_VALUES);
  const subjectPreview = renderTemplate(editing?.subject, SAMPLE_VARIABLE_VALUES);
  const length = smsLength(bodyPreview);

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

              {/*
                The message as the customer will read it, so the spacing, the
                honorific and the length are visible before it is saved rather
                than after it has been sent.
              */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-600">
                  پیش‌نمایش (با مقادیر نمونه)
                </label>
                <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2.5 space-y-1">
                  {channel === CHANNELS.EMAIL && (
                    <div className="text-[11px] text-emerald-900 border-b border-emerald-100 pb-1.5">
                      <span className="font-bold">موضوع: </span>
                      {subjectPreview || <span className="text-emerald-700/60">—</span>}
                    </div>
                  )}
                  <div className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap">
                    {bodyPreview || <span className="text-slate-400">هنوز متنی نوشته نشده است.</span>}
                  </div>
                </div>
              </div>

              {/*
                Drawn from the same list the server fills in, rather than typed
                out here — that is how `namePrefix` came to exist without the
                people writing templates ever being told about it.
              */}
              <div className="text-[10px] text-slate-500 bg-slate-50 border border-slate-150 rounded-lg px-2 py-2 space-y-1.5">
                <div className="font-bold">متغیرهای در دسترس (برای درج، روی هرکدام کلیک کنید):</div>
                <div className="flex flex-wrap gap-1">
                  {MESSAGE_VARIABLES.map((variable) => (
                    <button
                      key={variable.key}
                      type="button"
                      title={variable.label}
                      onClick={() => setEditing((current) => (current
                        ? { ...current, body: `${current.body ?? ''}{{${variable.key}}}` }
                        : current))}
                      className="font-mono bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-600 hover:border-sky-300 hover:text-sky-700"
                      dir="ltr"
                    >
                      {variable.key}
                    </button>
                  ))}
                </div>
                <p>
                  «پیشوند نام» برای مرد «جناب آقای مهندس» و برای زن «سرکار خانم مهندس» است و
                  برای شرکت یا مشتری بدون جنسیت خالی می‌ماند؛ در آن حالت از «addressee» استفاده
                  کنید تا فاصله‌ی اضافی در متن نیفتد.
                </p>
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

/* ---------------------------- sending behaviour --------------------------- */

/**
 * The three switches that decide *how* messages go out, as opposed to *which*
 * provider carries them.
 *
 * They were read by the server from the start and set by nothing: `dryRun`,
 * the quiet window and the retry limit lived in `settings.messaging`, which no
 * screen ever wrote. A dry-run switch nobody can find is a dry-run switch
 * nobody can use, which is exactly what happened.
 */
function SendingBehaviour({
  settings, onUpdateSettings, onNotice,
}: {
  settings: ERPSettings;
  onUpdateSettings?: (next: ERPSettings) => void;
  onNotice: (t: string) => void;
}) {
  const messaging = settings.messaging ?? {};
  const dryRun = messaging.dryRun === true;
  const quietFrom = messaging.quietHours?.from ?? '';
  const quietTo = messaging.quietHours?.to ?? '';
  const maxAttempts = Number(messaging.maxAttempts) > 0 ? Number(messaging.maxAttempts) : 4;

  const patch = (change: Partial<NonNullable<ERPSettings['messaging']>>, notice: string) => {
    if (!onUpdateSettings) return;
    onUpdateSettings({
      ...settings,
      /*
       * Spread over what is stored, not rebuilt from the three fields this
       * panel knows. Rebuilding drops every other key in `settings.messaging`
       * — `staffSms` among them — so changing the retry limit would have
       * silently switched the staff notifications back to their defaults.
       */
      messaging: {
        ...messaging,
        quietHours: { from: quietFrom || null, to: quietTo || null },
        dryRun,
        maxAttempts,
        ...change,
      },
    });
    onNotice(notice);
  };

  return (
    <div className="border border-slate-150 rounded-2xl p-4 bg-white space-y-3">
      <h3 className="font-bold text-sm text-slate-800">رفتار ارسال</h3>

      {/*
        The switch the whole panel exists for. It is described by what it does
        to a message rather than by its name: "dry run" means nothing to
        somebody deciding whether it is safe to turn a new rule on.
      */}
      <label className={`flex items-start gap-2.5 rounded-xl border p-3 cursor-pointer ${
        dryRun ? 'border-amber-200 bg-amber-50' : 'border-slate-150 bg-slate-50/60'
      }`}>
        <input
          type="checkbox"
          checked={dryRun}
          disabled={!onUpdateSettings}
          onChange={(e) => patch(
            { dryRun: e.target.checked },
            e.target.checked ? 'حالت آزمایشی روشن شد؛ هیچ پیامی واقعاً ارسال نمی‌شود.' : 'حالت آزمایشی خاموش شد؛ پیام‌ها واقعاً ارسال می‌شوند.',
          )}
          className="accent-amber-500 mt-0.5"
        />
        <span className="text-[11px] leading-6">
          <span className="font-bold text-slate-800">حالت آزمایشی (بدون ارسال واقعی)</span>
          <span className="block text-slate-500">
            پیام‌ها مثل همیشه ساخته می‌شوند و در «صندوق خروجی» با برچسب «آزمایشی» و وضعیت
            «ارسال شده» دیده می‌شوند، اما هیچ‌چیز به پنل پیامک، بله یا ایمیل فرستاده نمی‌شود و
            هزینه‌ای هم ندارد. برای امتحان کردن یک قانون خودکار تازه: روشنش کنید، کاری که قانون
            به آن حساس است را انجام دهید، متن ساخته‌شده را در صندوق خروجی ببینید و بعد خاموشش کنید.
          </span>
          {dryRun && (
            <span className="block mt-1 font-bold text-amber-800">
              الان روشن است — تا خاموش نشود هیچ پیامی به دست مشتری نمی‌رسد.
            </span>
          )}
        </span>
      </label>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-600">شروع ساعات سکوت</label>
          <input
            type="time"
            value={quietFrom}
            disabled={!onUpdateSettings}
            onChange={(e) => patch(
              { quietHours: { from: e.target.value || null, to: quietTo || null } },
              'ساعات سکوت ذخیره شد.',
            )}
            dir="ltr"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-center"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-600">پایان ساعات سکوت</label>
          <input
            type="time"
            value={quietTo}
            disabled={!onUpdateSettings}
            onChange={(e) => patch(
              { quietHours: { from: quietFrom || null, to: e.target.value || null } },
              'ساعات سکوت ذخیره شد.',
            )}
            dir="ltr"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-center"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-600">حداکثر تلاش برای ارسال</label>
          <input
            type="number"
            min={1}
            max={10}
            value={maxAttempts}
            disabled={!onUpdateSettings}
            onChange={(e) => patch(
              { maxAttempts: Math.min(10, Math.max(1, Number(e.target.value) || 1)) },
              'تعداد تلاش ذخیره شد.',
            )}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-center"
          />
        </div>
      </div>
      <p className="text-[10px] text-slate-400 leading-5">
        در ساعات سکوت پیام حذف نمی‌شود؛ تا باز شدن پنجره نگه داشته می‌شود و زمان واقعی ارسالش
        در صندوق خروجی نوشته می‌شود. بازه می‌تواند از نیمه‌شب رد شود (مثلاً ۲۲:۰۰ تا ۰۸:۰۰).
        هر دو خانه را خالی بگذارید تا ساعات سکوتی در کار نباشد.
      </p>
    </div>
  );
}

/* --------------------------- staff notifications -------------------------- */

/**
 * Texting a colleague the work that has just been handed to them.
 *
 * Two events and no more: a task assigned to somebody, and a referral raised
 * for them in a project's feed. A sales follow-up is deliberately not one —
 * it is a call that person scheduled themselves and it arrives on their board
 * on the morning it is due — and neither are the category notices, which are
 * worth knowing and are not a request to anybody.
 *
 * The wording is editable because it is what a colleague reads, and because
 * Persian SMS is UCS-2: 70 characters and then 67 per part, which is money.
 * The counter beside each box is the same `smsLength` the outbox uses.
 */
function StaffNotifications({
  settings, onUpdateSettings, onNotice,
}: {
  settings: ERPSettings;
  onUpdateSettings?: (next: ERPSettings) => void;
  onNotice: (t: string) => void;
}) {
  const messaging = settings.messaging ?? {};
  const staff = messaging.staffSms ?? {};
  // Absent is on: a live settings document never sees a default added to the
  // seed, and this was asked for. `settingsPatches` writes the key in once.
  const enabled = staff.enabled !== false;

  const patch = (next: NonNullable<ERPSettings['messaging']>['staffSms'], notice: string) => {
    if (!onUpdateSettings) return;
    onUpdateSettings({ ...settings, messaging: { ...messaging, staffSms: next } });
    onNotice(notice);
  };

  const bodyFor = (kind: StaffNotificationKind) => staffTemplateFor(kind, staff);

  return (
    <div className="border border-slate-150 rounded-2xl p-4 bg-white space-y-3">
      <h3 className="font-bold text-sm text-slate-800">پیامک ارجاع کار به همکاران</h3>

      <label className="flex items-start gap-2.5 rounded-xl border border-slate-150 bg-slate-50/60 p-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!onUpdateSettings}
          onChange={(e) => patch(
            { ...staff, enabled: e.target.checked },
            e.target.checked ? 'پیامک ارجاع کار روشن شد.' : 'پیامک ارجاع کار خاموش شد.',
          )}
          className="accent-sky-500 mt-0.5"
          id="staff-sms-enabled"
        />
        <span className="text-[11px] leading-6">
          <span className="font-bold text-slate-800">ارسال پیامک به همکار در لحظه ارجاع</span>
          <span className="block text-slate-500">
            فقط دو رویداد: وظیفه‌ای که مستقیم به یک همکار ارجاع می‌شود، و ارجاع کاری که در فید
            پروژه با نام بردن او ثبت می‌شود. <b>پیگیری فروش پیامک ندارد</b> — روز سررسیدش خودش
            به ستون «در حال انجام» می‌آید — و اعلان‌های دسته فعالیت هم پیامک ندارند.
            پیامک به شماره موبایل ثبت‌شده در «مدیریت کاربران» می‌رود؛ کاربر بدون شماره، پیامکی
            دریافت نمی‌کند. ساعات سکوت و حالت آزمایشی بالا روی این پیامک‌ها هم اعمال می‌شود.
          </span>
        </span>
      </label>

      {STAFF_NOTIFICATION_KINDS.map((kind) => {
        const body = bodyFor(kind);
        const parts = smsLength(body);
        return (
          <div key={kind} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] font-bold text-slate-600">
                متن پیامک: {STAFF_NOTIFICATION_LABELS[kind]}
              </label>
              <span className="text-[10px] font-mono text-slate-500">
                {parts.characters} کاراکتر · {parts.parts} بخش
              </span>
            </div>
            <textarea
              rows={2}
              value={body}
              disabled={!onUpdateSettings}
              id={`staff-sms-template-${kind}`}
              onChange={(e) => patch(
                { ...staff, templates: { ...staff.templates, [kind]: e.target.value } },
                'متن پیامک ذخیره شد.',
              )}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right leading-6"
            />
          </div>
        );
      })}

      {/*
        The palette and the preview render from one list, so a variable cannot
        exist in one and not the other — the same rule the customer templates
        follow, and for the same reason: a name offered here that nothing fills
        in would reach a colleague as «{dueDate}».
      */}
      <div className="flex flex-wrap gap-1.5">
        {STAFF_VARIABLES.map((v) => (
          <span
            key={v.key}
            title={v.label}
            className="text-[10px] font-mono bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5 text-slate-600"
          >
            {`{${v.key}}`}
          </span>
        ))}
      </div>
      <p className="text-[10px] text-slate-500 leading-5">
        نمونه با مقادیر آزمایشی: {renderTemplate(bodyFor('REFERRAL_RAISED'), STAFF_SAMPLE_VALUES)}
      </p>
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
  /** Bale's recent chats, once somebody has asked for them. */
  const [chats, setChats] = useState<BaleChatRow[] | null>(null);
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

  /**
   * Asks Bale who has written to the bot lately.
   *
   * The numeric chat id is the only thing Bale will send to, and it exists
   * nowhere a person can look it up: not on the customer's phone, not in this
   * database, not derivable from their number. This is the one place it can be
   * read, so the setup is «ask the customer to message the bot, then press
   * this».
   */
  const loadChats = async (row: ProviderSummary) => {
    setBusy(row.channel);
    try {
      const result = await messagingApi.providerChats(row.channel);
      if (!result.ok) {
        onError(new ApiError(result.error ?? 'خواندن گفتگوهای بله ممکن نشد.', 400), '');
        return;
      }
      setChats(result.chats);
      if (result.chats.length === 0) {
        onNotice('هیچ گفتگوی تازه‌ای پیدا نشد. از مخاطب بخواهید یک پیام به ربات بفرستد و دوباره امتحان کنید.');
      }
    } catch (err) {
      onError(err, 'خواندن گفتگوهای بله ممکن نشد.');
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
                  {field.type === 'checkbox' ? (
                    <label className="flex items-start gap-2 text-[11px] font-bold text-slate-600 cursor-pointer pt-5">
                      <input
                        type="checkbox"
                        checked={!!(draft[field.key] ?? row.config[field.key] ?? false)}
                        onChange={(e) => setField(field.key, e.target.checked)}
                        className="accent-sky-500 mt-0.5"
                      />
                      {field.label}
                    </label>
                  ) : (
                    <>
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
                    </>
                  )}
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

            {/*
              Bale addresses a person by a number, and the number is invisible
              to everyone involved until the bot has been written to. Saying so
              here — beside the credentials, where somebody is already setting
              this up — is the difference between a field people fill in and one
              they guess a phone number into.
            */}
            {row.channel === CHANNELS.BALE && (
              <div className="space-y-2 rounded-xl bg-amber-50/60 border border-amber-100 p-3">
                <p className="text-[11px] text-amber-800 leading-6">
                  بله فقط با «شناسه عددی گفتگو» پیام می‌فرستد، نه با شماره موبایل.
                  مخاطب باید یک بار به ربات شرکت پیام بدهد تا این شناسه ساخته شود؛
                  سپس آن را از فهرست زیر بردارید و در پرونده مشتری ثبت کنید.
                </p>
                <button
                  type="button"
                  disabled={busy === row.channel}
                  onClick={() => void loadChats(row)}
                  className="px-3 py-1.5 border border-amber-200 bg-white rounded-lg text-[11px] font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {busy === row.channel ? <Loader2 size={12} className="animate-spin" /> : <Users size={12} />}
                  گفتگوهای اخیر ربات
                </button>

                {chats !== null && (
                  chats.length === 0 ? (
                    <p className="text-[10px] text-amber-700">
                      گفتگویی پیدا نشد. از مخاطب بخواهید یک پیام به ربات بفرستد و دوباره امتحان کنید.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {chats.map((chat) => (
                        <li
                          key={chat.id}
                          className="flex items-center justify-between gap-2 bg-white border border-amber-100 rounded-lg px-2.5 py-1.5"
                        >
                          <span className="text-[11px] font-bold text-slate-700 truncate">{chat.name}</span>
                          <span className="flex items-center gap-1.5">
                            <code className="text-[11px] font-mono text-slate-500" dir="ltr">{chat.id}</code>
                            <button
                              type="button"
                              title="کپی شناسه"
                              onClick={() => {
                                void navigator.clipboard?.writeText(chat.id);
                                setTestTo((t) => ({ ...t, [row.channel]: chat.id }));
                                onNotice('شناسه گفتگو کپی شد.');
                              }}
                              className="p-1 rounded text-slate-400 hover:text-sky-600 hover:bg-sky-50"
                            >
                              <Copy size={12} />
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )
                )}
              </div>
            )}

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
                  placeholder={
                    row.channel === CHANNELS.EMAIL ? 'name@example.com'
                      : row.channel === CHANNELS.BALE ? 'شناسه عددی گفتگو'
                        : '09121234567'
                  }
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
