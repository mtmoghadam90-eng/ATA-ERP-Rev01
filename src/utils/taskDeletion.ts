/**
 * Who may delete a task — the rule the server enforces and the screen draws
 * its bin from, so the bin appears on exactly the tasks the server accepts.
 *
 * **Whoever raised it, or a system administrator — never merely the person it
 * was given to.** That is the referral's rule (`canModifyActivity`): a request
 * belongs to the person who made it, and the person it was handed to answers it
 * by closing it, not by making it disappear. Deleting removes the task from the
 * board of whoever raised it too, with no notice, so work handed over could be
 * dropped in silence — which is what this closes. The assignee still has every
 * honest answer: «انجام شده», or «کنسل شده» when it is not going to be done.
 *
 * A task with **no recorded creator** — raised by an automation (the workflow
 * engine, the milestone rules, the sales follow-up, the assistant), or written
 * before `createdByUserId` existed — is nobody's to delete but an
 * administrator's, exactly as a system entry on the feed is. Reading a blank
 * creator as «anybody may» would hand every reminder a rule raised to whoever
 * it landed on, which is the silent drop again.
 */
export function canDeleteTask(
  task: { createdByUserId?: string | null },
  user: { id?: string | null; isSystemAdmin?: boolean | null } | null | undefined,
): boolean {
  if (!user?.id) return false;
  if (user.isSystemAdmin === true) return true;
  return !!task.createdByUserId && task.createdByUserId === user.id;
}

/** What the refusal says — naming the answer the assignee does have. */
export const TASK_DELETE_REFUSAL =
  "وظیفه را فقط کسی که آن را ثبت کرده یا مدیر سیستم می‌تواند حذف کند. اگر این کار انجام نمی‌شود، وضعیت آن را «کنسل شده» کنید.";
