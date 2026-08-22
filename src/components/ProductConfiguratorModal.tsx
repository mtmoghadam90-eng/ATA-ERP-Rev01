import { Settings, X } from 'lucide-react';
import type { Product } from '../types';
import type { ConfigSelections } from '../utils/productConfig';

/**
 * Picking the values of a catalogue item's configurable features.
 *
 * Presentation only: it ticks boxes, enforces the product's own
 * `configRules`, and hands the selections back. What is done with them — the
 * specification text, finding or creating the SKU, pricing the line — belongs
 * to the screen, because a proforma line and a supplier-inquiry line want
 * different things done.
 *
 * It lived inside `ProformasView` and the supplier-inquiry form needed the same
 * thing, which is the point at which a second copy gets written and the two
 * start disagreeing about which combinations are allowed.
 */

interface Props {
  product: Product;
  selections: ConfigSelections;
  onSelectionsChange: (next: ConfigSelections) => void;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  /** True while the confirm is writing to the catalogue. */
  busy?: boolean;
  /** One line above the boxes, saying what confirming will do here. */
  intro: React.ReactNode;
}

export default function ProductConfiguratorModal({
  product, selections, onSelectionsChange, onCancel, onConfirm, confirmLabel, busy = false, intro,
}: Props) {
  const features = product.features ?? [];
  const rules = product.configRules ?? [];

  /**
   * Drops any selection the rules now forbid, repeatedly.
   *
   * Repeatedly because removing one value can satisfy the conditions of another
   * rule; the iteration cap is there so a pair of rules that undo each other
   * cannot hang the screen.
   */
  const prune = (input: ConfigSelections): ConfigSelections => {
    if (rules.length === 0) return input;
    const current = { ...input };
    for (let i = 0; i < 10; i++) {
      let changed = false;
      for (const rule of rules) {
        if (!rule.active) continue;
        const conditionsMet = rule.conditions.every((cond) => {
          const f = features.find((feat) => feat.name === cond.featureName);
          if (!f) return false;
          return (current[f.id] || []).some((v) => cond.values.includes(v));
        });
        if (!conditionsMet) continue;
        for (const act of rule.actions) {
          const f = features.find((feat) => feat.name === act.featureName);
          if (!f) continue;
          const before = current[f.id] || [];
          const after = before.filter((v) => !act.values.includes(v));
          if (after.length !== before.length) {
            current[f.id] = after;
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
    return current;
  };

  const isExcluded = (featureName: string, option: string): boolean => {
    for (const rule of rules) {
      if (!rule.active) continue;
      const conditionsMet = rule.conditions.every((cond) => {
        const f = features.find((feat) => feat.name === cond.featureName);
        if (!f) return false;
        return (selections[f.id] || []).some((v) => cond.values.includes(v));
      });
      if (!conditionsMet) continue;
      if (rule.actions.some((a) => a.featureName === featureName && a.values.includes(option))) {
        return true;
      }
    }
    return false;
  };

  return (
    /*
      Bounded to the viewport and scrolled inside.

      This panel had a width and no height: a product with a handful of features
      and a dozen options each grew it straight past the bottom of the screen,
      taking the تایید and انصراف buttons with it and leaving nothing to scroll.
      The overlay scrolls, the body scrolls, the header and footer stay put.
    */
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-start sm:items-center justify-center z-50 p-2 sm:p-4 overflow-y-auto" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg sm:max-w-2xl border border-slate-100 overflow-hidden my-auto flex flex-col max-h-[calc(100vh-1rem)] sm:max-h-[calc(100vh-2rem)]">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <Settings size={18} className="text-sky-600" />
            پیکربندی ویژگی‌های کالا
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 hover:bg-slate-200 text-slate-500 rounded-lg transition"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-5 overflow-y-auto flex-1">
          <div className="bg-sky-50 text-sky-800 p-3 rounded-lg text-xs leading-relaxed border border-sky-100 mb-4">
            {intro}
          </div>

          {features.map((feature) => (
            <div key={feature.id} className="space-y-2 border border-slate-100 rounded-lg p-3">
              <label className="text-sm font-bold text-slate-700">{feature.name}</label>
              {/* One column on a phone, two once there is room: a feature with
                  a dozen sizes was a very long list. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 mt-2">
                {feature.options.map((opt) => {
                  const excluded = isExcluded(feature.name, opt.value);
                  const selected = (selections[feature.id] || []).includes(opt.value);
                  return (
                    <label
                      key={opt.id}
                      className={`flex items-center gap-2 select-none ${
                        excluded ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer group'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected && !excluded}
                        disabled={excluded}
                        onChange={(e) => {
                          const next = { ...selections };
                          const current = next[feature.id] || [];
                          next[feature.id] = e.target.checked
                            ? [...current, opt.value]
                            : current.filter((v) => v !== opt.value);
                          onSelectionsChange(prune(next));
                        }}
                        className={`w-4 h-4 rounded border-slate-300 focus:ring-sky-500 ${
                          excluded ? 'text-slate-300 cursor-not-allowed' : 'text-sky-600 cursor-pointer'
                        }`}
                      />
                      <span className={`text-sm ${
                        excluded
                          ? 'text-slate-400 line-through'
                          : 'text-slate-600 group-hover:text-slate-900 font-medium'
                      }`}>
                        {opt.value}
                      </span>
                      {excluded && (
                        <span className="text-[10px] bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded font-bold mr-auto">
                          غیرمجاز طبق شروط
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50 flex flex-wrap justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg text-sm font-medium transition"
          >
            انصراف
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 sm:flex-none px-6 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-sm font-bold shadow-sm transition disabled:opacity-50"
          >
            {busy ? 'در حال ثبت…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
