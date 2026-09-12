import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { loadSettings } from "../settings";
import { getTodayShamsi } from "../../dateUtils";
import { normalizeJalali } from "../dates";
import { WorkflowRule, enrichPayload, executeRule } from "./workflowService";
import { matchesConditions } from "../../utils/workflowConditions";
import { FINISHED_TASK_STATUSES, isTerminalOutcome } from "../../utils/salesFollowUp";
import { AFTER_SALES_CLOSED } from "../../utils/moduleStatuses";
import { getProformaOutcome } from "../proformaStatus";
import { expandDateFields } from "../dates";
import {
  REPEAT_SWEEP_WINDOW_DAYS, SCHEDULE_SUBJECTS, SWEEP_WINDOW_DAYS,
  dueDay, occurrenceDue, scheduleRepeats, scheduledRules, sweepRange,
} from "../../utils/workflowSchedule";

/**
 * The daily sweep that fires time-based workflow rules.
 *
 * Runs like the exchange-rate refresh does: once per Shamsi day, started by the
 * first person to sign in and never awaited by them. There is no cron on this
 * server and nothing else that ticks, and a scheduled rule that only fires when
 * somebody happens to open the right screen would be worse than no rule.
 *
 * Every firing is written to `workflow_firings` **before** the actions run, on
 * a unique index of (rule, record): the sweep runs again tomorrow, and the
 * records it looks at stay past their due day for ever. The insert failing on
 * that index is the normal way a second sweep discovers there is nothing to do.
 */

/** What the sweep reads from each model, and what it hands the rule. */
const PAYLOAD_SELECT: Record<string, Record<string, unknown>> = {
  proforma: {
    id: true, proformaNumber: true, status: true, projectId: true, customerId: true,
    currency: true, finalAmount: true, totalAmount: true,
    issueDateJalali: true, expiryDateJalali: true, deliveryDateJalali: true,
    sentDateJalali: true,
    /*
     * The state, not only the dates — see `SCHEDULE_MODEL_FIELDS.proforma`.
     *
     * `status` is the two-value stored column, so a quotation won a week ago
     * still reads «ارسال شده»: without these a rule counted from `sentDate`
     * fired on documents that had been won, lost, cancelled, superseded by a
     * revision, or deferred at the customer's own request.
     *
     * The lines come down with it because the outcome is derived from them and
     * from `isCancelled`, which is the whole reason it cannot be a column. That
     * is the one costly key here — a document of twenty lines is twenty rows —
     * so it is a `status` projection and nothing else, and this runs once a day.
     */
    isCancelled: true,
    followUpState: true,
    items: { select: { status: true } },
    _count: { select: { nextVersions: true } },
  },
  project: {
    id: true, code: true, name: true, status: true, customerId: true, salesExpert: true,
    creationDateJalali: true,
    /*
     * The stage and the day it last moved. A dwell rule asks about the stage in
     * its condition — «۷ روز در انتظار پاسخ تأمین‌کننده مانده» — and a payload
     * without it would match nothing while saving, printing and reading
     * perfectly: exactly the silent failure the trigger catalogue exists to end.
     */
    stage: true, stageChangedAtJalali: true,
    // And the sale's own clock, for «۳ روز پس از ثبت باخت» — a different
    // question from the stage's, which is why it is a different column.
    statusChangedAtJalali: true,
  },
  purchaseOrder: {
    id: true, poNumber: true, status: true, projectId: true, supplierId: true,
    orderDateJalali: true, expectedDeliveryDateJalali: true, statusChangedAtJalali: true,
  },
  afterSalesService: {
    // No customer of its own — it hangs off the project, and `enrichPayload`
    // resolves the customer from `projectId` the way it does everywhere else.
    id: true, itemName: true, status: true, projectId: true, proformaNumber: true,
    statusChangedAtJalali: true,
  },
  packagingDelivery: {
    id: true, packingListNumber: true, projectId: true, proformaId: true,
    deliveryDateJalali: true, actualDeliveryDateJalali: true,
  },
  supplierInquiry: {
    id: true, projectId: true, supplierId: true, isWinner: true,
    creationDateJalali: true,
  },
  /*
   * Only a recorded sales chase reaches here — the subject narrows to it, so
   * this is not «every task».
   *
   * `relatedToId` is the quotation the chase belongs to, and it is projected
   * into `proformaId` below rather than being left under this name: nothing
   * downstream reads `relatedToId`, while `enrichPayload` keys on `proformaId`
   * to find the document's project and its customer. Without that step the rule
   * fires, the message has nobody to go to, and the module owner is notified
   * instead of the customer.
   */
  task: {
    id: true, title: true, taskKind: true, priority: true, status: true,
    followUpResult: true, completionNote: true,
    relatedToType: true, relatedToId: true,
    assignedToName: true, completedAtJalali: true,
  },
};

