import { DETAIL_LABELS } from '../utils/cardSummary';
import { useEffect, useRef, useState } from 'react';
import { AtSign, CalendarPlus, Link2, X } from 'lucide-react';
import ShamsiDatePicker from './ShamsiDatePicker';
import { useUserDirectory } from '../api/useUserDirectory';
import { projectsApi } from '../api/projects';
import { getTodayShamsi } from '../dateUtils';
import {
  NextActionDraft, NextActionSource, nextActionDraft, nextActionRefusal,
} from '../utils/nextAction';
import {
  EMPTY_REFERRAL_DRAFT, NextActionReferralDraft, ReferralCategoryChoice,
  defaultReferralCategory, referralCategoryChoices, referralDraftRefusal,
} from '../utils/nextActionReferral';
import { categoryContext } from '../utils/categoryContext';
import type { NextActionReferralSubmit } from '../utils/useNextAction';

/** A project's category groups, as the referral half needs to see them. */
type GroupRow = { id: string; categoryId: string; categoryName: string };

/**
 * «اقدام بعدی» — one form, opened after a save on whichever screen made it.
 *
 * There is deliberately **one** of these rather than a block on each screen: a
 * next action is one shape of thing, and ten copies of the form would be ten
 * answers to what it inherits from the record it follows. The rules are pure in
 * `src/utils/nextAction.ts` and this draws them.
 *
 * It writes nothing itself — `useNextAction` does, after the host's own save
 * has landed. Same division as `ProductConfiguratorModal`, which builds a
 * mutation and lets its host save it.
 */
