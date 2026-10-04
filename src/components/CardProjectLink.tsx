import { ExternalLink } from 'lucide-react';
import type { ActivityJump } from '../utils/notificationJump';
import { activityHref, isPlainLeftClick } from '../utils/appLinks';

/**
 * The project's code and name on a work card, as one press into the project.
 *
 * Drawn by the board and by both kinds of row on the list, so the three read
 * and behave alike. Without a jump or a handler it is the plain text it always
 * was — a customer-only line, or a screen nobody has wired up.
 *
 * The press **stops the event**: the card's own headline opens the record,
 * and following the project is a different intent that must not do both.
 */
interface Props {
  code?: string | null;
  name?: string | null;
  jump?: ActivityJump | null;
  onOpen?: (jump: ActivityJump) => void;
}

export default function CardProjectLink({ code, name, jump, onOpen }: Props) {
  const codeText = String(code ?? '').trim();
  const nameText = String(name ?? '').trim();
  if (!codeText && !nameText) return null;

  /*
   * The name is written out in full and wraps, rather than being cut to one
   * line: on a board column two hundred pixels wide «ترانسمیترهای پروژه ن…» was
   * all anybody could read, and several jobs here share their first words. The
   * code never wraps — «ATA-05-\n40» reads as two codes — and the whole line is
   * also the hover text.
   */
  const full = [codeText, nameText].filter(Boolean).join(' | ');
  const body = (
    <>
      {codeText && <span className="font-mono font-bold whitespace-nowrap" dir="ltr">{codeText}</span>}
      {codeText && nameText && <span className="text-sky-300">|</span>}
      {nameText && <span className="break-words min-w-0" data-card-project-name>{nameText}</span>}
    </>
  );

  if (!jump || !onOpen) {
    return <span className="inline-flex flex-wrap items-center gap-1 min-w-0" title={full}>{body}</span>;
  }

  return (
    // A link with an address, so the project can be opened in a new tab; an
    // ordinary click still opens it here (`appLinks.ts`).
    <a
      href={activityHref(jump)}
      data-card-project={jump.projectId}
      title={`باز کردن پروژه: ${full}`}
      onClick={(e) => {
        e.stopPropagation();
        if (!isPlainLeftClick(e)) return;
        e.preventDefault();
        onOpen(jump);
      }}
      className="inline-flex flex-wrap items-center gap-1 min-w-0 hover:text-sky-500 hover:underline transition text-right"
    >
      <ExternalLink size={10} className="shrink-0 opacity-70" />
      {body}
    </a>
  );
}
