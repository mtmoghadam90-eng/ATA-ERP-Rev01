import { useEffect } from "react";

/**
 * Applies the project code a screen was opened with, once per hand-off.
 *
 * The counterpart to `openProjectIn` in `App.tsx`: a project code is a link
 * everywhere it is printed, and following one switches module *and* filters the
 * destination to that job. This is the destination's half.
 *
 * **The term is cleared as soon as it is applied**, and that is deliberate.
 * Left in place, coming back to the module later — through the sidebar, hours
 * afterwards — would silently re-apply a filter nobody asked for, and a screen
 * that filters itself for reasons the reader cannot see is worse than one that
 * does not filter at all. Clearing also makes a second jump to the *same* code
 * work: the value goes away and arrives again, so the effect fires.
 */
export function useProjectJump(
  term: string | undefined,
  setSearch: (value: string) => void,
  onApplied?: () => void,
): void {
  useEffect(() => {
    if (!term) return;
    setSearch(term);
    onApplied?.();
    // `setSearch` and `onApplied` are new functions on every render of the
    // screen above; listing them here would re-apply the filter on each one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);
}
