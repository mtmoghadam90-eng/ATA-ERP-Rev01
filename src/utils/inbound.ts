/**
 * Reading what a customer sent to the Bale bot.
 *
 * Bale's `getUpdates` answers Telegram's shape: an `update_id` and a `message`
 * carrying a `chat`, a `from`, and one of `text`, `caption`, `contact`,
 * `photo`, `document`, `voice`. This turns one update into the row the inbox
 * stores, or null for an update that is not a message from a person (an
 * edited message, a callback, a channel post). Pure, so it can be held without
 * a bot.
 */

export type InboundKind = "TEXT" | "CONTACT" | "PHOTO" | "DOCUMENT" | "VOICE" | "OTHER";

export const INBOUND_KIND_LABELS: Record<InboundKind, string> = {
  TEXT: "متن",
  CONTACT: "شماره تماس",
  PHOTO: "عکس",
  DOCUMENT: "فایل",
  VOICE: "پیام صوتی",
  OTHER: "سایر",
};

export interface ParsedInbound {
  updateId: number;
  chatId: string;
  senderName: string | null;
  senderUsername: string | null;
  phone: string | null;
  kind: InboundKind;
  text: string | null;
  fileName: string | null;
  /** When Bale says it was sent; the poll time when it does not say. */
  sentAt: Date | null;
}

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v)).trim();

export function parseBaleUpdate(update: unknown): ParsedInbound | null {
  const u = (update ?? {}) as Record<string, unknown>;
  const updateId = Number(u.update_id);
  if (!Number.isFinite(updateId)) return null;
  const m = u.message as Record<string, unknown> | undefined;
  if (!m || typeof m !== "object") return null;
  const chat = (m.chat ?? {}) as Record<string, unknown>;
  const chatId = str(chat.id);
  if (!chatId) return null;
  // A group or a channel is not a customer writing to us.
  if (chat.type && chat.type !== "private") return null;
  const from = (m.from ?? {}) as Record<string, unknown>;
  const name = [str(from.first_name || chat.first_name), str(from.last_name || chat.last_name)]
    .filter(Boolean).join(" ");
  const username = str(from.username || chat.username);

  let kind: InboundKind = "OTHER";
  let text: string | null = str(m.text) || str(m.caption) || null;
  let phone: string | null = null;
  let fileName: string | null = null;
  const contact = m.contact as Record<string, unknown> | undefined;
  if (contact && typeof contact === "object") {
    kind = "CONTACT";
    phone = str(contact.phone_number) || null;
    const who = [str(contact.first_name), str(contact.last_name)].filter(Boolean).join(" ");
    text = text ?? (who ? `${who}: ${phone ?? ""}`.trim() : phone);
  } else if (Array.isArray(m.photo) && m.photo.length > 0) {
    kind = "PHOTO";
  } else if (m.document && typeof m.document === "object") {
    kind = "DOCUMENT";
    fileName = str((m.document as Record<string, unknown>).file_name) || null;
  } else if (m.voice || m.audio) {
    kind = "VOICE";
  } else if (str(m.text)) {
    kind = "TEXT";
  }

  const date = Number(m.date);
  return {
    updateId,
    chatId,
    senderName: name || null,
    senderUsername: username || null,
    phone,
    kind,
    text,
    fileName,
    sentAt: Number.isFinite(date) && date > 0 ? new Date(date * 1000) : null,
  };
}

/** One line for a notice: the text, or what kind of thing was sent. */
export function inboundSummary(row: { kind: string; text?: string | null; fileName?: string | null }): string {
  const text = str(row.text);
  if (text) return text.length > 140 ? `${text.slice(0, 140)}…` : text;
  if (row.kind === "DOCUMENT" && row.fileName) return `[فایل: ${row.fileName}]`;
  return `[${INBOUND_KIND_LABELS[row.kind as InboundKind] ?? row.kind}]`;
}
