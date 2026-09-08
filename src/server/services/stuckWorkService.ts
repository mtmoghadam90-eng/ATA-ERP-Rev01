import { getDb } from "../db";
import { AuthUser, hasPermission } from "../auth";
import { loadSettings } from "../settings";
import { getTodayShamsi } from "../../dateUtils";
import { visibilityClause as projectVisibility } from "./projectService";
import {
  STUCK_SECTIONS, StuckSection, StuckSeverity, StuckThresholdSettings,
  dwellDays, overdueRatio, severityFor, thresholdFor,
} from "../../utils/stuckWork";

/**
 * The reading behind «کارهای متوقف».
 *
 * Answers one question — what is sitting still across the chain, and how badly —
 * and **writes nothing**. It needs no workflow rule to have been set up, which
 * is the whole point: the engine can act on a stuck record only once somebody
 * has written a rule for that exact state, and this is what tells them which
 * states are worth writing one for.
 *
 * Three rules it carries.
 *
 * **Each section goes through its own module's permission**, and a section the
 * caller may not see is *reported as withheld* rather than returned empty. An
 * empty list reads as «there is nothing wrong», which is the opposite of «you
 * may not look» — the same distinction the assistant's tools were corrected for.
 *
 * **The scan is bounded and says so.** Every figure on a row is derived from a
 * threshold, so no database can order by it: the rank has to be computed here,
 * over the whole set, and a rank computed over a page is a rank that changes
 * when you turn it. Same shape as the follow-up queue.
 *
 * **A record with no clock is counted, not dropped.** The dwell migration
 * backfilled nothing on purpose, so «this application has never seen this record
 * move» is a real state and it is reported as its own figure.
 */

/** How many rows one section will look at. A ceiling, not a page. */
export const STUCK_SCAN_LIMIT = 600;

export interface StuckRow {
  section: StuckSection;
  id: string;
  /** What the row is called on screen — a PO number, a project code, an item. */
  label: string;
  /** The job it belongs to, where there is one. */
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  /** The state it is sitting in, and since when. */
  state: string;
  sinceJalali: string | null;
  dwellDays: number | null;
  thresholdDays: number;
  severity: StuckSeverity;
  /** dwell ÷ threshold — the only comparison that means anything across legs. */
  ratio: number;
}

export interface StuckSectionReport {
  section: StuckSection;
  /** False when the caller lacks that module: «withheld», never «nothing». */
  visible: boolean;
  overdue: number;
  warning: number;
  /** Open records this application has never seen move. Not overdue: unmeasured. */
  unmeasured: number;
  /** The scan hit its ceiling, so the counts are «at least». */
  truncated: boolean;
}

export interface StuckWorkReport {
  today: string;
  rows: StuckRow[];
  sections: StuckSectionReport[];
  truncated: boolean;
}

/* ----------------------------- the three reads ---------------------------- */

const PO_SELECT = {
  id: true, poNumber: true, status: true, statusChangedAtJalali: true,
  project: { select: { id: true, code: true, name: true } },
} as const;

const AS_SELECT = {
  id: true, itemName: true, status: true, statusChangedAtJalali: true,
  project: { select: { id: true, code: true, name: true } },
} as const;

const PROJECT_SELECT = {
  id: true, code: true, name: true, stage: true, stageChangedAtJalali: true,
} as const;

/**
 * The stuck work this user may see, ranked.
 *
 * `includeWarning` decides how much of the amber band comes back; the overdue
 * rows always do.
 */
