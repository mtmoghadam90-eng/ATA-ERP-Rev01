import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { loadSettings } from "../settings";
import { getTodayShamsi } from "../../dateUtils";
import { normalizeJalali } from "../dates";
import { WorkflowRule, enrichPayload, executeRule } from "./workflowService";
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
  },
  purchaseOrder: {
    id: true, poNumber: true, status: true, projectId: true, supplierId: true,
    orderDateJalali: true, expectedDeliveryDateJalali: true,
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

  return fired;
}
