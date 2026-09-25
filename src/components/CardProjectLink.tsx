import { ExternalLink } from 'lucide-react';
import type { ActivityJump } from '../utils/notificationJump';

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

  const body = (
    <>
      {codeText && <span className="font-mono font-bold">{codeText}</span>}
      {codeText && nameText && <span className="text-sky-300">|</span>}
      {nameText && <span className="truncate">{nameText}</span>}
    </>
  );

  if (!jump || !onOpen) return <span className="inline-flex items-center gap-1 min-w-0">{body}</span>;

  return (
    <button
      type="button"
      data-card-project={jump.projectId}
      title={`باز کردن پروژه ${codeText || nameText}`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(jump);
      }}
      className="inline-flex items-center gap-1 min-w-0 hover:text-sky-500 hover:underline transition text-right"
    >
      <ExternalLink size={10} className="shrink-0 opacity-70" />
      {body}
    </button>
  );
}
