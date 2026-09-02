import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, PhoneOff, X } from 'lucide-react';

import ShamsiDatePicker from './ShamsiDatePicker';
import { SearchableSelect } from './SearchableSelect';
import {
  DEFAULT_FOLLOW_UP_RESULTS, FollowUpDecision, SETTLE_OUTCOMES, SETTLE_OUTCOME_LABELS,
  SettleOutcome, completionRefusalReason, impliedSettlement,
} from '../utils/salesFollowUp';
import { getTodayShamsi, addDaysToShamsi } from '../dateUtils';
import { TASK_PRIORITIES } from '../utils/moduleStatuses';
import type { FollowUpRow, FollowUpCompletionBody } from '../api/salesFollowUp';

/**
 * Finishing one sales follow-up.
 *
 * Not the ordinary «انجام شد» tick, and deliberately so: a follow-up that is
 * merely ticked leaves the quotation with nobody on it and nothing recorded
 * about why. So the modal asks three things — what the customer said, any note,
 * and **what happens next** — and the last one is not optional.
 *
 * The four answers are the four things that can actually be true. Either there
 * is a next step, or the customer asked to be left until a date, or the chase
 * is being given up, or the sale itself is already over. That fourth one is
 * offered only when the proforma's derived outcome says so: closing a live
 * quotation with no next step is exactly the hole this screen exists to close.
 */

interface Props {
  row: FollowUpRow;
  /** From `settings.dropdownItems.followUpResults`, editable in Settings. */
  resultOptions: string[];
  /** Names for the assignee picker — the project's sales expert leads. */
  userNames: string[];
  /** True when the proforma's outcome is already won, lost or cancelled. */
  outcomeIsTerminal: boolean;
  /** `settings.lossReasons`, asked for only when a document is marked lost. */
  lossReasons: string[];
  onClose: () => void;
  onSubmit: (body: FollowUpCompletionBody) => Promise<void>;
  /** «اولویت», from `settings.dropdownItems.taskPriorities`. */
  priorityOptions?: string[];
  /**
   * Editing a follow-up that has already been recorded, rather than recording
   * one.
   *
   * A follow-up and an ordinary task are different things, so «ویرایش» on one
   * opens the form it was filled in on. What that form shows depends on
   * whether the chase is closed:
   *
   *  * **open** — no call has happened, so there is no result to correct. What
   *    is editable is the chase *itself*: what it is for, when it is due, whose
   *    it is, how urgent. Opening a blank completion form for that is what
   *    «فرم خام» meant.
   *  * **closed** — everything that was recorded, in one place: the chase's own
   *    fields, what the customer said, and the next action it raised. A person
   *    filled all of that in through one form and expects to correct it through
   *    the same one; that the system keeps it as two task rows is not their
   *    problem.
   *
   * What is deliberately *not* re-offered is the decision block, the deferral
   * and the settlement question. Those already happened — the task is closed,
   * the proforma's follow-up state moved, the replacement exists and the sale
   * may be settled — and answering any of them again would raise a second next
   * action or re-date a sale the customer-value ranking counts from. Editing
   * writes fields; it never re-runs the completion.
   */
  editing?: {
    taskId: string;
    closed: boolean;
    followUpResult: string;
    completionNote: string;
    /** The chase itself. */
    title: string;
    description: string;
    dueDate: string;
    assignee: string;
    priority: string;
    /** The replacement it raised, when one is still open. */
    next?: {
      taskId: string;
      title: string;
      description: string;
      dueDate: string;
      assignee: string;
      priority: string;
    } | null;
  } | null;
  /**
   * Saves an edit. One callback rather than three, because which rows are
   * written depends on the mode and that decision belongs to the screen that
   * owns them, not to the form.
   */
  onSaveEdits?: (body: {
    followUpResult: string;
    completionNote: string;
    action: {
      title: string; description: string; dueDate: string;
      assignedToName: string; priority: string;
    };
    next?: {
      taskId: string; title: string; description: string; dueDate: string;
      assignedToName: string; priority: string;
    };
  }) => Promise<void>;
}

