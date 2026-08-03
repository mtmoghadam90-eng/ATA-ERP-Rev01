/**
 * Live currency rates, scraped from tgju.org.
 *
 * Kept apart from the route that serves them so the same fetch can back both
 * "show me today's rates" and "refresh the stored ones" — the client used to
 * scrape through one endpoint and then write the answer back itself, which
 * meant every browser wrote its own copy and two of them refreshing at once
 * raced.
 */

export const RATE_FALLBACKS: Record<string, number> = {
  USD: 625000,
  EUR: 678000,
  AED: 171000,
  CNY: 86000,
};

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
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
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

  return { rates, failedCurrencies };
}
