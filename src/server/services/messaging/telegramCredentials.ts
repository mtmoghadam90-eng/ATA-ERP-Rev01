import {
  setTelegramCredentialSource, telegramCredentialsFrom, envTelegramCredentials,
  type TelegramCredentials,
} from "./telegramClient";
import { storedTelegramApi } from "./messageService";

/**
 * Where this ERP reads Telegram's `api_id`/`api_hash` from.
 *
 * **The provider row first, the environment second**, and both halves of that
 * are decisions rather than a hedge.
 *
 * The row is first because it is the home every other channel's credentials
 * already have: Kavenegar's API key, the SMTP password and Bale's bot token are
 * all typed into the messaging settings screen, and a secret in a provider row
 * never leaves the server — a masked hint goes out and a blank box on save means
 * «unchanged», which is the same rule `passwordHash` follows. Putting Telegram's
 * pair in an env file instead meant the one channel whose setup needed a shell
 * on a Windows server, for a value no more sensitive than the ones beside it.
 *
 * The environment stays because **the relay has no database**. That process runs
 * this same socket implementation and reopens its own session at its own boot,
 * long before any request could hand it anything, so there the env is not a
 * fallback but the only answer there is. Keeping it here too means an
 * installation already configured that way goes on working untouched — the rule
 * `relayEnv` follows for the relay's address, and for the same reason: a
 * variable renamed out from under a live installation is a channel that goes
 * silent for a reason nothing on any screen can name.
 *
 * It is **installed** rather than imported by the client, because the client is
 * the file the relay runs: a static import of this module would drag Prisma onto
 * a machine whose whole value is carrying two packages.
 */

/**
 * Reads the stored pair, falling back to the environment.
 *
 * Two rules, and the second is the one worth writing down.
 *
 * The fallback is per-*pair* and never per-field: a half-typed row beside a
 * complete env pair would otherwise mix an id from one home with a hash from the
 * other, and Telegram's answer to that is `API_ID_INVALID` — a sentence pointing
 * at neither of the two places the values came from.
 *
 * And **the row is in play the moment somebody has typed anything into it**,
 * refusal included, rather than only when it is usable. Read the other way, an
 * id mistyped on the settings screen falls through to a working env pair and the
 * channel connects — so the box says one thing, the session uses another, and
 * the typo is invisible for as long as the env value keeps rescuing it. A
 * completely empty row is «this company has not set Telegram up here», which is
 * the only case the environment answers.
 *
 * The two-step password is never stored, so it always comes from the
 * environment; on the ordinary path the panel supplies one for the length of a
 * single sign-in and this is not consulted at all.
 */
export function pickTelegramCredentials(
  stored: { apiId: unknown; apiHash: unknown },
  env: TelegramCredentials,
): TelegramCredentials {
  const typed = (v: unknown) => String(v ?? "").trim() !== "";
  if (!typed(stored.apiId) && !typed(stored.apiHash)) return env;
  return telegramCredentialsFrom(stored.apiId, stored.apiHash, env.password);
}

/** The two readings, joined. The rule above is the whole of the decision. */
export async function databaseTelegramCredentials(): Promise<TelegramCredentials> {
  return pickTelegramCredentials(await storedTelegramApi(), envTelegramCredentials());
}

/** Points the socket at this ERP's own reading. Called once, at startup. */
export function installTelegramCredentials(): void {
  setTelegramCredentialSource(databaseTelegramCredentials);
}