export async function stuckWorkReport(
  user: AuthUser,
  opts: { includeWarning?: boolean; todayJalali?: string } = {},
): Promise<StuckWorkReport> {
  const db = getDb();
  const today = opts.todayJalali || getTodayShamsi();
  const settings = (await loadSettings()) as { stuckThresholds?: StuckThresholdSettings } | null;
  const thresholds = settings?.stuckThresholds ?? null;

  const canSee: Record<StuckSection, boolean> = {
    purchaseOrder: hasPermission(user, "purchaseOrders"),
    // After-sales has no permission key of its own; it borrows the delivery
    // module's, exactly as `KEY_PERMISSION` does for its endpoints.
    afterSales: hasPermission(user, "packagingDelivery"),
    projectStage: hasPermission(user, "projects"),
  };

  const rows: StuckRow[] = [];
  const sections: StuckSectionReport[] = [];

  const collect = (
    section: StuckSection,
    found: { id: string; label: string; state: string; since: string | null;
             project: { id: string; code: string | null; name: string | null } | null }[],
  ) => {
    let overdue = 0;
    let warning = 0;
    let unmeasured = 0;

    for (const rec of found) {
      const threshold = thresholdFor(section, rec.state, thresholds);
      // Zero is «never stuck here» — a received order, a delivered service — so
      // it is out of the report entirely rather than sitting at severity OK and
      // padding the unmeasured count with finished work.
      if (threshold <= 0) continue;

      const dwell = dwellDays(rec.since, today);
      if (dwell === null) { unmeasured++; continue; }

      const severity = severityFor(dwell, threshold);
      if (severity === "OVERDUE") overdue++;
      else if (severity === "WARN") warning++;
      else continue;

      rows.push({
        section,
        id: rec.id,
        label: rec.label,
        projectId: rec.project?.id ?? null,
        projectCode: rec.project?.code ?? null,
        projectName: rec.project?.name ?? null,
        state: rec.state,
        sinceJalali: rec.since,
        dwellDays: dwell,
        thresholdDays: threshold,
        severity,
        ratio: overdueRatio(dwell, threshold),
      });
    }

    return { overdue, warning, unmeasured, scanned: found.length };
  };

  let truncated = false;

  for (const section of STUCK_SECTIONS) {
    if (!canSee[section]) {
      sections.push({
        section, visible: false, overdue: 0, warning: 0, unmeasured: 0, truncated: false,
      });
      continue;
    }

    let found: Parameters<typeof collect>[1] = [];

    if (section === "purchaseOrder") {
      const list = await db.purchaseOrder.findMany({
        select: PO_SELECT,
        orderBy: { statusChangedAtJalali: "asc" },
        take: STUCK_SCAN_LIMIT,
      });
      found = list.map((r) => ({
        id: r.id,
        label: r.poNumber || r.id,
        state: String(r.status ?? ""),
        since: r.statusChangedAtJalali ?? null,
        project: r.project ?? null,
      }));
    } else if (section === "afterSales") {
      const list = await db.afterSalesService.findMany({
        select: AS_SELECT,
        orderBy: { statusChangedAtJalali: "asc" },
        take: STUCK_SCAN_LIMIT,
      });
      found = list.map((r) => ({
        id: r.id,
        label: r.itemName || r.id,
        state: String(r.status ?? ""),
        since: r.statusChangedAtJalali ?? null,
        project: r.project ?? null,
      }));
    } else {
      /*
       * Record-level visibility, inside the query rather than after it — the
       * one rule this file must not get wrong. Applied as a `where` so a user
       * restricted to their own projects never learns that the others exist.
       */
      const list = await db.project.findMany({
        where: projectVisibility(user),
        select: PROJECT_SELECT,
        orderBy: { stageChangedAtJalali: "asc" },
        take: STUCK_SCAN_LIMIT,
      });
      found = list.map((r) => ({
        id: r.id,
        label: r.code || r.name || r.id,
        state: String(r.stage ?? ""),
        since: r.stageChangedAtJalali ?? null,
        project: { id: r.id, code: r.code ?? null, name: r.name ?? null },
      }));
    }

    const counted = collect(section, found);
    const hitCeiling = counted.scanned >= STUCK_SCAN_LIMIT;
    if (hitCeiling) truncated = true;
    sections.push({
      section,
      visible: true,
      overdue: counted.overdue,
      warning: counted.warning,
      unmeasured: counted.unmeasured,
      truncated: hitCeiling,
    });
  }

  /*
   * Ranked here, over everything, and never in SQL: the figure it orders by is
   * a proportion of a threshold that lives in the settings document, so no
   * database can sort by it. Paging first and sorting the page afterwards is
   * what put a six-month-old overdue quotation on page three of the follow-up
   * queue, and this is the same shape.
   */
  rows.sort((a, b) => b.ratio - a.ratio || (b.dwellDays ?? 0) - (a.dwellDays ?? 0));

  const wanted = opts.includeWarning === false
    ? rows.filter((r) => r.severity === "OVERDUE")
    : rows;

  return { today, rows: wanted, sections, truncated };
}