const DECISIONS: { value: FollowUpDecision; label: string; hint: string; icon: typeof CheckCircle2 }[] = [
  {
    value: 'NEXT_ACTION', label: 'اقدام بعدی ثبت شود',
    hint: 'پیگیری بعدی با تاریخ و مسئول مشخص ساخته می‌شود و پیش‌فاکتور در حال پیگیری می‌ماند.',
    icon: CheckCircle2,
  },
  {
    value: 'DEFER', label: 'موکول به تاریخ دیگر',
    hint: 'مشتری تصمیم خرید را عقب انداخته است؛ تا آن تاریخ در فهرست عقب‌افتاده‌ها دیده نمی‌شود.',
    icon: CalendarClock,
  },
  {
    value: 'NO_RESPONSE', label: 'بستن پیگیری به دلیل عدم پاسخ',
    hint: 'پیگیری بسته می‌شود؛ وضعیت تجاری پیش‌فاکتور تغییری نمی‌کند و بعداً قابل فعال‌سازی مجدد است.',
    icon: PhoneOff,
  },
  {
    value: 'TERMINAL', label: 'بدون اقدام بعدی (نتیجه نهایی مشخص است)',
    hint: 'وقتی نتیجه نهایی پیش‌فاکتور مشخص است — چه قبلاً ثبت شده باشد و چه همین‌جا ثبتش کنید.',
    icon: AlertTriangle,
  },
];

