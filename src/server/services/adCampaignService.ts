import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { AuthUser, hasPermission } from "../auth";
import { expandDateFields, jalaliRangeFilter } from "../dates";
import { toNullableString, toNumber } from "../childSync";
import { logAction } from "./auditService";
import { adQuality, nextAdCampaignCode } from "../../utils/adEffectiveness";

/**
 * «اثربخشی تبلیغات» — recording campaigns and reading them back.
 *
 * The module records what a campaign cost and what came of it; running the
 * campaign happens elsewhere. Every figure beyond the typed ones is derived in
 * `src/utils/adEffectiveness.ts`, on the screen, from the rows this returns —
 * a report has to see the whole filtered set to weight its ratios, so the read
 * is a **bounded scan** with a `truncated` flag rather than a page (the
 * satisfaction-letters and price-history rule).
 */

/** The module's permission key; strict, so only an explicit grant opens it. */
export const AD_PERMISSION = "adEffectiveness";

export const AD_SCAN_LIMIT = 5000;

const SELECT = {
  id: true, code: true, runDateJalali: true, channel: true, topic: true,
  audience: true, audienceSize: true, directCost: true, responses: true,
  leads: true, sales: true, revenue: true, quality: true, notes: true,
  createdByName: true, createdAt: true,
} satisfies Prisma.AdCampaignSelect;

export interface AdCampaignRow {
  id: string;
  code: string;
  runDateJalali: string | null;
  channel: string;
  topic: string;
  audience: string | null;
  audienceSize: number;
  directCost: number;
  responses: number | null;
  leads: number | null;
  sales: number | null;
  revenue: number | null;
  quality: number | null;
  notes: string | null;
  createdByName: string | null;
}

function toRow(r: Prisma.AdCampaignGetPayload<{ select: typeof SELECT }>): AdCampaignRow {
  return {
    id: r.id,
    code: r.code,
    runDateJalali: r.runDateJalali,
    channel: r.channel,
    topic: r.topic,
    audience: r.audience,
    audienceSize: r.audienceSize,
    directCost: Number(r.directCost),
    responses: r.responses,
    leads: r.leads,
    sales: r.sales,
    revenue: r.revenue === null ? null : Number(r.revenue),
    quality: r.quality,
    notes: r.notes,
    createdByName: r.createdByName,
  };
}

const allowed = (user: AuthUser) => hasPermission(user, AD_PERMISSION);

export interface AdCampaignFilters {
  from?: unknown;
  to?: unknown;
  channel?: unknown;
  audience?: unknown;
}

export async function listAdCampaigns(
  filters: AdCampaignFilters,
  user: AuthUser,
): Promise<"forbidden" | { campaigns: AdCampaignRow[]; truncated: boolean }> {
  if (!allowed(user)) return "forbidden";
  const where: Prisma.AdCampaignWhereInput = {};
  const range = jalaliRangeFilter(filters.from, filters.to);
  if (range) where.runDate = range;
  const channel = toNullableString(filters.channel, 100);
  if (channel) where.channel = channel;
  const audience = toNullableString(filters.audience, 200);
  if (audience) where.audience = audience;

  const rows = await getDb().adCampaign.findMany({
    where,
    select: SELECT,
    orderBy: [{ runDate: "desc" }, { createdAt: "desc" }],
    take: AD_SCAN_LIMIT + 1,
  });
  return {
    campaigns: rows.slice(0, AD_SCAN_LIMIT).map(toRow),
    truncated: rows.length > AD_SCAN_LIMIT,
  };
}

export interface AdCampaignInput {
  code?: unknown;
  runDate?: unknown;
  channel?: unknown;
  topic?: unknown;
  audience?: unknown;
  audienceSize?: unknown;
  directCost?: unknown;
  responses?: unknown;
  leads?: unknown;
  sales?: unknown;
  revenue?: unknown;
  quality?: unknown;
  notes?: unknown;
}

/** A count: blank is «not recorded» (null), never zero. */
const count = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(toNumber(v, NaN));
  return Number.isFinite(n) ? Math.max(0, n) : null;
};

/** The writable columns named in `input`; absent keys are «not edited». */
function scalarData(input: AdCampaignInput): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if ("channel" in input) data.channel = toNullableString(input.channel, 100) ?? "";
  if ("topic" in input) data.topic = toNullableString(input.topic, 400) ?? "";
  if ("audience" in input) data.audience = toNullableString(input.audience, 200);
  if ("audienceSize" in input) data.audienceSize = count(input.audienceSize) ?? 0;
  if ("directCost" in input) data.directCost = Math.max(0, toNumber(input.directCost, 0));
  if ("responses" in input) data.responses = count(input.responses);
  if ("leads" in input) data.leads = count(input.leads);
  if ("sales" in input) data.sales = count(input.sales);
  if ("revenue" in input) {
    const v = input.revenue;
    data.revenue = v === null || v === undefined || v === "" ? null : Math.max(0, toNumber(v, 0));
  }
  if ("quality" in input) data.quality = adQuality(input.quality);
  if ("notes" in input) data.notes = toNullableString(input.notes);
  Object.assign(data, expandDateFields(input as Record<string, unknown>, ["runDate"]));
  return data;
}

