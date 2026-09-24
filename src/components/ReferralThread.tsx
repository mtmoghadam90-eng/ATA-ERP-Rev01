import { useEffect, useRef, useState } from 'react';
import {
  CalendarClock, CheckCircle2, MessageSquare, Paperclip, Pencil, RefreshCcw, Send, X,
} from 'lucide-react';

import { referralIsOpen } from '../utils/workBoard';
import { MAX_ACTIVITY_ATTACHMENTS, formatFileSize, type ActivityAttachment } from '../utils/attachments';
import { oversizedUploadReason } from '../utils/uploadLimits';
import ShamsiDatePicker from './ShamsiDatePicker';

/**
 * A referral, read as the conversation it actually is.
 *
 * It used to be drawn as a request followed by a column of identical green
 * blocks, each labelled with a name — so who said what came from reading the
 * labels rather than from looking at it, and the box you type in sat in the
 * same column as everything already said. A referral is two people going back
 * and forth about one job; a chat is what that looks like.
 *
 * Sided by **account id**, never by display name: an account since renamed, or
 * one whose name was never filled in, matched nobody and the whole thread came
 * out on one side. Deliberately subtle — a tint and an alignment, no bubbles
 * with tails — because this sits inside a project's activity feed as well as on
 * its own screen.
 *
 * Presentation plus a draft; the writes belong to the screens, which each have
 * their own reload and error reporting.
 */

export interface ThreadMessage {
  text: string;
  responder?: string;
  responderUserId?: string | null;
  createdAt?: string;
  /** Every file on the message, already hosted under `/uploads`. */
  attachments?: ActivityAttachment[];
}

export interface ThreadReferral {
  id: string;
  status?: string;
  actionRequired: string;
  assignedBy?: string;
  assignedTo?: string;
  assignedByUserId?: string | null;
  assignedToUserId?: string | null;
  /** «تا کی؟», and whether the assignee is the one who was asked to say. */
  dueDateJalali?: string | null;
  dueDateByAssignee?: boolean;
  messages?: ThreadMessage[];
}

export type ReplyOutcome = 'none' | 'done' | 'reopen';

export interface ReferralComposerSubmit {
  text: string;
  attachments: ActivityAttachment[];
  outcome: ReplyOutcome;
  forwardToUserId: string;
}

interface Props {
  referral: ThreadReferral;
  currentUserId?: string | null;
  /** Formats a stored timestamp; each screen already has its own helper. */
  formatDate: (value?: string) => string;
  /** Colleagues a referral can be handed to. Empty hides the forward picker. */
  users?: { id: string; fullName: string; position?: string }[];
  /**
   * Puts one picked file on the server and answers its `/uploads/...` path.
   *
   * Omitted where the screen has no upload path. The host does the upload
   * because `uploadFile` lives in `imageUtils`, which pulls `file-saver` at
   * module scope and would make this component unmountable outside a bundler.
   * It used to hand back a data URL, which the server stored in a 500-character
   * column — so every reply's file was cut short and never opened.
   */
  onUploadFile?: (file: File) => Promise<string>;
  onSubmit?: (body: ReferralComposerSubmit) => Promise<void>;
  /** Corrects the request. Only offered to the person who raised it. */
  onEditAction?: (text: string) => Promise<void>;
  /**
   * Agrees or moves the deadline. Offered to **either** party.
   *
   * Unlike the request's own text: the assignee writing here is answering
   * «مهلت را خودت تعیین کن», and refusing them would leave that switch a
   * question nobody could answer from any screen. Omitted where the screen has
   * no write path, and the strip is then read-only rather than absent — a
   * deadline is worth reading wherever the request is.
   */
  onSetDue?: (dueDate: string | null) => Promise<void>;
  /** Smaller type, for the activity feed. */
  compact?: boolean;
}

