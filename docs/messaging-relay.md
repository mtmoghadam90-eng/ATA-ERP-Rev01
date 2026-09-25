# Sending WhatsApp and Telegram through a relay

Both channels send from the company's **own account** — WhatsApp as a linked
device, Telegram as a logged-in session. By default the socket that holds each
one runs inside the ERP process and no configuration is needed. This document is
about the other deployment: the sockets held on a machine outside the network,
with the ERP talking to it over HTTPS.

**One relay holds both.** They are the same idea, they are unreachable from the
same server for the same reason, and one process means one machine to secure,
one certificate to renew and one secret to rotate. What is *not* shared is the
pacing clock: two accounts are two accounts, and a WhatsApp send has nothing to
say about when Telegram may send next.

## When this is needed

Where WhatsApp is unreachable from the server. Behind that kind of filtering the
socket is reset before its handshake completes (`read ECONNRESET`), and because
**WhatsApp sends the pairing code during the handshake** — baileys does not
generate it locally — no code ever appears. There is nothing to fix in the code.

## Why a relay and not a proxy

A proxy is the tempting answer and is the wrong shape. A linked device holds one
connection open for days, so proxying it means every minute of that connection
crosses the filtered border, and every severance costs a fresh handshake — which
is exactly the machine-paced traffic that gets a number blocked.

A relay puts the socket entirely on the far side. The link from here carries only
short requests, and the outbox queue already retries those. **A failed POST is
free; a severed WebSocket is not.**

## What the relay is

Deliberately dumb: it holds the socket and nothing else. No customers, no
templates, no quiet hours, no opt-outs, no queue — all of that stays in the ERP,
where it already is. A second copy of any of it on another machine is how the one
nobody remembered (the opt-out) comes to be skipped.

Its endpoints answer exactly the shapes `src/server/services/messaging/whatsappClient.ts`
already exposes, because that file **is** what runs there — one implementation of
the socket, two places it can be deployed.

| Endpoint | Body | Answers |
|---|---|---|
| `POST /send` | `{ recipient, body }` | `{ ok, providerMessageId?, error? }` |
| `GET /status` | — | `WhatsappReport` + `linked: boolean` |
| `POST /link` | `{}` | `WhatsappReport` |
| `POST /unlink` | `{}` | `WhatsappReport` |
| `POST /tg/send` | `{ recipient, body }` | `{ ok, providerMessageId?, error?, retryAfterMs? }` |
| `GET /tg/status` | — | `TelegramReport` + `linked: boolean` |
| `POST /tg/link` | `{}` | `TelegramReport` |
| `POST /tg/unlink` | `{}` | `TelegramReport` |

`WhatsappReport` is `{ state, qr, linkedNumber, lastError, since }`. Note `qr` is
the **raw string**, not an image: the ERP renders it, which is why the pairing
code is still scanned from the ERP's own settings screen and nobody has to reach
the relay's console.

`TelegramReport` is the same shape with `linkedAccount` in place of
`linkedNumber`, and `qr` is the `tg://login?token=…` string — again raw, so the
login code is scanned from the ERP's own settings screen.

`retryAfterMs` on a Telegram send is the one field WhatsApp has no use for.
Telegram answers a rate limit with the number of seconds it wants
(`FLOOD_WAIT_…`, routinely minutes and occasionally a day), and the ERP's queue
honours it: the row stays QUEUED, its attempts are **not** spent, and it goes
when the wait is over. Dropped, the ordinary backoff would spend every attempt
inside the first two minutes, mark a perfectly good message FAILED, and make the
restriction worse each time.

Every request carries `Authorization: Bearer <MESSAGING_RELAY_TOKEN>`. The relay
must refuse anything else — an open `/send` on a public address is a machine
anybody can send as the company's own account from.

## Configuring the ERP

```
MESSAGING_RELAY_URL=https://relay.example.com
MESSAGING_RELAY_TOKEN=<a long random string>
```

`WHATSAPP_RELAY_URL`/`WHATSAPP_RELAY_TOKEN` are still read, so a server
configured before Telegram existed keeps working untouched; the new names win
where both are set, because those are the ones somebody typed on purpose.

Both, or neither. Rules the ERP enforces (`relayConfigRefusal`):

- **https is required** (loopback excepted), because the token would otherwise
  cross the border in the clear on every send;
- **the token is required**, for the reason above;
- a half-configured pair is **refused and reported** rather than falling back to
  the local socket — a silent fallback would send from the wrong place, or from
  nowhere, with nothing on any screen naming which.

The settings screen marks a relayed line «از طریق رله» and names which half a
failure belongs to — the route, the account, or the configuration.

## Running it

The relay is `relay/server.ts` **in this repository**, and it imports the ERP's
own `whatsappClient.ts` rather than copying it — the pairing, the reconnect
policy, the `loggedOut` rule and the session handling are one piece of code in
both deployments. That is why it lives here and not in a repository of its own,
and why the two `@whiskeysockets/baileys` pins — and the two `telegram` pins —
must stay identical (`test:rules` holds each pair against the other: two hosts on
two versions of an unofficial protocol client, against one account, is a fault
nobody would go looking for). The same is true of `telegramClient.ts`.

`relay/package.json` declares only baileys, `telegram` and `tsx`, so installing
inside `relay/` does not pull Prisma, sharp or anything else the ERP needs.

