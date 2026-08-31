import { useEffect, useRef, useState } from 'react';
import { AtSign, CornerUpLeft, Paperclip, Send, X } from 'lucide-react';
import {
  MentionableUser, insertMention, mentionIsComplete, mentionQuery, mentionSuggestions,
  parseMentions,
} from '../utils/mentions';
import type { ActivityAttachment } from '../utils/attachments';

/**
 * Writing a message on a project's feed.
 *
 * The feed is where staff record what happened on a job, and it is where they
 * talk about it — so it is composed like a messenger rather than like a form:
 * you write a sentence, you name whoever needs to act on it, and you can answer
 * what somebody else said.
 *
 * **Naming somebody is the referral.** The form used to carry a checkbox, a
 * colleague picker and a separate "what should they do" box, which said in
 * three controls what the sentence already said — and left two texts to keep in
 * step. The server parses the names out of the message and raises one referral
 * each, with the message itself as the request.
 */

interface Props {
  /** Colleagues who can be named. The author is filtered out by the server. */
  users: MentionableUser[];
  /** The message being answered, if any. */
  replyTo: { id: string; text: string; authorName?: string | null } | null;
  onCancelReply: () => void;
  attachments: ActivityAttachment[];
  onAttachmentsChange: (next: ActivityAttachment[]) => void;
  onPickFiles: (files: FileList | null) => void;
  uploading: boolean;
  onSend: (text: string) => Promise<void>;
}

