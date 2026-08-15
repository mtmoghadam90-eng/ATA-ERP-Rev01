import { getDb } from "../db";
import { getTodayShamsi, toShamsiStr } from "../../dateUtils";
import { RATE_NAMES, scrapeRates } from "../rateSource";

/**
 * Refreshing the stored currency rates once a day, on first use.
 *
 * Every foreign-priced document — a proforma line, a purchase order's landed
 * cost, a supplier's offer — is valued at the stored rate, and a rate that is
 * a week old prices the whole day's work wrongly without saying so. Until now
 * the only way it moved was somebody remembering to press "refresh" on the
 * settings screen.
 *
 * So the first request of the day that needs rates brings them up to date, and
 * every request after that finds them already fresh. Deliberately server-side:
 *
 *  - The browser cannot do it. Refreshing rates needs the settings permission,
 *    and the first person through the door in the morning is as likely to be a
 *    warehouse or sales account — for whom it would silently never happen.
 *  - Several people arrive within the same minute. One in-process promise means
 *    they all wait on the same scrape rather than each starting their own and
 *    hammering tgju four ways.
 *
 * "A day" is the Shamsi day the app itself displays, not 24 hours since the
 * last write: rates are quoted per trading day, and a refresh at 09:00 should
 * not stop tomorrow's 08:00 opening from getting new ones.
 */

/** How long a caller will wait before being served the stored rates instead. */
const WAIT_BUDGET_MS = 6000;

/** After a failed attempt, how long before another caller may try again. */
const RETRY_AFTER_MS = 30 * 60 * 1000;

/** Sentinel: the stored rates already carried today's date, so nothing was scraped. */
const ALREADY_CURRENT = -1;

export interface RateRefreshState {
  /** The Shamsi day whose rates are already stored, if any. */
  freshFor: string | null;
  /** When the last attempt gave nothing, epoch ms; 0 when none has. */
  lastFailureAt: number;
  /** Whether a scrape is running right now. */
  running: boolean;
}

/**
 * Whether this caller should start a scrape, wait on one, or do nothing.
 *
 * Pure, and separate from the work, because the interesting part of a
 * once-a-day job is entirely in these three answers — and the alternative is a
 * test that can only be run by waiting until tomorrow.
 */
export function refreshDecision(
  state: RateRefreshState,
  today: string,
  now: number,
  retryAfterMs = RETRY_AFTER_MS,
): "skip" | "wait" | "start" {
  if (state.running) return "wait";
  if (state.freshFor === today) return "skip";
  // A failed attempt holds everyone off for a while rather than making every
  // request of the morning re-scrape two web pages that are not answering.
  if (state.lastFailureAt > 0 && now - state.lastFailureAt < retryAfterMs) return "skip";
  return "start";
}

let freshFor: string | null = null;
let lastFailureAt = 0;
let inFlight: Promise<number> | null = null;

/** Whether every stored rate already carries today's date. */
async function alreadyRefreshedToday(today: string): Promise<boolean> {
  const rows = await getDb().exchangeRate.findMany({ select: { lastUpdated: true } });
  // Nothing stored yet is not "fresh": seeding creates the rows with opening
  // values that were current whenever the seed file was last touched.
  if (rows.length === 0) return false;
  return rows.every((r) => toShamsiStr(r.lastUpdated) === today);
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
    console.warn(`[rates] daily refresh could not read: ${failedCurrencies.join(", ")}`);
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
export async function ensureRatesFreshToday(): Promise<void> {
  const today = getTodayShamsi();

  try {
    const decision = refreshDecision(
      { freshFor, lastFailureAt, running: !!inFlight }, today, Date.now());
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
        // Somebody's manual refresh, or a restart part-way through the day.
        if (await alreadyRefreshedToday(today)) return ALREADY_CURRENT;
        return refreshNow();
      })()
        .then((updated) => {
          if (updated === ALREADY_CURRENT) {
            freshFor = today;
          } else if (updated > 0) {
            // Marked done only when something actually moved. A scrape that
            // read nothing leaves the day open for a later retry, or one bad
            // minute at 08:00 would freeze the rates until tomorrow.
            freshFor = today;
            lastFailureAt = 0;
            console.log(`[rates] daily refresh updated ${updated} currencies`);
          } else {
            lastFailureAt = Date.now();
          }
          return updated;
        })
        .catch((err) => {
          lastFailureAt = Date.now();
          console.warn("[rates] daily refresh failed:", (err as Error)?.message ?? err);
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
    console.warn("[rates] daily refresh check failed:", (err as Error)?.message ?? err);
  }
}
