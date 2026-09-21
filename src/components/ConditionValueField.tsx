import { conditionValueList } from '../utils/workflowConditions';

/**
 * The box a workflow condition's value is typed or picked in.
 *
 * Its own component because its failure is one a type-check cannot see: a
 * control that draws perfectly, reads its value perfectly and never calls back
 * — the «switch that does nothing» shape this codebase keeps repairing — and
 * because `SettingsView` is far too large to render in `test:ui`. Here it is
 * driven directly.
 *
 * **Three shapes, and the operator decides between two of them.** «یکی از
 * این‌ها باشد» names a *list*, so a single dropdown beside it would be a
 * control that contradicts the operator it is answering: pick `in`, then be
 * able to name exactly one value. A field with a closed list therefore draws
 * ticks; one without draws the same box every other operator gets, where the
 * separator is typed by hand.
 *
 * The list is written back with the **Persian** comma, because that is what
 * somebody reading this screen would type, and `conditionValueList` takes
 * either — the fold is one copy so the two cannot disagree.
 */

/** Fields whose value is a figure, so the box is a number. */
const NUMERIC_FIELDS = [
  'stockLevel', 'minStockLevel', 'proformaAmount', 'totalAmount', 'price', 'amountRIYAL',
];

export interface ConditionValueFieldProps {
  /** The condition's field id — only its being numeric matters here. */
  field: string;
  operator: string;
  value: string;
  /** What the field may hold, when it is a closed list. */
  options: readonly string[];
  onChange: (value: string) => void;
}

export function ConditionValueField({
  field, operator, value, options, onChange,
}: ConditionValueFieldProps) {
  const numeric = NUMERIC_FIELDS.includes(field);

  if (operator === 'in' && options.length > 0) {
    const picked = conditionValueList(value);
    return (
      <div className="flex flex-wrap items-center gap-2" data-condition-values>
        {options.map((val) => {
          const on = picked.includes(val);
          return (
            <label
              key={val}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border cursor-pointer transition ${
                on
                  ? 'bg-sky-50 border-sky-200 text-sky-700 font-bold'
                  : 'bg-white border-slate-200 text-slate-600'
              }`}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => onChange(
                  (on ? picked.filter((v) => v !== val) : [...picked, val]).join('، '),
                )}
                className="rounded border-slate-300 text-sky-500 focus:ring-sky-500"
              />
              <span>{val}</span>
            </label>
          );
        })}
      </div>
    );
  }

  /*
   * A typed box: for a figure, for a field with no closed list, and for an `in`
   * on such a field — where the separator is the person's own comma.
   */
  if (numeric || options.length === 0 || operator === 'in') {
    return (
      <input
        type={numeric ? 'number' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          operator === 'in' ? 'مقدارها را با «،» جدا کنید'
            : ['stockLevel', 'minStockLevel'].includes(field) ? 'تعداد'
              : 'مقدار مورد نظر'
        }
        className="border border-slate-200 rounded-lg p-2 bg-white focus:outline-none focus:border-sky-500 font-mono text-left"
      />
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border border-slate-200 rounded-lg p-2 bg-white focus:outline-none focus:border-sky-500"
    >
      <option value="">-- انتخاب مقدار --</option>
      {options.map((val) => (
        <option key={val} value={val}>{val}</option>
      ))}
    </select>
  );
}

export default ConditionValueField;
