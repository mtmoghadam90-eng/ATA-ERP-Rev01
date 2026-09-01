import { CheckCircle2, CornerDownLeft, Inbox, ListTodo, MessageSquare, Phone } from 'lucide-react';

import {
  BOARD_LANES, BoardLane, BoardSort, LANE_LABELS, TASK_CANCELLED,
  referralLane, sortBoardCards, taskLane,
} from '../utils/workBoard';

/**
 * The three columns, over both kinds of work.
 *
 * «کارتابل ارجاعات» and «وظایف و پیگیری» asked the same question — what has
 * been given to me to do — so a person had to look in two places and remember
 * which kind of thing they were looking for. This is the one place.
 *
 * A referral is **not** copied into the tasks table: it stays its own record
 * with its own conversation thread, and `workBoard.ts` maps each kind's own
 * status onto a column. So the card knows which it is and renders the right
 * thing — a referral opens its thread, a sales follow-up opens the completion
 * form, an ordinary task gets the ordinary tick — and nothing had to be
 * reimplemented to move it here.
 */

export interface BoardTaskCard {
  kind: 'task';
  id: string;
  title: string;
  createdAt: string;
  priority?: string | null;
  status: string;
  taskKind?: string | null;
  dueDate?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  assignedTo?: string | null;
  createdBy?: string | null;
  context?: { code: string; name: string; customerName: string | null } | null;
}

export interface BoardReferralCard {
  kind: 'referral';
  id: string;
  title: string;
  createdAt: string;
  status: string;
  assignedTo?: string | null;
  createdBy?: string | null;
  context?: { code: string; name: string; customerName: string | null } | null;
  /** How many replies the thread already carries — a card can say «۳ پاسخ». */
  replies: number;
}

export type BoardCard = BoardTaskCard | BoardReferralCard;

interface Props {
  cards: BoardCard[];
  sort: BoardSort;
  /** Ids currently ticked, across every column. */
  selected: Set<string>;
  onToggleSelect: (key: string) => void;
  /** Moves everything ticked into `lane`. */
  onMove: (lane: BoardLane) => void;
  /** Opens the card: the referral thread, the follow-up form, or the edit box. */
  onOpen: (card: BoardCard) => void;
  moving: boolean;
}

/** A stable key across the two record types, since ids only collide by accident. */
export function cardKey(card: BoardCard): string {
  return `${card.kind}:${card.id}`;
}

function laneOf(card: BoardCard): BoardLane {
  return card.kind === 'task' ? taskLane(card.status) : referralLane(card.status);
}

const PRIORITY_CLASS: Record<string, string> = {
  'فوری': 'bg-rose-50 text-rose-700 border-rose-200',
  'بالا': 'bg-amber-50 text-amber-800 border-amber-200',
  'متوسط': 'bg-sky-50 text-sky-700 border-sky-200',
  'پایین': 'bg-slate-50 text-slate-600 border-slate-200',
};

const LANE_CLASS: Record<BoardLane, string> = {
  TODO: 'border-sky-200 bg-sky-50/40',
  DOING: 'border-amber-200 bg-amber-50/40',
  DONE: 'border-emerald-200 bg-emerald-50/30',
};

