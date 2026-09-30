import { referralIsOpen } from "./workBoard";

/**
 * «به این شخص در همین دسته‌بندی قبلاً ارجاعی داده‌ای که هنوز باز است».
 *
 * Naming a colleague raises a referral, and naming them again on the same
 * category while the first is still open usually means somebody forgot the
 * first — two requests to one person about one strand of work is two cards on
 * their board saying the same thing. So the composer asks before sending. It
 * **asks rather than refuses**: a second, different request to the same
 * person on the same job is perfectly legitimate, and only the writer knows
 * which of the two this is.
 *
 * The scope is exactly the one asked for: **this category**, **this writer**
 * as the one who raised it, **this colleague** as its assignee, and **open**
 * by the board's own rule (`referralIsOpen`, an exclusion — a status nobody
 * anticipated counts as open, which asks one question too many rather than
 * letting a duplicate through silently). Matched by account id, never by name.
 */

export interface OpenReferralSource {
  createdAt?: string;
  referrals?: {
    assignedToUserId?: string | null;
    assignedByUserId?: string | null;
    assignedTo?: string;
    actionRequired?: string;
    status?: string | null;
    createdAt?: string;
  }[];
}

export interface OpenReferralHit {
  userId: string;
  name: string;
  /** What that open request asked, so the writer can tell whether it is the same. */
  actionRequired: string;
  createdAt: string;
}

/**
 * One hit per named colleague — the most recent open request — in the order
 * the colleagues were named. Empty when nothing would be duplicated.
 */
export function openReferralsTo(
  activities: OpenReferralSource[] | null | undefined,
  authorUserId: string | null | undefined,
  namedUserIds: string[],
): OpenReferralHit[] {
  if (!authorUserId || namedUserIds.length === 0) return [];
  const latest = new Map<string, OpenReferralHit>();
  for (const act of activities ?? []) {
    for (const ref of act.referrals ?? []) {
      const to = ref.assignedToUserId ?? "";
      if (!to || ref.assignedByUserId !== authorUserId) continue;
      if (!namedUserIds.includes(to) || !referralIsOpen(ref.status)) continue;
      const createdAt = ref.createdAt || act.createdAt || "";
      const seen = latest.get(to);
      if (seen && seen.createdAt >= createdAt) continue;
      latest.set(to, {
        userId: to,
        name: ref.assignedTo ?? "",
        actionRequired: ref.actionRequired ?? "",
        createdAt,
      });
    }
  }
  const out: OpenReferralHit[] = [];
  for (const id of namedUserIds) {
    const hit = latest.get(id);
    if (hit) out.push(hit);
  }
  return out;
}
