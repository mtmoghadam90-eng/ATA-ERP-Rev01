import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, CheckCircle2, ClipboardList, Clock, FileText, Loader2, MapPin, Paperclip,
  Plus, Search, Trash2, Users, X, AlertTriangle, Lock,
} from 'lucide-react';
import type { User } from '../types';
import ShamsiDatePicker from './ShamsiDatePicker';
import { SearchableSelect } from './SearchableSelect';
import { getTodayShamsi } from '../dateUtils';
import { useList } from '../api/useList';
import { useEntitySearch } from '../api/useEntitySearch';
import { useUserDirectory } from '../api/useUserDirectory';
import { dataChanged } from '../api/liveData';
import type { ProjectRow } from '../api/projects';
import type { CustomerRow } from '../api/customers';
import {
  meetingsApi, type CarryOverItem, type MeetingInput, type MeetingItemInput, type MeetingRow,
} from '../api/meetings';
import {
  MEETING_ITEM_KINDS, MEETING_ITEM_KIND_LABELS, MEETING_ITEM_STATE_LABELS, MEETING_STATUS_LABELS,
  meetingRefusal, type MeetingAssignee, type MeetingItemKind, type MeetingItemState,
  type MeetingParticipant,
} from '../utils/meetingMinutes';
import { formatFileSize, type ActivityAttachment } from '../utils/attachments';

/**
 * «صورتجلسات» — the list, its filters, and the minutes form.
 *
 * One component with two call sites: the module (every meeting this person may
 * see) and a project's own tab (`projectId` fixed, the project filter hidden).
 * A second near-copy for the tab would be two answers to «what does a meeting
 * look like», which is how the two come to disagree.
 */

interface Props {
  currentUser: User | null;
  /** Fixed when drawn inside a project's detail. */
  projectId?: string;
  projectLabel?: string;
  onOpenProject?: (code: string) => void;
}

const STATE_TONE: Record<MeetingItemState, string> = {
  NONE: '',
  PENDING: 'bg-slate-100 text-slate-600',
  OPEN: 'bg-sky-50 text-sky-700',
  OVERDUE: 'bg-rose-50 text-rose-700',
  DONE: 'bg-emerald-50 text-emerald-700',
  CANCELLED: 'bg-slate-100 text-slate-500 line-through',
};

const KIND_TONE: Record<MeetingItemKind, string> = {
  DECISION: 'bg-indigo-50 text-indigo-700',
  ACTION: 'bg-amber-50 text-amber-700',
  INFO: 'bg-slate-100 text-slate-600',
};

