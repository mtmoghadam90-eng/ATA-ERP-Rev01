import { getDb } from "../db";
import { AuthUser, hasPermission } from "../auth";
import { isWonStatus } from "../proformaStatus";
import { jalaliToDate } from "../dates";
import { toNullableString } from "../childSync";
import { SALE_SELECT, buildCostLookup, grossProfitOf, type SaleRow } from "./customerValueService";
import { summarizeProjectFinance } from "./projectFinance";
import { logAction } from "./auditService";
import { afterCommit } from "../afterCommit";
import {
  CommissionState, CommissionTerms, PAYOUT_KINDS, PayoutKind, commissionEarned, commissionPayable,
  commissionState, isCommissionBasis, resolveTerms,
} from "../../utils/referralCommission";

/**
 * «معرف‌ها و پورسانت» — who brought which job, what it made us, and what they
 * are owed. The money rules are `src/utils/referralCommission.ts`; the profit
 * is the customer-value ranking's own (`grossProfitOf`: won lines, the cost
 * recorded on each line, uncosted lines out of both sides of the margin), and
 * the collected share is `summarizeProjectFinance`'s, so this screen and those
 * cannot disagree about one project.
 *
 * Gated by the strict `referrerCommissions` flag: profit and commission are
 * not for every account that can open a project.
 */

export const REFERRER_PERMISSION = "referrerCommissions";

/** How many referred projects one report reads — a bound, reported when hit. */
export const REFERRER_SCAN_LIMIT = 2000;

export interface ReferredProjectRow {
  projectId: string;
  code: string;
  name: string;
  status: string;
  customerName: string;
  referrerCustomerId: string;
  won: boolean;
  winningDateJalali: string | null;
  creationDateJalali: string | null;
  revenueRial: number;
  grossProfitRial: number;
  marginPercent: number | null;
  costCoveragePercent: number;
  collectedPercent: number;
  terms: CommissionTerms | null;
  earned: number;
  payable: number;
  given: number;
  due: number;
  state: CommissionState;
}

export interface ReferrerRow {
  customerId: string;
  name: string;
  /** False when the contact has since been deleted. */
  exists: boolean;
  commissionBasis: string | null;
  commissionRate: number | null;
  referred: number;
  won: number;
  revenueRial: number;
  grossProfitRial: number;
  earned: number;
  payable: number;
  given: number;
  due: number;
  projects: ReferredProjectRow[];
}

