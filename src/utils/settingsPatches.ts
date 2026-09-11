/**
 * Additions to the settings document that an existing database has to be given.
 *
 * `settings` is one JSON row, seeded once and thereafter owned by the user: a
 * default added to `seedData.ts` reaches a fresh installation and no other. That
 * is right for most of it — a company's dropdown lists are theirs — and wrong
 * for the handful of entries a *rule* refers to by name.
 *
 * `settings.dropdownItems.followUpResults` is the case that made this necessary.
 * Three of its entries are what `impliedSettlement` keys on, so a stored list
 * without them cannot express the outcomes the follow-up screen exists to
 * record: the option was simply not in the dropdown, and the feature looked
 * broken rather than unconfigured. Editing every live settings document by hand
 * is the alternative, and it is the one that was already being asked for.
 *
 * Two rules keep this from becoming a way to overwrite people's choices.
 *
 * A patch is **applied once**, recorded by name in `settings.appliedPatches`, so
 * removing an entry afterwards sticks — nobody has an addition forced back on
 * them every restart. And a patch only ever **adds**: it never renames, reorders
 * or removes, because the list is the user's and this is a floor under it, not a
 * replacement for it.
 *
 * There is **one** exception and it proves the rule rather than loosening it.
 * A patch that *wrote* a value may later replace that exact value — the case is
 * `staff-sms-addressee-1`, because `staff-sms-notifications-1` copies the
 * message wording into the document, which then puts every later improvement to
 * that wording out of reach of every database but a brand-new one: the very
 * fault this file exists to answer, arriving through the door this file opened.
 * It is safe only under the condition that makes it not an overwrite — the
 * stored value must be **character-for-character** what the earlier patch
 * itself wrote, so anything a person has touched is untouched. A patch may
 * never replace a value it did not write, and `test:rules` holds this one
 * against an edited document.
 */

import type { ERPSettings } from "../types";
import { DEFAULT_NEXT_ACTION_KINDS } from "./nextAction";
import {
  RESULT_LOST_TO_COMPETITOR, RESULT_PURCHASE_CANCELLED, RESULT_PURCHASE_CONFIRMED,
} from "./salesFollowUp";
import {
  DEFAULT_STAFF_TEMPLATES, STAFF_NOTIFICATION_KINDS, SUPERSEDED_STAFF_TEMPLATES,
  type StaffNotificationKind,
} from "./staffNotifications";

export interface SettingsPatch {
  /** Recorded in `settings.appliedPatches`; never reused for different content. */
  id: string;
  /** What it does, in one line — read by whoever finds the id in the document. */
  describe: string;
  /** The new document, or null when there is nothing to change. */
  apply: (settings: ERPSettings) => ERPSettings | null;
}

/** Appends the entries a list lacks, in order, leaving what is there alone. */
function appendMissing(list: string[] | undefined, wanted: string[]): string[] | null {
  const current = list ?? [];
  const missing = wanted.filter((w) => !current.includes(w));
  return missing.length === 0 ? null : [...current, ...missing];
}

