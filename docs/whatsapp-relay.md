# Sending WhatsApp through a relay

The WhatsApp channel sends from the company's **own line**, as a linked device.
By default the socket that holds that device runs inside the ERP process and no
configuration is needed. This document is about the other deployment: the socket
held on a machine outside the network, with the ERP talking to it over HTTPS.

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

`WhatsappReport` is `{ state, qr, linkedNumber, lastError, since }`. Note `qr` is
the **raw string**, not an image: the ERP renders it, which is why the pairing
code is still scanned from the ERP's own settings screen and nobody has to reach
the relay's console.

Every request carries `Authorization: Bearer <WHATSAPP_RELAY_TOKEN>`. The relay
must refuse anything else — an open `/send` on a public address is a machine
anybody can send as the company's line from.

## Configuring the ERP

```
WHATSAPP_RELAY_URL=https://wa-relay.example.com
WHATSAPP_RELAY_TOKEN=<a long random string>
```

Both, or neither. Rules the ERP enforces (`relayConfigRefusal`):

- **https is required** (loopback excepted), because the token would otherwise
  cross the border in the clear on every send;
- **the token is required**, for the reason above;
- a half-configured pair is **refused and reported** rather than falling back to
  the local socket — a silent fallback would send from the wrong place, or from
  nowhere, with nothing on any screen naming which.

The settings screen marks a relayed line «از طریق رله» and names which half a
failure belongs to — the route, the account, or the configuration.

## The relay host

- **Node 20 or newer** (`@whiskeysockets/baileys` requires it).
- A persistent process (systemd), restarted on failure.
- A directory for the session, outside any path the web server serves.
- TLS: a domain and a certificate. If you would rather it were not publicly
  reachable at all, put WireGuard between the two machines and bind the relay to
  that interface only — the same argument applies, since this link carries only
  retryable requests.
- A fixed IP. Stability matters more than speed here: an exit address that
  changes re-handshakes constantly, which is itself the pattern to avoid.

## Two things to decide deliberately

**The session credentials move to a rented machine.** The files under the
relay's session directory can send *and read* as the company's line. That is a
change in where the company's credentials sit, not a detail.

**A datacenter IP is not a residential one.** WhatsApp is more sensitive to some
datacenter ranges. Not a blocker — most linked-device setups on a VPS work — but
if the number is ever challenged, this is part of why.

Neither of these makes the number un-bannable, and the pacing stays what it is:
three messages a minute, fixed in code.
