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
import { PROJECT_TECHNICAL_APPROVED, PROJECT_TECHNICAL_OFFERED } from "./moduleStatuses";
import { STAGE_OFFER_REVIEW, STAGE_OFFER_REVIEW_WAS } from "./projectStage";
import {
  WEB_RFQ_COMMUNICATION_METHOD, WEB_RFQ_MARKETING_CHANNEL, webEntryIn,
} from "./webRfq";
import {
  RESULT_LOST_TO_COMPETITOR, RESULT_PURCHASE_CANCELLED, RESULT_PURCHASE_CONFIRMED,
  RESULT_TECHNICAL_APPROVED, resultKey,
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
    id: "web-rfq-channel-1",
    describe: "گزینهٔ «وب‌سایت» در کانال بازاریابی و روش ارتباط، برای استعلام‌های سایت",
    apply: (settings) => {
      /*
       * The two columns a website enquiry fills in are `<select>`s over these
       * lists, so a list with no website entry means the import must leave both
       * blank — the value would otherwise be rewritten to whatever heads the
       * list the first time somebody opened the project and pressed save.
       *
       * Added **only where the list has no entry that already means it**, which
       * `webEntryIn` decides across every spelling this build recognises: a
       * company that calls it «وب‌سایت» must not end up with «وب‌سایت / آنلاین»
       * beside it, because two names for one channel split every report that
       * groups by it. That is the `categoryKey` lesson, and it is the reason
       * this patch reads before it appends.
       */
      const lists = settings.dropdownItems;
      const marketingChannels = webEntryIn(lists?.marketingChannels)
        ? null
        : appendMissing(lists?.marketingChannels, [WEB_RFQ_MARKETING_CHANNEL]);
      const communicationMethods = webEntryIn(lists?.communicationMethods)
        ? null
        : appendMissing(lists?.communicationMethods, [WEB_RFQ_COMMUNICATION_METHOD]);
      if (!marketingChannels && !communicationMethods) return null;
      return {
        ...settings,
        dropdownItems: {
          ...lists,
          ...(marketingChannels ? { marketingChannels } : {}),
          ...(communicationMethods ? { communicationMethods } : {}),
        },
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
    id: "quiet-days-1",
    describe: "خاموش کردن ارسال پیام به مشتری در جمعه‌ها و تعطیلات رسمی",
    apply: (settings) => {
      /*
       * Asked for, so it has to reach a live document — and a default in
       * `seedData.ts` never does. Written **once**: from then on the checkbox
       * decides, so somebody who switches it back off is not re-decided by any
       * later reading of the code.
       *
       * Only ever an addition, as every patch here: a document that already
       * carries the key — because a person has pressed the control — is left
       * exactly as it is, whichever way they set it.
       */
      if (settings.messaging?.quietDays !== undefined) return null;
      return {
        ...settings,
        messaging: { ...settings.messaging, quietDays: true },
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
  {
    id: "project-stage-offer-review-rename-1",
    describe: "انتقال آستانه توقف «پیگیری پیش‌فاکتور» به نام جدید مرحله، «بررسی آفر توسط مشتری»",
    apply: (settings) => {
      /*
       * The stage was renamed by **this application**, not by the company — the
       * old word named what the sales desk was doing rather than where the job
       * had got to. `settings.stuckThresholds.projectStage` is keyed by that
       * name, and `pruneStuckThresholds` drops a key no state answers to on the
       * next settings save, so a company that had deliberately changed «۳۰ روز»
       * would have lost the number silently.
       *
       * This is a **move, not a rename of somebody's content**: the key belongs
       * to the application and only its own value travels with it. It never
       * touches a value already stored under the new name, and it does nothing
       * at all when the old key is absent — which is every fresh installation.
       */
      const stages = settings.stuckThresholds?.projectStage;
      const carried = stages?.[STAGE_OFFER_REVIEW_WAS];
      if (carried === undefined) return null;
      const { [STAGE_OFFER_REVIEW_WAS]: _dropped, ...rest } = stages ?? {};
      void _dropped;
      return {
        ...settings,
        stuckThresholds: {
          ...settings.stuckThresholds,
          projectStage: {
            // Anything already answering to the new name is the newer decision.
            [STAGE_OFFER_REVIEW]: carried, ...rest,
          },
        },
      };
    },
  },
  {
    id: "project-technical-offer-status-1",
    describe: "وضعیت «ارائه پیش‌فاکتور فنی» برای پروژه‌هایی که پیشنهاد فنی برایشان ارسال شده",
    apply: (settings) => {
      /*
       * `syncProjectStatus` writes this value the moment a technical offer is
       * sent, and the project form's status control is a `<select>` over this
       * very list. A `<select>` whose value matches no option renders the
       * **first** one — so without this entry somebody opening such a project
       * would see «جدید», change nothing, press save, and silently rewrite the
       * column. The list is the company's, so the entry is appended and never
       * reordered.
       */
      const next = appendMissing(settings.dropdownItems?.projectStatuses, [
        PROJECT_TECHNICAL_OFFERED,
      ]);
      if (!next) return null;
      return {
        ...settings,
        dropdownItems: { ...settings.dropdownItems, projectStatuses: next },
      };
    },
  },
  {
    id: "technical-approval-1",
    describe: "نتیجه پیگیری «تأیید پیشنهاد فنی» و وضعیت پروژه‌ای که از آن به دست می‌آید",
    apply: (settings) => {
      /*
       * Two lists, for the two reasons each entry has to exist.
       *
       * The result is what somebody picks on the follow-up form, and on a
       * database seeded before it the option would simply not be there — the
       * feature reading as broken rather than as unconfigured, exactly how the
       * settle-the-sale results were reported. It is compared **folded**, so a
       * company that already typed «تایید پیشنهاد فنی» without the hamza is not
       * handed a second copy beside it.
       *
       * The status is what `syncProjectStatus` then writes, and the project
       * form's control is a `<select>` over that list: a value matching no
       * option renders the first one, and saving would rewrite it to «جدید».
       */
      const results = settings.dropdownItems?.followUpResults ?? [];
      const hasResult = results.some((r) => resultKey(r) === resultKey(RESULT_TECHNICAL_APPROVED));
      const nextResults = hasResult ? null : [...results, RESULT_TECHNICAL_APPROVED];
      const nextStatuses = appendMissing(settings.dropdownItems?.projectStatuses, [
        PROJECT_TECHNICAL_APPROVED,
      ]);
      if (!nextResults && !nextStatuses) return null;
      return {
        ...settings,
        dropdownItems: {
          ...settings.dropdownItems,
          ...(nextResults ? { followUpResults: nextResults } : {}),
          ...(nextStatuses ? { projectStatuses: nextStatuses } : {}),
        },
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
