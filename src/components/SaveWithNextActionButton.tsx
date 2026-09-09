import { CalendarPlus } from 'lucide-react';

/**
 * «ذخیره و ثبت اقدام بعدی» — the second save button, drawn the same way on
 * every form that offers it.
 *
 * It is a **`type="submit"`** and not an `onClick` that saves: the form's own
 * submit handler is where the validation, the required-field checks and the
 * write already live, and a second path into them is a second copy of all of
 * it — the five customer creation forms, in miniature. Pressing this only says
 * *which* button was pressed (`onArm`) and then lets the form submit exactly as
 * it always did, so a form whose validation refuses the save asks no question
 * about a record it did not write.
 *
 * One component rather than a snippet pasted into ten footers, because the
 * wording is what teaches people the feature exists and ten spellings of it
 * would read as ten different buttons.
 */
export default function SaveWithNextActionButton({
  onArm,
  disabled,
  className = '',
}: {
  /** Marks this press so the host asks the question once the save lands. */
  onArm: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="submit"
      onClick={onArm}
      disabled={disabled}
      data-save-with-next-action
      title="رکورد ذخیره می‌شود و بعد اقدام بعدی روی آن را تعریف می‌کنید"
      className={`px-4 py-2 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl text-sm font-medium transition flex items-center gap-1.5 disabled:opacity-50 ${className}`}
    >
      <CalendarPlus size={15} />
      ذخیره و اقدام بعدی
    </button>
  );
}
