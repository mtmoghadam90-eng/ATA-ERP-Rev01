import { api } from "./client";
import type { StuckSection, StuckSeverity } from "../utils/stuckWork";

/**
 * «کارهای متوقف» — read-only, one request, no paging.
 *
 * The rank is a proportion of a threshold that lives in the settings document,
 * so no database can order by it and the server ranks the whole bounded scan
 * before answering. Paging that would mean sorting a slice of the middle, which
 * is the fault the follow-up queue was corrected for.
 */

export interface StuckRow {
  section: StuckSection;
  id: string;
  label: string;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  state: string;
  sinceJalali: string | null;
  dwellDays: number | null;
  thresholdDays: number;
  severity: StuckSeverity;
  ratio: number;
}

export interface StuckSectionReport {
  section: StuckSection;
  /** False means «you may not see this», which is not «there is nothing». */
  visible: boolean;
  overdue: number;
  warning: number;
  unmeasured: number;
  truncated: boolean;
}

export interface StuckWorkReport {
  today: string;
  rows: StuckRow[];
  sections: StuckSectionReport[];
  truncated: boolean;
}

export const stuckWorkApi = {
  report: (includeWarning = true) =>
    api.get<StuckWorkReport>(
      "/api/stuck-work",
      includeWarning ? undefined : { includeWarning: "false" },
    ),
};