/**
 * The values a scheduled rule can ask about that are not columns.
 *
 * A condition is evaluated at fire time against the record as it stands, which
 * is the whole mechanism that lets «هفت روز بعد» mean «هفت روز بعد, **if it is
 * still true**» — and it can only ask about what the payload carries. These
 * three are the states that decide whether a quotation is still the situation
 * the rule was written about, and none of them is storable:
 *
 *  - `outcome` is derived from the line statuses and `isCancelled`, which is
 *    why `proformas.status` cannot answer it and why a won document read
 *    «ارسال شده» to every rule ever written;
 *  - `superseded` is the existence of a revision, a relation a person creates;
 *  - `chaseCount` lives in another table entirely — one grouped read for the
 *    whole band rather than one per row, because the sweep sees up to 500.
 *
 * `relatedToType` is the **Latin** `"proforma"` here on purpose: that is what
 * `followUpService` writes, and the Persian spellings belong to tasks a person
 * typed (see `taskRelations.ts`). A chase counts once its **result** is
 * recorded — a cancelled one was never a conversation — which is also why this
 * is not a count of open tasks.
 */
async function derivedProformaValues(
  rows: Record<string, unknown>[],
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (rows.length === 0) return out;

  const ids = rows.map((r) => String(r.id));
  const chases = await getDb().task.groupBy({
    by: ["relatedToId"],
    where: {
      relatedToType: "proforma",
      taskKind: "SALES_FOLLOW_UP",
      relatedToId: { in: ids },
      followUpResult: { not: null },
    },
    _count: { _all: true },
  });
  const chaseCount = new Map<string, number>();
  for (const row of chases) {
    if (row.relatedToId) chaseCount.set(String(row.relatedToId), row._count._all);
  }

  for (const row of rows) {
    const id = String(row.id);
    const counts = row._count as { nextVersions?: number } | undefined;
    const outcome = getProformaOutcome(row as never);
    out.set(id, {
      outcome,
      /*
       * One condition instead of four «مخالف با …», and through the rule the
       * follow-up queue already uses to decide what it stops chasing — so a
       * quotation that leaves the queue leaves the automations with it.
       */
      settled: isTerminalOutcome(outcome),
      superseded: (counts?.nextVersions ?? 0) > 0,
      chaseCount: chaseCount.get(id) ?? 0,
    });
  }
  return out;
}

/**
 * How much of this project's after-sales work is still open.
 *
 * «یک ماه پس از تحویل کالا، بپرس نصب و راه‌اندازی چطور پیش رفت و اگر کمکی لازم
 * است ما هستیم» is a friendly note, and a friendly note is exactly the wrong
 * thing to send to a customer whose warranty complaint has been sitting on our
 * own desk for three weeks — it reads as not knowing. The packing list carries
 * no such state and could carry none: the cases are another module's rows.
 *
 * One grouped read for the whole band, the shape `chaseCount` takes, and the
 * open/closed rule is `afterSalesIsOpen`'s — an exclusion, so a status nobody
 * anticipated counts as open and withholds the note rather than sending it into
 * a complaint.
 */
