import React, { useEffect, useMemo, useState } from 'react';
import { PhoneCall, X } from 'lucide-react';
import ShamsiDatePicker from './ShamsiDatePicker';
import NumberField from './NumberField';
import { useUserDirectory } from '../api/useUserDirectory';
import { tasksApi, type BulkCallResult } from '../api/tasks';
import { addDaysToShamsi, addWorkingDaysToShamsi, getTodayShamsi, isOfficialHoliday } from '../dateUtils';
import { DEFAULT_NEXT_ACTION_KINDS } from '../utils/nextAction';
import {
  MAX_CALLS_PER_DAY, bulkCallRefusal, spreadDueDates,
} from '../utils/bulkCallTasks';

/**
 * «ساخت وظیفهٔ تماس گروهی» — the form behind the customers grid's selection.
 *
 * One press per person: the customers ticked go to the one assignee chosen
 * here, and a second batch for a colleague is a second press — the person
 * decides who rings whom. The dates are spread `perDay` to a working day and
 * previewed with the same `spreadDueDates` the server runs, so what the form
 * promises is what is written.
 */
export interface BulkCallTasksModalProps {
  open: boolean;
  customers: { id: string; name: string }[];
  kinds?: readonly string[];
  priorities?: readonly string[];
  currentUserId?: string | null;
  onClose: () => void;
  /** Called with the server's answer once the tasks exist. */
  onDone: (result: BulkCallResult) => void;
}

const fa = (n: number): string => n.toLocaleString('fa-IR');

export default function BulkCallTasksModal({
  open, customers, kinds, priorities, currentUserId, onClose, onDone,
}: BulkCallTasksModalProps): React.ReactElement | null {
  const kindList = kinds && kinds.length > 0 ? kinds : DEFAULT_NEXT_ACTION_KINDS;
  const priorityList = priorities && priorities.length > 0 ? priorities : ['پایین', 'متوسط', 'بالا', 'فوری'];
  const { users } = useUserDirectory();

  const [kind, setKind] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [perDay, setPerDay] = useState(5);
  const [priority, setPriority] = useState('متوسط');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seeded on opening, never on the props object (the price-calculator rule).
  useEffect(() => {
    if (!open) return;
    setKind(kindList.includes('تماس تلفنی') ? 'تماس تلفنی' : kindList[0] ?? '');
    setDescription('');
    setAssigneeId(currentUserId ?? '');
    setStartDate(addWorkingDaysToShamsi(getTodayShamsi(), 1));
    setPerDay(5);
    setPriority(priorityList.includes('متوسط') ? 'متوسط' : priorityList[0] ?? 'متوسط');
    setError(null);
  }, [open]);

  const dates = useMemo(() => spreadDueDates(customers.length, startDate, perDay, {
    nextDay: (d) => addDaysToShamsi(d, 1),
    isOff: (d) => isOfficialHoliday(d),
  }), [customers.length, startDate, perDay]);
  const dayCount = new Set(dates).size;

  if (!open) return null;

  const activeUsers = users.filter((u) => u.isActive !== false);

  const submit = async () => {
    const refusal = bulkCallRefusal({
      customerIds: customers.map((c) => c.id), startDate, perDay, kind,
    });
    if (refusal) { setError(refusal); return; }
    setSaving(true);
    setError(null);
    try {
      const result = await tasksApi.bulkCustomerCalls({
        customerIds: customers.map((c) => c.id),
        kind,
        description: description.trim() || null,
        assignedToUserId: assigneeId || null,
        startDate,
        perDay,
        priority,
      });
      onDone(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ثبت وظایف با خطا مواجه شد.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" data-bulk-call-modal>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-slate-200 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-hairline shrink-0">
          <h3 className="font-bold text-sm text-slate-800 inline-flex items-center gap-2">
            <PhoneCall size={16} /> ساخت وظیفهٔ تماس گروهی
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" title="انصراف">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <p className="text-xs text-secondary">
            برای هر یک از {fa(customers.length)} مشتری انتخاب‌شده یک وظیفه ساخته می‌شود. برای سپردن بخشی از فهرست به همکار، همان بخش را انتخاب کنید و دوباره این فرم را باز کنید.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="bulk-call-kind" className="block text-xs font-medium text-slate-700 mb-1">نوع اقدام</label>
              <select id="bulk-call-kind" value={kind} onChange={(e) => setKind(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
                {kindList.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="bulk-call-assignee" className="block text-xs font-medium text-slate-700 mb-1">مسئول</label>
              <select id="bulk-call-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
                {activeUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.id === currentUserId ? `${u.fullName} (خودم)` : u.fullName}</option>
                ))}
              </select>
            </div>
            <div>
              <ShamsiDatePicker label="تاریخ شروع" value={startDate} onChange={setStartDate} />
            </div>
            <div>
              <label htmlFor="bulk-call-per-day" className="block text-xs font-medium text-slate-700 mb-1">تعداد در هر روز کاری</label>
              <NumberField id="bulk-call-per-day" value={perDay} onChange={setPerDay} min={1} max={MAX_CALLS_PER_DAY} integer
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="bulk-call-priority" className="block text-xs font-medium text-slate-700 mb-1">اولویت</label>
              <select id="bulk-call-priority" value={priority} onChange={(e) => setPriority(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
                {priorityList.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="bulk-call-description" className="block text-xs font-medium text-slate-700 mb-1">
              شرح کار <span className="text-faint">(اختیاری، برای همه یکسان)</span>
            </label>
            <textarea id="bulk-call-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
              placeholder="مثلاً: بپرس فعلاً به چه تجهیزی نیاز دارند"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right resize-y" />
          </div>

          {dates.length > 0 && (
            <p className="text-xs text-slate-700 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2" data-bulk-call-preview>
              {dayCount > 1
                ? `از ${dates[0]} تا ${dates[dates.length - 1]}، در ${fa(dayCount)} روز کاری (روزهای تعطیل رد می‌شوند).`
                : `همه برای ${dates[0]}.`}
            </p>
          )}

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-hairline shrink-0">
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 text-slate-600 hover:bg-slate-50">
            انصراف
          </button>
          <button type="button" onClick={() => void submit()} disabled={saving} id="bulk-call-submit"
            className="px-3 py-1.5 rounded-lg text-xs bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-60">
            {saving ? 'در حال ثبت…' : `ثبت ${fa(customers.length)} وظیفه`}
          </button>
        </div>
      </div>
    </div>
  );
}
