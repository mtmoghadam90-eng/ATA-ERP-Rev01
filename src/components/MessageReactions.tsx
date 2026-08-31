import { useState } from 'react';
import { Eye, SmilePlus } from 'lucide-react';

import {
  ACTIVITY_REACTIONS, ReactionRow, summarizeReactions,
} from '../utils/reactions';

/**
 * The two messenger affordances on one activity message: react, and see who
 * has read it.
 *
 * Its own component rather than more markup inside `ProjectsView` for two
 * reasons. The feed's message card is already several hundred lines of JSX and
 * nobody can see a bug in it; and this has real behaviour worth testing — the
 * readers are fetched **when the eye is pressed and never before**, which is
 * what keeps every reader of every message out of the feed response, and a
 * check can only assert that against a component it can render.
 */

export interface MessageReader {
  userId: string;
  name: string;
  readAt: string;
}

interface Props {
  activityId: string;
  reactions: ReactionRow[];
  /** How many people have seen it. The names are one request away. */
  readCount: number;
  currentUserId?: string | null;
  /** The current display name for an id — a renamed colleague reads as such. */
  nameOf?: (userId: string) => string | undefined;
  onToggle: (emoji: string) => void | Promise<void>;
  loadReaders: () => Promise<MessageReader[]>;
}

export default function MessageReactions({
  activityId, reactions, readCount, currentUserId, nameOf, onToggle, loadReaders,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [readersOpen, setReadersOpen] = useState(false);
  const [readers, setReaders] = useState<MessageReader[] | null>(null);
  const [loadingReaders, setLoadingReaders] = useState(false);

  const chips = summarizeReactions(reactions, currentUserId, nameOf);

  const openReaders = () => {
    if (readersOpen) { setReadersOpen(false); return; }
    setReadersOpen(true);
    // Fetched on opening, every time: somebody presses the eye precisely to
    // find out whether one more person has read it since they last looked.
    setLoadingReaders(true);
    loadReaders()
      .then(setReaders)
      .catch(() => setReaders([]))
      .finally(() => setLoadingReaders(false));
  };

  return (
    <div className="relative mt-1.5 flex flex-wrap items-center gap-1" dir="rtl">
      {/* What people have already pressed. */}
      {chips.map((chip) => (
        <button
          key={chip.emoji}
          type="button"
          onClick={() => { void onToggle(chip.emoji); }}
          data-reaction-chip={chip.emoji}
          title={chip.names.join('، ')}
          className={`px-1.5 py-0.5 rounded-full border text-[11px] leading-none flex items-center gap-1 transition ${
            chip.mine
              ? 'bg-sky-50 border-sky-400 text-sky-800 font-bold'
              : 'bg-white border-slate-200 text-slate-600 hover:border-sky-300'
          }`}
        >
          <span>{chip.emoji}</span>
          <span className="font-mono text-[10px]">{chip.count}</span>
        </button>
      ))}

      {/* Add one. */}
      <button
        type="button"
        onClick={() => setPickerOpen((open) => !open)}
        id={`reaction-open-${activityId}`}
        title="واکنش"
        className="p-1 rounded-full border border-slate-200 bg-white text-slate-400 hover:text-sky-600 hover:border-sky-300 transition"
      >
        <SmilePlus size={12} />
      </button>

      {/*
        Who has seen it.

        The count is drawn without asking anybody — it travels with the feed —
        and the names are fetched only when this is pressed.
      */}
      <button
        type="button"
        onClick={openReaders}
        id={`reaction-eye-${activityId}`}
        title="چه کسانی این پیام را دیده‌اند"
        className={`p-1 rounded-full border transition flex items-center gap-1 ${
          readersOpen
            ? 'bg-sky-50 border-sky-400 text-sky-700'
            : 'border-slate-200 bg-white text-slate-400 hover:text-sky-600 hover:border-sky-300'
        }`}
      >
        <Eye size={12} />
        {readCount > 0 && (
          <span className="font-mono text-[10px] leading-none">{readCount}</span>
        )}
      </button>

      {pickerOpen && (
        <div
          className="absolute z-30 top-full right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg p-1 flex items-center gap-0.5"
          id={`reaction-picker-${activityId}`}
        >
          {ACTIVITY_REACTIONS.map((option) => (
            <button
              key={option.emoji}
              type="button"
              title={option.label}
              onClick={() => { setPickerOpen(false); void onToggle(option.emoji); }}
              data-reaction-pick={option.emoji}
              className="px-1.5 py-1 rounded-lg hover:bg-slate-100 text-base leading-none transition"
            >
              {option.emoji}
            </button>
          ))}
        </div>
      )}

      {readersOpen && (
        <div
          className="absolute z-30 top-full right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg p-2 min-w-[160px] max-h-48 overflow-y-auto text-right"
          id={`reaction-readers-${activityId}`}
        >
          <div className="text-[10px] font-bold text-slate-500 border-b border-slate-100 pb-1 mb-1">
            دیده‌شده توسط
          </div>
          {loadingReaders && <div className="text-[10px] text-slate-400">در حال دریافت…</div>}
          {/*
            Nobody yet is a real answer and is said out loud. A blank panel here
            reads as a screen that failed rather than as a message nobody has
            opened, which is the thing the eye exists to tell you.
          */}
          {!loadingReaders && (readers?.length ?? 0) === 0 && (
            <div className="text-[10px] text-slate-400">هنوز کسی این پیام را ندیده است.</div>
          )}
          {(readers ?? []).map((reader) => (
            <div key={reader.userId} className="text-[11px] text-slate-700 py-0.5">
              {nameOf?.(reader.userId) || reader.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