async function derivedDeliveryValues(
  rows: Record<string, unknown>[],
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (rows.length === 0) return out;

  const projectIds = [...new Set(
    rows.map((r) => String(r.projectId ?? "")).filter(Boolean),
  )];
  const openByProject = new Map<string, number>();
  if (projectIds.length > 0) {
    const groups = await getDb().afterSalesService.groupBy({
      by: ["projectId"],
      where: {
        projectId: { in: projectIds },
        status: { notIn: AFTER_SALES_CLOSED as string[] },
      },
      _count: { _all: true },
    });
    for (const group of groups) {
      openByProject.set(String(group.projectId), group._count._all);
    }
  }

  for (const row of rows) {
    out.set(String(row.id), {
      openAfterSalesCount: openByProject.get(String(row.projectId ?? "")) ?? 0,
    });
  }
  return out;
}

/**
 * The quotation a recorded chase belongs to — its id, and what became of it.
 *
 * A follow-up task names its document through the polymorphic
 * `relatedToType`/`relatedToId` pair, and **nothing downstream reads those**:
 * `enrichPayload` keys on `proformaId` to resolve the project and the customer,
 * and `create_task` keys on it to decide what a task is about. So a rule
 * counted from «ثبت نتیجهٔ پیگیری» would fire correctly and reach nobody.
 *
 * The Latin `"proforma"` is what `followUpService` writes; the Persian
 * spellings belong to tasks a person typed, and a chase is never one of those.
 *
 * **And the quotation's own state had to come with it.** «۲ روز پس از ثبت نتیجهٔ
 * پیگیری، لینک نظرسنجی بفرست» is the rule this subject exists for, and the
 * subject offered `followUpResult`, `priority` and the id — nothing that could
 * ask whether the sale was *still* the one the rule was written about. So the
 * survey went to a customer who cancelled the next morning, exactly as the
 * `proforma` subject's own `status` field once wrote to customers whose order
 * had already been won or lost. Identical fault, through the other door: a date
 * says when to look and a condition says whether it is still true, and there was
 * nothing to ask.
 *
 * It reuses `derivedProformaValues` rather than deriving the outcome a second
 * time — that function already is the one reading, and the key names are the
 * same ones so a person writing «اگر معامله تمام نشده» writes one condition
 * whichever subject they chose.
 */
async function derivedTaskValues(
  rows: Record<string, unknown>[],
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (rows.length === 0) return out;

  const proformaOf = new Map<string, string>();
  for (const row of rows) {
    if (row.relatedToType === "proforma" && row.relatedToId) {
      proformaOf.set(String(row.id), String(row.relatedToId));
    }
  }

  /*
   * One read for the whole band, in exactly the shape `derivedProformaValues`
   * takes — the lines because the outcome is derived from them, the version
   * count because `superseded` is.
   */
  const ids = [...new Set(proformaOf.values())];
  const derived = ids.length === 0
    ? new Map<string, Record<string, unknown>>()
    : await derivedProformaValues(await getDb().proforma.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, status: true, isCancelled: true,
        items: { select: { status: true } },
        _count: { select: { nextVersions: true } },
      },
    }) as unknown as Record<string, unknown>[]);

  for (const row of rows) {
    const id = String(row.id);
    const proformaId = proformaOf.get(id);
    if (!proformaId) {
      out.set(id, {});
      continue;
    }
    /*
     * `chaseCount` is computed by that function and deliberately **not offered**
     * on this subject: it counts the recorded chases on the quotation, and a rule
     * fired *by* one of them would be asking about itself — never below 1, so a
     * condition on it could only ever mislead.
     */
    out.set(id, { proformaId, ...(derived.get(proformaId) ?? {}) });
  }
  return out;
}

/**
 * The derived state of a band of rows, for whichever model they are.
 *
 * **One reading, because there are two readers.** The firing sweep computes
 * these and so must `resolveFinishedTasks`: it reloads the raw row and asks
 * `matchesConditions` the same question, so without them a rule conditioned on
 * a derived field compared `undefined` against its value, answered «no longer
 * matches», closed the task it had just raised and deleted the firing — and the
 * next day's sweep raised it again. A create-and-close loop, every day, on a
 * rule that was written correctly. Two reviewers found it independently, which
 * is what a second copy of a derivation earns.
 *
 * A model with nothing derived answers an empty map, which is every subject
 * whose conditions are all stored columns.
 */