export default function FollowUpCompletionModal({
  row, resultOptions, userNames, outcomeIsTerminal, lossReasons, onClose, onSubmit,
  priorityOptions, editing = null, onSaveEdits,
}: Props) {
  /** Editing what was recorded, rather than recording a completion. */
  const isEditing = !!editing;
  /** A closed chase: the whole record, including the next action it raised. */
  const isCorrecting = editing?.closed === true;
  /** An open chase: its own fields only — no call has happened yet. */
  const isEditingAction = isEditing && !isCorrecting;
  const priorities = priorityOptions?.length ? priorityOptions : [...TASK_PRIORITIES];
  const today = getTodayShamsi();

  const [decision, setDecision] = useState<FollowUpDecision>('NEXT_ACTION');
  const [followUpResult, setFollowUpResult] = useState('');
  const [completionNote, setCompletionNote] = useState('');
  /*
   * Two groups, because a closed chase shows both at once.
   *
   * `action*` is the chase being looked at; `next*` is the one that follows it.
   * Completing, only `next*` is used (there is no other chase to edit);
   * editing an open one, only `action*` (there is no next action yet).
   */
  const [actionTitle, setActionTitle] = useState('');
  const [actionDescription, setActionDescription] = useState('');
  const [actionDueDate, setActionDueDate] = useState(today);
  const [actionAssignee, setActionAssignee] = useState('');
  const [actionPriority, setActionPriority] = useState('متوسط');

  const [nextTitle, setNextTitle] = useState(`پیگیری پیش‌فاکتور ${row.proformaNumber}`);
  const [nextDescription, setNextDescription] = useState('');
  const [nextDueDate, setNextDueDate] = useState(addDaysToShamsi(today, 3));
  const [nextAssignee, setNextAssignee] = useState(row.salesExpert ?? '');
  const [nextPriority, setNextPriority] = useState('متوسط');
  const [deferredUntil, setDeferredUntil] = useState(addDaysToShamsi(today, 14));
  /*
   * Whether to also write the commercial outcome, and which.
   *
   * `null` is «only record what the customer said», which stays the default
   * however decisive the result sounds — the screen asks, it does not decide.
   */
  const [settleOutcome, setSettleOutcome] = useState<SettleOutcome | null>(null);
  const [settleLossReason, setSettleLossReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Seeded once per follow-up, keyed on the task.
   *
   * The screen behind this modal re-renders on its own — a list revalidates, a
   * badge poll returns — and an effect that re-seeds from a prop would wipe a
   * half-typed note every time. Same family as the price calculator.
   */
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    /*
      Keyed on the task being *worked on*. Correcting a closed chase, the row's
      `nextActionTaskId` is a different task — the replacement that was raised
      — so seeding on it would re-seed as soon as that one moved.
    */
    const key = editing?.taskId ?? row.nextActionTaskId;
    if (seededFor.current === key) return;
    seededFor.current = key;
    setDecision('NEXT_ACTION');
    setFollowUpResult(editing?.followUpResult ?? '');
    setCompletionNote(editing?.completionNote ?? '');
    /*
      The chase itself, whenever there is one to look at. Completing, there is
      nothing here to edit — the chase is being closed, not changed.
    */
    setActionTitle(editing?.title ?? '');
    setActionDescription(editing?.description ?? '');
    setActionDueDate(editing?.dueDate || getTodayShamsi());
    setActionAssignee(editing?.assignee ?? '');
    setActionPriority(editing?.priority || 'متوسط');

    /*
      The next action. Editing a closed chase it is the replacement that was
      raised — real, with real values — and completing one it is the task about
      to be created, which starts from the usual defaults.
    */
    setNextTitle(editing?.next?.title ?? `پیگیری پیش‌فاکتور ${row.proformaNumber}`);
    setNextDescription(editing?.next?.description ?? '');
    setNextDueDate(editing?.next?.dueDate || addDaysToShamsi(getTodayShamsi(), 3));
    setNextAssignee(editing?.next?.assignee ?? row.salesExpert ?? '');
    setNextPriority(editing?.next?.priority || 'متوسط');
    setDeferredUntil(addDaysToShamsi(getTodayShamsi(), 14));
    setSettleOutcome(null);
    setSettleLossReason('');
    setError(null);
  }, [row.nextActionTaskId, row.proformaNumber, row.salesExpert, editing]);

  const options = resultOptions.length > 0 ? resultOptions : DEFAULT_FOLLOW_UP_RESULTS;

  const body: FollowUpCompletionBody = {
    decision,
    followUpResult,
    completionNote: completionNote || undefined,
    nextTitle: decision === 'NEXT_ACTION' ? nextTitle : undefined,
    /*
      Sent even when empty, and only for this decision.

      An empty box is a person saying there is nothing more to add, which the
      server must not confuse with the field being absent — that means «old
      caller», and keeps carrying the completion note onto the next task.
    */
    nextDescription: decision === 'NEXT_ACTION' ? nextDescription : undefined,
    nextDueDate: decision === 'NEXT_ACTION' ? nextDueDate : undefined,
    nextAssignedToName: decision === 'NEXT_ACTION' ? (nextAssignee || undefined) : undefined,
    /*
      The next chase's own urgency, rather than inheriting this one's.

      Every follow-up used to take the priority of the one it replaced, so a
      quotation first chased as «فوری» raised «فوری» tasks for ever and one
      raised as «پایین» never became more urgent however long it sat.
    */
    nextPriority: decision === 'NEXT_ACTION' ? nextPriority : undefined,
    deferredUntil: decision === 'DEFER' ? deferredUntil : undefined,
    settleOutcome: settleOutcome ?? undefined,
    settleLossReason: settleOutcome === 'LOST' ? (settleLossReason || undefined) : undefined,
  };

  /** What this result implies, if anything. A suggestion — see the block below. */
  const suggested = impliedSettlement(followUpResult);

  // The same pure rule the server runs, so the button cannot submit what the
  // server would refuse — and the server does not trust that it did not.
  /*
    Editing asks the form for what it is showing, and the completion's own
    rules are about a decision, a date and an outcome — none of which is being
    taken again.
  */
  const editRefusal = !isEditing ? null
    : !actionTitle.trim() ? 'عنوان اقدام الزامی است.'
      : !actionDueDate.trim() ? 'تاریخ اقدام الزامی است.'
        : isCorrecting && !followUpResult.trim() ? 'ثبت نتیجه پیگیری الزامی است.'
          : editing?.next && !nextTitle.trim() ? 'عنوان اقدام بعدی الزامی است.'
            : editing?.next && !nextDueDate.trim() ? 'تاریخ اقدام بعدی الزامی است.'
              : null;

  const refusal = isEditing
    ? editRefusal
    : completionRefusalReason(body, { todayJalali: today, outcomeIsTerminal });

  const submit = async () => {
    if (refusal) { setError(refusal); return; }
    setSaving(true);
    setError(null);
    try {
      if (isEditing) {
        await onSaveEdits?.({
          followUpResult,
          completionNote,
          action: {
            title: actionTitle,
            description: actionDescription,
            dueDate: actionDueDate,
            assignedToName: actionAssignee,
            priority: actionPriority,
          },
          /*
            Only when the chase actually raised one that is still open. There
            is nothing to write otherwise, and inventing a next action from an
            empty form is how a second one comes to exist.
          */
          next: editing?.next
            ? {
                taskId: editing.next.taskId,
                title: nextTitle,
                description: nextDescription,
                dueDate: nextDueDate,
                assignedToName: nextAssignee,
                priority: nextPriority,
              }
            : undefined,
        });
      } else await onSubmit(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ثبت نتیجه پیگیری با خطا مواجه شد.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      dir="rtl"
      id="follow-up-completion-modal"
    >
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800">
              {isEditingAction ? 'ویرایش اقدام پیگیری'
                : isCorrecting ? 'ویرایش نتیجه پیگیری'
                : 'ثبت نتیجه پیگیری'}
            </h3>
            <p className="text-[11px] text-slate-500 mt-1">
              <span className="font-mono font-bold">{row.proformaNumber}</span>
              {row.customerName ? ` — ${row.customerName}` : ''}
              {row.nextAction ? ` — ${row.nextAction}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/*
            The chase itself, first, because it is what the reader pressed
            «ویرایش» on. Shown whenever there is one to look at — an open chase
            has nothing but this, and a closed one has this above what came of
            it.
          */}
          {isEditing && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-white border border-slate-200 rounded-xl p-3">
              <div className="md:col-span-3 flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
                <CheckCircle2 size={12} className="text-sky-500" />
                {isCorrecting ? 'اقدام انجام‌شده' : 'اقدام پیگیری'}
              </div>
              <div className="md:col-span-3">
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  عنوان اقدام <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={actionTitle}
                  onChange={(e) => setActionTitle(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-xs bg-white"
                  id="follow-up-action-title"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[11px] font-bold text-slate-600 mb-1">شرح اقدام</label>
                <textarea
                  value={actionDescription}
                  onChange={(e) => setActionDescription(e.target.value)}
                  rows={2}
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-xs bg-white focus:outline-none focus:border-sky-400"
                  id="follow-up-action-description"
                />
              </div>
              <div>
                <ShamsiDatePicker
                  label="تاریخ اقدام"
                  value={actionDueDate}
                  onChange={setActionDueDate}
                  required
                  compact
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">مسئول</label>
                <SearchableSelect
                  value={actionAssignee}
                  onChange={setActionAssignee}
                  options={userNames.map((n) => ({ value: n, label: n }))}
                  placeholder="مسئول پیگیری"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">اولویت</label>
                <select
                  value={actionPriority}
                  onChange={(e) => setActionPriority(e.target.value)}
                  id="follow-up-action-priority"
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-xs bg-white"
                >
                  {priorities.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          )}

          {/*
            Editing an open chase records nothing: there has been no call yet,
            and a result box on a form for «what should be done next» is what
            made this read as a blank completion form.
          */}
          {!isEditingAction && (
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">
              نتیجه پیگیری <span className="text-rose-500">*</span>
            </label>
            <SearchableSelect
              value={followUpResult}
              onChange={setFollowUpResult}
              options={options.map((o) => ({ value: o, label: o }))}
              placeholder="-- انتخاب کنید --"
              required
            />
            <p className="text-[10px] text-slate-400 mt-1">
              این فهرست در تنظیمات قابل ویرایش است و «دلیل باخت» نیست.
            </p>
          </div>
          )}

          {/*
            The question, asked only when the result actually implies an
            outcome and the document is not already settled.

            It is a question and not an action: «تأیید نهایی خرید» on the phone
            can still mean two lines out of five, and only the person on the
            call knows. Declining leaves the proforma exactly as it was, which
            is what happened before this existed.
          */}
          {suggested && !outcomeIsTerminal && !isEditing && (
            <div className="border border-sky-200 bg-sky-50/70 rounded-xl p-3.5 space-y-2.5">
              <p className="text-[11px] font-bold text-sky-900 leading-relaxed">
                این نتیجه یعنی تکلیف پیش‌فاکتور روشن شده. وضعیت تجاری آن را هم به
                «{SETTLE_OUTCOME_LABELS[suggested]}» تغییر می‌دهید؟
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSettleOutcome(suggested)}
                  id="follow-up-settle-yes"
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition ${
                    settleOutcome
                      ? 'bg-sky-500 text-white border-sky-500'
                      : 'bg-white text-sky-700 border-sky-300 hover:bg-sky-100'
                  }`}
                >
                  بله، وضعیت را به‌روز کن
                </button>
                <button
                  type="button"
                  onClick={() => { setSettleOutcome(null); setSettleLossReason(''); }}
                  id="follow-up-settle-no"
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition ${
                    settleOutcome
                      ? 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                      : 'bg-slate-700 text-white border-slate-700'
                  }`}
                >
                  نه، فقط نتیجه ثبت شود
                </button>
              </div>

              {settleOutcome && (
                <div className="space-y-2 pt-1">
                  {/*
                    The suggestion is a starting point, not the answer: a call
                    that ended in «باخت» may have been recorded under a result
                    that suggests cancellation, and the person can correct it
                    here without going back.
                  */}
                  <div className="flex flex-wrap gap-1.5">
                    {SETTLE_OUTCOMES.map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() => setSettleOutcome(o)}
                        id={`follow-up-settle-${o}`}
                        className={`px-2.5 py-1 rounded-md text-[10px] font-bold border transition ${
                          settleOutcome === o
                            ? 'bg-sky-600 text-white border-sky-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {SETTLE_OUTCOME_LABELS[o]}
                      </button>
                    ))}
                  </div>

                  {/*
                    Required, not optional. The project's own loss reason is
                    derived from these lines and is no longer typed on the
                    project form, so a document settled as «باخته» with this
                    blank is a lost job nothing can explain.
                  */}
                  {settleOutcome === 'LOST' && (
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 mb-1">
                        دلیل باخت <span className="text-rose-500">*</span>
                      </label>
                      <SearchableSelect
                        value={settleLossReason}
                        onChange={setSettleLossReason}
                        options={lossReasons.map((r) => ({ value: r, label: r }))}
                        placeholder="-- انتخاب کنید --"
                        required
                      />
                      <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                        همین دلیل، دلیل باخت پروژه هم می‌شود.
                      </p>
                    </div>
                  )}

                  <p className="text-[10px] text-sky-800/80 leading-relaxed">
                    همه ردیف‌های این پیش‌فاکتور «{SETTLE_OUTCOME_LABELS[settleOutcome]}» می‌شوند و
                    وضعیت پروژه دوباره محاسبه می‌شود. اگر بخشی از اقلام برنده شده، به‌جای این از
                    «ثبت نتیجه اقلام» در خود پیش‌فاکتور استفاده کنید.
                  </p>
                </div>
              )}
            </div>
          )}

          {!isEditingAction && (
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">یادداشت</label>
            <textarea
              value={completionNote}
              onChange={(e) => setCompletionNote(e.target.value)}
              rows={3}
              placeholder="خلاصه گفت‌وگو با مشتری…"
              className="w-full border border-slate-200 rounded-xl p-3 text-xs focus:outline-none focus:border-sky-400"
              id="follow-up-note"
            />
          </div>
          )}

          {/*
            «مرحله بعد چه باشد؟» is not a question that can be re-answered.

            Correcting a closed chase, the next action already exists as its own
            task, on its own card, with its own edit box — one record to change
            rather than two that would then disagree.
          */}
          {isCorrecting && (
            <p className="text-[10px] text-slate-500 bg-slate-50 border border-slate-150 rounded-xl p-2.5 leading-relaxed">
              {editing?.next
                ? 'این پیگیری قبلاً ثبت شده است. اقدام انجام‌شده، نتیجه و اقدام بعدی همگی اینجا قابل ویرایش‌اند.'
                : 'این پیگیری قبلاً ثبت شده و اقدام بعدی بازی ندارد؛ اقدام انجام‌شده و نتیجه‌ی آن قابل ویرایش است.'}
              {' '}تصمیم پیگیری، تعیین وضعیت تجاری و ساخت اقدام بعدیِ تازه دوباره انجام نمی‌شود.
            </p>
          )}

          {isEditingAction && (
            <p className="text-[10px] text-slate-500 bg-slate-50 border border-slate-150 rounded-xl p-2.5 leading-relaxed">
              این پیگیری هنوز باز است و نتیجه‌ای برایش ثبت نشده. اینجا خودِ اقدام ویرایش می‌شود؛
              برای ثبت نتیجه، روی همین کارت دکمهٔ تیک را بزنید.
            </p>
          )}

          {!isEditing && (
          <div>
            <span className="block text-[11px] font-bold text-slate-600 mb-2">
              مرحله بعد چه باشد؟ <span className="text-rose-500">*</span>
            </span>
            <div className="grid grid-cols-1 gap-2">
              {DECISIONS.map((d) => {
                // Closing a live quotation with nothing planned is the hole this
                // screen exists to close, so the option is not merely hidden —
                // it is shown, disabled, with the reason.
                /*
                 * Settling the outcome here counts as settling it. The option
                 * used to be greyed out at exactly the moment it was wanted —
                 * the call where the customer confirms the purchase is the call
                 * after which no next action is needed.
                 */
                const disabled = d.value === 'TERMINAL' && !outcomeIsTerminal && !settleOutcome;
                return (
                  <button
                    key={d.value}
                    type="button"
                    disabled={disabled}
                    onClick={() => setDecision(d.value)}
                    id={`follow-up-decision-${d.value}`}
                    className={`text-right p-3 rounded-xl border transition ${
                      decision === d.value
                        ? 'border-sky-400 bg-sky-50/70'
                        : 'border-slate-200 hover:bg-slate-50'
                    } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                      <d.icon size={13} />
                      {d.label}
                    </span>
                    <span className="block text-[10px] text-slate-500 mt-1 leading-relaxed">{d.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>
          )}

          {((isCorrecting && !!editing?.next) || (!isEditing && decision === 'NEXT_ACTION')) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-50 border border-slate-100 rounded-xl p-3">
              {isCorrecting && (
                <div className="md:col-span-3 flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
                  <CalendarClock size={12} className="text-sky-500" />
                  اقدام بعدی
                </div>
              )}
              <div className="md:col-span-3">
                <label className="block text-[11px] font-bold text-slate-600 mb-1">عنوان اقدام بعدی</label>
                <input
                  type="text"
                  value={nextTitle}
                  onChange={(e) => setNextTitle(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-xs bg-white"
                  id="next-action-title"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  شرح اقدام بعدی
                </label>
                <textarea
                  value={nextDescription}
                  onChange={(e) => setNextDescription(e.target.value)}
                  rows={2}
                  placeholder="دقیقاً چه کاری باید انجام شود…"
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-xs bg-white focus:outline-none focus:border-sky-400"
                  id="next-action-description"
                />
              </div>
              <div>
                <ShamsiDatePicker
                  label="تاریخ اقدام بعدی"
                  value={nextDueDate}
                  onChange={setNextDueDate}
                  required
                  compact
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">مسئول پیگیری</label>
                <SearchableSelect
                  value={nextAssignee}
                  onChange={setNextAssignee}
                  options={userNames.map((n) => ({ value: n, label: n }))}
                  placeholder="کارشناس فروش پروژه"
                />
              </div>
              {/*
                Its own urgency, not this chase's. Inheriting meant a quotation
                first chased as «فوری» raised «فوری» tasks for ever.
              */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">اولویت</label>
                <select
                  value={nextPriority}
                  onChange={(e) => setNextPriority(e.target.value)}
                  id="next-action-priority"
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-xs bg-white"
                >
                  {priorities.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          )}

          {!isEditing && decision === 'DEFER' && (
            <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
              <ShamsiDatePicker
                label="پیگیری مجدد در تاریخ"
                value={deferredUntil}
                onChange={setDeferredUntil}
                required
                compact
              />
              <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                یک پیگیری برای همان تاریخ ساخته می‌شود و تا آن روز این پیش‌فاکتور در «عقب‌افتاده» دیده نمی‌شود.
              </p>
            </div>
          )}

          {(error || refusal) && (
            <div className="bg-rose-50 border border-rose-100 text-rose-600 text-[11px] font-bold rounded-xl p-3 flex items-center gap-1.5">
              <AlertTriangle size={13} />
              {error ?? refusal}
            </div>
          )}
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-lg transition"
          >
            انصراف
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving || !!refusal}
            id="follow-up-submit"
            className="px-5 py-2 text-xs font-bold bg-sky-500 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition"
          >
            {saving ? 'در حال ثبت…' : isEditing ? 'ثبت ویرایش' : 'ثبت نتیجه'}
          </button>
        </div>
      </div>
    </div>
  );
}
