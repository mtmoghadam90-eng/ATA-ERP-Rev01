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
 */

import type { ERPSettings } from "../types";
import {
  RESULT_LOST_TO_COMPETITOR, RESULT_PURCHASE_CANCELLED, RESULT_PURCHASE_CONFIRMED,
} from "./salesFollowUp";

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