async function derivedValuesFor(
  model: string,
  rows: Record<string, unknown>[],
): Promise<Map<string, Record<string, unknown>>> {
  if (model === "proforma") return derivedProformaValues(rows);
  if (model === "task") return derivedTaskValues(rows);
  if (model === "packagingDelivery") return derivedDeliveryValues(rows);
  return new Map<string, Record<string, unknown>>();
}

/** The state of the once-a-day guard. Process-local, like the rate refresh's. */
let ranFor: string | null = null;
let running: Promise<number> | null = null;

/**
 * Runs the sweep at most once per Shamsi day.
 *
 * Started, not awaited, at login. Returns how many rules fired, which is what
 * the manual "run now" button reports.
 */
export async function ensureWorkflowSweepRanToday(
  todayJalali = getTodayShamsi(),
): Promise<number> {
  if (ranFor === todayJalali) return 0;
  if (running) return running;

  running = runDueWorkflows(todayJalali)
    .then((fired) => { ranFor = todayJalali; return fired; })
    .catch((err) => {
      // A failed sweep must not stop the next one from trying: leaving `ranFor`
      // alone means the next sign-in has another go.
      console.error("[workflow] scheduled sweep failed:", (err as Error)?.message || err);
      return 0;
    })
    .finally(() => { running = null; });

  return running;
}

/**
 * Fires every scheduled rule that has come due, once per record.
 *
 * Exported so the settings screen can ask for it on demand — a rule set up at
 * 10am should be testable at 10am, not tomorrow.
 */
