/**
 * Where a notification leads.
 *
 * The «اعلان‌ها» panel listed what had happened and led nowhere: the only
 * clickable thing on it was the project's name, and the handler behind that
 * was never passed in by the screen that embeds the panel — so every notice
 * on it was a dead end, and reading «فلانی به ارجاع شما پاسخ داد» meant going
 * to «پروژه‌ها», finding the job, opening its feed and hunting for the
 * category the referral was raised under. The evidence was already on the row:
 * a referral carries its originating message, that message carries its
 * category group, and the group carries its project.
 *
 * Pure on purpose — `test:rules` holds the rules below, and the three of them
 * are exactly the places a link like this goes wrong.
 */

export interface ActivityJump {
  /** The job whose feed to open. Required: everything else hangs off it. */
  projectId: string;
  /**
   * Which category group to expand. Absent opens the feed as it stands.
   */
  groupId?: string;
  /**
   * Which message to scroll to and mark. Absent means the group alone.
   */
  activityId?: string;
}

/** The shape the notifications panel builds its rows from. */
export interface NotifiedReferral {
  activity?: {
    id?: string | null;
    group?: {
      id?: string | null;
      project?: { id?: string | null } | null;
    } | null;
  } | null;
}

const text = (value: string | null | undefined): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

/**
 * A reply to a referral leads to **the referral**, never to the reply.
 *
 * The answer lives inside that referral's own thread, and the thread is opened
 * from the message that raised it — the feed draws no row of its own for a
 * reply, so a target naming one would scroll to an element that is not there
 * and the link would read as broken on exactly the notices it was built for.
 *
 * Answers **null** where there is no project: a module notice raised about no
 * job, or a referral whose project has since been removed. A link that opens
 * the projects screen and then finds nothing is worse than no link — the same
 * reason `moduleForCategory` gives no link to a category it cannot match.
 */
export function referralJump(referral: NotifiedReferral): ActivityJump | null {
  const projectId = text(referral.activity?.group?.project?.id);
  if (!projectId) return null;
  return {
    projectId,
    groupId: text(referral.activity?.group?.id),
    activityId: text(referral.activity?.id),
  };
}

/**
 * A module notice leads to its project, and to nothing finer.
 *
 * `notifications.projectId` is the whole of what such a row records about
 * where it came from — there is no message and no category behind it — so the
 * jump carries the project alone rather than inventing a target inside it.
 */
export function moduleNotificationJump(
  notification: { projectId?: string | null },
): ActivityJump | null {
  const projectId = text(notification.projectId);
  return projectId ? { projectId } : null;
}