export const SETTINGS_PATCHES: SettingsPatch[] = [
  {
    id: "follow-up-settlement-results-1",
    describe: "سه نتیجه پیگیری که وضعیت تجاری پیش‌فاکتور را تعیین می‌کنند",
    apply: (settings) => {
      const next = appendMissing(settings.dropdownItems?.followUpResults, [
        RESULT_PURCHASE_CONFIRMED, RESULT_PURCHASE_CANCELLED, RESULT_LOST_TO_COMPETITOR,
      ]);
      if (!next) return null;
      return {
        ...settings,
        dropdownItems: { ...settings.dropdownItems, followUpResults: next },
      };
    },
  },
  {
    id: "staff-sms-notifications-1",
    describe: "پیامک ارجاع وظیفه و ارجاع کار به همکاران، با متن قابل ویرایش",
    apply: (settings) => {
      /*
       * Written in explicitly, and that is the whole point of doing it here.
       *
       * `staffNotifyEnabled` reads an absent key as **on**, because a live
       * database never sees a default added to `seedData` and this was asked
       * for. But «absent means on» would also mean somebody who switched it off
       * had their choice re-decided by any later reading of the code — so the
       * key is written down once, and from then on `false` is `false`.
       *
       * Only ever an addition: a document that already carries `staffSms` is
       * left exactly as it is, wording included.
       */
      if (settings.messaging?.staffSms) return null;
      return {
        ...settings,
        messaging: {
          ...settings.messaging,
          staffSms: { enabled: true, templates: { ...DEFAULT_STAFF_TEMPLATES } },
        },
      };
    },
  },
  {
    id: "staff-sms-addressee-1",
    describe: "افزودن خطاب همکار («آقای/خانم») به متن پیش‌فرض پیامک ارجاع کار",
    /*
     * The one patch that replaces rather than appends, and the reason it may.
     *
     * `staff-sms-notifications-1` above **copies** the wording into the settings document the
     * first time it runs, so every live database now stores the text of the day
     * it restarted — and a later edit of `DEFAULT_STAFF_TEMPLATES` reaches a
     * fresh installation and nothing else. That is the very rule this file
     * exists for, arriving through the door this file opened. Without this the
     * honorific would be a variable in the palette that the message nobody
     * edited never uses, which reads as a feature that was wired up and does
     * nothing.
     *
     * It is still not an overwrite: a stored template is replaced **only when
     * it is character-for-character** one of the wordings a previous patch
     * itself wrote (`SUPERSEDED_STAFF_TEMPLATES`). Anything a person has
     * touched — a word changed, a variable moved, a space added — is left
     * exactly as it is. Same rule as `isGeneratedPaymentBody` in the proforma
     * notes: a mechanism that manages a piece of text may take back precisely
     * what it put there and nothing else.
     *
     * A document with no `staffSms` at all is left to `staff-sms-notifications-1`,
     * which
     * writes the current defaults; patching it here as well would be two
     * writers for one value.
     */
    apply: (settings) => {
      const staff = settings.messaging?.staffSms;
      const stored = staff?.templates;
      if (!staff || !stored) return null;

      const next: Partial<Record<StaffNotificationKind, string>> = { ...stored };
      let changed = false;
      for (const kind of STAFF_NOTIFICATION_KINDS) {
        const current = stored[kind];
        if (typeof current !== "string") continue;
        if (!SUPERSEDED_STAFF_TEMPLATES[kind].includes(current)) continue;
        next[kind] = DEFAULT_STAFF_TEMPLATES[kind];
        changed = true;
      }
      if (!changed) return null;

      return {
        ...settings,
        messaging: {
          ...settings.messaging,
          staffSms: { ...staff, templates: next },
        },
      };
    },
  },
  {
    id: "next-action-kinds-1",
    describe: "انواع اقدام بعدی برای دکمهٔ «ذخیره و اقدام بعدی»",
    /*
     * A list, not a rule.
     *
     * Nothing in the code reads any of these strings — unlike the three
     * follow-up results above, which `impliedSettlement` keys on by name. It is
     * here for the plainer reason that a live settings document never sees a
     * default added to `seedData`, so on every existing installation the
     * dropdown would open empty and the button would read as broken rather than
     * as unconfigured. Appended only, so a company that deletes one keeps it
     * deleted.
     */
    apply: (settings) => {
      const next = appendMissing(
        settings.dropdownItems?.nextActionKinds, [...DEFAULT_NEXT_ACTION_KINDS]);
      if (!next) return null;
      return {
        ...settings,
        dropdownItems: { ...settings.dropdownItems, nextActionKinds: next },
      };
    },
  },
];

/**
 * The settings document with every patch it has not yet had.
 *
 * Returns `null` when there is nothing to do, so a caller writes only when
 * something actually changed — this runs at startup and on every settings save,
 * and a write per save of an already-patched document is pure noise.
 */
export function applySettingsPatches(
  settings: ERPSettings,
  patches: SettingsPatch[] = SETTINGS_PATCHES,
): { next: ERPSettings; applied: string[] } | null {
  const already = new Set(settings.appliedPatches ?? []);
  let next = settings;
  const applied: string[] = [];

  for (const patch of patches) {
    if (already.has(patch.id)) continue;
    const patched = patch.apply(next);
    /*
     * Recorded even when it changed nothing. A document that already has the
     * three entries — a fresh installation, or one somebody added by hand — is
     * as patched as one this just edited, and marking it says so once instead
     * of re-deciding every restart.
     */
    if (patched) next = patched;
    applied.push(patch.id);
  }

  if (applied.length === 0) return null;
  return {
    next: { ...next, appliedPatches: [...(next.appliedPatches ?? []), ...applied] },
    applied,
  };
}
