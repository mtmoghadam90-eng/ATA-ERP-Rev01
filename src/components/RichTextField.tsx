import { useEffect, useRef } from 'react';
import { Bold, Highlighter, Italic, Underline } from 'lucide-react';
import { RICH_MARKS, renderRichText, toggleMark } from '../utils/richText';

/**
 * A plain textarea with a small formatting toolbar and a live preview.
 *
 * Not a WYSIWYG editor, on purpose. The field it edits is read line by line by
 * the product configurator and is interpolated into the printed document, so
 * what is stored has to stay plain text — the toolbar writes markers and
 * `renderRichText` turns them into HTML at the one place that prints them. The
 * preview is there because a marker somebody cannot see the effect of is a
 * marker they will not trust.
 */

const ICONS = {
  bold: Bold,
  underline: Underline,
  italic: Italic,
  highlight: Highlighter,
} as const;

interface Props {
  value: string;
  onChange: (next: string) => void;
  /**
   * The **minimum** height, in lines. The box never draws shorter than this,
   * and grows past it to fit what is in it — see `maxRows`.
   */
  rows?: number;
  /**
   * The ceiling the growth stops at, after which the box scrolls like any
   * other textarea.
   *
   * There has to be one: a specification pasted out of a datasheet can run to
   * two hundred lines, and a box that matched it would push every control
   * below it off the screen with no way back but scrolling past the paste.
   */
  maxRows?: number;
  placeholder?: string;
  className?: string;
  /** LTR by default: these are Latin specifications. */
  dir?: 'rtl' | 'ltr';
  /**
   * Passed through to the textarea, so a field the settings screen has marked
   * required is still enforced by the browser — wrapping a control in a
   * component is exactly how that quietly stops happening.
   */
  required?: boolean;
}

export default function RichTextField({
  value, onChange, rows = 2, maxRows = 40, placeholder, className = '',
  dir = 'ltr', required = false,
}: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  /*
   * The box is as tall as what is in it.
   *
   * `rows` alone is a fixed window: a thirteen-feature specification typed
   * into a two-row box is twelve features the writer cannot see while
   * checking the thirteenth, and the same is true of a document's terms. So
   * `rows` becomes the floor and this grows past it, up to `maxRows`.
   *
   * Measured rather than computed from a line count, because the two callers
   * set different padding and line-height through `className` and a rule that
   * assumed one would be wrong on the other. Height is set to `auto` first so
   * `scrollHeight` reports the content rather than the height already applied
   * — without that the box only ever grows and never shrinks back when text
   * is deleted.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const style = window.getComputedStyle(el);
    const border = (parseFloat(style.borderTopWidth) || 0)
      + (parseFloat(style.borderBottomWidth) || 0);

    el.style.height = 'auto';
    /*
     * jsdom reports 0 for every layout figure, so this would set the box to
     * the borders alone and collapse it — `test:ui` renders this component.
     * A measurement of zero means «this environment does not lay out», and
     * the right answer there is to leave the `rows` attribute doing its job.
     */
    if (el.scrollHeight <= 0) {
      el.style.height = '';
      return;
    }

    // `scrollHeight` counts padding and not the border, while `height` under
    // Tailwind's border-box counts both — so the border is added back, or the
    // box is two pixels short and scrolls by exactly that.
    const wanted = el.scrollHeight + border;

    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5 || 16;
    const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const cap = lineHeight * maxRows + padding + border;

    const height = Math.min(wanted, cap);
    el.style.height = `${height}px`;
    // Only once it is capped: a scrollbar on a box that fits its content is a
    // phantom, and on Windows it reserves width and reflows the text under it.
    el.style.overflowY = wanted > cap ? 'auto' : 'hidden';
  }, [value, maxRows, rows]);

  const apply = (token: string) => {
    const el = ref.current;
    if (!el) return;
    const next = toggleMark(value ?? '', el.selectionStart, el.selectionEnd, token);
    onChange(next.text);
    // After React has written the new value, or the browser puts the caret at
    // the end and the next click formats the wrong words.
    //
    // `requestAnimationFrame` is not a global everywhere this renders — the
    // jsdom harness has it on `window` and not on `globalThis` — and a toolbar
    // that throws is worse than one that restores the caret a tick later.
    const afterPaint = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (fn: () => void) => setTimeout(fn, 0);
    afterPaint(() => {
      el.focus();
      el.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  };

  const preview = renderRichText(value);
  const formatted = preview !== renderRichText('') && /<(strong|em|span)/.test(preview);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        {RICH_MARKS.map((mark) => {
          const Icon = ICONS[mark.key];
          return (
            <button
              key={mark.key}
              type="button"
              title={mark.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply(mark.token)}
              className="p-1 rounded border border-slate-200 bg-white text-slate-500 hover:text-sky-600 hover:border-sky-300 transition"
            >
              <Icon size={12} />
            </button>
          );
        })}
        <span className="text-[9px] text-slate-400 mr-1">
          متن را انتخاب کنید و دکمه بزنید
        </span>
      </div>

      <textarea
        ref={ref}
        rows={rows}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className={className}
      />

      {/* Only once there is something to show: an empty box below every line
          would double the height of the grid for nothing. */}
      {formatted && (
        <div className="rounded-lg border border-slate-150 bg-slate-50/70 px-3 py-1.5">
          <div className="text-[9px] font-bold text-slate-400 mb-0.5">پیش‌نمایش چاپ</div>
          <div
            className="text-xs text-slate-700 leading-relaxed"
            style={{ whiteSpace: 'pre-line', direction: dir, textAlign: dir === 'ltr' ? 'left' : 'right' }}
            dangerouslySetInnerHTML={{ __html: preview }}
          />
        </div>
      )}
    </div>
  );
}
