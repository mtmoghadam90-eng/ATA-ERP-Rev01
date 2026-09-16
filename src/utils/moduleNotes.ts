import { nameKey } from "./assigneeName";
import type { ActivityAttachment } from "./attachments";

/**
 * The rules a document's note follows, with nothing to run them against.
 *
 * `module_notes` is the table behind «توافقات خاص و کامنت‌های این پیش‌فاکتور»
 * and the same block on three other screens. Two of its rules are decisions
 * rather than plumbing, and both are read from two places — the service that
 * enforces them and the screen that has to draw controls matching them — so
 * they live here where one copy answers for both.
 */

/** Whatever the two sides of the authorship question know about a note. */
export interface NoteAuthorship {
  authorUserId: string | null | undefined;
  authorName: string | null | undefined;
}

/** Whatever a reader knows about themselves. */
export interface NoteReader {
  id: string;
  isSystemAdmin?: boolean;
  /** Only ever needed for a note written before `authorUserId` existed. */
  fullName?: string | null;
}

/**
 * Whether this person may remove this note.
 *
 * **The id decides; the name is the fallback for rows that have no id.**
 * Matching by name was the whole rule until that column existed, and a name is
 * not an identity here: SQL Server's collation reads ی/ي and ک/ك apart, two
 * colleagues genuinely share a name, and renaming an account silently took away
 * the right to delete one's own notes. It is the fault `resolveAssignee` was
 * written for, arriving on a delete button. Where the id is present it answers
 * alone, so a rename changes nothing and a namesake is not somebody else.
 *
 * The fallback folds through `nameKey` rather than comparing strings, which is
 * what the old rule did — so a note written under «محمد مقدم» and an account
 * spelled with ي is the same person, which it always was.
 *
 * **A note with neither is nobody's**, and only an administrator may remove it:
 * reading a blank author as «matches my blank name» would let anybody delete
 * every anonymous note in the company.
 */
export function canDeleteNote(note: NoteAuthorship, reader: NoteReader): boolean {
  if (reader.isSystemAdmin) return true;
  if (note.authorUserId) return note.authorUserId === reader.id;
  const mine = nameKey(String(reader.fullName ?? ""));
  return mine !== "" && nameKey(String(note.authorName ?? "")) === mine;
}

/**
 * Whether there is anything to record.
 *
 * **A file on its own is a note.** What is written here is usually an
 * agreement, and the evidence of one is the customer's confirming email or a
 * signed page — so «متن یادداشت الزامی است» in front of somebody who has just
 * attached exactly that is a refusal about the wrong thing. The screen and the
 * server both ask this, or one of the two is a control that does nothing.
 */
export function noteHasContent(
  text: string | null | undefined,
  attachments: ActivityAttachment[],
): boolean {
  return String(text ?? "").trim().length > 0 || attachments.length > 0;
}

/**
 * What the project's timeline says a note was.
 *
 * A file-only note has no words to quote, and «یادداشت … : «»» around a blank
 * reads as a history entry that failed to load rather than as one that happened
 * — so it names the files, which is what was actually added. A note with both
 * keeps its words and says how many came with them, because the words are what
 * somebody reading the history is looking for.
 */
export function noteSummary(
  text: string | null | undefined,
  attachments: ActivityAttachment[],
): string {
  const words = String(text ?? "").trim();
  const count = attachments.length;
  if (words) {
    return count > 0 ? `${words} (${count.toLocaleString("fa-IR")} پیوست)` : words;
  }
  if (count === 0) return "";
  return count === 1
    ? `فایل «${attachments[0].name}» پیوست شد`
    : `${count.toLocaleString("fa-IR")} فایل پیوست شد`;
}