const nameOf = (c: { companyName: string | null; firstName: string | null; lastName: string | null }) =>
  (c.companyName || `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "بدون نام");

const inRange = (value: string | null, from: string, to: string): boolean => {
  if (!from && !to) return true;
  if (!value) return false;
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
};

/**
 * The report. A won project is in the period by its approval date
 * («تاریخ تایید»), which is when the sale happened; one not won yet, by the
 * date it was opened, so «what did this person bring us this quarter» lists the
 * jobs still open as well as the ones that paid.
 */
export async function referrerReport(
  filters: { from?: unknown; to?: unknown; referrerId?: unknown },
  user: AuthUser,
): Promise<"forbidden" | { referrers: ReferrerRow[]; truncated: boolean }> {
  if (!hasPermission(user, REFERRER_PERMISSION)) return "forbidden";
  const db = getDb();
  const from = String(filters.from ?? "").trim();
  const to = String(filters.to ?? "").trim();
  const referrerId = String(filters.referrerId ?? "").trim();

  const projects = await db.project.findMany({
    where: referrerId ? { referrerCustomerId: referrerId } : { referrerCustomerId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: REFERRER_SCAN_LIMIT + 1,
    select: {
      id: true, code: true, name: true, status: true,
      winningDateJalali: true, creationDateJalali: true,
      referrerCustomerId: true, commissionBasis: true, commissionRate: true,
      customer: { select: { companyName: true, firstName: true, lastName: true } },
    },
  });
  const truncated = projects.length > REFERRER_SCAN_LIMIT;
  const scanned = projects.slice(0, REFERRER_SCAN_LIMIT).filter((p) => {
    const won = isWonStatus(p.status);
    return inRange(won ? p.winningDateJalali : p.creationDateJalali, from, to);
  });
  const ids = scanned.map((p) => p.id);

  const [sales, finance, payouts, referrers] = await Promise.all([
    ids.length ? db.proforma.findMany({ where: { projectId: { in: ids } }, select: { ...SALE_SELECT, projectId: true } }) : [],
    summarizeProjectFinance(ids),
    ids.length ? db.referralPayout.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, amountRial: true } }) : [],
    db.customer.findMany({
      where: { id: { in: [...new Set(scanned.map((p) => p.referrerCustomerId!).filter(Boolean))] } },
      select: { id: true, companyName: true, firstName: true, lastName: true, commissionBasis: true, commissionRate: true },
    }),
  ]);
  const costs = await buildCostLookup(db, sales as unknown as SaleRow[]);
  const salesByProject = new Map<string, SaleRow[]>();
  for (const s of sales as unknown as (SaleRow & { projectId: string | null })[]) {
    if (!s.projectId) continue;
    const list = salesByProject.get(s.projectId) ?? [];
    list.push(s);
    salesByProject.set(s.projectId, list);
  }
  const givenBy = new Map<string, number>();
  for (const p of payouts) givenBy.set(p.projectId, (givenBy.get(p.projectId) ?? 0) + Number(p.amountRial));
  const referrerById = new Map(referrers.map((r) => [r.id, r]));

  const byReferrer = new Map<string, ReferrerRow>();
  for (const p of scanned) {
    const refId = p.referrerCustomerId!;
    const referrer = referrerById.get(refId) ?? null;
    const won = isWonStatus(p.status);
    const profit = grossProfitOf(salesByProject.get(p.id) ?? [], costs);
    const collected = Math.min(100, Math.max(0, finance.get(p.id)?.settlementPercent ?? 0));
    const terms = resolveTerms(p, referrer);
    const earned = commissionEarned(terms, { won, revenueRial: profit.revenueRial, grossProfitRial: profit.grossProfitRial });
    const payable = commissionPayable(earned, collected);
    const given = Math.round(givenBy.get(p.id) ?? 0);
    const row: ReferredProjectRow = {
      projectId: p.id, code: p.code, name: p.name, status: p.status,
      customerName: p.customer ? nameOf(p.customer) : "",
      referrerCustomerId: refId,
      won,
      winningDateJalali: p.winningDateJalali, creationDateJalali: p.creationDateJalali,
      revenueRial: profit.revenueRial,
      grossProfitRial: profit.grossProfitRial,
      marginPercent: profit.costedRevenueRial > 0
        ? Math.round((profit.grossProfitRial / profit.costedRevenueRial) * 1000) / 10 : null,
      costCoveragePercent: profit.coveragePercent,
      collectedPercent: Math.round(collected * 10) / 10,
      terms, earned, payable, given,
      due: Math.max(0, payable - given),
      state: commissionState({ terms, won, earned, payable, given }),
    };
    let group = byReferrer.get(refId);
    if (!group) {
      group = {
        customerId: refId,
        name: referrer ? nameOf(referrer) : "مخاطب حذف‌شده",
        exists: !!referrer,
        commissionBasis: referrer?.commissionBasis ?? null,
        commissionRate: referrer?.commissionRate ?? null,
        referred: 0, won: 0, revenueRial: 0, grossProfitRial: 0, earned: 0, payable: 0, given: 0, due: 0,
        projects: [],
      };
      byReferrer.set(refId, group);
    }
    group.referred += 1;
    if (won) group.won += 1;
    group.revenueRial += row.revenueRial;
    group.grossProfitRial += row.grossProfitRial;
    group.earned += row.earned;
    group.payable += row.payable;
    group.given += row.given;
    group.due += row.due;
    group.projects.push(row);
  }
  const referrersOut = [...byReferrer.values()].sort((a, b) => b.grossProfitRial - a.grossProfitRial);
  return { referrers: referrersOut, truncated };
}

/** A referrer's default terms. Null basis clears them. */
export async function setReferrerTerms(
  customerId: string,
  input: { commissionBasis?: unknown; commissionRate?: unknown },
  user: AuthUser,
): Promise<"forbidden" | "not-found" | "invalid" | "ok"> {
  if (!hasPermission(user, REFERRER_PERMISSION)) return "forbidden";
  const db = getDb();
  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!customer) return "not-found";
  const basis = input.commissionBasis === null || input.commissionBasis === "" ? null : input.commissionBasis;
  const rate = input.commissionRate === null || input.commissionRate === "" ? null : Number(input.commissionRate);
  if (basis !== null && (!isCommissionBasis(basis) || rate === null || !Number.isFinite(rate) || rate < 0)) return "invalid";
  if (basis !== null && basis !== "FIXED" && (rate as number) > 100) return "invalid";
  await db.customer.update({
    where: { id: customerId },
    data: { commissionBasis: basis as string | null, commissionRate: basis === null ? null : rate },
  });
  return "ok";
}

/** A payout or a gift against one project. */
export async function addPayout(
  projectId: string,
  input: { kind?: unknown; amountRial?: unknown; payoutDate?: unknown; description?: unknown },
  user: AuthUser,
  todayJalali: string,
): Promise<"forbidden" | "not-found" | "invalid" | { id: string }> {
  if (!hasPermission(user, REFERRER_PERMISSION)) return "forbidden";
  const db = getDb();
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, code: true, referrerCustomerId: true } });
  if (!project) return "not-found";
  const kind = (PAYOUT_KINDS as readonly string[]).includes(String(input.kind)) ? (input.kind as PayoutKind) : null;
  const amount = Number(input.amountRial);
  if (!kind || !Number.isFinite(amount) || amount <= 0) return "invalid";
  const dateJalali = toNullableString(input.payoutDate, 10) ?? todayJalali;
  const row = await db.referralPayout.create({
    data: {
      projectId,
      referrerCustomerId: project.referrerCustomerId,
      kind,
      amountRial: amount,
      payoutDate: jalaliToDate(dateJalali),
      payoutDateJalali: dateJalali,
      description: toNullableString(input.description),
      createdByUserId: user.id,
      createdByName: user.fullName ?? null,
    },
  });
  await afterCommit("referral payout audit", () => logAction({
    action: "CREATE", module: "معرف‌ها و پورسانت", entityId: row.id,
    description: `ثبت ${kind === "GIFT" ? "هدیه" : "پرداخت پورسانت"} ${amount.toLocaleString("en-US")} ریال برای پروژه ${project.code}`,
    afterState: row,
  }, user, todayJalali));
  return { id: row.id };
}

export async function listPayouts(projectId: string, user: AuthUser) {
  if (!hasPermission(user, REFERRER_PERMISSION)) return "forbidden" as const;
  return getDb().referralPayout.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } });
}

export async function deletePayout(id: string, user: AuthUser, todayJalali: string): Promise<"forbidden" | "not-found" | "ok"> {
  if (!hasPermission(user, REFERRER_PERMISSION)) return "forbidden";
  const db = getDb();
  const row = await db.referralPayout.findUnique({ where: { id } });
  if (!row) return "not-found";
  await db.referralPayout.delete({ where: { id } });
  await afterCommit("referral payout audit", () => logAction({
    action: "DELETE", module: "معرف‌ها و پورسانت", entityId: id,
    description: `حذف ${row.kind === "GIFT" ? "هدیه" : "پرداخت پورسانت"} ${row.amountRial.toLocaleString("en-US")} ریال`,
    beforeState: row,
  }, user, todayJalali));
  return "ok";
}
