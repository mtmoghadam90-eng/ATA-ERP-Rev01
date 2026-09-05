import { getTodayShamsi } from "../../../dateUtils";
import { getDb } from "../../db";
import { AuthUser, canSeeCosts } from "../../auth";
import { parseListQuery } from "../../listing";
import {
  redactCustomerValues, redactProduct, redactProformas, redactPurchaseOrders,
} from "../../costs";
import { listProjects, getProject } from "../projectService";
import { listCustomers, getCustomer } from "../customerService";
import { listProformas, getProforma } from "../proformaService";
import { listProducts, lowStockProducts } from "../productService";
import { listPurchaseOrders, getPurchaseOrder } from "../purchaseOrderService";
import { listTransactions } from "../transactionService";
import { listTasks } from "../taskService";
import {
  FOLLOW_UP_SORTABLE, followUpSummary, listFollowUpQueue, projectFollowUpReport,
} from "../followUpService";
import { LANE_FILTERS } from "../../../utils/workBoard";
import {
  ALL_DEMAND_GROUPINGS, ALL_DEMAND_OUTCOMES, ALL_DEMAND_SOURCES,
  demandGroupingOf, demandOutcomeOf, demandSourceOf,
} from "../../../utils/demandAnalysis";
import { listCategoryGroups, REFERRAL_SORTABLE, listReferrals } from "../activityService";
import { dashboardSummary } from "../dashboardService";
import { productDemand } from "../demandService";
import { summarizeProjectFinance } from "../projectFinance";
import { dateToJalali, jalaliToDate } from "../../dates";
import type { ChatToolDefinition } from "./provider";

/**
 * What the assistant is allowed to look at.
 *
 * Every tool goes through the same service the REST API goes through, so
 * record-level visibility and cost redaction hold exactly as they do on the
 * screens: a user who cannot see a colleague's projects cannot ask the
 * assistant about them either, and one without the `costs` flag gets a
 * assistant that does not know what anything cost.
 *
 * The set is deliberately small and answer-shaped rather than a thin wrapper
 * per table. A model given `run_sql` writes plausible wrong queries; a model
 * given `project_timeline` answers «کجا هولد شده و چند روز» correctly the first
 * time. Where a question needs arithmetic across rows — profit on a project,
 * how long activities take — the arithmetic is here, not in the model.
 */

export interface ToolContext {
  user: AuthUser;
  todayJalali: string;
}