export async function runDueWorkflows(todayJalali = getTodayShamsi()): Promise<number> {
  const settings = (await loadSettings()) as any;
  const rules = scheduledRules<WorkflowRule>(settings?.workflows ?? []);
  if (rules.length === 0) return 0;

  const db = getDb();
  const today = normalizeJalali(todayJalali) ?? todayJalali;
  let fired = 0;

  for (const rule of rules) {
    const subject = SCHEDULE_SUBJECTS[rule.schedule!.subject];
    const days = rule.schedule!.days;
    const direction = rule.schedule!.direction ?? "after";
    const select = PAYLOAD_SELECT[subject.model];
    if (!select) continue;

    /*
     * Only base dates inside the sweep's band: far enough back that a record
     * due long before the rule existed is left alone, and — for a rule that
     * counts *before* a date — far enough forward to see a date still ahead.
     *
     * A **repeating** rule reaches much further back, and that is not a tuning
     * knob: the record it is chasing is still stuck, which is the entire thing
     * being reported, so a 45-day lookback would silently stop chasing exactly
     * the orders that have been ignored longest.
     */
    const repeats = scheduleRepeats(rule.schedule);
    const band = sweepRange(
      days, today, direction,
      repeats ? REPEAT_SWEEP_WINDOW_DAYS : SWEEP_WINDOW_DAYS,
    );
    const delegate = (db as any)[subject.model];
    const rows: Record<string, unknown>[] = await delegate.findMany({
      where: {
        [subject.dateField]: { gte: band.from, lte: band.to, not: null },
        // The subject's own rows, where it is narrower than its table — see
        // `ScheduleSubject.where`. Absent for every subject that is a whole one.
        ...(subject.where ?? {}),
      },
      select,
      take: 500,
    });

    /*
     * The state the row cannot carry, read once for the whole band rather than
     * per record — and through the same `derivedValuesFor` the resolver uses,
     * because a second copy of this is how a task comes to be raised by one
     * half and closed by the other on the very same sweep.
     */
    const derived = await derivedValuesFor(subject.model, rows);

    for (const row of rows) {
      const base = row[subject.dateField] as string | null;
      /*
       * Which firing is due *now*, rather than whether the first one ever was.
       *
       * For a rule that does not repeat this answers 1 for ever and the guard
       * below is the same «once per record» it always was. For one that does,
       * it answers the occurrence today has reached — and deliberately only
       * that one: a server that was off for a fortnight comes back and raises a
       * single card, not the five it missed.
       */
      const occurrence = occurrenceDue(
        base, days, today, direction,
        rule.schedule!.repeatEveryDays, rule.schedule!.maxOccurrences,
      );
      if (occurrence < 1) continue;

      const entityId = String(row.id);
      // Written first, and the unique index is what decides: two servers, or a
      // sweep overlapping a manual run, cannot both get past this line. The
      // occurrence is part of that key, which is the whole of what lets a
      // repeat through while a one-shot rule stays a one-shot rule.
      try {
        await db.workflowFiring.create({
          data: {
            ruleId: rule.id,
            entityType: subject.entityType,
            entityId,
            occurrence,
            dueDay: dueDay(base, days, direction),
          } as Prisma.WorkflowFiringUncheckedCreateInput,
        });
      } catch (err) {
        // P2002: this rule has already fired this occurrence for this record.
        // Anything else is a real problem and is worth the log line.
        if ((err as { code?: string })?.code !== "P2002") {
          console.error("[workflow] could not record firing:", (err as Error)?.message || err);
        }
        continue;
      }

      try {
        // Through the same enrichment an event-driven rule gets, so the same
        // templates — {projectName}, {customerName} — work in both.
        const payload = await enrichPayload(
          {
            ...row,
            /*
             * Before the ids below, and after the row: these are the record's
             * own state and a column of the same name would be the thing they
             * exist to replace.
             */
            ...(derived.get(entityId) ?? {}),
            /*
             * The record this fired on, under the key the engine looks for.
             *
             * The row arrives with a plain `id` and nothing downstream reads
             * that: `enrichPayload` keys on `proformaId` to resolve the
             * document's project, and `create_task` keys on it to decide what
             * the task is *about*. Without it every scheduled rule raised a
             * task attached to the wrong record — a follow-up filed against a
             * project, which `completeFollowUp` refuses and the ordinary tick
             * refuses too, so it could not be closed from any screen.
             *
             * After the spread, deliberately: a proforma row carries its own
             * `projectId` foreign key and that is a different question from
             * «which record is this rule firing on».
             */
            [subject.payloadIdKey]: entityId,
            // What the record is, so a queued message names it as well.
            entityType: subject.entityType,
            entityId,
            ruleName: rule.name,
            elapsedDays: days,
            dueDay: dueDay(base, days, direction),
            /*
             * Which reminder this is. It reaches `create_task` for the
             * escalation and is a template variable in its own right, so a
             * repeating rule can title its card «یادآوری {occurrence}» rather
             * than printing the same sentence every three days.
             */
            occurrence,
            today,
          },
          subject.entityType,
        );
        await executeRule(rule, payload, undefined, settings);
        fired++;
      } catch (err) {
        console.error(`[workflow] rule "${rule.name}" failed on ${entityId}:`, (err as Error)?.message || err);
      }
    }
  }

  // Raising is only half of it — see `resolveFinishedTasks`.
  await resolveFinishedTasks(rules, today);

  return fired;
}

/* ------------------------- closing what is finished ------------------------ */

/** How many stale reminders one pass will retire. A ceiling, not a page. */
const RESOLVE_LIMIT = 500;

/** What the closing note says, so a person reading the card knows why. */
const RESOLVED_NOTE = "بسته شد چون شرط قانون دیگر برقرار نیست.";

