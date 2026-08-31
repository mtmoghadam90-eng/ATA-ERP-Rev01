import { useCallback, useEffect, useState } from "react";
import type { ActivityAttachment } from "../utils/attachments";
import { useRevalidate } from "./liveData";
import type { ProjectCategoryGroup } from "../types";
import { getTodayShamsi } from "../dateUtils";
import { projectsApi } from "./projects";
import { groupToView } from "./activityAdapter";

/**
 * The activity/referral feed for one project.
 *
 * Loads that project's category groups — with their activities and referrals —
 * from the API and exposes the mutations the feed needs, each of which writes
 * through a REST endpoint and then refetches. The browser used to hold every
 * project's groups at once so this one screen could filter to the open project;
 * scoping the fetch to `projectId` is what removes that.
 *
 * Every mutation rejects with an `ApiError` on failure, so the caller can show
 * the server's own Persian message.
 */

export interface ActivityAttachmentInput {
  attachments?: ActivityAttachment[];
}

export interface ActivityReferralInput {
  assignedToUserId?: string | null;
  assignedToName?: string | null;
  actionRequired: string;
}

export interface AddActivityInput extends ActivityAttachmentInput {
  text: string;
  /** The message this one answers, when it is a reply. */
  replyToId?: string | null;
  /**
   * Kept for the automatic entries other modules write.
   *
   * A person raises a referral by naming somebody in the message now, so no
   * screen sends this; an integration still may, and dropping it silently
   * would lose a request.
   */
  referral?: ActivityReferralInput;
}

export interface ProjectActivitiesApi {
  groups: ProjectCategoryGroup[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  addGroup: (categoryId: string, categoryName: string, startDate: string) => Promise<void>;
  updateGroupDates: (group: ProjectCategoryGroup, patch: { startDate?: string; endDate?: string }) => Promise<void>;
  setGroupMembers: (group: ProjectCategoryGroup, memberUserIds: string[]) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  completeGroup: (group: ProjectCategoryGroup) => Promise<void>;
  resumeGroup: (group: ProjectCategoryGroup) => Promise<void>;
  addActivity: (groupId: string, input: AddActivityInput) => Promise<void>;
  updateActivity: (id: string, text: string, attachments?: ActivityAttachment[]) => Promise<void>;
  deleteActivity: (id: string) => Promise<void>;
}

export function useProjectActivities(projectId: string | null | undefined): ProjectActivitiesApi {
  const [groups, setGroups] = useState<ProjectCategoryGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  // The feed is written from every other module — a proforma issued, an
  // instalment paid, a shipment packed all land here as entries. Those writes
  // happen on screens this hook cannot see, so it listens for them.
  useRevalidate(
    ["activities", "referrals", "projects", "proformas", "purchase-orders",
     "transactions", "deliveries", "inquiries"],
    refresh,
    { enabled: !!projectId },
  );

  useEffect(() => {
    if (!projectId) {
      setGroups([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    projectsApi
      .categoryGroups(projectId)
      .then((rows) => {
        if (cancelled) return;
        setGroups(rows.map(groupToView));
        setError(null);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("دریافت فعالیت‌های پروژه با خطا مواجه شد.");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectId, reloadKey]);

  const addGroup = useCallback(async (categoryId: string, categoryName: string, startDate: string) => {
    if (!projectId) return;
    await projectsApi.upsertCategoryGroup(projectId, {
      categoryId, categoryName, status: "جاری", startDate: startDate || getTodayShamsi(),
    });
    refresh();
  }, [projectId, refresh]);

  // Status is always resent, because the server defaults a group with no status
  // to "جاری" — editing a completed group's dates would otherwise reopen it.
  const upsertFromGroup = useCallback(async (
    group: ProjectCategoryGroup,
    overrides: { status?: string; startDate?: string; endDate?: string; memberUserIds?: string[] },
  ) => {
    if (!projectId) return;
    await projectsApi.upsertCategoryGroup(projectId, {
      categoryId: group.categoryId,
      categoryName: group.categoryName,
      status: overrides.status ?? group.status,
      startDate: "startDate" in overrides ? overrides.startDate : (group.startDate || undefined),
      endDate: "endDate" in overrides ? overrides.endDate : (group.endDate ?? undefined),
      /*
       * Sent only when it is what is being changed.
       *
       * Deliberately *not* resent from `group` the way status is: every other
       * caller here is editing a date or closing the category, and re-posting a
       * membership they never looked at would write it back from whatever the
       * screen last fetched — including over somebody else's edit. Absent means
       * «leave it alone» all the way to the column.
       */
      ...("memberUserIds" in overrides ? { memberUserIds: overrides.memberUserIds } : {}),
    });
  }, [projectId]);

  const updateGroupDates = useCallback(async (
    group: ProjectCategoryGroup, patch: { startDate?: string; endDate?: string },
  ) => {
    await upsertFromGroup(group, patch);
    refresh();
  }, [upsertFromGroup, refresh]);

  /** Sets who follows this category's conversation. */
  const setGroupMembers = useCallback(async (
    group: ProjectCategoryGroup, memberUserIds: string[],
  ) => {
    await upsertFromGroup(group, { memberUserIds });
    refresh();
  }, [upsertFromGroup, refresh]);

  const deleteGroup = useCallback(async (id: string) => {
    await projectsApi.deleteCategoryGroup(id);
    refresh();
  }, [refresh]);

  const completeGroup = useCallback(async (group: ProjectCategoryGroup) => {
    await upsertFromGroup(group, { status: "اتمام کار", endDate: getTodayShamsi() });
    await projectsApi.addActivity({ groupId: group.id, text: `اتمام کار دسته‌بندی «${group.categoryName}»` });
    refresh();
  }, [upsertFromGroup, refresh]);

  const resumeGroup = useCallback(async (group: ProjectCategoryGroup) => {
    await upsertFromGroup(group, { status: "جاری", endDate: "" });
    await projectsApi.addActivity({ groupId: group.id, text: `بازگشایی مجدد دسته‌بندی «${group.categoryName}»` });
    refresh();
  }, [upsertFromGroup, refresh]);

  const addActivity = useCallback(async (groupId: string, input: AddActivityInput) => {
    await projectsApi.addActivity({
      groupId,
      text: input.text,
      attachments: input.attachments ?? [],
      replyToId: input.replyToId ?? null,
      referral: input.referral
        ? {
            assignedToUserId: input.referral.assignedToUserId ?? null,
            assignedToName: input.referral.assignedToName ?? null,
            actionRequired: input.referral.actionRequired,
          }
        : undefined,
    });
    refresh();
  }, [refresh]);

  const updateActivity = useCallback(async (
    id: string, text: string, attachments?: ActivityAttachment[],
  ) => {
    await projectsApi.updateActivity(id, text, attachments);
    refresh();
  }, [refresh]);

  const deleteActivity = useCallback(async (id: string) => {
    await projectsApi.deleteActivity(id);
    refresh();
  }, [refresh]);

  return {
    groups, loading, error, refresh,
    addGroup, updateGroupDates, setGroupMembers, deleteGroup, completeGroup, resumeGroup,
    addActivity, updateActivity, deleteActivity,
  };
}