export default function WorkBoard({
  cards, sort, selected, onToggleSelect, onMove, onOpen, moving,
}: Props) {
  const byLane: Record<BoardLane, BoardCard[]> = { TODO: [], DOING: [], DONE: [] };
  for (const card of cards) byLane[laneOf(card)].push(card);
  for (const lane of BOARD_LANES) byLane[lane] = sortBoardCards(byLane[lane], sort);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" dir="rtl" id="work-board">
      {BOARD_LANES.map((lane) => {
        const list = byLane[lane];

        return (
          <div
            key={lane}
            id={`work-board-lane-${lane}`}
            className={`rounded-2xl border ${LANE_CLASS[lane]} p-3 flex flex-col gap-2 min-h-[120px]`}
          >
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/70">
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold text-slate-700">{LANE_LABELS[lane]}</span>
                <span className="text-[10px] font-mono bg-white border border-slate-200 rounded-full px-1.5 text-slate-500">
                  {list.length}
                </span>
              </div>

              {/*
                One button per column: «move what is ticked into this one».

                Not drag-and-drop. Dragging needs a library to work at all and
                is unusable on the phone this is read on; ticking a few cards
                and pressing a column is the same gesture, works everywhere,
                and is one request rather than one per card — which is what
                keeps a column from rearranging itself an item at a time.

                It moves in **both** directions by construction, so putting a
                finished job back into «در حال انجام» is the same press.
              */}
              <button
                type="button"
                disabled={moving || selected.size === 0}
                onClick={() => onMove(lane)}
                id={`work-board-move-${lane}`}
                title={`انتقال ${selected.size} مورد انتخاب‌شده به «${LANE_LABELS[lane]}»`}
                className="px-1.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-sky-600 hover:border-sky-300 transition disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1 text-[10px] font-bold"
              >
                <CornerDownLeft size={11} />
                انتقال به اینجا
              </button>
            </div>

            {list.length === 0 && (
              <p className="text-[11px] text-slate-400 py-4 text-center">موردی در این ستون نیست.</p>
            )}

            {list.map((card) => {
              const key = cardKey(card);
              const isSelected = selected.has(key);
              const cancelled = card.kind === 'task' && card.status === TASK_CANCELLED;

              return (
                <div
                  key={key}
                  id={`work-board-card-${key}`}
                  className={`bg-white rounded-xl border p-2.5 space-y-1.5 transition ${
                    isSelected ? 'border-sky-400 ring-2 ring-sky-500/15' : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelect(key)}
                      id={`work-board-select-${key}`}
                      className="mt-0.5 accent-sky-500"
                      aria-label="انتخاب برای انتقال"
                    />
                    <button
                      type="button"
                      onClick={() => onOpen(card)}
                      className="flex-1 text-right text-[12px] font-bold text-slate-800 leading-relaxed hover:text-sky-700 transition"
                    >
                      {card.title}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-1 pr-6">
                    {/*
                      What kind of work it is, because the answer decides what
                      pressing the card does — reply in a thread, record what
                      the customer said, or tick it.
                    */}
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-slate-50 border-slate-200 text-slate-600 inline-flex items-center gap-1">
                      {card.kind === 'referral' ? <><Inbox size={9} /> ارجاع</>
                        : card.taskKind === 'SALES_FOLLOW_UP' ? <><Phone size={9} /> پیگیری فروش</>
                          : <><ListTodo size={9} /> وظیفه</>}
                    </span>

                    {card.kind === 'task' && card.priority && (
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                        PRIORITY_CLASS[card.priority] ?? PRIORITY_CLASS['متوسط']
                      }`}>
                        {card.priority}
                      </span>
                    )}

                    {card.kind === 'referral' && card.replies > 0 && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-white border-slate-200 text-slate-500 inline-flex items-center gap-1">
                        <MessageSquare size={9} />
                        {card.replies} پاسخ
                      </span>
                    )}

                    {/*
                      A cancelled task is finished work and belongs in the last
                      column, but it is not the same as done — so it is marked
                      rather than given a column nobody asked for.
                    */}
                    {cancelled && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-rose-50 border-rose-200 text-rose-700">
                        کنسل شده
                      </span>
                    )}
                  </div>

                  {card.context && (card.context.code || card.context.customerName) && (
                    <div className="pr-6 text-[10px] text-sky-700 flex flex-wrap items-center gap-1">
                      {card.context.code && <span className="font-mono font-bold">{card.context.code}</span>}
                      {card.context.name && <span className="truncate">{card.context.name}</span>}
                      {card.context.customerName && (
                        <span className="text-slate-500">— {card.context.customerName}</span>
                      )}
                    </div>
                  )}

                  <div className="pr-6 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400 font-mono">
                    {card.kind === 'task' && card.dueDate && <span>سررسید: {card.dueDate}</span>}
                    {/* The two facts the board records: when it started, when it closed. */}
                    {card.kind === 'task' && card.startedAt && <span>شروع: {card.startedAt}</span>}
                    {card.kind === 'task' && card.completedAt && (
                      <span className="text-emerald-600 inline-flex items-center gap-0.5">
                        <CheckCircle2 size={9} /> {card.completedAt}
                      </span>
                    )}
                    <span className="font-sans">مسئول: {card.assignedTo || '—'}</span>
                    <span className="font-sans">ارجاع‌دهنده: {card.createdBy || 'سیستم'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
