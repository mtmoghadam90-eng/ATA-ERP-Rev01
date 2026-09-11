import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { loadSettings } from "../settings";
import { getTodayShamsi } from "../../dateUtils";
import { normalizeJalali } from "../dates";
import { WorkflowRule, enrichPayload, executeRule } from "./workflowService";
import { matchesConditions } from "../../utils/workflowConditions";
import { FINISHED_TASK_STATUSES, isTerminalOutcome } from "../../utils/salesFollowUp";
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
      },
      select,
      take: 500,
    });

    /*
     * The state the row cannot carry, read once for the whole band rather than
     * per record. Only the quotation has any: the other subjects' conditions
     * are all stored columns.
     */
    const derived = subject.model === "proforma"
      ? await derivedProformaValues(rows)
      : new Map<string, Record<string, unknown>>();

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
        const stillMatches = row
          ? matchesConditions(
              rule.conditions,
              await enrichPayload(
                {
                  ...row,
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
