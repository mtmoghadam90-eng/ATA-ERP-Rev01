import { useState, useCallback } from "react";
import { projectsApi } from "./projects";

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

      // Find the matching group by normalized category name
      const normalize = (str: string) => str.replace(/[\s‌]/g, "").trim().toLowerCase();
      const targetGroup = groups.find(
        (g) => normalize(g.categoryName) === normalize(prompt.categoryName)
      );

      if (targetGroup && targetGroup.status !== "اتمام کار") {
        // Mark it complete via the API
        await projectsApi.upsertCategoryGroup(prompt.projectId, {
          categoryId: targetGroup.categoryId,
          categoryName: targetGroup.categoryName,
          status: "اتمام کار",
          startDate: targetGroup.startDate || undefined,
          endDate: undefined, // Server will set to today
        });

        // Log an activity for the completion
        await projectsApi.addActivity({
          groupId: targetGroup.id,
          text: `اتمام کار دسته‌بندی «${targetGroup.categoryName}»`,
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
