/**
 * Where the relay is, for every channel whose socket may be held on it.
 *
 * **One machine, one address, one token.** The relay is a process that holds the
 * company's WhatsApp *and* Telegram sessions — both are the same idea, a
 * personal account this application borrows, and both are unreachable from a
 * server behind Iran's filtering — so a second pair of variables for the second
 * channel would be two things to keep in step in order to name one host.
 *
 * `MESSAGING_RELAY_URL`/`MESSAGING_RELAY_TOKEN` are the names, and the WhatsApp
 * ones are **still read** so that nothing already deployed stops working: a
 * server configured before Telegram existed carries `WHATSAPP_RELAY_*` in its
 * env file, and renaming a variable out from under a live installation is a
 * channel that goes silent for a reason nothing on any screen can name. The new
 * name wins where both are set, because that is the one somebody typed on
 * purpose.
 */

export interface RelayEnv {
  url: string | undefined;
  token: string | undefined;
}

const first = (...values: (string | undefined)[]): string | undefined =>
  values.find((v) => String(v ?? "").trim() !== "");

export function relayEnv(): RelayEnv {
  return {
    url: first(process.env.MESSAGING_RELAY_URL, process.env.WHATSAPP_RELAY_URL),
    token: first(process.env.MESSAGING_RELAY_TOKEN, process.env.WHATSAPP_RELAY_TOKEN),
  };
}
