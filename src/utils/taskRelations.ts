/**
 * What a task is attached to, whichever way the value was spelled.
 *
 * `Task.relatedToType` is written in **two languages**, by two sets of writers,
 * and nothing ever reconciled them. The task form stores the Persian words the
 * type union declares — «پروژه», «پیش‌فاکتور», «مشتری» — while every automated
 * writer stores a Latin key: `followUpService` raises each sales follow-up as
 * `"proforma"`, and the workflow engine, the milestone automation and the
 * assistant all raise theirs as `"project"`.
 *
 * The reader that resolves a task's project knew only the Persian spellings, so
 * the whole automated half of the board — every sales follow-up among it —
 * showed no project and no customer at all.
 *
 * Both spellings are read here, in one place, because the stored values cannot
 * be changed: `completeFollowUp` and several queries filter on
 * `relatedToType: "proforma"` exactly, and rewriting the column would orphan
 * every row already on disk.
 */

/** The kind of record a task points at, or null when it points at none. */
export type TaskRelationKind = "project" | "proforma" | "customer";

const KINDS: Record<string, TaskRelationKind> = {
  // What the task form writes.
  "پروژه": "project",
  "پیش‌فاکتور": "proforma",
  "مشتری": "customer",
  // What the automated writers write.
  project: "project",
  proforma: "proforma",
  customer: "customer",
};

export function taskRelationKind(relatedToType: unknown): TaskRelationKind | null {
  const key = String(relatedToType ?? "").trim();
  return KINDS[key] ?? null;
}

/**
 * Every spelling a query has to ask for to find one kind of relation.
 *
 * **Derived from the map above rather than written out beside it**, which is
 * the whole point of this file: a query naming only «پروژه» finds the tasks a
 * person typed and none of the ones the workflow engine raised, and a query
 * naming only `"project"` finds exactly the opposite half — each answering with
 * a plausible-looking list that is missing the other writer's work, which is
 * the silent half of the fault this file was written for.
 */
export function relationSpellings(kind: TaskRelationKind): string[] {
  return Object.keys(KINDS).filter((key) => KINDS[key] === kind);
}