export default function ReferralThread({
  referral, currentUserId, formatDate, users = [],
  onUploadFile, onSubmit, onEditAction, onSetDue, compact = false,
}: Props) {
  /*
   * Open, which is not the same question as «در انتظار اقدام».
   *
   * This compared the status against that one literal, and a referral has had a
   * middle state since the board was merged in — so the moment somebody picked
   * a referral up, «ثبت اتمام کار» vanished for the assignee and «ثبت پاسخ و
   * ارجاع مجدد» appeared for the referrer against a referral that was not
   * finished. There was then no way to close it from the thread at all, which
   * is exactly how it was reported.
   *
   * `referralIsOpen` is the same exclusion the inbox badge and the board use: a
   * status nobody anticipated counts as open rather than silently closing.
   */
  const isOpen = referralIsOpen(referral.status);
  const isAssignee = !!currentUserId && referral.assignedToUserId === currentUserId;
  const isReferrer = !!currentUserId && referral.assignedByUserId === currentUserId;

  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<ActivityAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [forwardTo, setForwardTo] = useState('');
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState(false);
  const [draftAction, setDraftAction] = useState(referral.actionRequired);
  const [savingAction, setSavingAction] = useState(false);

  const [editingDue, setEditingDue] = useState(false);
  const [draftDue, setDraftDue] = useState(referral.dueDateJalali ?? '');
  const [savingDue, setSavingDue] = useState(false);

  /*
   * Seeded on open and on the referral changing, not on every render.
   *
   * The screens behind this re-render on their own — a badge poll returns, a
   * list revalidates — and an effect keyed on the text alone would wipe a
   * half-typed correction each time. Same family as the price calculator.
   */
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (seededFor.current === referral.id) return;
    seededFor.current = referral.id;
    setDraftAction(referral.actionRequired);
    setEditing(false);
    setDraftDue(referral.dueDateJalali ?? '');
    setEditingDue(false);
  }, [referral.id, referral.actionRequired, referral.dueDateJalali]);

  const messages = referral.messages ?? [];

  const send = async (outcome: ReplyOutcome) => {
    if (!onSubmit) return;
    setBusy(true);
    try {
      await onSubmit({ text, attachments, outcome, forwardToUserId: forwardTo });
      setText('');
      setAttachments([]);
      setForwardTo('');
    } finally {
      setBusy(false);
    }
  };

  /*
   * Several files, one after another.
   *
   * Sequential for the reason the feed's composer is: one disk and one image
   * pipeline on the server, and ten at once on a phone connection is how the
   * whole batch times out. The limits are checked on the batch first, so four
   * are not uploaded before the fifth is refused.
   */
  const pickFiles = async (picked: File[]) => {
    if (!onUploadFile || picked.length === 0) return;
    if (attachments.length + picked.length > MAX_ACTIVITY_ATTACHMENTS) {
      alert(`حداکثر ${MAX_ACTIVITY_ATTACHMENTS} فایل برای هر پیام قابل ثبت است.`);
      return;
    }
    const oversized = picked.map(oversizedUploadReason).find(Boolean);
    if (oversized) { alert(oversized); return; }
    setUploading(true);
    try {
      // Each file joins the reply the moment it lands, so a failure half way
      // through leaves the ones already uploaded on the reply rather than on
      // the server with nothing pointing at them.
      for (const file of picked) {
        const url = await onUploadFile(file);
        const added: ActivityAttachment = { name: file.name, size: formatFileSize(file.size), url };
        setAttachments((prev) => [...prev, added]);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'بارگذاری فایل با خطا مواجه شد.');
    } finally {
      setUploading(false);
    }
  };

  const saveDue = async (value: string | null) => {
    if (!onSetDue) return;
    setSavingDue(true);
    try {
      await onSetDue(value);
      setEditingDue(false);
    } finally {
      setSavingDue(false);
    }
  };

  const saveAction = async () => {
    if (!onEditAction) return;
    setSavingAction(true);
    try {
      await onEditAction(draftAction);
      setEditing(false);
    } finally {
      setSavingAction(false);
    }
  };

  const size = compact
    ? { body: 'text-[11px]', meta: 'text-[9px]', pad: 'p-2' }
    : { body: 'text-sm', meta: 'text-[10px]', pad: 'p-3' };

  return (
    <div className="space-y-3" id={`referral-thread-${referral.id}`}>
      {/* The request itself: the first thing said, so the first thing shown. */}
      <div className="flex justify-start">
        <div className="max-w-[85%] space-y-1">
          <div className={`flex items-center gap-1.5 ${size.meta} font-bold text-slate-400`}>
            <span>{referral.assignedBy || 'ارجاع‌دهنده'}</span>
            <span className="text-slate-300">·</span>
            <span>اقدام خواسته‌شده</span>
            {onEditAction && isReferrer && !editing && (
              <button
                type="button"
                onClick={() => { setDraftAction(referral.actionRequired); setEditing(true); }}
                className="text-sky-500 hover:text-sky-700 transition"
                title="ویرایش متن ارجاع"
                id={`referral-edit-${referral.id}`}
              >
                <Pencil size={11} />
              </button>
            )}
          </div>

          {editing ? (
            <div className="space-y-1.5">
              <textarea
                rows={3}
                value={draftAction}
                onChange={(e) => setDraftAction(e.target.value)}
                className={`w-full border border-sky-300 rounded-xl px-3 py-2 ${size.body} outline-none focus:border-sky-500 bg-white`}
                id={`referral-action-input-${referral.id}`}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void saveAction()}
                  disabled={savingAction || !draftAction.trim()}
                  className="px-3 py-1 text-[11px] font-bold bg-sky-600 hover:bg-sky-700 text-white rounded-lg transition disabled:opacity-50"
                  id={`referral-action-save-${referral.id}`}
                >
                  {savingAction ? 'در حال ثبت…' : 'ثبت ویرایش'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="px-3 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-200 rounded-lg transition"
                >
                  انصراف
                </button>
              </div>
            </div>
          ) : (
            <div className={`bg-sky-50 border border-sky-100 rounded-xl rounded-tr-sm ${size.pad} ${size.body} font-bold text-slate-800 leading-relaxed whitespace-pre-line`}>
              {referral.actionRequired}
            </div>
          )}
        </div>
      </div>

      {/*
        The deadline, under the request it belongs to.

        Drawn even when there is none, and that is the point: «بدون مهلت» is an
        answer somebody can act on, while an absent strip reads as a thread that
        simply does not have the feature — which is how a referral went years
        with nothing able to say it was late.

        «تعیین مهلت با ارجاع‌شونده» is its own wording rather than a blank,
        because it is the one state that is *waiting* on somebody: the person
        who raised it has said «تا کی خودت بگو», and the reminder pass asks for
        it once.
      */}
      <div
        className={`flex flex-wrap items-center gap-2 ${size.meta} text-slate-500`}
        data-referral-due-strip={referral.id}
      >
        <span className="flex items-center gap-1 font-bold text-slate-400">
          <CalendarClock size={11} />
          مهلت:
        </span>

        {editingDue ? (
          <>
            <div className="w-40">
              <ShamsiDatePicker
                value={draftDue}
                onChange={setDraftDue}
                compact
                placeholder="بدون مهلت"
              />
            </div>
            <button
              type="button"
              onClick={() => void saveDue(draftDue.trim() || null)}
              disabled={savingDue}
              className="px-2 py-0.5 font-bold bg-sky-600 hover:bg-sky-700 text-white rounded transition disabled:opacity-50"
              id={`referral-due-save-${referral.id}`}
            >
              {savingDue ? '…' : 'ثبت'}
            </button>
            <button
              type="button"
              onClick={() => { setDraftDue(referral.dueDateJalali ?? ''); setEditingDue(false); }}
              className="px-2 py-0.5 font-bold text-slate-500 hover:bg-slate-200 rounded transition"
            >
              انصراف
            </button>
          </>
        ) : (
          <>
            {referral.dueDateJalali ? (
              <span className="font-mono font-bold text-slate-700">{referral.dueDateJalali}</span>
            ) : referral.dueDateByAssignee ? (
              <span className="font-bold text-amber-700">
                تعیین مهلت بر عهدهٔ {isAssignee ? 'شما' : referral.assignedTo || 'ارجاع‌شونده'}
              </span>
            ) : (
              <span>بدون مهلت</span>
            )}
            {onSetDue && (isAssignee || isReferrer) && isOpen && (
              <button
                type="button"
                onClick={() => { setDraftDue(referral.dueDateJalali ?? ''); setEditingDue(true); }}
                className="text-sky-500 hover:text-sky-700 transition"
                title="تعیین یا تغییر مهلت"
                id={`referral-due-edit-${referral.id}`}
              >
                <Pencil size={11} />
              </button>
            )}
          </>
        )}
      </div>

      {/* The replies. Whoever is not the referrer sits on the other side. */}
      {messages.map((msg, idx) => {
        /*
         * By id, with the name only as a fallback for a message written before
         * `responderUserId` was stored. A name comparison put a renamed
         * account's whole side of the conversation back on the referrer's.
         */
        const fromReferrer = msg.responderUserId
          ? msg.responderUserId === referral.assignedByUserId
          : msg.responder === referral.assignedBy;
        const mine = !!currentUserId && msg.responderUserId === currentUserId;

        return (
          <div key={idx} className={`flex ${fromReferrer ? 'justify-start' : 'justify-end'}`}>
            <div className="max-w-[85%] space-y-1">
              <div className={`flex items-center gap-1.5 ${size.meta} text-slate-400 ${fromReferrer ? '' : 'justify-end'}`}>
                <span className="font-bold">{msg.responder || '—'}</span>
                {msg.createdAt && <span className="font-mono">{formatDate(msg.createdAt)}</span>}
              </div>
              {/* A reply may be files alone, and an empty bubble reads as a lost message. */}
              {msg.text && (
                <div className={`rounded-xl ${size.pad} ${size.body} leading-relaxed whitespace-pre-line border ${
                  fromReferrer
                    ? 'bg-sky-50/60 border-sky-100 rounded-tr-sm text-slate-800'
                    : `bg-emerald-50/60 border-emerald-100 rounded-tl-sm text-slate-800 ${mine ? 'ring-1 ring-emerald-200' : ''}`
                }`}>
                  {msg.text}
                </div>
              )}
              {(msg.attachments ?? []).length > 0 && (
                <div className={`flex flex-wrap gap-1 ${fromReferrer ? '' : 'justify-end'}`} data-thread-files>
                  {(msg.attachments ?? []).map((file) => (
                    <a
                      key={file.url}
                      href={file.url}
                      target="_blank"
                      rel="noreferrer"
                      download={file.name}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 text-[10px] font-bold transition"
                    >
                      <Paperclip size={10} />
                      <span>{file.name}</span>
                      {file.size && <span className="text-slate-400">({file.size})</span>}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/*
        The compose area, on the other side of a rule.

        It is not another message in the column: everything above happened and
        this has not, and putting them in one stack is how a draft gets read as
        something already said.
      */}
      {onSubmit && (
        <div className="mt-2 pt-3 border-t-2 border-dashed border-slate-200 bg-slate-50/60 rounded-xl p-3 space-y-2">
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="پیام خود را بنویسید…"
            className={`w-full border border-slate-200 rounded-xl px-3 py-2 ${size.body} bg-white outline-none focus:border-sky-400 text-right placeholder-slate-400`}
            id={`referral-reply-${referral.id}`}
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {users.length > 0 && (
                <select
                  value={forwardTo}
                  onChange={(e) => setForwardTo(e.target.value)}
                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] text-slate-600 bg-white outline-none focus:border-sky-400"
                >
                  <option value="">-- ارجاع به همکار (اختیاری) --</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}{u.position ? ` - ${u.position}` : ''}
                    </option>
                  ))}
                </select>
              )}

              {onUploadFile && (
                <label className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 bg-white text-slate-600 text-[11px] font-bold transition">
                  <Paperclip size={12} className="text-slate-400" />
                  <span>{uploading ? 'در حال بارگذاری…' : 'پیوست فایل'}</span>
                  <input
                    type="file"
                    multiple
                    disabled={uploading}
                    className="hidden"
                    data-thread-file-input
                    onChange={(e) => {
                      // Copied out before the reset: an emptied input empties
                      // the list it handed over.
                      const picked = Array.from(e.target.files ?? []);
                      // Cleared so choosing the same file again still fires.
                      e.target.value = '';
                      void pickFiles(picked);
                    }}
                  />
                </label>
              )}

              {attachments.map((file) => (
                <span key={file.url} className="inline-flex items-center gap-1.5 bg-sky-50 text-sky-700 text-[11px] px-2 py-1 rounded-lg border border-sky-100 font-medium">
                  {file.name}{file.size ? ` (${file.size})` : ''}
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((f) => f.url !== file.url))}
                    className="text-rose-500 hover:text-rose-700"
                    title="حذف فایل"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void send('none')}
                disabled={busy || uploading}
                id={`referral-send-${referral.id}`}
                className="px-4 py-1.5 bg-sky-500 hover:bg-sky-600 text-white rounded-lg text-[11px] font-bold transition flex items-center gap-1.5 disabled:opacity-50"
              >
                <Send size={13} />
                ارسال پیام
              </button>

              {isOpen && isAssignee && (
                <button
                  type="button"
                  onClick={() => void send('done')}
                  disabled={busy || uploading}
                  className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-[11px] font-bold transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  <CheckCircle2 size={13} />
                  ثبت اتمام کار
                </button>
              )}

              {/*
                The conversation does not end when the assignee calls it done.

                Often that is when it starts: whoever raised the referral reads
                the result and finds it is not what they asked for. A message
                alone leaves it closed, so nobody is told to look again;
                reopening alone says nothing about what was wanted. This does
                both, from wherever the reply is being read — including the
                project's own activity feed, which is where the answer is
                usually seen first.
              */}
              {!isOpen && isReferrer && (
                <button
                  type="button"
                  onClick={() => void send('reopen')}
                  disabled={busy || uploading}
                  id={`referral-reopen-${referral.id}`}
                  className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[11px] font-bold transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCcw size={13} />
                  ثبت پاسخ و ارجاع مجدد
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {!onSubmit && messages.length === 0 && (
        <p className="text-[10px] text-slate-400 flex items-center gap-1">
          <MessageSquare size={11} />
          هنوز پاسخی ثبت نشده است.
        </p>
      )}
    </div>
  );
}
