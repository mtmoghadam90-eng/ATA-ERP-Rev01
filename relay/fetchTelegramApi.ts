/**
 * Fetch the Telegram `api_id`/`api_hash` from my.telegram.org without a browser.
 *
 *   cd relay && npx tsx fetchTelegramApi.ts
 *
 * Run it on the relay host (outside the filtered network). It asks for the
 * account's phone number, then for the code Telegram sends to the Telegram app
 * (not an SMS), then prints the pair. If the account has no application yet it
 * creates one. Nothing is written to disk and nothing is logged anywhere but
 * this console. Output is English on purpose: Persian is mangled by consoles.
 */
import { createInterface } from "readline/promises";
import {
  parseCreateFormHash,
  parseTelegramApiApp,
  telegramAppShortName,
  telegramLoginPhone,
} from "../src/utils/telegramApiApp";

const BASE = "https://my.telegram.org";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "X-Requested-With": "XMLHttpRequest",
  Origin: BASE,
  Referer: `${BASE}/auth`,
};

async function post(path: string, form: Record<string, string>, cookie = "") {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", ...(cookie ? { Cookie: cookie } : {}) },
    body: new URLSearchParams(form).toString(),
    redirect: "manual",
  });
  return { res, body: await res.text() };
}

function fail(msg: string, detail?: string): never {
  console.error(`\nFAILED: ${msg}`);
  if (detail) console.error(`Server said: ${detail.slice(0, 300)}`);
  process.exit(1);
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const phone = telegramLoginPhone(await rl.question("Telegram phone number (e.g. +98912...): "));
  if (!phone) fail("That is not a phone number.");

  const sent = await post("/auth/send_password", { phone });
  let randomHash = "";
  try { randomHash = JSON.parse(sent.body).random_hash ?? ""; } catch { /* not JSON */ }
  if (!randomHash) {
    fail(
      /too many/i.test(sent.body)
        ? "Too many attempts for this number. Wait several hours (often 8-24h) and try again."
        : "my.telegram.org did not send a code.",
      sent.body,
    );
  }

  console.log("A code was sent to the Telegram app on that account (look for a message from 'Telegram').");
  const code = (await rl.question("Code: ")).trim();
  rl.close();

  const login = await post("/auth/login", { phone, random_hash: randomHash, password: code });
  const cookies = (login.res.headers.getSetCookie?.() ?? [])
    .map(c => c.split(";")[0])
    .filter(c => c.startsWith("stel_"));
  if (login.body.trim() !== "true" || !cookies.some(c => c.startsWith("stel_token="))) {
    fail("Sign-in to my.telegram.org was refused (wrong or expired code?).", login.body);
  }
  const cookie = cookies.join("; ");

  const appsPage = async () => {
    const r = await fetch(`${BASE}/apps`, { headers: { ...HEADERS, Cookie: cookie } });
    return r.text();
  };

  let html = await appsPage();
  let app = parseTelegramApiApp(html);
  if (!app) {
    const hash = parseCreateFormHash(html);
    if (!hash) fail("Could not read the apps page (no application and no creation form).", html.replace(/\s+/g, " "));
    const shortName = telegramAppShortName();
    const created = await post("/apps/create", {
      hash,
      app_title: "ATA ERP Messaging",
      app_shortname: shortName,
      app_url: "",
      app_platform: "desktop",
      app_desc: "Internal messaging for company customers",
    }, cookie);
    if (/error/i.test(created.body) && created.body.length < 200) {
      fail(
        "Telegram refused to create the application. This is usually the network (VPN / datacenter IP) " +
          "or an account that is too new. Try again later from another IP.",
        created.body,
      );
    }
    html = await appsPage();
    app = parseTelegramApiApp(html);
    if (!app) fail("The application was requested but its credentials did not appear on /apps.");
  }

  console.log("\nSuccess. Type these into the ERP (Messaging -> Providers -> Telegram) and/or the relay env:");
  console.log(`  TELEGRAM_API_ID=${app.apiId}`);
  console.log(`  TELEGRAM_API_HASH=${app.apiHash}`);
  console.log("Keep the hash private. It is not stored anywhere by this script.");
}

main().catch(err => fail(err instanceof Error ? err.message : String(err)));
