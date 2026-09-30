import type { DeviationFields } from '../utils/deviations';

/**
 * One proforma line's «مغایرت با درخواست مشتری».
 *
 * A single tick, off by default, so a line that complies costs nothing; the
 * four boxes appear only once it is ticked. What is typed is in English
 * because it prints on the English «Technical Deviation List» page.
 */
interface Props {
  value: DeviationFields;
  onChange: (next: DeviationFields) => void;
  /** Distinguishes the controls of one row from another's. */
  rowIndex: number;
}

const box =
  'w-full border border-slate-200 rounded-md px-2 py-1 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 text-left [direction:ltr]';

export default function ProformaDeviationFields({ value, onChange, rowIndex }: Props) {
  const on = value.deviation === true;
  const set = (patch: Partial<DeviationFields>) => onChange({ ...value, ...patch });

  return (
    <div
      className={`mt-2 rounded-lg border p-2 ${on ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 bg-white'}`}
      data-deviation-row={rowIndex}
    >
      <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 cursor-pointer">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => set({ deviation: e.target.checked })}
          className="w-3.5 h-3.5 accent-amber-600"
          data-deviation-toggle
        />
        مغایرت با درخواست مشتری دارد
        {!on && <span className="font-normal text-slate-400">(پیش‌فرض: مطابق درخواست)</span>}
      </label>

      {on && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
          <div>
            <label className="block text-[10px] text-slate-500 mb-0.5">
              مشخصهٔ درخواستی مشتری (Required) *
            </label>
            <textarea
              rows={2}
              value={value.deviationRequested ?? ''}
              onChange={(e) => set({ deviationRequested: e.target.value })}
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
              value={value.deviationOffered ?? ''}
              onChange={(e) => set({ deviationOffered: e.target.value })}
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
              value={value.deviationReference ?? ''}
              onChange={(e) => set({ deviationReference: e.target.value })}
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
              value={value.deviationRemark ?? ''}
              onChange={(e) => set({ deviationRemark: e.target.value })}
              placeholder="e.g. Equivalent performance, shorter delivery"
              className={box}
              data-deviation-remark
            />
          </div>
        </div>
      )}
    </div>
  );
}
