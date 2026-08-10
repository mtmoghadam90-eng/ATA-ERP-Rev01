/**
 * The choice offered when deleting a record that has written to a project's
 * timeline.
 *
 * Two coherent outcomes, and the user picks:
 *
 *  - **Unticked** (the default): the automatic entries stay and one more says
 *    the document was removed. The project's history reads continuously — this
 *    proforma was issued, was won, and was later deleted.
 *  - **Ticked**: those entries go, along with a category group they leave
 *    empty. The timeline reads as though the document never existed, which is
 *    what someone who created it by mistake wants.
 *
 * Entries are matched on the link each one stores, never on its wording. That
 * matters: the version of this feature that existed before the migration fell
 * back to matching text when no link was stored, which could just as easily
 * delete a sibling document's entry that happened to name the same product.
 * Entries written before the link existed are simply left alone.
 */
export default function DeleteActivitiesOption({
  checked,
  onChange,
  what,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  /** What the record is, for the label: «این پیش‌فاکتور», «این پکینگ لیست». */
  what: string;
}) {
  return (
    <label className="mt-4 pt-4 border-t border-slate-100 flex items-start gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-3.5 h-3.5 text-rose-600 border-slate-300 rounded focus:ring-rose-500 cursor-pointer shrink-0"
      />
      <span className="text-xs text-slate-600 leading-relaxed">
        فعالیت‌هایی که سیستم درباره {what} در تایم‌لاین پروژه ثبت کرده نیز حذف شوند.
        <span className="block text-[10px] text-slate-400 mt-0.5">
          بدون این گزینه، فعالیت‌ها باقی می‌مانند و یک فعالیت جدید هم ثبت می‌شود که
          این سند حذف شده است.
        </span>
      </span>
    </label>
  );
}
