import { getDb } from "../db";
import { RATE_NAMES, scrapeRates } from "../rateSource";

/**
 * Refreshing the stored currency rates, every two hours.
 *
 * Every foreign-priced document — a proforma line, a purchase order's landed
 * cost, a supplier's offer — is valued at the stored rate, and a stale rate
 * prices the whole day's work wrongly without saying so. Until this existed the
 * only way it moved was somebody remembering to press "refresh" on the settings
 * screen.
 *
 * It used to run once per Shamsi day, on the first sign-in. That is not enough
 * for a currency that moves through the day: a document priced at four in the
 * afternoon was carrying the morning's number. So the rates are considered
 * fresh for two hours, and three things ask for them:
 *
 *  - a sign-in, which is when the first person of the day arrives;
 *  - a read of `GET /api/exchange-rates`, which waits a moment for a fresh one;
 *  - a timer in the server process, so an afternoon with nobody signing in
 *    still gets the four o'clock rate.
 *
 * Deliberately server-side:
 *
 *  - The browser cannot do it. Refreshing rates needs the settings permission,
 *    and the first person through the door in the morning is as likely to be a
 *    warehouse or sales account — for whom it would silently never happen.
 *  - Several people arrive within the same minute. One in-process promise means
 *    they all wait on the same scrape rather than each starting their own and
 *    hammering tgju four ways.
 */


/** How long a caller will wait before being served the stored rates instead. */
const WAIT_BUDGET_MS = 6000;

/** How long a stored rate counts as current. */
export const FRESH_FOR_MS = 2 * 60 * 60 * 1000;

/** After a failed attempt, how long before another caller may try again. */
const RETRY_AFTER_MS = 30 * 60 * 1000;

/** Sentinel: the stored rates were already current, so nothing was scraped. */
const ALREADY_CURRENT = -1;

export interface RateRefreshState {
  /** When the rates were last brought up to date, epoch ms; 0 when never. */
  lastSuccessAt: number;
  /** When the last attempt gave nothing, epoch ms; 0 when none has. */
  lastFailureAt: number;
  /** Whether a scrape is running right now. */
  running: boolean;
}

/**
 * Whether this caller should start a scrape, wait on one, or do nothing.
 *
 * Pure, and separate from the work, because the interesting part of a periodic
 * job is entirely in these three answers — and the alternative is a test that
 * can only be run by waiting two hours.
 */
export function refreshDecision(
  state: RateRefreshState,
  now: number,
  freshForMs = FRESH_FOR_MS,
  retryAfterMs = RETRY_AFTER_MS,
): "skip" | "wait" | "start" {
  if (state.running) return "wait";
  if (state.lastSuccessAt > 0 && now - state.lastSuccessAt < freshForMs) return "skip";
  // A failed attempt holds everyone off for a while rather than making every
  // request re-scrape two web pages that are not answering.
  if (state.lastFailureAt > 0 && now - state.lastFailureAt < retryAfterMs) return "skip";
  return "start";
}

let lastSuccessAt = 0;
let lastFailureAt = 0;
let inFlight: Promise<number> | null = null;

/**
 * Whether every stored rate is younger than the freshness window.
 *
 * Asked of the database rather than only of this process's memory, so a restart
 * — or a second process — does not re-scrape rates that were fetched minutes
 * ago. `lastUpdated` is a real timestamp, so this is an age, not a calendar day.
 */
async function alreadyFresh(now: number): Promise<boolean> {
  const rows = await getDb().exchangeRate.findMany({ select: { lastUpdated: true } });
  // Nothing stored yet is not "fresh": seeding creates the rows with opening
  // values that were current whenever the seed file was last touched.
  if (rows.length === 0) return false;
  return rows.every((r) => now - new Date(r.lastUpdated).getTime() < FRESH_FOR_MS);
}

/**
 * Scrapes and stores, returning how many currencies moved.
 *
 * Writes the rows directly rather than through `upsertExchangeRate`, which
 * takes an `AuthUser` and checks the settings permission. There is no user
 * here, and inventing one that passes a permission check is the sort of thing
 * that gets reused later as a way around the check.
 *
 * A currency the sources could not give is left exactly as it was — never
 * overwritten with a fallback. A rate somebody maintains by hand is better than
 * a guess, and a document priced wrongly is wrong for good.
 */
async function refreshNow(): Promise<number> {
  const { rates, failedCurrencies } = await scrapeRates();
  const db = getDb();
  let updated = 0;

  for (const [currency, rateToRial] of Object.entries(rates)) {
    if (!(rateToRial > 0)) continue;
    await db.exchangeRate.upsert({
      where: { currency },
      create: { currency, name: RATE_NAMES[currency] ?? currency, rateToRial },
      update: { rateToRial, lastUpdated: new Date() },
    });
    updated++;
  }

  if (failedCurrencies.length > 0) {
    console.warn(`[rates] refresh could not read: ${failedCurrencies.join(", ")}`);
  }
  return updated;
}

/**
 * Brings the rates up to date if today's have not been fetched yet.
 *
 * Returns once the rates are current, or once `WAIT_BUDGET_MS` has passed —
 * whichever comes first. The scrape is not abandoned on timeout; it finishes in
 * the background and the next caller finds the new numbers. That bound exists
 * because the sources are two web pages: they answer in well under a second on
 * a normal day, and on a bad one nobody's first screen of the morning should
 * sit and wait for them.
 *
 * Never throws. A refresh that cannot happen must not take a working screen
 * down with it — the stored rates are still perfectly usable, just older.
 */
export async function ensureRatesFresh(): Promise<void> {
  const now = Date.now();

  try {
    const decision = refreshDecision(
      { lastSuccessAt, lastFailureAt, running: !!inFlight }, now);
    if (decision === "skip") return;

    if (decision === "start") {
      /*
       * Assigned synchronously, before the first `await` inside it.
       *
       * Several people sign in within the same second in the morning. If the
       * "is it already current?" query were awaited out here, two of them would
       * both see no run in progress and both start one.
       */
      inFlight = (async () => {
        // Somebody's manual refresh, or a restart inside the window.
        if (await alreadyFresh(now)) return ALREADY_CURRENT;
        return refreshNow();
      })()
        .then((updated) => {
          if (updated === ALREADY_CURRENT) {
            lastSuccessAt = now;
          } else if (updated > 0) {
            // Marked done only when something actually moved. A scrape that
            // read nothing leaves the window open for a retry, or one bad
            // minute would freeze the rates for the next two hours.
            lastSuccessAt = Date.now();
            lastFailureAt = 0;
            console.log(`[rates] refresh updated ${updated} currencies`);
          } else {
            lastFailureAt = Date.now();
          }
          return updated;
        })
        .catch((err) => {
          lastFailureAt = Date.now();
          console.warn("[rates] refresh failed:", (err as Error)?.message ?? err);
          return 0;
        })
        .finally(() => { inFlight = null; });
    }

    const running = inFlight;
    if (!running) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      running,
      new Promise((resolve) => { timer = setTimeout(resolve, WAIT_BUDGET_MS); }),
    ]);
    if (timer) clearTimeout(timer);
  } catch (err) {
    console.warn("[rates] refresh check failed:", (err as Error)?.message ?? err);
  }
}