export interface AssistantTool {
  definition: ChatToolDefinition;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

/* ------------------------------- helpers -------------------------------- */

const str = (value: unknown): string => String(value ?? "").trim();
const num = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** A bounded page. The model does not get to ask for the whole table. */
const listQuery = (args: Record<string, unknown>, sortable: readonly string[]) =>
  parseListQuery(
    {
      search: str(args.search),
      page: num(args.page, 1),
      pageSize: Math.min(50, num(args.pageSize, 20)),
      sort: str(args.sort),
      order: str(args.order),
      ...(args.filters && typeof args.filters === "object" ? args.filters : {}),
    },
    sortable,
    Object.keys((args.filters as Record<string, unknown>) ?? {}),
  );

/** Days between two Jalali dates, or null when either is missing. */
function daysBetween(fromJalali: string | null, toJalali: string | null): number | null {
  if (!fromJalali || !toJalali) return null;
  const a = jalaliToDate(fromJalali);
  const b = jalaliToDate(toJalali);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

const PAGE_ARGS = {
  search: { type: "string", description: "متن جستجو (اختیاری)" },
  page: { type: "number", description: "شماره صفحه، از ۱" },
  pageSize: { type: "number", description: "تعداد در هر صفحه، حداکثر ۵۰" },
} as const;

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

/* --------------------------------- tools --------------------------------- */

export function assistantTools(): AssistantTool[] {
  return [
    {
      definition: {
        name: "dashboard_summary",
        description:
          "خلاصه‌ی کل کسب‌وکار: تعداد مشتری، کالا و پروژه، موجودی رو به اتمام،"
          + " سفارش‌های خرید باز، ارزش قراردادهای برنده و در جریان، نرخ برد و"
          + " وضعیت پروژه‌ها."
          /*
           * Spelled out because it was being mistaken for a demand figure and
           * reported as one. `revenueByCategory` is *money already won*, summed
           * per category — so the largest entry is whichever category holds the
           * biggest settled contracts, which is routinely not the one most
           * often asked for. A single sentence in a description is what stands
           * between that number and an answer to a different question.
           */
          + " دو فیلد دسته‌بندی این ابزار «مبلغ» است، نه «تعداد»:"
          + " revenueByCategory یعنی درآمد قراردادهای برنده به تفکیک دسته و"
          + " conversionByCategory یعنی نرخ برد به تفکیک دسته."
          + " برای «چه کالایی بیشتر درخواست شده» یا هر پرسش پرتکرارترین/پرفروش‌ترین"
          + " کالا، این ابزار پاسخ نیست؛ از product_demand استفاده کن.",
        parameters: object({}),
      },
      run: async (_args, ctx) => dashboardSummary(ctx.user),
    },

    {
      definition: {
        name: "search_projects",
        description:
          "جستجوی پروژه‌ها (فرصت‌های فروش) با نام، کد یا نام کارفرما."
          + " هر ردیف وضعیت، تاریخ‌ها و ارقام کلیدی پروژه را دارد.",
        parameters: object({
          ...PAGE_ARGS,
          status: { type: "string", description: "فیلتر وضعیت، مثلاً «برنده (موفق)»" },
        }),
      },
      run: async (args, ctx) => {
        const q = listQuery(args, ["createdAt", "code", "name", "status"]);
        if (str(args.status)) q.filters.status = str(args.status);
        return listProjects(q, ctx.user);
      },
    },

    {
      definition: {
        name: "get_project",
        description:
          "همه‌ی جزئیات یک پروژه با شناسه: مشتری، وضعیت، تاریخ‌ها، مایلستون‌ها،"
          + " اقلام مورد نیاز و خلاصه‌ی تحویل و فروش.",
        parameters: object({ projectId: { type: "string" } }, ["projectId"]),
      },
      run: async (args, ctx) => {
        const project = await getProject(str(args.projectId), ctx.user);
        return project ?? { error: "پروژه یافت نشد یا در دسترس این کاربر نیست." };
      },
    },

    {
      definition: {
        name: "project_finance",
        description:
          "وضعیت مالی یک یا چند پروژه: مبلغ فروش، دریافتی، مانده و درصد تسویه،"
          + " با تفکیک هر پیش‌فاکتور و هر دریافت. برای سوال «چقدر فروختیم /"
          + " چقدر گرفتیم / چقدر طلبکاریم» از این استفاده کن.",
        parameters: object(
          { projectIds: { type: "array", items: { type: "string" }, description: "حداکثر ۲۰ شناسه" } },
          ["projectIds"],
        ),
      },
      run: async (args) => {
        const ids = Array.isArray(args.projectIds)
          ? args.projectIds.map(str).filter(Boolean).slice(0, 20) : [];
        const map = await summarizeProjectFinance(ids);
        return [...map.values()];
      },
    },

    {
      definition: {
        name: "project_profit",
        description:
          "سود ناخالص یک پروژه: درآمد ردیف‌های برنده منهای بهای تمام‌شده‌ی همان"
          + " ردیف‌ها، به ریال. فقط برای کاربری که اجازه دیدن ارقام مالی دارد.",
        parameters: object({ projectId: { type: "string" } }, ["projectId"]),
      },
      run: async (args, ctx) => {
        if (!canSeeCosts(ctx.user)) {
          return { error: "این کاربر اجازه دیدن بهای تمام‌شده و سود را ندارد." };
        }
        const db = getDb();
        const projectId = str(args.projectId);
        const project = await db.project.findUnique({
          where: { id: projectId },
          select: { id: true, code: true, name: true },
        });
        if (!project) return { error: "پروژه یافت نشد." };

        /*
         * Won lines only, and each line's own stored cost.
         *
         * The cost is a snapshot taken when the line was quoted — see
         * `ProformaItem.unitCost`. Looking the product's cost up today would
         * rewrite last year's profit every time a supplier changed a price.
         */
        const items = await db.proformaItem.findMany({
          where: {
            proforma: { projectId, isCancelled: false },
            status: { in: ["برنده", "برنده (تایید شده)"] },
          },
          select: {
            quantity: true, unitPriceRial: true, totalPriceRial: true,
            unitCost: true, costSource: true, productName: true,
            proforma: { select: { proformaNumber: true, currency: true, historicalExchangeRate: true } },
          },
        });

        let revenue = 0;
        let cost = 0;
        let costedRevenue = 0;
        const uncosted: string[] = [];

        for (const item of items) {
          const rate = Number(item.proforma?.historicalExchangeRate ?? 0) || 1;
          const inRial = item.proforma?.currency && item.proforma.currency !== "ریال" ? rate : 1;
          const lineRevenue = Number(item.totalPriceRial ?? 0) * inRial;
          revenue += lineRevenue;

          if (item.unitCost === null || item.unitCost === undefined) {
            uncosted.push(item.productName);
            continue;
          }
          cost += Number(item.unitCost) * Number(item.quantity) * inRial;
          costedRevenue += lineRevenue;
        }

        const grossProfit = costedRevenue - cost;
        return {
          project,
          currency: "ریال",
          wonLines: items.length,
          revenueRial: Math.round(revenue),
          costRial: Math.round(cost),
          grossProfitRial: Math.round(grossProfit),
          grossMarginPercent: costedRevenue > 0
            ? Math.round((grossProfit / costedRevenue) * 1000) / 10 : null,
          /*
           * How much of the revenue could be costed at all. A line with no cost
           * is left out of both sides rather than counted as pure margin, and
           * this is what stops a suspiciously good margin from reading as good
           * news when it is really missing data.
           */
          costCoveragePercent: revenue > 0
            ? Math.round((costedRevenue / revenue) * 1000) / 10 : null,
          uncostedLines: uncosted,
        };
      },
    },

    {
      definition: {
        name: "project_timeline",
        description:
          "خط زمانی یک پروژه: هر دسته‌بندی فعالیت با تاریخ شروع و پایان، تعداد"
          + " روز باز بودن، آخرین فعالیت و تعداد روزی که از آن گذشته."
          + " برای سوال «کجا متوقف شده و چند روز» دقیقاً همین را بخوان.",
        parameters: object({ projectId: { type: "string" } }, ["projectId"]),
      },
      run: async (args, ctx) => {
        const projectId = str(args.projectId);
        const groups = await listCategoryGroups(projectId, ctx.user);
        if (!groups) return { error: "پروژه یافت نشد یا در دسترس این کاربر نیست." };

        const db = getDb();
        const rows = groups as unknown as {
          id: string; categoryName: string; status: string;
          startDateJalali: string | null; endDateJalali: string | null;
        }[];

        const stages = [];
        for (const group of rows) {
          const last = await db.projectActivity.findFirst({
            where: { groupId: group.id },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true, text: true, authorName: true },
          });
          const lastJalali = last ? dateToJalali(last.createdAt) : null;
          const count = await db.projectActivity.count({ where: { groupId: group.id } });

          stages.push({
            category: group.categoryName,
            status: group.status,
            startDate: group.startDateJalali,
            endDate: group.endDateJalali,
            daysOpen: daysBetween(group.startDateJalali, group.endDateJalali ?? ctx.todayJalali),
            activityCount: count,
            lastActivityDate: lastJalali,
            daysSinceLastActivity: daysBetween(lastJalali, ctx.todayJalali),
            lastActivityText: last?.text?.slice(0, 200) ?? null,
            lastActivityBy: last?.authorName ?? null,
          });
        }

        const openStages = stages.filter((s) => s.status !== "اتمام کار");
        return {
          today: ctx.todayJalali,
          stages,
          /*
           * The answer to "where is it stuck": the open stage that has gone
           * longest without anybody writing anything on it.
           */
          stalledStage: openStages
            .slice()
            .sort((a, b) => (b.daysSinceLastActivity ?? -1) - (a.daysSinceLastActivity ?? -1))[0]
            ?? null,
        };
      },
    },

    {
      definition: {
        name: "activity_stats",
        description:
          "آمار زمان انجام کارها در کل شرکت یا یک بازه: میانگین و میانه‌ی روزهای"
          + " باز بودن هر دسته‌بندی فعالیت، تعداد نمونه‌ها، و میانگین فاصله‌ی"
          + " بین فعالیت‌ها. برای «میانگین زمان انجام هر فعالیت» از این استفاده کن.",
        parameters: object({
          fromDate: { type: "string", description: "تاریخ شمسی YYYY/MM/DD (اختیاری)" },
          toDate: { type: "string", description: "تاریخ شمسی YYYY/MM/DD (اختیاری)" },
          category: { type: "string", description: "فقط یک دسته‌بندی (اختیاری)" },
        }),
      },
      run: async (args, ctx) => {
        const db = getDb();
        const where: Record<string, unknown> = {};
        if (str(args.category)) where.categoryName = str(args.category);

        const groups = await db.projectCategoryGroup.findMany({
          where,
          select: {
            categoryName: true, status: true,
            startDateJalali: true, endDateJalali: true,
            _count: { select: { activities: true } },
          },
          take: 5000,
        });

        const from = str(args.fromDate) || null;
        const to = str(args.toDate) || ctx.todayJalali;

        const byCategory = new Map<string, number[]>();
        let inRange = 0;

        for (const group of groups) {
          if (!group.startDateJalali) continue;
          if (from && group.startDateJalali < from) continue;
          if (to && group.startDateJalali > to) continue;
          inRange++;
          // Only finished stages have a duration; an open one is still running
          // and averaging it in would understate every figure here.
          if (group.status !== "اتمام کار" || !group.endDateJalali) continue;
          const days = daysBetween(group.startDateJalali, group.endDateJalali);
          if (days === null || days < 0) continue;
          const list = byCategory.get(group.categoryName) ?? [];
          list.push(days);
          byCategory.set(group.categoryName, list);
        }

        const summary = [...byCategory.entries()].map(([category, days]) => {
          const sorted = days.slice().sort((a, b) => a - b);
          const sum = sorted.reduce((acc, d) => acc + d, 0);
          return {
            category,
            completedCount: sorted.length,
            averageDays: Math.round((sum / sorted.length) * 10) / 10,
            medianDays: sorted[Math.floor(sorted.length / 2)],
            minDays: sorted[0],
            maxDays: sorted[sorted.length - 1],
          };
        }).sort((a, b) => b.completedCount - a.completedCount);

        const allDays = [...byCategory.values()].flat();
        return {
          range: { from, to },
          stagesInRange: inRange,
          completedStagesMeasured: allDays.length,
          overallAverageDays: allDays.length
            ? Math.round((allDays.reduce((a, d) => a + d, 0) / allDays.length) * 10) / 10
            : null,
          byCategory: summary,
          note: "فقط دسته‌بندی‌های «اتمام کار» با تاریخ شروع و پایان اندازه‌گیری شده‌اند.",
        };
      },
    },

    {
      definition: {
        name: "search_customers",
        description:
          "جستجوی مشتریان با نام، موبایل، کد اقتصادی یا استان. رتبه‌ی ارزش مشتری"
          + " و ارقام ارزیابی هم در هر ردیف هست.",
        parameters: object(PAGE_ARGS),
      },
      run: async (args, ctx) => {
        const result = await listCustomers(
          listQuery(args, ["createdAt", "companyName", "province"]), ctx.user, {},
        );
        return { ...result, rows: redactCustomerValues(result.rows, ctx.user) };
      },
    },

    {
      definition: {
        name: "get_customer",
        description: "پرونده‌ی کامل یک مشتری با شناسه، شامل ارزیابی ارزش مشتری.",
        parameters: object({ customerId: { type: "string" } }, ["customerId"]),
      },
      run: async (args, ctx) => {
        const customer = await getCustomer(str(args.customerId), ctx.user);
        if (!customer) return { error: "مشتری یافت نشد یا در دسترس این کاربر نیست." };
        return redactCustomerValues([customer], ctx.user)[0];
      },
    },

    {
      definition: {
        name: "search_proformas",
        description:
          "جستجوی پیش‌فاکتورها. هر ردیف شماره، مشتری، پروژه، مبلغ و وضعیت"
          + " (پیش‌نویس/ارسال شده) و نتیجه (برنده/باخته/نیمه‌برنده) دارد.",
        parameters: object({
          ...PAGE_ARGS,
          status: { type: "string" },
          projectId: { type: "string" },
        }),
      },
      run: async (args, ctx) => {
        const q = listQuery(args, ["createdAt", "proformaNumber", "finalAmount"]);
        if (str(args.status)) q.filters.status = str(args.status);
        // A project is a filter on this endpoint, not an extra.
        if (str(args.projectId)) q.filters.projectId = str(args.projectId);
        const result = await listProformas(q, ctx.user, {});
        return { ...result, rows: redactProformas(result.rows, ctx.user) };
      },
    },

    {
      definition: {
        name: "get_proforma",
        description: "یک پیش‌فاکتور کامل با همه‌ی ردیف‌ها، قیمت‌ها و شرایط.",
        parameters: object({ proformaId: { type: "string" } }, ["proformaId"]),
      },
      run: async (args, ctx) => {
        const proforma = await getProforma(str(args.proformaId), ctx.user);
        if (!proforma) return { error: "پیش‌فاکتور یافت نشد." };
        return redactProformas([proforma], ctx.user)[0];
      },
    },

    {
      definition: {
        name: "search_products",
        description: "جستجوی کالا و تجهیزات انبار: موجودی، قیمت و مشخصات.",
        parameters: object(PAGE_ARGS),
      },
      run: async (args, ctx) => {
        const result = await listProducts(
          listQuery(args, ["createdAt", "displayName", "stockLevel"]), ctx.user, {},
        );
        return { ...result, rows: result.rows.map((row) => redactProduct(row, ctx.user)) };
      },
    },

    {
      definition: {
        name: "product_demand",
        description:
          "پرتکرارترین کالاهای درخواست‌شده: هر کالا چند بار و در چند سند درخواست"
          + " شده، چه تعدادی، از چند مشتری، و چند ردیفش برنده یا بازنده شده است."
          + " پاسخ همیشه در سطح «کالا»ست مگر groupBy را عوض کنی."
          + " برای این پرسش‌ها همین ابزار درست است: بیشترین/کمترین درخواست،"
          + " پرتکرارترین کالا، پرفروش‌ترین کالا، کالایی که بیشتر باخته‌ایم،"
          + " تقاضای یک دسته یا یک بازه زمانی."
          + " خروجی یک فیلد measured دارد که می‌گوید دقیقاً چه چیزی شمرده شده؛"
          + " آن را در پاسخت بازگو کن.",
        parameters: object({
          source: {
            type: "string",
            enum: [...ALL_DEMAND_SOURCES],
            description:
              "PROFORMA = درخواست قیمت مشتری در پیش‌فاکتور (پیش‌فرض و معنای"
              + " معمول «درخواست»)، PROJECT = اقلام مورد نیاز پروژه‌ها،"
              + " INQUIRY = استعلام‌های ما از تأمین‌کننده.",
          },
          groupBy: {
            type: "string",
            enum: [...ALL_DEMAND_GROUPINGS],
            description: "PRODUCT (پیش‌فرض) | VARIANT (کد فنی) | CATEGORY (دسته‌بندی)",
          },
          outcome: {
            type: "string",
            enum: [...ALL_DEMAND_OUTCOMES],
            description: "فقط برای PROFORMA: ALL (پیش‌فرض) | WON | LOST | OPEN",
          },
          from: { type: "string", description: "از تاریخ شمسی YYYY/MM/DD (اختیاری)" },
          to: { type: "string", description: "تا تاریخ شمسی YYYY/MM/DD (اختیاری)" },
          category: { type: "string", description: "فقط یک دسته‌بندی کالا (اختیاری)" },
          search: { type: "string", description: "محدود کردن به کالاهایی با این نام (اختیاری)" },
          limit: { type: "number", description: "چند ردیف برگردد، حداکثر ۵۰" },
        }),
      },
      run: async (args, ctx) => productDemand({
        source: demandSourceOf(args.source),
        grouping: demandGroupingOf(args.groupBy),
        outcome: demandOutcomeOf(args.outcome),
        fromJalali: str(args.from) || null,
        toJalali: str(args.to) || null,
        category: str(args.category) || null,
        search: str(args.search) || null,
        limit: Math.min(50, Math.max(1, num(args.limit, 15))),
      }, ctx.user),
    },

    {
      definition: {
        name: "low_stock_products",
        description: "کالاهایی که موجودی قابل فروششان به حداقل تعیین‌شده رسیده یا کمتر است.",
        parameters: object({ limit: { type: "number" } }),
      },
      run: async (args, ctx) => {
        const rows = await lowStockProducts(ctx.user, Math.min(100, num(args.limit, 50)));
        return rows.map((row) => redactProduct(row, ctx.user));
      },
    },

    {
      definition: {
        name: "search_purchase_orders",
        description:
          "سفارش‌های خرید خارجی: تأمین‌کننده، پروژه، مبالغ ارزی، وضعیت حمل و ترخیص.",
        parameters: object({ ...PAGE_ARGS, status: { type: "string" } }),
      },
      run: async (args, ctx) => {
        const q = listQuery(args, ["createdAt", "poNumber"]);
        if (str(args.status)) q.filters.status = str(args.status);
        const result = await listPurchaseOrders(q, ctx.user, {});
        return { ...result, rows: redactPurchaseOrders(result.rows, ctx.user) };
      },
    },

    {
      definition: {
        name: "get_purchase_order",
        description: "یک سفارش خرید کامل با ردیف‌ها، هزینه‌ها و مراحل.",
        parameters: object({ purchaseOrderId: { type: "string" } }, ["purchaseOrderId"]),
      },
      run: async (args, ctx) => {
        const order = await getPurchaseOrder(str(args.purchaseOrderId), ctx.user);
        if (!order) return { error: "سفارش خرید یافت نشد." };
        return redactPurchaseOrders([order], ctx.user)[0];
      },
    },

    {
      definition: {
        name: "search_transactions",
        description:
          "دریافت‌ها و پرداخت‌های ریالی: تاریخ، طرف حساب، مبلغ، بابت و پروژه‌ی مرتبط.",
        parameters: object({
          ...PAGE_ARGS,
          type: { type: "string", description: "«دریافت» یا «پرداخت»" },
          projectId: { type: "string" },
        }),
      },
      run: async (args, ctx) => {
        const q = listQuery(args, ["createdAt", "occurredAt", "amountRial"]);
        if (str(args.type)) q.filters.type = str(args.type);
        if (str(args.projectId)) q.filters.projectId = str(args.projectId);
        const result = await listTransactions(q, ctx.user, {});
        return result ?? { error: "این کاربر اجازه دیدن تراکنش‌های مالی را ندارد." };
      },
    },

    {
      definition: {
        name: "search_tasks",
        description:
          "وظایف و پیگیری‌ها: عنوان، مسئول، ارجاع‌دهنده، سررسید، وضعیت و پروژه‌ی مربوطه."
          + " جستجو، متن وظیفه و کد/نام پروژه و مشتری آن را هم می‌گردد.",
        parameters: object({
          ...PAGE_ARGS,
          /*
           * The board's own column, not a status word.
           *
           * Every automation writes «در انتظار» — a fourth value no dropdown
           * ever offered — so an exact status filter answered with nothing on a
           * board full of them. `lane` is the exclusion the screen uses.
           */
          lane: {
            type: "string",
            description: `یکی از: ${LANE_FILTERS.join("، ")}`,
          },
          scope: {
            type: "string",
            description: "toMe (به من ارجاع شده) یا fromMe (من ارجاع دادم)",
          },
          status: { type: "string", description: "وضعیت دقیق، اگر lane کافی نیست" },
          hideCompleted: { type: "boolean", description: "پنهان‌کردن ستون انجام‌شده" },
        }),
      },
      run: async (args, ctx) => {
        const q = listQuery(args, ["createdAt", "dueDate", "title"]);
        if (str(args.status)) q.filters.status = str(args.status);
        const scope = str(args.scope);
        return listTasks(q, ctx.user, {
          lane: str(args.lane) || undefined,
          hideCompleted: args.hideCompleted === true,
          scope: scope === "toMe" || scope === "fromMe" ? scope : undefined,
          // «در انتظار مشتری» is a date comparison and not a status word, so
          // the assistant cannot ask for that column without today either.
          today: getTodayShamsi(),
        });
      },
    },

    /*
     * The sales desk's own queue.
     *
     * Every figure on a row is derived — the next action, its date, whether it
     * is overdue — so this is the service the screen uses and not a read of the
     * proformas table: assembling it from rows would be a second copy of the
     * ranking, which is how two answers to one question come about.
     */
    {
      definition: {
        name: "sales_follow_up_queue",
        description:
          "صف پیگیری فروش: پیش‌فاکتورهای بازی که باید دنبال شوند، با اقدام بعدی،"
          + " تاریخ سررسید، مسئول و سلامت پیگیری (عقب‌افتاده، امروز، بدون اقدام بعدی)."
          + " برای «چه پیگیری‌هایی عقب افتاده» و «کدام پیش‌فاکتورها رها شده‌اند».",
        parameters: object({
          ...PAGE_ARGS,
          health: {
            type: "string",
            description: "OVERDUE | DUE_TODAY | NO_NEXT_ACTION | UPCOMING — محدود به یک وضعیت",
          },
        }),
      },
      run: async (args, ctx) => {
        const q = listQuery(args, [...FOLLOW_UP_SORTABLE]);
        const result = await listFollowUpQueue(q, ctx.user, { health: str(args.health) });
        return result ?? { error: "این کاربر اجازه دیدن پیگیری‌های فروش را ندارد." };
      },
    },

    {
      definition: {
        name: "follow_up_summary",
        description:
          "شمارش سلامت پیگیری‌ها: امروز، عقب‌افتاده، بدون اقدام بعدی، موکول‌شده،"
          + " بدون پاسخ، و آن‌هایی که بیش از دو هفته باز مانده‌اند.",
        parameters: object({}),
      },
      run: async (_args, ctx) => followUpSummary(ctx.user, ctx.todayJalali),
    },

    {
      definition: {
        name: "project_follow_ups",
        description:
          "تاریخچه‌ی کامل پیگیری‌های یک پروژه، شامل پیش‌فاکتورهای تعیین‌تکلیف‌شده."
          + " برای «روی این پروژه چه پیگیری‌هایی انجام شده و مشتری چه گفته».",
        parameters: object({ projectId: { type: "string" } }, ["projectId"]),
      },
      run: async (args, ctx) => {
        const report = await projectFollowUpReport(str(args.projectId), ctx.user);
        return report ?? { error: "این کاربر اجازه دیدن پیگیری‌های فروش را ندارد." };
      },
    },

    /*
     * Referrals are the other half of the merged board: work handed between
     * colleagues, with its own thread. Scoped by the service, which forces the
     * caller's own id into the query for anything but the company-wide view.
     */
    {
      definition: {
        name: "search_referrals",
        description:
          "ارجاع‌های کاری بین همکاران: درخواست، ارجاع‌دهنده، مسئول، وضعیت و پروژه."
          + " scope=toMe یعنی آنچه به این کاربر ارجاع شده، fromMe یعنی آنچه او ارجاع داده.",
        parameters: object({
          ...PAGE_ARGS,
          scope: { type: "string", description: "toMe | fromMe | mine" },
          open: { type: "boolean", description: "فقط ارجاع‌های باز" },
        }),
      },
      run: async (args, ctx) => {
        const q = listQuery(args, [...REFERRAL_SORTABLE]);
        const scope = str(args.scope);
        return listReferrals(q, ctx.user, {
          scope: scope === "toMe" || scope === "fromMe" || scope === "mine" ? scope : undefined,
          open: args.open === true,
        });
      },
    },

    {
      definition: {
        name: "recent_activities",
        description:
          "آخرین فعالیت‌های ثبت‌شده روی پروژه‌ها، با متن، نویسنده، دسته‌بندی و تاریخ."
          + " برای «آخرین وضعیت فلان پروژه چیست» مفید است.",
        parameters: object({
          ...PAGE_ARGS,
          projectId: { type: "string", description: "محدود به یک پروژه (اختیاری)" },
        }),
      },
      run: async (args, ctx) => {
        const db = getDb();
        const projectId = str(args.projectId);
        const rows = await db.projectActivity.findMany({
          where: projectId ? { group: { projectId } } : {},
          orderBy: { createdAt: "desc" },
          take: Math.min(50, num(args.pageSize, 20)),
          select: {
            id: true, text: true, authorName: true, createdAt: true,
            group: {
              select: {
                categoryName: true,
                project: { select: { id: true, code: true, name: true } },
              },
            },
          },
        });
        // Visibility is checked by asking for the projects the user may see.
        const visible = await listProjects(
          parseListQuery({ pageSize: 200 }, []), ctx.user, { withSummary: false },
        );
        const allowed = new Set(visible.rows.map((r) => String((r as { id: string }).id)));
        return rows
          .filter((row) => !row.group?.project?.id || allowed.has(row.group.project.id))
          .map((row) => ({
            id: row.id,
            date: dateToJalali(row.createdAt),
            category: row.group?.categoryName ?? null,
            project: row.group?.project ?? null,
            author: row.authorName,
            text: row.text.slice(0, 400),
          }));
      },
    },
  ];
}

/** The tool definitions, as the provider wants them. */
export function toolDefinitions(tools: AssistantTool[]): ChatToolDefinition[] {
  return tools.map((tool) => tool.definition);
}