export default function NextActionModal({
  source,
  kinds,
  people,
  saving,
  error,
  onSubmit,
  onClose,
  colleagues = [],
  categories = [],
  loadGroups,
}: {
  /** The record just saved. Null means the question is not being asked. */
  source: NextActionSource | null;
  /** `settings.dropdownItems.nextActionKinds`, the company's own list. */
  kinds: readonly string[];
  /** The assignment picker's names; whoever pressed save leads. */
  people: readonly string[];
  saving?: boolean;
  /** Reported by the host, because the host is what writes. */
  error?: string | null;
  /**
   * Either half may be null: the person may raise only their own next action,
   * only a referral, or both.
   */
  onSubmit: (draft: NextActionDraft | null, referral: NextActionReferralSubmit | null) => void;
  onClose: () => void;
  /** Who can be referred to; ids, because the referral belongs to an account. */
  colleagues?: readonly { id: string; fullName: string }[];
  /** `settings.activityCategories` — what a category not yet opened can be. */
  categories?: readonly { id: string; name: string }[];
  /** The project's opened categories. Injected so a render test needs no server. */
  loadGroups?: (projectId: string) => Promise<GroupRow[]>;
}) {
  const [draft, setDraft] = useState<NextActionDraft>(
    () => nextActionDraft(
      source ?? { relatedToType: '', relatedToId: '', relatedToName: '' },
      getTodayShamsi()));
  const [refusal, setRefusal] = useState<string | null>(null);
  /*
   * The two halves are each switched on separately.
   *
   * The next action starts on, because that is what the button is called; the
   * referral starts off, because handing work to somebody else is a decision
   * and not a default.
   */
  const [withTask, setWithTask] = useState(true);
  const [withReferral, setWithReferral] = useState(false);
  const [referral, setReferral] = useState<NextActionReferralDraft>(EMPTY_REFERRAL_DRAFT);
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [groupsError, setGroupsError] = useState<string | null>(null);

  /*
   * Seeded on the record it is about, and never on the object prop itself.
   *
   * `source` is built inline by the screen behind this, and those screens
   * re-render on their own (the badge poll, any live-data event), so an effect
   * watching the object would re-seed a half-typed form every time. The id is
   * read through a ref for the same reason: it decides *when* to seed without
   * making the values a dependency.
   */
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const key = `${source?.relatedToType ?? ''}:${source?.relatedToId ?? ''}`;
  useEffect(() => {
    if (!sourceRef.current) return;
    setDraft(nextActionDraft(sourceRef.current, getTodayShamsi()));
    setRefusal(null);
    setWithTask(true);
    setWithReferral(false);
    setReferral(EMPTY_REFERRAL_DRAFT);
    setGroups(null);
    setGroupsError(null);
  }, [key]);

  /*
   * The project's categories are read only once a referral is asked for: most
   * next actions never refer anybody, and the read needs the projects
   * permission, which a refusal here must not turn into a broken form.
   */
  const projectId = source?.projectId || '';
  const loadRef = useRef(loadGroups);
  loadRef.current = loadGroups;
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;
  useEffect(() => {
    if (!withReferral || !projectId || groups !== null) return;
    let cancelled = false;
    const load = loadRef.current
      ?? ((id: string) => projectsApi.categoryGroups(id) as Promise<GroupRow[]>);
    load(projectId)
      .then((rows) => {
        if (cancelled) return;
        setGroups(rows);
        const choices = referralCategoryChoices(rows, categoriesRef.current);
        const chosen = defaultReferralCategory(
          choices, sourceRef.current?.module, projectId, categoryContext());
        setReferral((r) => (r.categoryId ? r : { ...r, categoryId: chosen }));
      })
      .catch((err) => {
        if (cancelled) return;
        setGroups([]);
        setGroupsError(err instanceof Error ? err.message : 'دسته‌بندی‌های پروژه خوانده نشد.');
      });
    return () => { cancelled = true; };
  }, [withReferral, projectId, groups]);

  if (!source) return null;

  const choices: ReferralCategoryChoice[] = referralCategoryChoices(groups ?? [], categories);
  const canRefer = Boolean(projectId);
  // Whoever pressed save is not offered: a referral to yourself is what the
  // next action above already is.
  const self = String(source.assignedTo ?? '').trim();
  const offered = colleagues.filter((c) => c.fullName !== self);

  const submit = () => {
    const referring = canRefer && withReferral;
    let why: string | null = null;
    if (!withTask && !referring) why = 'اقدام بعدی یا ارجاع به همکار را انتخاب کنید.';
    if (!why && withTask) why = nextActionRefusal(draft);
    if (!why && referring) why = groupsError ?? referralDraftRefusal(referral);
    const choice = choices.find((c) => c.categoryId === referral.categoryId);
    if (!why && referring && !choice) why = 'دسته‌بندی فعالیت ارجاع را انتخاب کنید.';
    setRefusal(why);
    if (why) return;
    onSubmit(
      withTask ? draft : null,
      referring && choice
        ? {
            draft: referral,
            choice,
            names: referral.userIds
              .map((id) => colleagues.find((c) => c.id === id)?.fullName)
              .filter((n): n is string => Boolean(n)),
          }
        : null,
    );
  };

  const toggleColleague = (id: string) => setReferral((r) => ({
    ...r,
    userIds: r.userIds.includes(id) ? r.userIds.filter((u) => u !== id) : [...r.userIds, id],
  }));

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[1200]" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
              <CalendarPlus size={16} />
            </div>
            <div className="text-right">
              <span className="text-sm font-bold text-slate-800 block">ثبت اقدام بعدی</span>
              <span className="text-[10px] text-slate-500 block">
                رکورد ذخیره شد؛ کار بعدی خودتان یا ارجاع به همکار را ثبت کنید.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 text-slate-500 rounded-lg transition"
            title="بستن"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/*
            The record it belongs to is carried, not re-picked: the next action
            is about the thing that was just saved, and asking again is the
            commonest reason a form like this is abandoned half way. It is shown
            rather than offered, because changing it would make this a second
            task form.
          */}
          <div className="flex items-center gap-2 text-[11px] bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <Link2 size={12} className="text-slate-400 shrink-0" />
            <span className="text-slate-500">{source.relatedToType}:</span>
            <span className="font-bold text-slate-700 break-words">
              {source.relatedToName || '—'}
            </span>
          </div>

          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={withTask}
              onChange={(e) => setWithTask(e.target.checked)}
              data-next-action-with-task
            />
            اقدام بعدی برای خودم
          </label>

          {withTask && (<>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600">
              نوع اقدام <span className="text-rose-500">*</span>
            </label>
            <select
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
              data-next-action-kind
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            >
              <option value="">انتخاب کنید…</option>
              {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            {/*
              An empty list is «not configured», not «no kinds exist», and saying
              so beats a dropdown that opens onto nothing.
            */}
            {kinds.length === 0 && (
              <p className="text-[10px] text-amber-700">
                فهرست «انواع اقدام بعدی» خالی است — در تنظیمات ← لیست‌های کشویی تعریفش کنید.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600">{DETAIL_LABELS.description}</label>
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={3}
              data-next-action-description
              placeholder="مثلاً: قیمت رقیب را بگیر و ۵٪ تخفیف پیشنهاد کن"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 resize-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ShamsiDatePicker
              label="تاریخ اقدام بعدی"
              required
              value={draft.dueDate}
              onChange={(v) => setDraft({ ...draft, dueDate: v })}
            />
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600">اولویت</label>
              <select
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
                data-next-action-priority
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              >
                {['پایین', 'متوسط', 'بالا', 'فوری'].map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600">مسئول</label>
            <select
              value={draft.assignedTo}
              onChange={(e) => setDraft({ ...draft, assignedTo: e.target.value })}
              data-next-action-assignee
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            >
              {/*
                «Nobody» is a real answer — the task form's «شخصی (بدون ارجاع)» —
                and `assigneeColumns` reads an empty name as deliberate rather
                than looking it up.
              */}
              <option value="">شخصی (بدون ارجاع)</option>
              {people.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          </>)}

          {/*
            «ارجاع به همکار» — the same project, under one of its activity
            categories, landing on the colleague's own board.

            Drawn only for a record that belongs to a project: a referral is a
            message in a project's feed, so a customer or a product has nowhere
            to file one, and a section that could only ever be refused is worse
            than none.
          */}
          {canRefer && (
            <div className="border-t border-slate-100 pt-4 space-y-3">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={withReferral}
                  onChange={(e) => setWithReferral(e.target.checked)}
                  data-next-action-with-referral
                />
                <AtSign size={13} className="text-sky-600" />
                ارجاع به همکار درباره‌ی همین فعالیت
              </label>

              {withReferral && (
                <div className="space-y-3" data-next-action-referral>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">
                      همکار <span className="text-rose-500">*</span>
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {offered.map((c) => {
                        const on = referral.userIds.includes(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => toggleColleague(c.id)}
                            data-referral-colleague={c.id}
                            aria-pressed={on}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                              on
                                ? 'bg-sky-600 text-white border-sky-600'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-sky-400'
                            }`}
                          >
                            {c.fullName}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">
                      دسته‌بندی فعالیت پروژه <span className="text-rose-500">*</span>
                    </label>
                    {groups === null ? (
                      <p className="text-[11px] text-slate-500">در حال خواندن دسته‌بندی‌های پروژه…</p>
                    ) : groupsError ? (
                      <p className="text-[11px] text-rose-700">{groupsError}</p>
                    ) : (
                      <select
                        value={referral.categoryId}
                        onChange={(e) => setReferral({ ...referral, categoryId: e.target.value })}
                        data-referral-category
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
                      >
                        <option value="">انتخاب کنید…</option>
                        {choices.map((c) => (
                          <option key={c.categoryId} value={c.categoryId}>
                            {c.groupId ? c.categoryName : `${c.categoryName} (روی پروژه باز می‌شود)`}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">
                      متن ارجاع <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      value={referral.text}
                      onChange={(e) => setReferral({ ...referral, text: e.target.value })}
                      rows={3}
                      data-referral-text
                      placeholder="مثلاً: لطفاً دیتاشیت سازنده را بررسی و تأیید کنید"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 resize-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">مهلت</label>
                    <div className="flex flex-wrap gap-3 text-[11px] text-slate-700">
                      {([
                        ['none', 'بدون مهلت'],
                        ['date', 'تا تاریخ'],
                        ['assignee', 'مهلت را ارجاع‌شونده تعیین کند'],
                      ] as const).map(([mode, label]) => (
                        <label key={mode} className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="radio"
                            name="referral-due"
                            checked={referral.dueMode === mode}
                            onChange={() => setReferral({ ...referral, dueMode: mode })}
                            data-referral-due={mode}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    {referral.dueMode === 'date' && (
                      <ShamsiDatePicker
                        label="مهلت ارجاع"
                        required
                        value={referral.dueDate}
                        onChange={(v) => setReferral({ ...referral, dueDate: v })}
                      />
                    )}
                  </div>

                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    به‌صورت یک پیام در فعالیت‌های پروژه ثبت می‌شود و در «وظایف و پیگیری» همکار می‌نشیند.
                  </p>
                </div>
              )}
            </div>
          )}

          {(refusal || error) && (
            <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
              {refusal || error}
            </p>
          )}
        </div>

        <div className="flex gap-2 px-5 py-3.5 border-t border-slate-100">
          <button
            type="button"
            disabled={saving}
            onClick={submit}
            data-next-action-save
            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition"
          >
            {saving ? 'در حال ثبت…' : 'ثبت'}
          </button>
          {/*
            «Not now» and not «cancel»: the record is already saved, so closing
            this abandons the reminder and nothing else. Saying so is the
            difference between a person closing it confidently and one wondering
            whether they have just undone their own save.
          */}
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
          >
            فعلاً نه
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The modal, wired to a `useNextAction()` and to the settings — so a form that
 * offers the button adds one line rather than five.
 *
 * The colleague directory is read here and not by each host: it is a
 * module-scoped cache, so ten screens mounting this is one request, and asking
 * each form to fetch it would be ten chances to forget.
 */
export function NextActionPrompt({
  next,
  kinds,
  categories,
}: {
  next: {
    source: NextActionSource | null;
    saving: boolean;
    error: string | null;
    close: () => void;
    submit: (draft: NextActionDraft | null, referral?: NextActionReferralSubmit | null) => Promise<void>;
  };
  /** `settings.dropdownItems.nextActionKinds`. */
  kinds: readonly string[] | undefined;
  /** `settings.activityCategories`, for a referral under a category not yet opened. */
  categories?: readonly { id: string; name: string }[];
}) {
  const { users } = useUserDirectory();
  const active = users.filter((u) => u.isActive !== false);
  return (
    <NextActionModal
      source={next.source}
      kinds={kinds ?? []}
      people={active.map((u) => u.fullName)}
      colleagues={active}
      categories={categories ?? []}
      saving={next.saving}
      error={next.error}
      onSubmit={(draft, referral) => { void next.submit(draft, referral); }}
      onClose={next.close}
    />
  );
}
