import { useState } from 'react';
import { Pencil, Plus, Settings, Trash2, X } from 'lucide-react';
import type { Product, ProductFeature } from '../types';
import type { ConfigSelections } from '../utils/productConfig';
import {
  catalogueCodeRefusal, catalogueNameRefusal, catalogueRemovalRefusal, newConfigId,
  removeFromCatalogue, renameFeature, renameOption,
} from '../utils/productConfig';

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
  /**
   * Writes a change to the catalogue item, and returns once it is stored.
   *
   * Optional: a caller that does not pass it gets a read-only configurator,
   * which is what a user without the products permission should see. The
   * modal builds the mutation — a new feature, or a new option on one — and
   * the screen owns the write, because each host already has the one helper
   * that loads the full product before changing it.
   */
  onCatalogueEdit?: (mutate: (full: Product) => Product) => Promise<void>;
}

export default function ProductConfiguratorModal({
  product, selections, onSelectionsChange, onCancel, onConfirm, confirmLabel, busy = false, intro,
  onCatalogueEdit,
}: Props) {
  const features = product.features ?? [];
  const rules = product.configRules ?? [];

  /*
   * Defining a feature or an option without leaving the quotation.
   *
   * The catalogue is never complete at the moment somebody is quoting from it:
   * a customer asks for a flange rating nobody has entered yet, and the choice
   * was to abandon the proforma, open the products screen, add the option and
   * start again. The write goes through the host's own product helper, so the
   * full record is loaded and changed rather than a picker row being sent back.
   */
  /*
   * …and correcting or removing one, which is the other half of the same need:
   * a value typed wrong in a hurry is as much a dead end as one never typed.
   * One small form serves all four: adding a feature, adding an option, and
   * editing either. A rename carries the SKUs' attributes and the rules with it
   * (`renameFeature`/`renameOption`), and a removal is refused while a SKU uses
   * the value (`catalogueRemovalRefusal`) — both decided against the **full**
   * record the host loads, not against what this modal was handed.
   */
  type Target =
    | { mode: 'add-feature' }
    | { mode: 'add-option'; featureId: string }
    | { mode: 'edit-feature'; featureId: string }
    | { mode: 'edit-option'; featureId: string; optionId: string };
  const [adding, setAdding] = useState<Target | null>(null);
  const [removing, setRemoving] = useState<{ featureId: string; optionId?: string } | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftCode, setDraftCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openForm = (target: Target) => {
    setAdding(target);
    setRemoving(null);
    const feature = 'featureId' in target ? features.find((f) => f.id === target.featureId) : undefined;
    const option = target.mode === 'edit-option'
      ? feature?.options.find((o) => o.id === target.optionId) : undefined;
    setDraftName(target.mode === 'edit-feature' ? feature?.name ?? ''
      : target.mode === 'edit-option' ? option?.value ?? '' : '');
    setDraftCode(target.mode === 'edit-feature' ? feature?.code ?? ''
      : target.mode === 'edit-option' ? option?.code ?? '' : '');
    setError(null);
  };

  /** The ticked values, kept in step with a rename or a removal. */
  const followSelections = (featureId: string, from: string | null, to: string | null) => {
    const current = selections[featureId];
    if (!current) return;
    const next = { ...selections };
    if (from === null) delete next[featureId];
    else next[featureId] = to === null
      ? current.filter((v) => v !== from)
      : current.map((v) => (v === from ? to : v));
    onSelectionsChange(next);
  };

  const submitAdd = async () => {
    if (!adding || !onCatalogueEdit) return;
    const target = adding;
    const isFeature = target.mode === 'add-feature' || target.mode === 'edit-feature';
    const feature = 'featureId' in target ? features.find((f) => f.id === target.featureId) : undefined;
    const siblings = isFeature
      ? features.filter((f) => !(target.mode === 'edit-feature' && f.id === target.featureId)).map((f) => f.name)
      : (feature?.options ?? [])
        .filter((o) => !(target.mode === 'edit-option' && o.id === target.optionId))
        .map((o) => o.value);

    const refusal = catalogueNameRefusal(draftName, siblings) ?? catalogueCodeRefusal(draftCode);
    if (refusal) { setError(refusal); return; }

    const name = draftName.trim();
    const code = draftCode.trim() || undefined;
    setSaving(true);
    setError(null);
    try {
      await onCatalogueEdit((full) => {
        const list = full.features ?? [];
        switch (target.mode) {
          case 'add-feature': {
            const created: ProductFeature = { id: newConfigId('feat'), name, code, options: [] };
            return { ...full, features: [...list, created] };
          }
          case 'add-option':
            return {
              ...full,
              features: list.map((f) => (f.id === target.featureId
                ? { ...f, options: [...f.options, { id: newConfigId('opt'), value: name, code }] }
                : f)),
            };
          case 'edit-feature':
            return renameFeature(full, target.featureId, name, code);
          case 'edit-option':
            return renameOption(full, target.featureId, target.optionId, name, code);
        }
      });
      if (target.mode === 'edit-option') {
        const before = feature?.options.find((o) => o.id === target.optionId)?.value;
        if (before && before !== name) followSelections(target.featureId, before, name);
      }
      setAdding(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ثبت در انبار با خطا مواجه شد.');
    } finally {
      setSaving(false);
    }
  };

  const submitRemove = async () => {
    if (!removing || !onCatalogueEdit) return;
    const { featureId, optionId } = removing;
    const feature = features.find((f) => f.id === featureId);
    const option = optionId ? feature?.options.find((o) => o.id === optionId) : undefined;
    // Asked of what the modal holds first, so the common refusal costs no
    // request; asked again of the full record inside the write.
    const early = catalogueRemovalRefusal(product, featureId, optionId);
    if (early) { setError(early); return; }
    setSaving(true);
    setError(null);
    try {
      await onCatalogueEdit((full) => {
        const refusal = catalogueRemovalRefusal(full, featureId, optionId);
        if (refusal) throw new Error(refusal);
        return removeFromCatalogue(full, featureId, optionId);
      });
      followSelections(featureId, option ? option.value : null, null);
      setRemoving(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حذف از انبار با خطا مواجه شد.');
    } finally {
      setSaving(false);
    }
  };

  const removeConfirm = (
    <div className="mt-2 border border-rose-200 bg-rose-50/60 rounded-lg p-2.5 space-y-2">
      <p className="text-[11px] text-rose-700 font-bold">
        {removing && !removing.optionId
          ? 'این ویژگی و همهٔ مقادیرش از این کالا حذف شود؟ شروطی که به آن اشاره می‌کنند هم حذف می‌شوند.'
          : 'این مقدار از این ویژگی حذف شود؟'}
      </p>
      {error && <p className="text-[10px] font-bold text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => { setRemoving(null); setError(null); }}
          className="px-3 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-200 rounded-lg transition"
        >
          انصراف
        </button>
        <button
          type="button"
          onClick={() => void submitRemove()}
          disabled={saving}
          id="configurator-remove-submit"
          className="px-3 py-1 text-[11px] font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition disabled:opacity-50"
        >
          {saving ? 'در حال حذف…' : 'حذف از انبار'}
        </button>
      </div>
    </div>
  );

  const openRemove = (target: { featureId: string; optionId?: string }) => {
    setRemoving(target);
    setAdding(null);
    setError(null);
  };
  const isRemoving = (featureId: string, optionId?: string) =>
    !!removing && removing.featureId === featureId && removing.optionId === optionId;
  const isEditing = (featureId: string, optionId?: string) => !!adding && (
    optionId
      ? adding.mode === 'edit-option' && adding.featureId === featureId && adding.optionId === optionId
      : adding.mode === 'edit-feature' && adding.featureId === featureId);

  const addForm = (
    <div className="mt-2 border border-sky-200 bg-sky-50/60 rounded-lg p-2.5 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input
          type="text"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder={adding?.mode === 'add-feature' || adding?.mode === 'edit-feature' ? 'نام ویژگی' : 'مقدار'}
          className="sm:col-span-2 w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white outline-none focus:border-sky-400"
          id="configurator-new-name"
          autoFocus
        />
        <input
          type="text"
          value={draftCode}
          onChange={(e) => setDraftCode(e.target.value)}
          placeholder="کد (اختیاری)"
          className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white outline-none focus:border-sky-400 font-mono text-left"
          id="configurator-new-code"
        />
      </div>
      {/* The code goes straight into the SKU, which is why it is restricted. */}
      <p className="text-[10px] text-slate-500">
        کد در ساخت SKU استفاده می‌شود؛ در صورت خالی بودن، شماره ردیف جایگزین می‌شود.
        {adding?.mode.startsWith('edit') && ' تغییر نام به SKUها و شروط موجود هم اعمال می‌شود؛ تغییر کد فقط روی SKUهای جدید اثر دارد.'}
      </p>
      {error && <p className="text-[10px] font-bold text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setAdding(null)}
          className="px-3 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-200 rounded-lg transition"
        >
          انصراف
        </button>
        <button
          type="button"
          onClick={() => void submitAdd()}
          disabled={saving}
          id="configurator-new-submit"
          className="px-3 py-1 text-[11px] font-bold bg-sky-600 hover:bg-sky-700 text-white rounded-lg transition disabled:opacity-50"
        >
          {saving ? 'در حال ثبت…' : adding?.mode.startsWith('edit') ? 'ذخیره تغییر' : 'افزودن به انبار'}
        </button>
      </div>
    </div>
  );

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
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-bold text-slate-700">{feature.name}</label>
                {onCatalogueEdit && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openForm({ mode: 'edit-feature', featureId: feature.id })}
                      id={`configurator-edit-feature-${feature.id}`}
                      title="ویرایش ویژگی"
                      className="p-1 text-slate-500 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => openRemove({ featureId: feature.id })}
                      id={`configurator-remove-feature-${feature.id}`}
                      title="حذف ویژگی"
                      className="p-1 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                    >
                      <Trash2 size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => openForm({ mode: 'add-option', featureId: feature.id })}
                      id={`configurator-add-option-${feature.id}`}
                      className="text-[10px] font-bold text-sky-600 hover:bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-lg transition flex items-center gap-1"
                    >
                      <Plus size={11} />
                      مقدار جدید
                    </button>
                  </div>
                )}
              </div>
              {isEditing(feature.id) && addForm}
              {isRemoving(feature.id) && removeConfirm}
              {/* One column on a phone, two once there is room: a feature with
                  a dozen sizes was a very long list. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 mt-2">
                {feature.options.map((opt) => {
                  const excluded = isExcluded(feature.name, opt.value);
                  const selected = (selections[feature.id] || []).includes(opt.value);
                  return (
                    <div
                      key={opt.id}
                      className={`min-w-0 ${isEditing(feature.id, opt.id) || isRemoving(feature.id, opt.id) ? 'sm:col-span-2' : ''}`}
                    >
                    <div className="flex items-center gap-1 group/opt">
                    <label
                      className={`flex-1 min-w-0 flex items-center gap-2 select-none ${
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
                    {/* Beside the label, never inside it: a press inside a
                        <label> toggles its checkbox as well. */}
                    {onCatalogueEdit && (
                      <>
                        <button
                          type="button"
                          onClick={() => openForm({ mode: 'edit-option', featureId: feature.id, optionId: opt.id })}
                          id={`configurator-edit-option-${opt.id}`}
                          title="ویرایش مقدار"
                          className="p-0.5 text-slate-400 hover:text-sky-600 rounded transition shrink-0"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={() => openRemove({ featureId: feature.id, optionId: opt.id })}
                          id={`configurator-remove-option-${opt.id}`}
                          title="حذف مقدار"
                          className="p-0.5 text-slate-400 hover:text-rose-600 rounded transition shrink-0"
                        >
                          <Trash2 size={11} />
                        </button>
                      </>
                    )}
                    </div>
                    {isEditing(feature.id, opt.id) && addForm}
                    {isRemoving(feature.id, opt.id) && removeConfirm}
                    </div>
                  );
                })}
              </div>
              {adding?.mode === 'add-option' && adding.featureId === feature.id && addForm}
            </div>
          ))}

          {/* A feature the catalogue has never had. The customer asking for a
              flange rating nobody entered is not a reason to abandon the
              quotation and start again from the products screen. */}
          {onCatalogueEdit && (
            <div className="pt-1">
              {adding?.mode === 'add-feature' ? addForm : (
                <button
                  type="button"
                  onClick={() => openForm({ mode: 'add-feature' })}
                  id="configurator-add-feature"
                  className="text-[11px] font-bold text-slate-600 hover:bg-slate-100 border border-dashed border-slate-300 px-3 py-1.5 rounded-lg transition flex items-center gap-1"
                >
                  <Plus size={12} />
                  تعریف ویژگی جدید برای این کالا
                </button>
              )}
            </div>
          )}
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
