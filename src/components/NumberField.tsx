import { useEffect, useRef, useState } from 'react';
import { clampNumber, isPartialNumber, parseDecimalInput, toLatinDigits } from '../utils/numberInput';

/**
 * A numeric box that can actually be typed into.
 *
 * It is a text input, deliberately. `<input type="number">` reports a value
 * that is not yet a complete number as the empty string, so the decimal point
 * in «0.7» never reaches the code and the controlled value snaps back to "0" —
 * see `src/utils/numberInput.ts` for the whole story. Here the typed text is
 * held as it is and a number is reported only once there is one.
 *
 * `inputMode="decimal"` still brings up the numeric keypad on a phone, and
 * Persian digits are accepted because a figure typed on a Persian keyboard is
 * the same figure.
 */

interface Props {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Whole numbers only — a decimal point is simply not accepted. */
  integer?: boolean;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
}

export default function NumberField({
  value, onChange, min, max, integer, placeholder, className, disabled, id,
}: Props) {
  const [draft, setDraft] = useState(() => String(value ?? ''));
  const focused = useRef(false);

  /*
   * Re-seeded only when the stored figure really changes, and never while the
   * box has focus.
   *
   * The dependency is a primitive, so this cannot fire on a parent re-render
   * the way an object-prop effect does; the focus guard is for the other case —
   * the figure changing *because of* what is being typed, which would otherwise
   * rewrite the box under the cursor.
   */
  useEffect(() => {
    if (focused.current) return;
    setDraft(String(value ?? ''));
  }, [value]);

  const handle = (text: string) => {
    const latin = toLatinDigits(text);
    const cleaned = integer ? latin.replace(/\./g, '') : latin;
    // A keystroke that can never become a number is simply not accepted, which
    // is the one thing `type="number"` did well.
    if (!isPartialNumber(cleaned)) return;
    setDraft(cleaned);

    const parsed = parseDecimalInput(cleaned);
    // null means "not a number yet" — «0.», «-», «». Keep the text, write
    // nothing: the alternative is reading half a number as a decision.
    if (parsed === null) return;
    onChange(clampNumber(integer ? Math.trunc(parsed) : parsed, min, max));
  };

  return (
    <input
      id={id}
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => handle(e.target.value)}
      onBlur={() => {
        focused.current = false;
        /*
         * Whatever is left in the box is put back to what was stored. That
         * repairs a half-typed «0.» and shows a clamped figure in the same
         * move: type 500 into a field that caps at 30 and the box reads 30 once
         * you leave it. Nothing is written here — every complete number the
         * user typed was written as they typed it.
         */
        const parsed = parseDecimalInput(draft);
        setDraft(String(clampNumber(
          parsed === null ? value : (integer ? Math.trunc(parsed) : parsed), min, max,
        )));
      }}
    />
  );
}
