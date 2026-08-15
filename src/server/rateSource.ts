/**
 * Live currency rates, from tgju.org with alanchand.com behind it.
 *
 * Kept apart from the route that serves them so the same fetch can back both
 * "show me today's rates" and "refresh the stored ones" — the client used to
 * scrape through one endpoint and then write the answer back itself, which
 * meant every browser wrote its own copy and two of them refreshing at once
 * raced.
 *
 * Two sources because one scraped page is a single point of failure: a markup
 * change or an outage at tgju leaves every document priced at a stale rate, and
 * nothing says so. Only the currencies tgju could not give are asked of the
 * second source, and only then is its page fetched at all.
 *
 * The two publish in different units. tgju's `_rl` pages are in **rial**;
 * alanchand quotes **toman**, so its figures are multiplied by ten. That is
 * measured, not assumed: on the same afternoon tgju read 1,856,000 for the
 * dollar and alanchand 185,650.
 */

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/120.0.0.0 Safari/537.36";

const RATE_URLS: Record<string, string> = {
  USD: "https://www.tgju.org/profile/price_dollar_rl",
  EUR: "https://www.tgju.org/profile/price_eur",
  AED: "https://www.tgju.org/profile/price_aed",
  CNY: "https://www.tgju.org/profile/price_cny",
};

/** Persian names, for a row created by a refresh before anyone named it. */
export const RATE_NAMES: Record<string, string> = {
  USD: "دلار آمریکا",
  EUR: "یورو",
  AED: "درهم امارات",
  CNY: "یوان چین",
};

/**
 * The backup source: one page carrying every currency, so it is fetched once.
 * Slugs are alanchand's own, taken from the row's link.
 */
const ALANCHAND_URL = "https://alanchand.com/";

const ALANCHAND_SLUGS: Record<string, string> = {
  USD: "usd",
  EUR: "eur",
  AED: "aed",
  CNY: "cny",
};

/** alanchand prints its figures in Persian digits with thousands separators. */
function parsePersianNumber(text: string): number | null {
  const ascii = text
    .replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)))
    .replace(/[,،٬\s]/g, "");
  if (!/^\d+$/.test(ascii)) return null;
  const value = parseInt(ascii, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Toman to rial. alanchand quotes toman; everything stored here is rial. */
const TOMAN_TO_RIAL = 10;

/**
 * Reads the sell prices out of alanchand's home page.
 *
 * Each currency is a table row that links to its own page, so the slug in that
 * link anchors the search and the `sellPrice` cell that follows it is the
 * figure. The sell price is what the user asked for: it is what an importer
 * actually pays.
 *
 * Exported for its own sake — the parsing is the part that breaks when a site
 * is redesigned, and it can be checked against saved markup without a network.
 */
export function parseAlanchand(html: string): Record<string, number> {
  const out: Record<string, number> = {};

  for (const [code, slug] of Object.entries(ALANCHAND_SLUGS)) {
    const anchor = html.indexOf(`currencies-price/${slug}'`);
    if (anchor === -1) continue;

    // Bounded to this row: without a limit a currency missing its sell price
    // would pick up the next currency's.
    const row = html.slice(anchor, anchor + 1500);
    const match = /class="sellPrice[^"]*"[^>]*>\s*([\d۰-۹٠-٩,،٬]+)/.exec(row);
    if (!match) continue;

    const value = parsePersianNumber(match[1]);
    if (value !== null) out[code] = value * TOMAN_TO_RIAL;
  }

  return out;
}

async function fetchAlanchand(): Promise<Record<string, number>> {
  const response = await fetch(ALANCHAND_URL, {
    headers: { "User-Agent": BROWSER_UA },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`HTTP error ${response.status}`);
  return parseAlanchand(await response.text());
}

export interface ScrapedRates {
  rates: Record<string, number>;
  failedCurrencies: string[];
}

function parsePrice(html: string): number | null {
  // The figure sits in a data-col attribute; the plain "price" class is the
  // fallback for when that markup changes.
  for (const regex of [
    /data-col="info\.last_trade\.PDrCotVal"[^>]*>([\d,]+)<\/span>/,
    /class="price"[^>]*>([\d,]+)<\/span>/,
  ]) {
    const match = html.match(regex);
    if (match?.[1]) {
      const value = parseInt(match[1].replace(/,/g, ""), 10);
      if (!isNaN(value) && value > 0) return value;
    }
  }
  return null;
}

/**
 * Fetches every currency in parallel.
 *
 * A currency that cannot be read is reported rather than guessed at: writing a
 * fallback over a rate someone maintains by hand would be worse than leaving it
 * alone, and a document priced at a wrong rate is wrong for good.
 */
export async function scrapeRates(): Promise<ScrapedRates> {
  const rates: Record<string, number> = {};
  const failedCurrencies: string[] = [];

  await Promise.all(
    Object.entries(RATE_URLS).map(async ([code, url]) => {
      try {
        const response = await fetch(url, {
          headers: { "User-Agent": BROWSER_UA },
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error(`HTTP error ${response.status}`);

        const value = parsePrice(await response.text());
        if (value === null) throw new Error("Could not parse price from HTML");
        rates[code] = value;
      } catch (err) {
        console.warn(`Failed to fetch rate for ${code}:`, (err as Error)?.message ?? err);
        failedCurrencies.push(code);
      }
    }),
  );

  // Whatever tgju could not give, asked of the backup source — one page for all
  // of them, and only fetched when there is something to ask for.
  if (failedCurrencies.length > 0) {
    try {
      const backup = await fetchAlanchand();
      for (const code of [...failedCurrencies]) {
        const value = backup[code];
        if (value === undefined) continue;
        rates[code] = value;
        failedCurrencies.splice(failedCurrencies.indexOf(code), 1);
        console.warn(`Rate for ${code} taken from alanchand.com`);
      }
    } catch (err) {
      console.warn("Backup rate source failed:", (err as Error)?.message ?? err);
    }
  }

  return { rates, failedCurrencies };
}
