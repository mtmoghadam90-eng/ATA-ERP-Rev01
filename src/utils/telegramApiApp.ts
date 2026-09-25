/**
 * Reading my.telegram.org's own pages, so the `api_id`/`api_hash` can be
 * fetched by a script rather than through a browser.
 *
 * The browser route fails for most people here with a bare «ERROR», and the
 * page never says why. The causes are almost always the connection rather than
 * the account — a VPN or datacenter exit, a browser extension rewriting the
 * form, a short name somebody else already took — so the same four requests
 * made from the relay host (outside the filtered network, on a clean client)
 * usually succeed where the browser did not. The flow is the site's own:
 * `send_password` → a code the Telegram app receives → `login` → `/apps`, and
 * `/apps/create` once if the account has no application yet.
 *
 * Pure so `test:rules` can hold the parsing; the requests live in
 * `relay/fetchTelegramApi.ts`. The pair is **printed and never stored**: it is
 * typed into the settings screen (the ERP) or the relay's env by a person.
 */

export interface TelegramApiApp {
  apiId: string;
  apiHash: string;
}

const textOf = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

/**
 * The pair off `/apps`, or null when the account has no application yet (the
 * page is then the creation form). `api_id` is digits and `api_hash` 32 hex
 * characters — anything else is not what this page prints, and a wrong pair
 * typed into the settings fails at sign-in with nothing naming the typo.
 */
export function parseTelegramApiApp(html: string): TelegramApiApp | null {
  const text = textOf(html);
  const id = /App\s+api_id\s*:?\s*(\d{3,12})\b/i.exec(text);
  const hash = /App\s+api_hash\s*:?\s*([0-9a-f]{32})\b/i.exec(text);
  if (!id || !hash) return null;
  return { apiId: id[1], apiHash: hash[1] };
}

/** The hidden `hash` input the creation form posts back, or null. */
export function parseCreateFormHash(html: string): string | null {
  const m =
    /<input[^>]*name=["']hash["'][^>]*value=["']([^"']+)["']/i.exec(html) ??
    /<input[^>]*value=["']([^"']+)["'][^>]*name=["']hash["']/i.exec(html);
  return m ? m[1] : null;
}

/**
 * A short name the site will accept: 5–32 Latin letters and digits, starting
 * with a letter. A taken or malformed one is the commonest cause of the bare
 * «ERROR», so the script proposes a unique one rather than a word somebody
 * else registered years ago. `random` is injected so the rule is testable.
 */
export function telegramAppShortName(random: () => number = Math.random): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let tail = "";
  for (let i = 0; i < 8; i++) tail += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
  return `ataerp${tail}`;
}

export const TELEGRAM_SHORT_NAME_RULE = /^[a-z][a-z0-9]{4,31}$/i;

/** International digits for the phone box: `+98912…`, the form the site asks for. */
export function telegramLoginPhone(raw: string): string | null {
  const fa = "۰۱۲۳۴۵۶۷۸۹", ar = "٠١٢٣٤٥٦٧٨٩";
  let digits = "";
  for (const ch of String(raw ?? "")) {
    const f = fa.indexOf(ch), a = ar.indexOf(ch);
    if (f >= 0) digits += String(f);
    else if (a >= 0) digits += String(a);
    else if (/[0-9]/.test(ch)) digits += ch;
  }
  const trimmed = String(raw ?? "").trim();
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11) digits = "98" + digits.slice(1);
  else if (!trimmed.startsWith("+") && digits.length === 10 && digits.startsWith("9")) digits = "98" + digits;
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
}
