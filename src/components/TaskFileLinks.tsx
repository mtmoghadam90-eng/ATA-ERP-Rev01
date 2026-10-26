import { CornerDownLeft, Paperclip } from 'lucide-react';
import type { ActivityAttachment } from '../utils/attachments';

/**
 * What a task card says about where the work came from and what came with it:
 * «در ادامهٔ وظیفهٔ …» when it continues another, and the files — the ones
 * handed over with it and the ones attached to its «شرح اقدام».
 *
 * One component for the list and the board, so the two views a tab apart do
 * not draw the same three facts two ways. Draws nothing when there is nothing.
 */
export default function TaskFileLinks({ previousTaskTitle, attachments, completionAttachments, compact }: {
  previousTaskTitle?: string | null;
  attachments?: readonly ActivityAttachment[] | null;
  completionAttachments?: readonly ActivityAttachment[] | null;
  compact?: boolean;
}) {
  const given = attachments ?? [];
  const done = completionAttachments ?? [];
  if (!previousTaskTitle && given.length === 0 && done.length === 0) return null;
  const size = compact ? 'text-[10px]' : 'text-[11px]';
  const links = (files: readonly ActivityAttachment[]) => files.map((f) => (
    <a
      key={f.url}
      href={f.url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 text-sky-700 hover:underline break-all"
    >
      <Paperclip size={compact ? 9 : 11} />{f.name}
    </a>
  ));
  return (
    <div className={`space-y-0.5 ${size}`} data-task-trail>
      {previousTaskTitle && (
        <div className="text-muted inline-flex items-center gap-1" data-task-continues>
          <CornerDownLeft size={compact ? 9 : 11} />
          در ادامهٔ وظیفهٔ: <span className="text-slate-700 break-words">{previousTaskTitle}</span>
        </div>
      )}
      {given.length > 0 && <div className="flex flex-wrap gap-x-3 gap-y-0.5" data-task-files>{links(given)}</div>}
      {done.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5" data-task-completion-files>
          <span className="text-muted">پیوست شرح اقدام:</span>{links(done)}
        </div>
      )}
    </div>
  );
}
