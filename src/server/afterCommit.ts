/**
 * Side effects that run once the record is already saved.
 *
 * The audit entry, the notification, the workflow rules and the project
 * timeline all happen *after* the write transaction commits — deliberately, so
 * that a notification which cannot be delivered never rolls back the document
 * it is about. But they were awaited plainly, so anything one of them threw
 * came back out of the route as a failed save: the proforma existed, its number
 * was taken, and the user was told it had not been saved and made a second one.
 *
 * These are bookkeeping, not the record. A failure here is logged and swallowed
 * — the same rule milestone automation already follows.
 */
export async function afterCommit(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const code = (err as { code?: string })?.code;
    console.error(`[api] after-commit ${label} failed:`, code ? `[${code}]` : "", (err as { message?: string })?.message || String(err));
  }
}
