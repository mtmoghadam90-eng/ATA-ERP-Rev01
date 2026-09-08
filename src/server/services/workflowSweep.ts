import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { loadSettings } from "../settings";
import { getTodayShamsi } from "../../dateUtils";
import { normalizeJalali } from "../dates";
import { WorkflowRule, enrichPayload, executeRule } from "./workflowService";
import { matchesConditions } from "../../utils/workflowConditions";
import { FINISHED_TASK_STATUSES } from "../../utils/salesFollowUp";
import { expandDateFields } from "../dates";
import {
  SCHEDULE_SUBJECTS, dueDay, isDue, scheduledRules, sweepRange,
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
const PAYLOAD_SELECT: Record<string, Record<string, boolean>> = {
  proforma: {
    id: true, proformaNumber: true, status: true, projectId: true, customerId: true,
    currency: true, finalAmount: true, totalAmount: true,
    issueDateJalali: true, expiryDateJalali: true, deliveryDateJalali: true,
    sentDateJalali: true,
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

    // Only base dates inside the sweep's band: far enough back that a record
    // due long before the rule existed is left alone, and — for a rule that
    // counts *before* a date — far enough forward to see a date still ahead.
    const band = sweepRange(days, today, direction);
    const delegate = (db as any)[subject.model];
    const rows: Record<string, unknown>[] = await delegate.findMany({
      where: {
        [subject.dateField]: { gte: band.from, lte: band.to, not: null },
      },
      select,
      take: 500,
    });

    for (const row of rows) {
      const base = row[subject.dateField] as string | null;
      if (!isDue(base, days, today, direction)) continue;

      const entityId = String(row.id);
      // Written first, and the unique index is what decides: two servers, or a
      // sweep overlapping a manual run, cannot both get past this line.
      try {
        await db.workflowFiring.create({
          data: {
            ruleId: rule.id,
            entityType: subject.entityType,
            entityId,
            dueDay: dueDay(base, days, direction),
          } as Prisma.WorkflowFiringUncheckedCreateInput,
        });
      } catch (err) {
        // P2002: this rule has already fired for this record. Anything else is
        // a real problem and is worth the log line.
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