/**
 * Closes the tasks a rule raised, once the record stops matching it.
 *
 * The half that was missing. `skipIfOpenSameKind` stops a *second* reminder and
 * nothing ever retired the first, so the supplier answered, the order cleared
 * customs, and the reminder sat on somebody's board for ever. A board filling
 * with dead reminders is a board people stop reading — which makes a working
 * automation worse than none, and is exactly why this had to land before
 * repeating reminders rather than after them.
 *
 * Four things decide its shape.
 *
 * **It walks the tasks, not the rule's subject rows.** The sweep above only
 * looks at records whose base date is inside the band, and a record that has
 * moved on has a *new* `statusChangedAt` — so it is out of the band precisely
 * when it becomes resolvable. Reading the tasks is the only query that finds it.
 *
 * **It asks the same question the firing asked**, through `matchesConditions`.
 * Two readings of «does this match» is how a task comes to be raised by one
 * half and never closed by the other.
 *
 * **A `SALES_FOLLOW_UP` is never auto-closed.** `completeFollowUp` is the only
 * thing that may close one — it moves the quotation's follow-up state and
 * raises the replacement in one transaction, and the ordinary tick refuses for
 * the same reason. Closing one here would tick the task and leave the quotation
 * marked as actively followed up with nothing chasing it.
 *
 * **The firing is deleted with the close**, so a record that falls back into
 * the state can be chased again: an order rejected at customs and sent back
 * into transit is a new problem, and `(ruleId, entityId)` would otherwise
 * remember the first one for ever. Only ever together with a real close, so a
 * rule cannot ping-pong on a record that still matches.
 */
export async function resolveFinishedTasks(
  rules: WorkflowRule[],
  today: string,
): Promise<number> {
  const db = getDb();
  let closed = 0;

  for (const rule of rules) {
    const wants = (rule.actions ?? []).some(
      (a) => a.type === "create_task" && a.taskConfig?.closeWhenResolved,
    );
    if (!wants || !rule.id) continue;

    const subject = SCHEDULE_SUBJECTS[rule.schedule!.subject];
    if (!subject) continue;

    const open = await db.task.findMany({
      where: {
        workflowRuleId: rule.id,
        workflowEntityId: { not: null },
        status: { notIn: [...FINISHED_TASK_STATUSES] },
        // Never a sales follow-up; see above.
        taskKind: { not: "SALES_FOLLOW_UP" },
      },
      select: { id: true, workflowEntityType: true, workflowEntityId: true },
      take: RESOLVE_LIMIT,
    });

    for (const task of open) {
      try {
        /*
         * The type stored on the task, not the rule's current subject: a rule
         * whose subject was changed since must not send the resolver to the
         * wrong table for a task already raised.
         */
        const model = task.workflowEntityType ?? subject.model;
        const select = PAYLOAD_SELECT[model];
        const delegate = (db as any)[model];
        if (!select || !delegate) continue;

        const row = await delegate.findUnique({
          where: { id: task.workflowEntityId },
          select,
        });

        /*
         * A record that is gone resolves the task with it: the thing the
         * reminder was about does not exist, so there is nothing to chase.
         */
        /*
         * The same derived state the firing had. Without it a condition on
         * `settled`, `outcome`, `superseded`, `chaseCount` or
         * `openAfterSalesCount` read `undefined` here, so the rule «no longer
         * matched» the instant it fired.
         */
        const derived = row
          ? (await derivedValuesFor(model, [row as Record<string, unknown>]))
              .get(String((row as { id?: unknown }).id)) ?? {}
          : {};

        const stillMatches = row
          ? matchesConditions(
              rule.conditions,
              await enrichPayload(
                {
                  ...row,
                  ...derived,
                  [subject.payloadIdKey]: task.workflowEntityId,
                  entityType: model,
                  entityId: task.workflowEntityId,
                  ruleName: rule.name,
                  today,
                },
                model,
              ),
            )
          : false;

        if (stillMatches) continue;

        /*
         * Conditional on it still being open, so two sweeps overlapping close
         * it once — the same shape as the follow-up's own closing.
         */
        const result = await db.task.updateMany({
          where: { id: task.id, status: { notIn: [...FINISHED_TASK_STATUSES] } },
          data: {
            status: "انجام شده",
            completionNote: `${RESOLVED_NOTE} (${rule.name})`,
            ...expandDateFields({ completedAt: today }, ["completedAt"]),
          },
        });
        if (result.count === 0) continue;

        closed++;
        await db.workflowFiring.deleteMany({
          where: { ruleId: rule.id, entityId: task.workflowEntityId },
        });
      } catch (err) {
        console.error(
          `[workflow] could not resolve "${rule.name}" on ${task.workflowEntityId}:`,
          (err as Error)?.message || err,
        );
      }
    }
  }

  return closed;
}
