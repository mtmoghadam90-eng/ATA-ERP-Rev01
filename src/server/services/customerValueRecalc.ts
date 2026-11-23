import { recalculateAll } from "./customerValueService";
import { getDb } from '../db';

/** Stored metrics from before this fix contain VAT. Refresh once after deploy;
 * mark success only after the new values were actually written. Normal
 * restarts skip the full recalculation, and a failed refresh retries next time.
 */
export async function refreshPreVatProfitMetricsOnce(db = getDb(), recalculate: () => Promise<unknown> = recalculateAll): Promise<void> {
  const id = 'profit-pre-vat-v1';
  if (await db.appSetting.findUnique({ where: { id } })) return;
  await recalculate();
  const data = JSON.stringify({ basis: 'PRE_VAT', completedAt: new Date().toISOString() });
  await db.appSetting.upsert({ where: { id }, create: { id, data }, update: { data } });
}

/**
 * Schedules a customer-value recalculation without making anyone wait for it.
 *
 * Every sale changes the ranking, because gross profit and frequency are scored
 * by percentile — one customer's order moves everyone else's standing. But a
 * recalculation reads every proforma in the evaluation period and rewrites a row
 * per customer, which is far too much to put in the path of saving a quotation.
 *
 * So writes call this instead. Two properties matter:
 *
 *  * **Coalescing.** Importing thirty proformas must not queue thirty passes.
 *    A request while one is already scheduled is absorbed; a request while one
 *    is *running* sets a flag so exactly one more follows it, because that
 *    request may have arrived after the running pass had already read the data.
 *  * **It can never fail a write.** A recalculation that throws is logged and
 *    forgotten. The sale is real whether or not the scoreboard caught up, and
 *    the nightly sweep and the manual button both put it right.
 *
 * The delay lets a burst of writes settle into one pass rather than starting
 * work the next line item is about to invalidate.
 */

const SETTLE_MS = 15_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let requestedWhileRunning = false;

async function run(): Promise<void> {
  running = true;
  try {
    await recalculateAll();
  } catch (err) {
    // Never rethrow: this is always running detached from a request.
    console.error("customer value recalculation failed:", err);
  } finally {
    running = false;
    if (requestedWhileRunning) {
      requestedWhileRunning = false;
      scheduleCustomerValueRecalculation();
    }
  }
}

/** Asks for a recalculation soon. Safe to call from anywhere, any number of times. */
export function scheduleCustomerValueRecalculation(delayMs: number = SETTLE_MS): void {
  if (running) {
    // The running pass may already have read past this change.
    requestedWhileRunning = true;
    return;
  }
  if (timer) return;

  timer = setTimeout(() => {
    timer = null;
    void run();
  }, delayMs);

  // A pending recalculation must not hold the process open at shutdown.
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as { unref: () => void }).unref();
  }
}

/** Runs one now and waits for it — for the manual button and the daily job. */
export async function recalculateCustomerValueNow(): Promise<void> {
  await run();
}