/** Why a campaign cannot be saved, or null. */
export function adCampaignRefusal(data: Record<string, unknown>, creating: boolean): string | null {
  if (creating || "channel" in data) {
    if (!String(data.channel ?? "").trim()) return "نوع کانال را انتخاب کنید.";
  }
  if (creating || "topic" in data) {
    if (!String(data.topic ?? "").trim()) return "موضوع کمپین را بنویسید.";
  }
  const leads = data.leads as number | null | undefined;
  const sales = data.sales as number | null | undefined;
  if (typeof leads === "number" && typeof sales === "number" && sales > leads) {
    return "تعداد فروش نهایی نمی‌تواند از تعداد سرنخ واقعی بیشتر باشد.";
  }
  return null;
}

async function freshCode(tx: Prisma.TransactionClient): Promise<string> {
  const codes = await tx.adCampaign.findMany({ select: { code: true } });
  return nextAdCampaignCode(codes.map((c) => c.code));
}

export async function createAdCampaign(
  input: AdCampaignInput,
  user: AuthUser,
  todayJalali: string,
): Promise<"forbidden" | { error: string } | { campaign: AdCampaignRow }> {
  if (!allowed(user)) return "forbidden";
  const data = scalarData(input);
  const refusal = adCampaignRefusal(data, true);
  if (refusal) return { error: refusal };

  const created = await getDb().$transaction(async (tx) => {
    const code = toNullableString(input.code, 40) ?? await freshCode(tx);
    return tx.adCampaign.create({
      data: {
        ...(data as Prisma.AdCampaignUncheckedCreateInput),
        code,
        createdByUserId: user.id,
        createdByName: user.fullName ?? null,
      },
      select: SELECT,
    });
  });
  await logAction(
    { action: "CREATE", module: "اثربخشی تبلیغات", entityId: created.id,
      description: `ثبت کمپین ${created.code} — ${created.topic}`, afterState: created },
    user, todayJalali,
  ).catch(() => {});
  return { campaign: toRow(created) };
}

export async function updateAdCampaign(
  id: string,
  input: AdCampaignInput,
  user: AuthUser,
  todayJalali: string,
): Promise<"forbidden" | null | { error: string } | { campaign: AdCampaignRow }> {
  if (!allowed(user)) return "forbidden";
  const db = getDb();
  const before = await db.adCampaign.findUnique({ where: { id }, select: SELECT });
  if (!before) return null;
  const data = scalarData(input);
  const merged = { ...toRow(before), ...data };
  const refusal = adCampaignRefusal(merged as Record<string, unknown>, false);
  if (refusal) return { error: refusal };
  const code = toNullableString(input.code, 40);
  if (code) data.code = code;

  const updated = await db.adCampaign.update({
    where: { id },
    data: data as Prisma.AdCampaignUncheckedUpdateInput,
    select: SELECT,
  });
  await logAction(
    { action: "UPDATE", module: "اثربخشی تبلیغات", entityId: id,
      description: `ویرایش کمپین ${updated.code}`, beforeState: before, afterState: updated },
    user, todayJalali,
  ).catch(() => {});
  return { campaign: toRow(updated) };
}

export async function deleteAdCampaign(
  id: string,
  user: AuthUser,
  todayJalali: string,
): Promise<"forbidden" | boolean> {
  if (!allowed(user)) return "forbidden";
  const db = getDb();
  const before = await db.adCampaign.findUnique({ where: { id }, select: SELECT });
  if (!before) return false;
  await db.adCampaign.delete({ where: { id } });
  await logAction(
    { action: "DELETE", module: "اثربخشی تبلیغات", entityId: id,
      description: `حذف کمپین ${before.code}`, beforeState: before },
    user, todayJalali,
  ).catch(() => {});
  return true;
}

export interface AdImportResult {
  created: number;
  updated: number;
  skipped: { row: number; reason: string }[];
}

/**
 * Rows from the spreadsheet, **matched by code**: a code already on file is
 * updated rather than duplicated, so importing the same sheet twice changes
 * nothing, and a row with no code gets the next one in the series.
 */
export async function importAdCampaigns(
  rows: AdCampaignInput[],
  user: AuthUser,
  todayJalali: string,
): Promise<"forbidden" | AdImportResult> {
  if (!allowed(user)) return "forbidden";
  const result: AdImportResult = { created: 0, updated: 0, skipped: [] };
  const list = Array.isArray(rows) ? rows.slice(0, AD_SCAN_LIMIT) : [];

  await getDb().$transaction(async (tx) => {
    const codes = (await tx.adCampaign.findMany({ select: { code: true } })).map((c) => c.code);
    for (let i = 0; i < list.length; i++) {
      const input = list[i] ?? {};
      const data = scalarData(input);
      const refusal = adCampaignRefusal(data, true);
      if (refusal) { result.skipped.push({ row: i + 1, reason: refusal }); continue; }
      const code = toNullableString(input.code, 40);
      if (code && codes.includes(code)) {
        await tx.adCampaign.update({ where: { code }, data: data as Prisma.AdCampaignUncheckedUpdateInput });
        result.updated++;
        continue;
      }
      const assigned = code ?? nextAdCampaignCode(codes);
      codes.push(assigned);
      await tx.adCampaign.create({
        data: {
          ...(data as Prisma.AdCampaignUncheckedCreateInput),
          code: assigned,
          createdByUserId: user.id,
          createdByName: user.fullName ?? null,
        },
      });
      result.created++;
    }
  }, { timeout: 60_000 });

  await logAction(
    { action: "CREATE", module: "اثربخشی تبلیغات", entityId: "import",
      description: `ورود از اکسل: ${result.created} جدید، ${result.updated} به‌روزرسانی، ${result.skipped.length} رد شده` },
    user, todayJalali,
  ).catch(() => {});
  return result;
}