That has one consequence worth knowing, because it shipped wrong. Node resolves
a bare specifier from the directory of the **importing** file, walking upwards —
and `whatsappClient.ts` sits two directories above `relay/`, where there is no
`node_modules` at all. Written there, `import("@whiskeysockets/baileys")` simply
rejected on the relay host: the rejection was swallowed, the panel drew
«در انتظار اسکن کد» for as long as anybody watched, and the session directory —
two lines after the import — was never created, which is what finally named it.
So the client does not write the specifier; the relay does, next to the
`package.json` that declares it, and hands it over through `setBaileysLoader` —
and through `setTelegramLoader`, which exists for exactly the same reason.
**Nothing needs installing at the repository root on the relay host, and no
symlink is needed.**

## Setting it up

On the relay host, as root (Ubuntu 22.04 or 24.04):

```bash
# Node 20+ and git
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs git

# the code, and the relay's two packages
git clone https://github.com/<owner>/<repo>.git /opt/ata-relay
cd /opt/ata-relay/relay && npm install

# the shared secret; the same value goes in the ERP's WHATSAPP_RELAY_TOKEN
umask 077
printf 'RELAY_TOKEN=%s\n' "$(openssl rand -hex 32)" > .env
chmod 600 .env
```

`relay/server.ts` reads `process.env` and loads no `.env` itself, so systemd
injects it:

```ini
# /etc/systemd/system/ata-wa-relay.service
[Unit]
Description=ATA WhatsApp relay (linked device)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/ata-relay/relay
EnvironmentFile=/opt/ata-relay/relay/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
```

`WorkingDirectory` is load-bearing rather than tidiness: the session directory is
`process.cwd()/whatsapp-session`, so this is what decides where the credentials
land — inside the checkout, where `.gitignore` already covers them, so a later
`git pull` to update the relay does not unlink the device.

Then TLS in front of it. Either works; use whatever already runs on the host —
a `reverse_proxy 127.0.0.1:8787` line in a Caddyfile, or an nginx server block
plus `certbot --nginx -d <host>`. One setting is worth naming: give the proxy a
read timeout of at least 120s. `POST /link` waits on WhatsApp's handshake and a
60-second default can cut off exactly the request that was about to produce the
pairing code — which from the ERP's screen looks like «بارکد نمی‌دهد» and says
nothing about a proxy.

What it refuses to do:

- **start without `RELAY_TOKEN`**, or with one under 24 characters — an open
  relay looks perfectly healthy while anybody sends as the company's line;
- **bind anything but loopback** unless told to, so only the TLS proxy in front
  can reach it;
- **log a message body** — those are a customer's words on a rented machine, and
  a log is the one place they would accumulate. The recipient is masked.

It also holds a floor between sends (`WHATSAPP_GAP_MS.min` and
`TELEGRAM_GAP_MS.min`, the same constants the ERP paces by), **on its own clock
per line** — one shared timer would make a WhatsApp send delay the next Telegram
one for no reason at all. That is an **interlock and not a second copy of the
policy**: the ERP decides when and how many, this only guarantees that nothing —
a retry storm, anybody holding the token — can make either account send faster
than a person types.

## The relay host

- **Node 20 or newer** (`@whiskeysockets/baileys` requires it).
- Telegram's `api_id`/`api_hash`, from <https://my.telegram.org> → API development
  tools, in the relay's env as `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`.

  **On the relay they are env variables and nowhere else**, because this process
  has no database: it reopens its own session at its own boot, long before any
  request could hand it anything. On the ERP the same pair is typed into
  «پیام‌رسان → تنظیمات درگاه‌ها → تلگرام» and stored on the provider row like
  every other channel's credentials, with the environment kept as a fallback so
  an installation already configured that way goes on working. The two hosts
  read them independently; setting them on the ERP does not configure the relay.

  If the account has two-step verification, the password is typed into the box
  on the link panel when you press «اتصال حساب» — it travels inside the same
  https request the bearer token authenticates, is used for that one sign-in and
  is stored on neither machine. `TELEGRAM_2FA_PASSWORD` in the relay's env is the
  fallback for the one sign-in nobody is standing in front of: the relay
  reconnecting after a reboot.
- A persistent process (systemd), restarted on failure.
- A directory for the session, outside any path the web server serves.
- TLS: a domain and a certificate. If you would rather it were not publicly
  reachable at all, put WireGuard between the two machines and bind the relay to
  that interface only — the same argument applies, since this link carries only
  retryable requests.
- A fixed IP. Stability matters more than speed here: an exit address that
  changes re-handshakes constantly, which is itself the pattern to avoid.

## Two things to decide deliberately

**The session credentials move to a rented machine.** The files under
`whatsapp-session/` and `telegram-session/` can send *and read* as the company's
own accounts. That is a change in where the company's credentials sit, not a
detail. Both directories are gitignored for the same reason.

**A datacenter IP is not a residential one.** WhatsApp is more sensitive to some
datacenter ranges. Not a blocker — most linked-device setups on a VPS work — but
if the number is ever challenged, this is part of why.

Neither of these makes the account un-bannable, and the pacing stays what it is:
three messages a minute per channel, fixed in code.

## One honest limit on Telegram

**Not everyone with a phone number is reachable.** They may have no Telegram
account at all, and one who does can close «who can find me by my phone number»
— Telegram's default is open, so this is the minority, but it is a real refusal
and it is named rather than being a message that vanishes
(`RECIPIENT` / «گیرنده در تلگرام پیدا نشد»). The remedy is a person's: write that
contact's `@username` into the same field the mobile is in, which
`telegramPeer` accepts as an address in its own right.

This is also why there is no separate «Telegram username» column. A second
address book is the Bale lesson — a channel that reaches only the handful of
people somebody has filled a box in for — and the mobile every customer record
already carries is what makes this the directory's channel.
