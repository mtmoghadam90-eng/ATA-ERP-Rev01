import { useCallback, useEffect, useState } from 'react';
import { CheckCheck, Inbox, Link2, Loader2, RefreshCw } from 'lucide-react';
import { messagingApi, type InboxPoll, type InboxRow } from '../api/messaging';
import { useEntitySearch } from '../api/useEntitySearch';
import { SearchableSelect } from './SearchableSelect';
import { formatDateTimeToShamsi } from '../dateUtils';
import { INBOUND_KIND_LABELS, type InboundKind } from '../utils/inbound';

/**
 * «صندوق دریافتی» — what customers wrote to the Bale bot (the بازو Safir sends
 * through). The server reads the bot once a minute; «بررسی پیام‌های جدید»
 * reads it now. A sender the server could not match to a customer is linked
 * here once, and every message from that chat is then filed under them.
 */
export default function MessagingInbox({
  onError, onNotice,
}: { onError: (e: unknown, f: string) => void; onNotice: (t: string) => void }) {
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [poll, setPoll] = useState<InboxPoll | null>(null);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState<InboxRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await messagingApi.inbox({ pageSize: 100, unread: onlyUnread ? 'true' : undefined });
      setRows(page.rows);
      setUnread(page.unread);
      setPoll(page.poll);
    } catch (err) {
      onError(err, 'خواندن صندوق دریافتی با خطا مواجه شد.');
    } finally {
      setLoading(false);
    }
  }, [onlyUnread, onError]);

  useEffect(() => { void load(); }, [load]);

  const checkNow = async () => {
    setBusy(true);
    try {
      const report = await messagingApi.pollInbox();
      setPoll(report);
      if (!report.configured) onNotice('توکن ربات بله ثبت نشده است؛ پیامی خوانده نشد.');
      else if (report.ok) onNotice(report.received ? `${report.received.toLocaleString('fa-IR')} پیام جدید دریافت شد.` : 'پیام جدیدی نیست.');
      await load();
    } catch (err) {
      onError(err, 'بررسی پیام‌های جدید ممکن نشد.');
    } finally {
      setBusy(false);
    }
  };

  const markRead = async (row: InboxRow) => {
    try {
      await messagingApi.readInbox(row.id);
      await load();
    } catch (err) {
      onError(err, 'علامت‌گذاری پیام ممکن نشد.');
    }
  };

  const readAll = async () => {
    try {
      await messagingApi.readAllInbox();
      await load();
    } catch (err) {
      onError(err, 'علامت‌گذاری پیام‌ها ممکن نشد.');
    }
  };

  return (
    <div className="space-y-4" data-messaging-inbox>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { void checkNow(); }}
          disabled={busy}
          className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          بررسی پیام‌های جدید
        </button>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} />
          فقط خوانده‌نشده‌ها
        </label>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => { void readAll(); }}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"
          >
            <CheckCheck size={13} /> خواندن همه ({unread.toLocaleString('fa-IR')})
          </button>
        )}
        {poll && (
          <span className={`text-[11px] mr-auto ${poll.ok ? 'text-slate-400' : 'text-rose-700'}`} data-inbox-poll>
            {!poll.configured
              ? 'توکن ربات بله ثبت نشده است؛ پیام‌ها خوانده نمی‌شوند.'
              : poll.ok
                ? `آخرین بررسی: ${formatDateTimeToShamsi(poll.at)}`
                : `خواندن پیام‌ها ناموفق بود: ${poll.error ?? ''}`}
          </span>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-400"><Loader2 size={20} className="animate-spin inline-block" /></div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-400 bg-slate-50/60 rounded-2xl border border-slate-150 flex flex-col items-center gap-2">
          <Inbox size={22} />
          {onlyUnread ? 'پیام خوانده‌نشده‌ای نیست.' : 'هنوز پیامی از مشتری‌ها در بله دریافت نشده است.'}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className={`border rounded-xl p-3 space-y-2 ${row.readAt ? 'border-slate-150 bg-white' : 'border-sky-200 bg-sky-50/40'}`}
              data-inbox-row={row.id}
            >
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                {!row.readAt && <span className="px-2 py-0.5 rounded-full bg-sky-600 text-white font-bold">جدید</span>}
                <span className="font-bold text-slate-800">
                  {row.customerName || row.senderName || row.senderUsername || 'ناشناس'}
                </span>
                {row.customerName && (row.senderName || row.senderUsername) && (
                  <span className="text-slate-400">({row.senderName || `@${row.senderUsername}`})</span>
                )}
                {!row.customerId && <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">مشتری نامشخص</span>}
                {row.phone && <span className="font-mono text-slate-600" dir="ltr">{row.phone}</span>}
                <span className="text-slate-400 mr-auto">{formatDateTimeToShamsi(row.receivedAt)}</span>
              </div>
              <div className="text-sm text-slate-700 whitespace-pre-line" dir="auto">
                {row.text || (row.kind === 'DOCUMENT' && row.fileName ? `[فایل: ${row.fileName}]` : `[${INBOUND_KIND_LABELS[row.kind as InboundKind] ?? row.kind}]`)}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!row.readAt && (
                  <button type="button" onClick={() => { void markRead(row); }} className="text-[11px] text-sky-700 hover:underline">
                    علامت خوانده شده
                  </button>
                )}
                <button type="button" onClick={() => setLinking(row)} className="text-[11px] text-slate-600 hover:underline flex items-center gap-1" data-inbox-link>
                  <Link2 size={12} /> {row.customerId ? 'تغییر مشتری' : 'اتصال به مشتری'}
                </button>
                {row.readAt && row.readByName && <span className="text-[10px] text-slate-400">خوانده شده توسط {row.readByName}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {linking && (
        <LinkCustomerModal
          row={linking}
          onClose={() => setLinking(null)}
          onLinked={async (count) => {
            setLinking(null);
            onNotice(`${count.toLocaleString('fa-IR')} پیام از این گفتگو به مشتری متصل شد.`);
            await load();
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

function LinkCustomerModal({
  row, onClose, onLinked, onError,
}: {
  row: InboxRow;
  onClose: () => void;
  onLinked: (count: number) => void;
  onError: (e: unknown, f: string) => void;
}) {
  const [customerId, setCustomerId] = useState(row.customerId ?? '');
  const [busy, setBusy] = useState(false);
  const picker = useEntitySearch<{ id: string; companyName: string | null; firstName: string | null; lastName: string | null; mobile: string | null }>({
    path: '/api/customers',
    limit: 25,
    selectedId: customerId || null,
    getLabel: (c) => c.companyName || `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim(),
  });
  const label = (c: { companyName: string | null; firstName: string | null; lastName: string | null; mobile: string | null }) =>
    [c.companyName || `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim(), c.mobile].filter(Boolean).join(' — ');

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
        <h3 className="font-bold text-slate-800">اتصال گفتگو به مشتری</h3>
        <p className="text-xs text-slate-600 leading-relaxed">
          همهٔ پیام‌های «{row.senderName || row.senderUsername || 'این گفتگو'}» زیر مشتری انتخاب‌شده ثبت می‌شود و
          پیام‌های بعدی هم خودکار به همین مشتری وصل می‌شوند.
        </p>
        <SearchableSelect
          value={customerId}
          onChange={setCustomerId}
          onSearchChange={picker.setTerm}
          loading={picker.loading}
          options={picker.matches.map((c) => ({ value: c.id, label: label(c) }))}
          placeholder="جستجوی مشتری..."
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-200">انصراف</button>
          <button
            type="button"
            disabled={!customerId || busy}
            onClick={async () => {
              setBusy(true);
              try {
                onLinked(await messagingApi.linkInbox(row.chatId, customerId));
              } catch (err) {
                onError(err, 'اتصال به مشتری ممکن نشد.');
                setBusy(false);
              }
            }}
            className="px-4 py-2 text-sm rounded-lg bg-sky-600 text-white font-bold disabled:opacity-50"
          >
            اتصال
          </button>
        </div>
      </div>
    </div>
  );
}
