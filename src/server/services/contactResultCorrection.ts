import { getDb } from '../db';
import type { AuthUser } from '../auth';
import { loadSettings } from '../settings';
import { visibilityClause } from './taskService';
import { contactResultKey, takesContactResult, CONTACT_RESULT_UNRECORDED } from '../../utils/contactResults';
import { TASK_DONE } from '../../utils/workBoard';

/** Correct only the recorded answer, retaining status, completion date and files. */
export async function correctContactResult(
  id: string, input: { contactResult?: unknown; previousResult?: unknown }, user: AuthUser,
  db = getDb(), readSettings = loadSettings,
) {
  if (input.contactResult !== null && typeof input.contactResult !== 'string') throw new Error('نتیجه تماس نامعتبر است.');
  const value = String(input.contactResult ?? '').trim();
  if (value.length > 200) throw new Error('نتیجه تماس بیش از حد طولانی است.');
  const settings = await readSettings();
  const options = settings?.dropdownItems?.contactResults ?? [];
  const canonical = options.find((option) => contactResultKey(option) === contactResultKey(value)) ?? value;
  const visibility = visibilityClause(user);
  return db.$transaction(async (tx) => {
    const task = await tx.task.findFirst({ where: visibility ? { AND: [{ id }, visibility] } : { id } });
    if (!task) return null;
    if (!takesContactResult(task) || task.status !== TASK_DONE) throw new Error('فقط نتیجهٔ تماس وظیفهٔ انجام‌شدهٔ مرتبط با مشتری قابل اصلاح است.');
    const previous = task.contactResult ?? '';
    if (previous === canonical) return { contactResult: task.contactResult };
    if (!('previousResult' in input) || String(input.previousResult ?? '') !== previous) throw new Error('نتیجهٔ این تماس هم‌زمان تغییر کرده است؛ فرم را دوباره باز کنید.');
    if (value && !options.some((option) => contactResultKey(option) === contactResultKey(value))) throw new Error('نتیجه را از فهرست نتایج تماس انتخاب کنید.');
    await tx.task.update({ where: { id }, data: { contactResult: canonical || null } });
    await tx.taskWorkLog.create({ data: {
      taskId: id, kind: 'CONTACT_RESULT',
      text: `اصلاح نتیجه تماس از «${previous || CONTACT_RESULT_UNRECORDED}» به «${canonical || CONTACT_RESULT_UNRECORDED}»`,
      authorUserId: user.id, authorName: user.fullName || 'کاربر', createdAt: new Date(),
    } });
    return { contactResult: canonical || null };
  }, { isolationLevel: 'Serializable' });
}