export default function MeetingsView({ currentUser, projectId, projectLabel, onOpenProject }: Props) {
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [status, setStatus] = useState('all');
  const [editing, setEditing] = useState<MeetingRow | 'new' | null>(null);

  const filterPicker = useEntitySearch<ProjectRow>({
    path: '/api/projects', limit: 25, params: { withSummary: 'false' },
    getLabel: (row) => `${row.code} — ${row.name}`,
    enabled: !projectId,
  });

  const list = useList<MeetingRow>({
    path: '/api/meetings',
    pageSize: 25,
    sort: 'meetingDate',
    order: 'desc',
    params: {
      project: projectId ?? (projectFilter === 'all' ? undefined : projectFilter),
      from: from || undefined,
      to: to || undefined,
      openActions: openOnly ? 'true' : undefined,
      status: status === 'all' ? undefined : status,
    },
  });

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <ClipboardList size={20} /> صورتجلسات{projectLabel ? ` — ${projectLabel}` : ''}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            اقدام‌های هر صورتجلسه با نهایی شدن آن به وظیفه مسئولش تبدیل می‌شود.
          </p>
        </div>
        <button
          type="button"
          id="meeting-new"
          onClick={() => setEditing('new')}
          className="flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-sm font-bold"
        >
          <Plus size={16} /> صورتجلسه جدید
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            id="meeting-search"
            value={list.search}
            onChange={(e) => list.setSearch(e.target.value)}
            placeholder="جستجو در عنوان، بندها، حاضرین و پروژه..."
            className="w-full pr-9 pl-3 py-2 text-sm border border-slate-200 rounded-lg bg-white dark:bg-slate-900"
          />
        </div>
        {!projectId && (
          <div className="min-w-[220px]">
            <SearchableSelect
              value={projectFilter}
              onChange={setProjectFilter}
              onSearchChange={filterPicker.setTerm}
              loading={filterPicker.loading}
              options={[
                { value: 'all', label: 'همه جلسات' },
                { value: 'internal', label: 'فقط جلسات داخلی (بدون پروژه)' },
                ...filterPicker.matches.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` })),
              ]}
              placeholder="پروژه"
            />
          </div>
        )}
        <div className="w-36"><ShamsiDatePicker value={from} onChange={setFrom} placeholder="از تاریخ" compact /></div>
        <div className="w-36"><ShamsiDatePicker value={to} onChange={setTo} placeholder="تا تاریخ" compact /></div>
        <select
          id="meeting-status-filter"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white dark:bg-slate-900"
        >
          <option value="all">وضعیت: همه</option>
          <option value="DRAFT">{MEETING_STATUS_LABELS.DRAFT}</option>
          <option value="FINAL">{MEETING_STATUS_LABELS.FINAL}</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200 px-2 py-2">
          <input
            type="checkbox"
            id="meeting-open-filter"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.target.checked)}
          />
          دارای اقدام باز
        </label>
      </div>

      {list.error && <div className="text-sm text-rose-600">{list.error}</div>}
      {list.initialLoading ? (
        <div className="flex justify-center py-10 text-slate-400"><Loader2 className="animate-spin" /></div>
      ) : list.rows.length === 0 ? (
        <div className="text-center text-sm text-slate-500 py-10 border border-dashed border-slate-200 rounded-xl">
          صورتجلسه‌ای یافت نشد.
        </div>
      ) : (
        <div className="space-y-2" data-meeting-list>
          {list.rows.map((m) => (
            <button
              type="button"
              key={m.id}
              data-meeting-row={m.id}
              onClick={() => setEditing(m)}
              className="w-full text-right bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 hover:border-sky-300 transition"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-500" dir="ltr">{m.code}</span>
                <span className="font-bold text-slate-800 dark:text-slate-100">{m.title}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${m.status === 'FINAL' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                  {MEETING_STATUS_LABELS[m.status]}
                </span>
                {m.openActionCount > 0 && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                    {m.openActionCount.toLocaleString('fa-IR')} اقدام باز
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-slate-500">
                <span className="flex items-center gap-1"><CalendarDays size={12} /> {m.meetingDateJalali}{m.startTime ? ` ساعت ${m.startTime}` : ''}</span>
                {m.place && <span className="flex items-center gap-1"><MapPin size={12} /> {m.place}</span>}
                <span>
                  {m.projectId ? (
                    <span
                      role="link"
                      className="text-sky-700 hover:underline"
                      onClick={(e) => { e.stopPropagation(); if (m.projectCode) onOpenProject?.(m.projectCode); }}
                    >
                      {m.projectCode} — {m.projectName}
                    </span>
                  ) : 'جلسه داخلی'}
                </span>
                <span className="flex items-center gap-1"><Users size={12} /> {m.attendees.length.toLocaleString('fa-IR')} حاضر</span>
                <span>{m.itemCount.toLocaleString('fa-IR')} بند، {m.actionCount.toLocaleString('fa-IR')} اقدام</span>
              </div>
            </button>
          ))}
          {list.totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 text-sm pt-2">
              <button type="button" disabled={list.page <= 1} onClick={() => list.setPage(list.page - 1)} className="px-3 py-1 border rounded disabled:opacity-40">قبلی</button>
              <span>{list.page.toLocaleString('fa-IR')} از {list.totalPages.toLocaleString('fa-IR')}</span>
              <button type="button" disabled={list.page >= list.totalPages} onClick={() => list.setPage(list.page + 1)} className="px-3 py-1 border rounded disabled:opacity-40">بعدی</button>
            </div>
          )}
        </div>
      )}

      {editing && (
        <MeetingFormModal
          meeting={editing === 'new' ? null : editing}
          currentUser={currentUser}
          fixedProjectId={projectId}
          fixedProjectLabel={projectLabel}
          onClose={() => setEditing(null)}
          onSaved={() => { list.refresh(); }}
        />
      )}
    </div>
  );
}

/* ------------------------------- the form ------------------------------- */

interface FormProps {
  meeting: MeetingRow | null;
  currentUser: User | null;
  fixedProjectId?: string;
  fixedProjectLabel?: string;
  onClose: () => void;
  onSaved: (meeting: MeetingRow) => void;
}

interface ItemDraft extends MeetingItemInput {
  key: string;
  state?: MeetingItemState;
  tasks?: { assigneeName: string; status: string | null }[];
}

let keySeq = 0;
const newKey = () => `item-${++keySeq}`;

export function MeetingFormModal({ meeting, currentUser, fixedProjectId, fixedProjectLabel, onClose, onSaved }: FormProps) {
  const { users } = useUserDirectory();
  const activeUsers = useMemo(() => users.filter((u) => u.isActive !== false), [users]);

  const [loaded, setLoaded] = useState<MeetingRow | null>(meeting);
  const [title, setTitle] = useState(meeting?.title ?? '');
  const [meetingDate, setMeetingDate] = useState(meeting?.meetingDateJalali ?? getTodayShamsi());
  const [startTime, setStartTime] = useState(meeting?.startTime ?? '');
  const [endTime, setEndTime] = useState(meeting?.endTime ?? '');
  const [place, setPlace] = useState(meeting?.place ?? '');
  const [summary, setSummary] = useState(meeting?.summary ?? '');
  const [projectId, setProjectId] = useState<string>(meeting ? (meeting.projectId ?? '') : (fixedProjectId ?? ''));
  const [attendees, setAttendees] = useState<MeetingParticipant[]>(meeting?.attendees ?? (
    currentUser ? [{ kind: 'user', userId: currentUser.id, name: currentUser.fullName }] : []));
  const [absentees, setAbsentees] = useState<MeetingParticipant[]>(meeting?.absentees ?? []);
  const [nextMeetingDate, setNextMeetingDate] = useState(meeting?.nextMeetingDateJalali ?? '');
  const [attachments, setAttachments] = useState<ActivityAttachment[]>(meeting?.attachments ?? []);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [carryOver, setCarryOver] = useState<CarryOverItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const projectPicker = useEntitySearch<ProjectRow>({
    path: '/api/projects', limit: 25, params: { withSummary: 'false' },
    selectedId: projectId || null,
    getLabel: (row) => `${row.code} — ${row.name}`,
    enabled: !fixedProjectId,
  });

  /*
   * The detail record, read when the form opens — the list row carries the
   * items too, but a row fetched minutes ago may predate a task being ticked,
   * and the state beside each action is the point of reopening finished
   * minutes. Keyed on the id, never on the object, so a re-render behind the
   * modal cannot re-seed what is being typed.
   */
  const meetingId = meeting?.id ?? null;
  useEffect(() => {
    const fromRow = (m: MeetingRow) => setItems((m.items ?? []).map((i) => ({
      key: newKey(), id: i.id, text: i.text, kind: i.kind, assignees: i.assignees,
      dueDate: i.dueDateJalali, state: i.state,
      tasks: i.tasks.map((t) => ({ assigneeName: t.assigneeName, status: t.status })),
    })));
    if (!meetingId) { setItems([]); return; }
    if (meeting) fromRow(meeting);
    let live = true;
    meetingsApi.get(meetingId).then(({ meeting: fresh }) => {
      if (!live) return;
      setLoaded(fresh);
      fromRow(fresh);
    }).catch(() => undefined);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  // The open actions of this project's earlier meetings.
  useEffect(() => {
    if (!projectId) { setCarryOver([]); return; }
    let live = true;
    meetingsApi.openActions(projectId, meetingId).then(({ items: open }) => {
      if (live) setCarryOver(open);
    }).catch(() => { if (live) setCarryOver([]); });
    return () => { live = false; };
  }, [projectId, meetingId]);

  const isFinal = loaded?.status === 'FINAL';
  const readOnly = !!loaded && !loaded.canEdit;

  const updateItem = (key: string, patch: Partial<ItemDraft>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const addItem = (kind: MeetingItemKind = 'DECISION', text = '') =>
    setItems((prev) => [...prev, { key: newKey(), text, kind, assignees: [], dueDate: null }]);

  const toInput = (finalize: boolean): MeetingInput => ({
    title, meetingDate,
    startTime: startTime || null, endTime: endTime || null,
    place: place || null, summary: summary || null,
    projectId: projectId || null,
    attendees, absentees,
    nextMeetingDate: nextMeetingDate || null,
    attachments,
    items: items.map((i) => ({
      id: i.id ?? null, text: i.text, kind: i.kind,
      assignees: i.kind === 'ACTION' ? i.assignees : [],
      dueDate: i.kind === 'ACTION' ? (i.dueDate ?? null) : null,
    })),
    finalize,
  });

  const save = async (finalize: boolean) => {
    const input = toInput(finalize);
    const refusal = meetingRefusal({
      title: input.title, meetingDateJalali: input.meetingDate,
      items: input.items.map((i) => ({ ...i, dueDateJalali: i.dueDate ?? null })),
    }, finalize || isFinal);
    if (refusal) { setError(refusal); return; }
    setBusy(true); setError(null);
    try {
      const result = loaded
        ? await meetingsApi.update(loaded.id, input)
        : await meetingsApi.create(input);
      if (result.createdTasks > 0 || result.cancelledTasks > 0) dataChanged('tasks');
      onSaved(result.meeting);
      setLoaded(result.meeting);
      setItems((result.meeting.items ?? []).map((i) => ({
        key: newKey(), id: i.id, text: i.text, kind: i.kind, assignees: i.assignees,
        dueDate: i.dueDateJalali, state: i.state,
        tasks: i.tasks.map((t) => ({ assigneeName: t.assigneeName, status: t.status })),
      })));
      const parts: string[] = ['صورتجلسه ذخیره شد.'];
      if (result.createdTasks > 0) parts.push(`${result.createdTasks.toLocaleString('fa-IR')} وظیفه ارجاع شد.`);
      if (result.cancelledTasks > 0) parts.push(`${result.cancelledTasks.toLocaleString('fa-IR')} وظیفه لغو شد.`);
      setNotice(parts.join(' '));
    } catch (err) {
      setError((err as Error).message || 'ذخیره انجام نشد.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!loaded) return;
    setBusy(true);
    try {
      await meetingsApi.remove(loaded.id);
      dataChanged('tasks');
      onSaved(loaded);
      onClose();
    } catch (err) {
      setError((err as Error).message || 'حذف انجام نشد.');
      setBusy(false);
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      // Required at call time: `imageUtils` pulls `file-saver`, which a test
      // renderer cannot load, so a static import would make the form unmountable.
      const { uploadFile } = await import('../imageUtils');
      const added: ActivityAttachment[] = [];
      for (const file of Array.from(files)) {
        const url = await uploadFile(file, 'meeting-files');
        added.push({ name: file.name, size: formatFileSize(file.size), url });
      }
      setAttachments((prev) => [...prev, ...added]);
    } catch (err) {
      setError((err as Error).message || 'بارگذاری فایل انجام نشد.');
    } finally {
      setUploading(false);
    }
  };

  const userOptions = activeUsers.map((u) => ({ value: u.id, label: u.fullName }));

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-xl">
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-sky-600" />
            <h3 className="font-bold text-slate-800 dark:text-slate-100">
              {loaded ? `صورتجلسه ${loaded.code}` : 'صورتجلسه جدید'}
            </h3>
            {loaded && (
              <span className={`text-[11px] px-2 py-0.5 rounded-full ${isFinal ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                {MEETING_STATUS_LABELS[loaded.status]}
              </span>
            )}
            {readOnly && <span className="text-[11px] text-slate-500 flex items-center gap-1"><Lock size={11} /> فقط مشاهده</span>}
          </div>
          <button type="button" onClick={onClose} aria-label="بستن" className="p-1.5 rounded-lg hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && <div className="text-sm text-rose-700 bg-rose-50 rounded-lg px-3 py-2" data-meeting-error>{error}</div>}
          {notice && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2" data-meeting-notice>{notice}</div>}

          <fieldset disabled={readOnly || busy} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="md:col-span-2 text-sm">
                <span className="text-slate-600">عنوان جلسه *</span>
                <input id="meeting-title" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white dark:bg-slate-800" />
              </label>
              <ShamsiDatePicker label="تاریخ جلسه *" value={meetingDate} onChange={setMeetingDate} />
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm"><span className="text-slate-600 flex items-center gap-1"><Clock size={12} /> شروع</span>
                  <input value={startTime} onChange={(e) => setStartTime(e.target.value)} placeholder="09:00" dir="ltr" className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white dark:bg-slate-800" />
                </label>
                <label className="text-sm"><span className="text-slate-600">پایان</span>
                  <input value={endTime} onChange={(e) => setEndTime(e.target.value)} placeholder="10:30" dir="ltr" className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white dark:bg-slate-800" />
                </label>
              </div>
              <label className="text-sm">
                <span className="text-slate-600">مکان</span>
                <input value={place} onChange={(e) => setPlace(e.target.value)} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white dark:bg-slate-800" />
              </label>
              <div className="text-sm">
                <span className="text-slate-600">پروژه</span>
                {fixedProjectId ? (
                  <div className="mt-1 px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 dark:bg-slate-800">{fixedProjectLabel ?? projectPicker.selectedLabel}</div>
                ) : (
                  <SearchableSelect
                    wrapperClassName="mt-1"
                    value={projectId}
                    onChange={setProjectId}
                    onSearchChange={projectPicker.setTerm}
                    loading={projectPicker.loading}
                    options={[
                      { value: '', label: 'جلسه داخلی (بدون پروژه)' },
                      ...(projectPicker.selected && !projectPicker.matches.some((p) => p.id === projectPicker.selected!.id)
                        ? [{ value: projectPicker.selected.id, label: projectPicker.selectedLabel }] : []),
                      ...projectPicker.matches.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` })),
                    ]}
                    placeholder="پروژه..."
                  />
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ParticipantPicker title="حاضرین" people={attendees} onChange={setAttendees} userOptions={userOptions} idPrefix="attendee" />
              <ParticipantPicker title="غایبین" people={absentees} onChange={setAbsentees} userOptions={userOptions} idPrefix="absentee" />
            </div>

            <label className="block text-sm">
              <span className="text-slate-600">دستور جلسه / خلاصه مذاکرات</span>
              <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white dark:bg-slate-800" />
            </label>

            {carryOver.length > 0 && (
              <div className="border border-amber-200 bg-amber-50/60 rounded-xl p-3" data-meeting-carry-over>
                <div className="text-sm font-bold text-amber-800 mb-2 flex items-center gap-1.5">
                  <AlertTriangle size={14} /> اقدام‌های باز جلسات قبلی این پروژه
                </div>
                <ul className="space-y-1.5">
                  {carryOver.map((c) => (
                    <li key={c.itemId} className="text-sm flex flex-wrap items-center gap-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATE_TONE[c.state]}`}>{MEETING_ITEM_STATE_LABELS[c.state]}</span>
                      <span className="text-slate-800 flex-1 min-w-[200px]">{c.text}</span>
                      <span className="text-xs text-slate-500">{c.assignees.join('، ')}{c.dueDateJalali ? ` — مهلت ${c.dueDateJalali}` : ''} ({c.meetingCode})</span>
                      {!readOnly && (
                        <button
                          type="button"
                          className="text-xs text-sky-700 hover:underline"
                          onClick={() => addItem('INFO', `پیگیری اقدام جلسه ${c.meetingCode}: ${c.text}`)}
                        >
                          درج در بندها
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200">بندهای صورتجلسه</span>
                {!readOnly && (
                  <button type="button" id="meeting-add-item" onClick={() => addItem()} className="text-sm text-sky-700 flex items-center gap-1"><Plus size={14} /> افزودن بند</button>
                )}
              </div>
              {items.length === 0 && <div className="text-xs text-slate-500">هنوز بندی ثبت نشده است.</div>}
              {items.map((item, idx) => (
                <div key={item.key} className="border border-slate-200 dark:border-slate-700 rounded-xl p-3 space-y-2" data-meeting-item={idx + 1}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-slate-500">بند {(idx + 1).toLocaleString('fa-IR')}</span>
                    <div className="flex gap-1">
                      {MEETING_ITEM_KINDS.map((k) => (
                        <button
                          type="button"
                          key={k}
                          data-item-kind={k}
                          onClick={() => updateItem(item.key, { kind: k })}
                          className={`text-xs px-2.5 py-1 rounded-full border ${item.kind === k ? `${KIND_TONE[k]} border-transparent font-bold` : 'border-slate-200 text-slate-500'}`}
                        >
                          {MEETING_ITEM_KIND_LABELS[k]}
                        </button>
                      ))}
                    </div>
                    {item.state && item.state !== 'NONE' && (
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATE_TONE[item.state]}`} data-item-state={item.state}>
                        {MEETING_ITEM_STATE_LABELS[item.state]}
                      </span>
                    )}
                    {!readOnly && (
                      <button type="button" onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))} className="mr-auto text-slate-400 hover:text-rose-600" aria-label="حذف بند">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <textarea
                    value={item.text}
                    onChange={(e) => updateItem(item.key, { text: e.target.value })}
                    rows={2}
                    placeholder="متن بند..."
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white dark:bg-slate-800"
                  />
                  {item.kind === 'ACTION' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <AssigneePicker
                        value={item.assignees}
                        onChange={(assignees) => updateItem(item.key, { assignees })}
                        userOptions={userOptions}
                      />
                      <ShamsiDatePicker label="مهلت انجام" value={item.dueDate ?? ''} onChange={(v) => updateItem(item.key, { dueDate: v })} compact />
                    </div>
                  )}
                  {item.tasks && item.tasks.length > 0 && (
                    <div className="text-xs text-slate-500 flex flex-wrap gap-2">
                      {item.tasks.map((t, i) => (
                        <span key={i} className="flex items-center gap-1"><CheckCircle2 size={11} /> {t.assigneeName}: {t.status ?? 'وظیفه یافت نشد'}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
              <ShamsiDatePicker label="تاریخ جلسه بعدی" value={nextMeetingDate} onChange={setNextMeetingDate} />
              <div className="text-sm">
                <span className="text-slate-600 flex items-center gap-1"><Paperclip size={12} /> پیوست‌ها</span>
                <ul className="mt-1 space-y-1">
                  {attachments.map((a, i) => (
                    <li key={a.url} className="flex items-center gap-2 text-xs">
                      <a href={a.url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline truncate">{a.name}</a>
                      <span className="text-slate-400">{a.size}</span>
                      {!readOnly && (
                        <button type="button" onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-600"><X size={12} /></button>
                      )}
                    </li>
                  ))}
                </ul>
                {!readOnly && (
                  <label className="mt-1 inline-flex items-center gap-1 text-xs text-sky-700 cursor-pointer">
                    {uploading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} افزودن فایل
                    <input type="file" multiple className="hidden" onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
                  </label>
                )}
              </div>
            </div>
          </fieldset>

          {loaded && (
            <div className="text-xs text-slate-500">
              ثبت توسط {loaded.createdByName ?? '—'}{loaded.finalizedByName ? `، نهایی شده توسط ${loaded.finalizedByName}` : ''}
            </div>
          )}
        </div>

        {!readOnly && (
          <div className="shrink-0 flex flex-wrap items-center gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-700">
            {!isFinal && (
              <button type="button" id="meeting-save-draft" disabled={busy} onClick={() => void save(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-bold">
                ذخیره پیش‌نویس
              </button>
            )}
            <button type="button" id="meeting-finalize" disabled={busy} onClick={() => void save(true)} className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold flex items-center gap-1.5">
              {busy && <Loader2 size={14} className="animate-spin" />}
              {isFinal ? 'ذخیره تغییرات' : 'نهایی کردن و ارجاع اقدام‌ها'}
            </button>
            {loaded && (
              confirmDelete ? (
                <span className="mr-auto flex items-center gap-2 text-sm">
                  <span className="text-rose-700">وظایف باز این جلسه لغو می‌شوند. حذف شود؟</span>
                  <button type="button" onClick={() => void remove()} className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs">بله، حذف</button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 rounded-lg border text-xs">انصراف</button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)} className="mr-auto text-sm text-rose-600 flex items-center gap-1"><Trash2 size={14} /> حذف</button>
              )
            )}
            {isFinal && (
              <span className="w-full text-xs text-slate-500">
                ویرایش بعد از نهایی شدن: اقدام جدید وظیفه جدید می‌سازد و بند حذف‌شده وظیفه‌اش را لغو می‌کند.
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------- participant pickers ---------------------------- */

function ParticipantPicker({ title, people, onChange, userOptions, idPrefix }: {
  title: string;
  people: MeetingParticipant[];
  onChange: (next: MeetingParticipant[]) => void;
  userOptions: { value: string; label: string }[];
  idPrefix: string;
}) {
  const [guestName, setGuestName] = useState('');
  const [guestOrg, setGuestOrg] = useState('');
  const [guestPick, setGuestPick] = useState('');
  const customers = useEntitySearch<CustomerRow>({
    path: '/api/customers', limit: 20,
    getLabel: (row) => row.companyName,
  });

  const addUser = (userId: string) => {
    const opt = userOptions.find((o) => o.value === userId);
    if (!opt || people.some((p) => p.userId === userId)) return;
    onChange([...people, { kind: 'user', userId, name: opt.label }]);
  };
  const addGuest = () => {
    const name = guestName.trim();
    if (!name) return;
    onChange([...people, { kind: 'contact', name, organization: guestOrg.trim() || null }]);
    setGuestName(''); setGuestOrg('');
  };
  const addCustomer = (customerId: string) => {
    setGuestPick('');
    const row = customers.matches.find((c) => c.id === customerId);
    if (!row || people.some((p) => p.customerId === customerId)) return;
    const company = row.linksFrom?.[0]?.to?.companyName ?? null;
    onChange([...people, { kind: 'contact', customerId, name: row.companyName, organization: company }]);
  };

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-3 space-y-2" data-participants={idPrefix}>
      <div className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5"><Users size={14} /> {title}</div>
      <div className="flex flex-wrap gap-1.5">
        {people.map((p, i) => (
          <span key={`${p.userId ?? p.customerId ?? p.name}-${i}`} className={`text-xs px-2 py-1 rounded-full flex items-center gap-1 ${p.kind === 'user' ? 'bg-sky-50 text-sky-800' : 'bg-violet-50 text-violet-800'}`}>
            {p.name}{p.organization ? ` (${p.organization})` : ''}
            <button type="button" aria-label="حذف" onClick={() => onChange(people.filter((_, j) => j !== i))}><X size={11} /></button>
          </span>
        ))}
        {people.length === 0 && <span className="text-xs text-slate-400">کسی انتخاب نشده</span>}
      </div>
      <select
        value=""
        data-add-user={idPrefix}
        onChange={(e) => addUser(e.target.value)}
        className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white dark:bg-slate-800"
      >
        <option value="">+ افزودن همکار...</option>
        {userOptions.filter((o) => !people.some((p) => p.userId === o.value)).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <SearchableSelect
        value={guestPick}
        onChange={addCustomer}
        onSearchChange={customers.setTerm}
        loading={customers.loading}
        options={[{ value: '', label: '+ افزودن از مشتریان...' }, ...customers.matches.map((c) => ({ value: c.id, label: c.companyName }))]}
        placeholder="+ افزودن از مشتریان..."
      />
      <div className="flex gap-1.5">
        <input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="نام مهمان" className="flex-1 min-w-0 px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white dark:bg-slate-800" />
        <input value={guestOrg} onChange={(e) => setGuestOrg(e.target.value)} placeholder="سازمان" className="flex-1 min-w-0 px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white dark:bg-slate-800" />
        <button type="button" onClick={addGuest} className="px-2 text-xs text-sky-700 border border-slate-200 rounded-lg">افزودن</button>
      </div>
    </div>
  );
}

function AssigneePicker({ value, onChange, userOptions }: {
  value: MeetingAssignee[];
  onChange: (next: MeetingAssignee[]) => void;
  userOptions: { value: string; label: string }[];
}) {
  return (
    <div className="text-sm">
      <span className="text-slate-600">مسئول(ها)</span>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {value.map((a) => (
          <span key={a.userId} className="text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-800 flex items-center gap-1" data-assignee={a.userId}>
            {a.name}
            <button type="button" aria-label="حذف" onClick={() => onChange(value.filter((x) => x.userId !== a.userId))}><X size={11} /></button>
          </span>
        ))}
      </div>
      <select
        value=""
        data-add-assignee
        onChange={(e) => {
          const opt = userOptions.find((o) => o.value === e.target.value);
          if (opt && !value.some((a) => a.userId === opt.value)) onChange([...value, { userId: opt.value, name: opt.label }]);
        }}
        className="mt-1 w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white dark:bg-slate-800"
      >
        <option value="">+ افزودن مسئول...</option>
        {userOptions.filter((o) => !value.some((a) => a.userId === o.value)).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
