import { Plus, Trash2 } from 'lucide-react';
import {
  MAX_DEVIATIONS_PER_LINE, deviationEntries, type DeviationEntry, type DeviationFields,
} from '../utils/deviations';

/**
 * One proforma line's «مغایرت با درخواست مشتری».
 *
 * A single tick, off by default, so a line that complies costs nothing; once
 * it is ticked the line carries a list of entries — one way it departs from the
 * request each, added with «افزودن مغایرت». What is typed is in English because
 * it prints on the English «Technical Deviation List» page.
 *
 * The change handed back is always the whole list, so the four single-entry
 * columns the line may still carry are never read again (`deviationEntries`
 * reads the list whenever it is present).
 */
interface Props {
  value: DeviationFields;
  onChange: (next: { deviation: boolean; deviations: DeviationEntry[] }) => void;
  /** Distinguishes the controls of one row from another's. */
  rowIndex: number;
}

const box =
  'w-full border border-slate-200 rounded-md px-2 py-1 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 text-left [direction:ltr]';

const blank = (): DeviationEntry => ({ reference: null, requested: null, offered: null, remark: null });

export default function ProformaDeviationFields({ value, onChange, rowIndex }: Props) {
  const on = value.deviation === true;
  const entries = deviationEntries(value);
  // A ticked line always shows at least one entry to fill in.
  const shown = on && entries.length === 0 ? [blank()] : entries;

  const write = (list: DeviationEntry[]) => onChange({ deviation: true, deviations: list });
  const setEntry = (index: number, patch: Partial<DeviationEntry>) =>
    write(shown.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  const removeEntry = (index: number) => {
    const next = shown.filter((_, i) => i !== index);
    // Removing the last entry is «this line complies».
    if (next.length === 0) onChange({ deviation: false, deviations: [] });
    else write(next);
  };

  return (
    <div
      className={`mt-2 rounded-lg border p-2 ${on ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 bg-white'}`}
      data-deviation-row={rowIndex}
    >
      <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 cursor-pointer">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => onChange({
            deviation: e.target.checked,
            deviations: e.target.checked && entries.length === 0 ? [blank()] : entries,
          })}
          className="w-3.5 h-3.5 accent-amber-600"
          data-deviation-toggle
        />
        مغایرت با درخواست مشتری دارد
        {!on && <span className="font-normal text-slate-400">(پیش‌فرض: مطابق درخواست)</span>}
      </label>

      {on && (
        <div className="mt-2 space-y-2">
          {shown.map((entry, index) => (
            <div
              key={index}
              className="rounded-md border border-amber-200 bg-white p-2"
              data-deviation-entry={index}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-amber-800">مغایرت {(index + 1).toLocaleString('fa-IR')}</span>
                <button
                  type="button"
                  onClick={() => removeEntry(index)}
                  className="text-slate-400 hover:text-red-600 p-0.5"
                  title="حذف این مغایرت"
                  data-deviation-remove={index}
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-500 mb-0.5">
                    مشخصهٔ درخواستی مشتری (Required) *
                  </label>
                  <textarea
                    rows={2}
                    value={entry.requested ?? ''}
                    onChange={(e) => setEntry(index, { requested: e.target.value })}
                    placeholder="e.g. Body material: SS316"
                    className={box}
                    data-deviation-requested
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-0.5">
                    مشخصهٔ پیشنهادی ما (Offered) *
                  </label>
                  <textarea
                    rows={2}
                    value={entry.offered ?? ''}
                    onChange={(e) => setEntry(index, { offered: e.target.value })}
                    placeholder="e.g. Body material: SS304"
                    className={box}
                    data-deviation-offered
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-0.5">
                    بند مرجع در مدرک مشتری (اختیاری)
                  </label>
                  <input
                    type="text"
                    value={entry.reference ?? ''}
                    onChange={(e) => setEntry(index, { reference: e.target.value })}
                    placeholder="e.g. Datasheet Rev.2 – Item 7"
                    className={box}
                    data-deviation-reference
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-0.5">
                    توضیح / دلیل (اختیاری)
                  </label>
                  <input
                    type="text"
                    value={entry.remark ?? ''}
                    onChange={(e) => setEntry(index, { remark: e.target.value })}
                    placeholder="e.g. Equivalent performance, shorter delivery"
                    className={box}
                    data-deviation-remark
                  />
                </div>
              </div>
            </div>
          ))}
          {shown.length < MAX_DEVIATIONS_PER_LINE && (
            <button
              type="button"
              onClick={() => write([...shown, blank()])}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 hover:text-amber-900 border border-dashed border-amber-300 rounded-md px-2 py-1 bg-white"
              data-deviation-add
            >
              <Plus size={12} /> افزودن مغایرت
            </button>
          )}
        </div>
      )}
    </div>
  );
}
