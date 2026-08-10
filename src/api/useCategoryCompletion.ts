import { useState, useCallback } from "react";
import { projectsApi } from "./projects";
import { sameCategory } from "../utils/activityCategories";

/**
 * Category completion prompt hook.
 *
 * Provides a mechanism for modules to prompt the user to close an activity
 * category when a significant milestone is reached (e.g., proforma won,
 * purchase order delivered, after-sales service completed).
 *
 * Usage:
 * 1. Call `promptCompletion()` after the milestone mutation succeeds
 * 2. Render the modal/dialog using the returned state
 * 3. When confirmed, call `confirmCompletion()` which closes the category
 *    and refetches the activity feed
 */

export interface CategoryCompletionPrompt {
  projectId: string;
  categoryName: string;
  message: string;
}

export function useCategoryCompletion() {
  const [prompt, setPrompt] = useState<CategoryCompletionPrompt | null>(null);

  const promptCompletion = useCallback((p: CategoryCompletionPrompt) => {
    setPrompt(p);
  }, []);

  const confirmCompletion = useCallback(async () => {
    if (!prompt) return;

    try {
      // Fetch the category groups for this project
      const groups = await projectsApi.categoryGroups(prompt.projectId);

      /*
       * Matched as a category, not as a string.
       *
       * A project's group may be stored under a spelling — or a previous name —
       * that is not the one the prompt asked about. Comparing the raw text
       * meant a renamed category could never be closed: the prompt appeared,
       * the user said yes, and the group it was looking for did not exist.
       */
      const targetGroup = groups.find((g) => sameCategory(g.categoryName, prompt.categoryName));

      /*
       * Three outcomes, and two of them used to be silent.
       *
       * No group at all means this project has no activity in that category yet
       * — there is nothing to close, and the user who just answered "yes"
       * deserves to be told rather than left to assume it worked. Already closed
       * is the same: not an error, but not nothing either.
       */
      if (!targetGroup) {
        alert(`دسته‌بندی «${prompt.categoryName}» هنوز برای این پروژه فعالیتی ندارد، بنابراین چیزی برای بستن وجود ندارد.`);
      } else if (targetGroup.status === "اتمام کار") {
        alert(`دسته‌بندی «${targetGroup.categoryName}» پیش از این بسته شده است.`);
      } else {
        await projectsApi.upsertCategoryGroup(prompt.projectId, {
          categoryId: targetGroup.categoryId,
          categoryName: targetGroup.categoryName,
          status: "اتمام کار",
          startDate: targetGroup.startDate || undefined,
          // Left out on purpose: the server stamps the day it closed.
        });

        // The feed says why it closed, not just that it did.
        await projectsApi.addActivity({
          groupId: targetGroup.id,
          text: `دسته‌بندی «${targetGroup.categoryName}» با اتمام کار بسته شد. ${prompt.message.replace(/آیا می‌خواهید.*$/s, "").trim()}`,
        });
      }

      setPrompt(null);
    } catch (err) {
      console.error("Failed to complete category:", err);
      alert("بستن دسته‌بندی با خطا مواجه شد.");
    }
  }, [prompt]);

  const dismissPrompt = useCallback(() => {
    setPrompt(null);
  }, []);

  return {
    prompt,
    promptCompletion,
    confirmCompletion,
    dismissPrompt,
  };
}