export default function ActivityComposer({
  users, replyTo, onCancelReply, attachments, onAttachmentsChange,
  onPickFiles, uploading, onSend,
}: Props) {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const box = useRef<HTMLTextAreaElement | null>(null);

  const query = mentionQuery(text, caret);
  const suggestions = query === null ? [] : mentionSuggestions(query, users);
  /*
   * A finished mention closes the list.
   *
   * The completed name is still a name, so it still matches and the list would
   * stay open over it — and Enter would pick the same person again instead of
   * starting a new line.
   */
  const listOpen = query !== null && suggestions.length > 0
    && !mentionIsComplete(text, caret, users);

  // The list is rebuilt as the term narrows, so the highlighted row has to come
  // back to the top or it points past the end of a shorter list.
  useEffect(() => { setHighlight(0); }, [query]);

  const named = parseMentions(text, users);

  /*
   * Where the cursor has to be put back after a name is inserted.
   *
   * React re-renders the textarea with the new value and the browser drops the
   * cursor at the end of it, so the caret is restored in an effect — after the
   * new value is on the node. Not `requestAnimationFrame`: that is a browser
   * global this component should not depend on, and it is absent when the
   * screen is rendered outside one.
   */
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);
  useEffect(() => {
    if (pendingCaret === null) return;
    const node = box.current;
    setPendingCaret(null);
    if (!node) return;
    try {
      if (node.ownerDocument.activeElement !== node) node.focus();
      node.setSelectionRange(pendingCaret, pendingCaret);
    } catch {
      // Putting a text cursor back is a convenience, and no environment is
      // obliged to support it — a headless one does not implement the focus
      // machinery React reaches for. It must never take the composer down.
    }
  }, [pendingCaret]);

  const choose = (user: MentionableUser) => {
    const next = insertMention(text, caret, user);
    setText(next.text);
    setCaret(next.caret);
    setPendingCaret(next.caret);
  };

  const send = async () => {
    if (!text.trim() && attachments.length === 0) return;
    setBusy(true);
    try {
      await onSend(text.trim());
      setText('');
      setCaret(0);
    } finally {
      setBusy(false);
    }
  };

  return (
    /*
      The compose bar has to read as a separate region from the messages above
      it, and it did not: its fill and theirs measured 1.03:1 — the same colour.
      Two large surfaces in a light interface cannot be pulled to 3:1 without
      one of them going obviously grey, so the separation is carried by the
      top edge instead. `border-edge` is 3.63:1 on white, which is what the
      contrast rule actually asks of a boundary.
    */
    <div
      className="space-y-2 bg-slate-50 p-3 rounded-xl border border-hairline border-t-2 border-t-edge"
      id="activity-composer"
    >
      {/* What is being answered, so the reply is not written blind. */}
      {replyTo && (
        <div className="flex items-start gap-2 bg-white border-r-2 border-sky-400 rounded-lg px-2.5 py-1.5">
          <CornerUpLeft size={12} className="text-sky-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold text-sky-700">
              پاسخ به {replyTo.authorName || 'یک همکار'}
            </div>
            <div className="text-[10px] text-slate-500 truncate">{replyTo.text}</div>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="text-slate-400 hover:text-rose-600 shrink-0"
            title="لغو پاسخ"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="relative">
        <textarea
          ref={box}
          rows={2}
          value={text}
          onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart ?? 0); }}
          onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={(e) => {
            if (!listOpen) return;
            // While the list is open the arrows and Enter belong to it, not to
            // the textarea — otherwise Enter posts the message mid-name.
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlight((h) => (h + 1) % suggestions.length);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
            } else if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              choose(suggestions[highlight]);
            } else if (e.key === 'Escape') {
              setCaret(text.length);
            }
          }}
          placeholder="پیام، شرح فعالیت یا مذاکره… برای ارجاع، نام همکار را با @ بنویسید"
          className="w-full border border-slate-200 rounded-lg p-2 text-xs focus:ring-2 focus:ring-sky-500/20 outline-none text-right placeholder-slate-400 bg-white"
          id="activity-composer-text"
          dir="rtl"
        />

        {listOpen && (
          <ul className="absolute z-30 right-2 bottom-full mb-1 w-64 max-h-52 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg py-1">
            {suggestions.map((user, i) => (
              <li key={user.id}>
                <button
                  type="button"
                  // `onMouseDown`, not `onClick`: a click blurs the textarea
                  // first, and the blur closes the list before the click lands.
                  onMouseDown={(e) => { e.preventDefault(); choose(user); }}
                  className={`w-full text-right px-3 py-1.5 text-xs flex items-center gap-1.5 transition ${
                    i === highlight ? 'bg-sky-50 text-sky-800' : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <AtSign size={11} className="text-sky-500" />
                  {user.fullName}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Who this message is asking, spelled out before it is sent. */}
      {named.length > 0 && (
        <p className="text-[10px] text-sky-700 bg-sky-50 border border-sky-100 rounded-lg px-2 py-1">
          با ارسال این پیام، برای{' '}
          <strong>{named.map((u) => u.fullName).join('، ')}</strong>{' '}
          ارجاع ثبت می‌شود و متن همین پیام به‌عنوان اقدام خواسته‌شده ثبت خواهد شد.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-2">
          <label className="cursor-pointer bg-white border border-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-50 transition font-bold text-slate-600 flex items-center gap-1">
            <Paperclip size={12} className="text-slate-400" />
            <span>{uploading ? 'در حال بارگذاری…' : 'پیوست فایل'}</span>
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                onPickFiles(e.target.files);
                // Cleared after the handler has read it: reading `files` once
                // the input has been reset gives an empty list.
                if (e.target) e.target.value = '';
              }}
            />
          </label>
          {attachments.map((file) => (
            <span
              key={file.url}
              className="text-sky-700 font-bold bg-sky-50 px-2 py-1 rounded flex items-center gap-1 border border-sky-100"
            >
              {file.name}
              <button
                type="button"
                onClick={() => onAttachmentsChange(attachments.filter((f) => f.url !== file.url))}
                className="text-rose-500 hover:text-rose-700 font-bold text-xs"
                title="حذف این فایل"
              >
                ×
              </button>
            </span>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || uploading || (!text.trim() && attachments.length === 0)}
          id="activity-composer-send"
          className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-md shadow-emerald-500/15 disabled:opacity-40"
        >
          <Send size={11} />
          {busy ? 'در حال ثبت…' : replyTo ? 'ارسال پاسخ' : 'ثبت پیام'}
        </button>
      </div>
    </div>
  );
}
