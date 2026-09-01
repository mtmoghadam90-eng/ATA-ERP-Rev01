import { ExternalLink } from 'lucide-react';

/**
 * A project code, as a link to the project.
 *
 * The same element wherever a code is printed — a quotation, a purchase order,
 * a receipt, a task card — so following one behaves identically everywhere and
 * looks like the one thing it is. Without a handler it renders as the plain
 * text it always was, which is what keeps it safe to drop into a screen that
 * has not been wired up yet, and into a printed document.
 */

interface Props {
  code?: string | null;
  /** Given the code, opens «پروژه‌ها» filtered to it. */
  onOpen?: (code: string) => void;
  className?: string;
  /** Draw the small arrow. Off inside a dense grid cell. */
  showIcon?: boolean;
}

export default function ProjectCodeLink({ code, onOpen, className, showIcon = true }: Props) {
  const text = String(code ?? '').trim();
  if (!text) return null;

  // No handler is not a broken link, it is a label — which is what this is on
  // any screen that has not been given one, and in anything printed.
  if (!onOpen) return <span className={className}>{text}</span>;

  return (
    <button
      type="button"
      onClick={(e) => {
        // Codes sit inside rows that open their own record; following the
        // project is a different intent and must not do both.
        e.stopPropagation();
        onOpen(text);
      }}
      title={`رفتن به پروژه ${text}`}
      data-project-code={text}
      className={`inline-flex items-center gap-1 hover:text-sky-600 hover:underline transition ${className ?? ''}`}
    >
      {showIcon && <ExternalLink size={10} className="shrink-0 opacity-70" />}
      <span>{text}</span>
    </button>
  );
}
