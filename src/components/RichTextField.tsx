import { useRef } from 'react';
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
  rows?: number;
  placeholder?: string;
  className?: string;
  /** LTR by default: these are Latin specifications. */
  dir?: 'rtl' | 'ltr';
}

export default function RichTextField({
  value, onChange, rows = 2, placeholder, className = '', dir = 'ltr',
}: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

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
