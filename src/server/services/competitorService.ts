import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { AuthUser, hasPermission } from "../auth";
import { getProformaOutcome } from "../proformaStatus";
import {
  CompetitorStanding, competitorNameRefusal, competitorStandings,
} from "../../utils/competitors";
import { jalaliRangeFilter } from "../dates";

/**
 * The competitors this company meets, and how it stands against each.
 *
 * Two halves with two different authorities. The **catalogue** is reference
 * data: anybody who can open a quotation has to be able to pick a competitor,
 * and only `settings` may edit the list — the same split the product categories
 * carry, and for the same reason. The **standings** are a sales report and need
 * the `proformas` permission, because they are nothing but prices and win rates.
 */

/**
 * A short reference list, read whole rather than paged.
 *
 * The same shape as the exchange rates: a company meets a few dozen
 * competitors, the picker needs all of them at once, and a page of twenty would
 * mean a search box for a list that fits on one screen. Bounded anyway, with
 * the flag, because "we assumed it was short" is how a screen silently drops
 * rows.
 */
export const COMPETITOR_LIMIT = 500;

const SELECT = {
  id: true, name: true, website: true, country: true, notes: true,
  isActive: true, createdAt: true,
} satisfies Prisma.CompetitorSelect;

export interface CompetitorRow {
  id: string;
  name: string;
  website: string | null;
  country: string | null;
  notes: string | null;
  isActive: boolean;
}

export async function listCompetitors(
  opts: { includeInactive?: boolean } = {},
): Promise<{ competitors: CompetitorRow[]; truncated: boolean }> {
  const rows = await getDb().competitor.findMany({
    where: opts.includeInactive ? undefined : { isActive: true },
    select: SELECT,
    orderBy: { name: "asc" },
    take: COMPETITOR_LIMIT + 1,
  });
  return {
    competitors: rows.slice(0, COMPETITOR_LIMIT).map((r) => ({
      id: r.id, name: r.name, website: r.website, country: r.country,
      notes: r.notes, isActive: r.isActive,
    })),
    truncated: rows.length > COMPETITOR_LIMIT,
  };
}

export interface CompetitorInput {
  name?: unknown;
  website?: unknown;
  country?: unknown;
  notes?: unknown;
  isActive?: unknown;
}

const text = (value: unknown, max: number): string | null => {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/** Every name already taken, which is what the duplicate rule is held against. */
async function existingNames(): Promise<{ id: string; name: string }[]> {
  return getDb().competitor.findMany({ select: { id: true, name: true } });
}

export async function createCompetitor(
  input: CompetitorInput,
  user: AuthUser,
): Promise<{ competitor: CompetitorRow } | { error: string } | "forbidden"> {
  if (!hasPermission(user, "settings")) return "forbidden";

  const refusal = competitorNameRefusal(input.name, await existingNames());
  if (refusal) return { error: refusal };

  const row = await getDb().competitor.create({
    data: {
      name: String(input.name).trim().slice(0, 200),
      website: text(input.website, 300),
      country: text(input.country, 100),
      notes: text(input.notes, 4000),
      isActive: input.isActive !== false,
    },
    select: SELECT,
  });
  return { competitor: row as CompetitorRow };
}

export async function updateCompetitor(
  id: string,
  input: CompetitorInput,
  user: AuthUser,
): Promise<{ competitor: CompetitorRow } | { error: string } | "forbidden" | "not-found"> {
  if (!hasPermission(user, "settings")) return "forbidden";

  const db = getDb();
  const current = await db.competitor.findUnique({ where: { id }, select: { id: true } });
  if (!current) return "not-found";

  const data: Prisma.CompetitorUpdateInput = {};
  if ("name" in input) {
    const refusal = competitorNameRefusal(input.name, await existingNames(), id);
    if (refusal) return { error: refusal };
    data.name = String(input.name).trim().slice(0, 200);
  }
  if ("website" in input) data.website = text(input.website, 300);
  if ("country" in input) data.country = text(input.country, 100);
  if ("notes" in input) data.notes = text(input.notes, 4000);
  if ("isActive" in input) data.isActive = input.isActive !== false;

  const row = await db.competitor.update({ where: { id }, data, select: SELECT });
  return { competitor: row as CompetitorRow };
}

/**
 * Retiring one, never deleting it.
 *
 * The quotations naming a competitor are the whole point of recording them, and
 * a delete would either orphan those documents or take the history with it. So
 * `isActive` is the answer: it leaves the pickers and keeps every figure.
 */
export async function retireCompetitor(
  id: string,
  user: AuthUser,
): Promise<"ok" | "forbidden" | "not-found"> {
  if (!hasPermission(user, "settings")) return "forbidden";
  const db = getDb();
  const found = await db.competitor.findUnique({ where: { id }, select: { id: true } });
  if (!found) return "not-found";
  await db.competitor.update({ where: { id }, data: { isActive: false } });
  return "ok";
}

/* ------------------------------- the report ------------------------------- */

export interface CompetitorReportRow extends CompetitorStanding {
  name: string;
}

/**
 * How the company stands against each competitor over a period.
 *
 * The outcome is **derived** from the line statuses, exactly as everywhere else,
 * so this reads the lines rather than trusting the stored status — a fully-won
 * quotation still carries «ارسال شده» in its own column.
 *
 * Bounded (`REPORT_SCAN_LIMIT`) with the flag, because the alternative to a
 * bounded scan here is a figure that silently changes with the size of the
 * table.
 */
export const REPORT_SCAN_LIMIT = 5_000;

export async function competitorReport(
  range: { from?: unknown; to?: unknown },
  user: AuthUser,
): Promise<{ rows: CompetitorReportRow[]; truncated: boolean } | "forbidden"> {
  if (!hasPermission(user, "proformas")) return "forbidden";

  const db = getDb();
  const issued = jalaliRangeFilter(range.from, range.to);
  const where: Prisma.ProformaWhereInput = {
    competitorId: { not: null },
    ...(issued ? { issueDate: issued } : {}),
  };

  const rows = await db.proforma.findMany({
    where,
    select: {
      competitorId: true, status: true, isCancelled: true,
      finalAmount: true, competitorAmount: true,
      items: { select: { status: true } },
    },
    orderBy: { issueDate: "desc" },
    take: REPORT_SCAN_LIMIT + 1,
  });

  const scanned = rows.slice(0, REPORT_SCAN_LIMIT);
  const standings = competitorStandings(scanned.map((pf) => ({
    competitorId: String(pf.competitorId),
    outcome: getProformaOutcome(pf as never),
    ourAmount: pf.finalAmount,
    competitorAmount: pf.competitorAmount,
  })));

  // The names, in one read rather than one per row.
  const named = await db.competitor.findMany({
    where: { id: { in: standings.map((s) => s.competitorId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(named.map((c) => [c.id, c.name]));

  return {
    rows: standings.map((s) => ({ ...s, name: nameById.get(s.competitorId) ?? "—" })),
    truncated: rows.length > REPORT_SCAN_LIMIT,
  };
}
