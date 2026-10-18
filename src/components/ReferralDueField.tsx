import { CalendarClock } from 'lucide-react';
import ShamsiDatePicker from './ShamsiDatePicker';

/**
 * «برای … ارجاع ثبت می‌شود» with its deadline — drawn once somebody is named.
 *
 * One component, because two boxes raise a referral by naming a colleague —
 * the project feed's composer and a referral thread's reply — and a deadline
 * offered in one and not the other is a request whose date depends on which
 * screen it happened to be written from.
 *
 * Two answers, and they are different things rather than two spellings of one:
 * a date the writer is agreeing, or «تعیینش با خودت» — which is a real answer
 * and not a blank, because it is what makes the system ask the other person for
 * one instead of letting the request sit undated.
 */
export default function ReferralDueField({
  names, dueDate, onDueDateChange, dueByAssignee, onDueByAssigneeChange,
}: {
  names: string[];
  dueDate: string;
  onDueDateChange: (next: string) => void;
  dueByAssignee: boolean;
  onDueByAssigneeChange: (next: boolean) => void;
}) {
  return (
    <div
      className="text-[10px] text-sky-700 bg-sky-50 border border-sky-100 rounded-lg px-2 py-1.5 space-y-1.5"
      data-referral-due
    >
      <p>
        با ارسال این پیام، برای{' '}
        <strong>{names.join('، ')}</strong>{' '}
        ارجاع ثبت می‌شود و متن همین پیام به‌عنوان اقدام خواسته‌شده ثبت خواهد شد.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 font-bold shrink-0">
          <CalendarClock size={11} />
          مهلت انجام:
        </span>

        {dueByAssignee ? (
          <span className="text-slate-600">تعیین مهلت بر عهدهٔ ارجاع‌شونده است.</span>
        ) : (
          <div className="w-40">
            <ShamsiDatePicker
              value={dueDate}
              onChange={onDueDateChange}
              compact
              placeholder="اختیاری"
            />
          </div>
        )}

        <label className="flex items-center gap-1 cursor-pointer text-slate-600">
          <input
            type="checkbox"
            checked={dueByAssignee}
            onChange={(e) => {
              onDueByAssigneeChange(e.target.checked);
              // The two answers are exclusive: a date agreed here is not a
              // date the other person was asked to pick.
              if (e.target.checked) onDueDateChange('');
            }}
            data-referral-due-by-assignee
            className="w-3 h-3 accent-sky-600"
          />
          مهلت را ارجاع‌شونده تعیین کند
        </label>
      </div>
    </div>
  );
}
