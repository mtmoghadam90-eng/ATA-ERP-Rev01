import { getDb } from "../db";
import { loadSettings } from "../settings";
import { AuthUser, hasPermission } from "../auth";
import { addDaysToShamsi, getShamsiDaysDifference } from "../../dateUtils";
import { jalaliToDate, dateToJalali } from "../dates";
import { ITEM_WON, getProformaOutcome, notTechnical } from "../proformaStatus";
import { isTerminalOutcome, FOLLOW_UP_KIND } from "../../utils/salesFollowUp";
import { TASK_DONE, TASK_CANCELLED, REFERRAL_DONE } from "../../utils/workBoard";
import { afterSalesIsOpen, PROJECT_STATUSES } from "../../utils/moduleStatuses";
import {
  AdvisorThresholds, resolveAdvisorThresholds, SIGNAL_LABELS, Signal, askedNeverBought, bottlenecksByState,
  countSignals, customerOpportunityHints, overdueSeverity, quoteExpirySignal,
  rankSignals, tallyByOwner, tallyReasons,
} from "../../utils/businessAdvisor";
import { stuckWorkReport } from "./stuckWorkService";
import { followUpSummary } from "./followUpService";
import { visibilityClause as projectVisibility } from "./projectService";
import { visibilityClause as proformaVisibility } from "./proformaService";
import { visibilityClause as customerVisibility } from "./customerService";
import { visibilityClause as taskVisibility } from "./taskService";

/**
 * The reading the «مشاور کسب‌وکار» tools answer from.
 *
 * Nothing here writes. Every query is narrowed by the module's own visibility
 * rule **inside** the query — an adviser that counted jobs this person may not
 * see would leak their existence through its totals — and a module the caller
 * cannot read is reported as **withheld** rather than as empty, because «nothing
 * is wrong» and «you may not look» are opposite answers. Every scan is bounded
 * and says so when it hits the bound.
 */

const SCAN = 300;
const TOP = 40;

/** Sales statuses a project can still be won or lost from. */
const OPEN_SALES_STATUSES: string[] = PROJECT_STATUSES.filter(
  (s) => !["برنده (موفق)", "باخته", "لغو شده", "نیمه برنده"].includes(s),
);

/**
 * The thresholds in force: the company's own from the assistant's settings tab,
 * filled in with the defaults. Read on every call so a change takes effect on
 * the next question without a restart.
 */
async function loadThresholds(): Promise<AdvisorThresholds> {
  const settings = await loadSettings() as { assistant?: { advisorThresholds?: unknown } } | undefined;
  return resolveAdvisorThresholds(settings?.assistant?.advisorThresholds);
}

const and = (...parts: (Record<string, unknown> | undefined | null)[]) => {
  const list = parts.filter(Boolean) as Record<string, unknown>[];
  return list.length === 1 ? list[0] : { AND: list };
};

const daysFrom = (fromJalali: string | null | undefined, toJalali: string): number | null =>
  fromJalali ? getShamsiDaysDifference(fromJalali, toJalali) : null;

/* --------------------------- the forgotten work --------------------------- */

export interface HealthCheck {
  measured: string;
  today: string;
  thresholds: AdvisorThresholds;
  counts: Record<string, number>;
  labels: typeof SIGNAL_LABELS;
  followUps: Awaited<ReturnType<typeof followUpSummary>> | null;
  signals: Signal[];
  /** Modules this person may not read, so their signals are absent, not zero. */
  withheld: string[];
  truncated: boolean;
}

export async function businessHealthCheck(user: AuthUser, today: string): Promise<HealthCheck> {
  const db = getDb();
  const t = await loadThresholds();
  const signals: Signal[] = [];
  const withheld: string[] = [];
  let truncated = false;
  const todayDate = jalaliToDate(today)!;

  /* 1. Records sitting in one state past their allowed time. */
  const stuck = await stuckWorkReport(user, { includeWarning: false, todayJalali: today });
  for (const section of stuck.sections) if (!section.visible) withheld.push(`stuck:${section.section}`);
  truncated ||= stuck.truncated;
  for (const row of stuck.rows.filter((r) => r.severity === "OVERDUE")) {
    signals.push({
      kind: "STUCK",
      severity: row.ratio >= 2 ? "HIGH" : "MEDIUM",
      fact: `${row.label} ${row.dwellDays} روز در «${row.state}» مانده (مجاز: ${row.thresholdDays} روز).`,
      days: row.dwellDays,
      ref: {
        type: row.section === "purchaseOrder" ? "purchaseOrder" : row.section === "afterSales" ? "afterSales" : "project",
        id: row.id, label: row.label, projectCode: row.projectCode,
      },
    });
  }

  /* 2. Tasks past their date. A sales chase is reported by the follow-up summary. */
  if (hasPermission(user, "tasks")) {
    const tasks = await db.task.findMany({
      where: and(taskVisibility(user), {
        dueDate: { lt: todayDate },
        status: { notIn: [TASK_DONE, TASK_CANCELLED] },
        taskKind: { not: FOLLOW_UP_KIND },
      }) as never,
      orderBy: { dueDate: "asc" },
      take: SCAN,
      select: { id: true, title: true, dueDateJalali: true, assignedToName: true, relatedToName: true },
    });
    truncated ||= tasks.length === SCAN;
    for (const task of tasks) {
      const late = daysFrom(task.dueDateJalali, today) ?? 0;
      signals.push({
        kind: "OVERDUE_TASK",
        severity: overdueSeverity(late),
        fact: `«${task.title}» ${late} روز از سررسیدش (${task.dueDateJalali}) گذشته.`,
        days: late,
        owner: task.assignedToName,
        ref: { type: "task", id: task.id, label: task.title, customerName: task.relatedToName },
      });
    }
  } else withheld.push("tasks");

  /* 3. Referrals still open a week on — the ones this person is party to. */
  const referrals = await db.projectReferral.findMany({
    where: {
      status: { not: REFERRAL_DONE },
      createdAt: { lt: jalaliToDate(addDaysToShamsi(today, -t.staleReferralDays))! },
      OR: [{ assignedToUserId: user.id }, { assignedByUserId: user.id }],
    },
    orderBy: { createdAt: "asc" },
    take: SCAN,
    select: {
      id: true, actionRequired: true, assignedToName: true, createdAt: true,
      activity: { select: { group: { select: { project: { select: { code: true } } } } } },
    },
  });
  truncated ||= referrals.length === SCAN;
  for (const r of referrals) {
    const age = daysFrom(dateToJalali(r.createdAt), today) ?? 0;
    signals.push({
      kind: "STALE_REFERRAL",
      severity: age >= 14 ? "HIGH" : "MEDIUM",
      fact: `ارجاع «${r.actionRequired.slice(0, 80)}» ${age} روز است باز مانده.`,
      days: age,
      owner: r.assignedToName,
      ref: {
        type: "referral", id: r.id, label: r.actionRequired.slice(0, 60),
        projectCode: r.activity?.group?.project?.code ?? null,
      },
    });
  }

  /* 4. Live quotations about to lapse, or lapsed and still open. */
  let followUps: HealthCheck["followUps"] = null;
  if (hasPermission(user, "proformas")) {
    followUps = await followUpSummary(user, today);
    const quotes = await db.proforma.findMany({
      where: and(proformaVisibility(user), notTechnical(), {
        isCancelled: false,
        expiryDate: {
          gte: jalaliToDate(addDaysToShamsi(today, -t.lapsedQuoteDays))!,
          lte: jalaliToDate(addDaysToShamsi(today, t.expiringQuoteDays))!,
        },
      }) as never,
      take: SCAN,
      select: {
        id: true, proformaNumber: true, status: true, isCancelled: true, proformaType: true,
        expiryDateJalali: true, items: { select: { status: true } },
        customer: { select: { companyName: true } },
        project: { select: { code: true, salesExpert: true } },
      },
    });
    truncated ||= quotes.length === SCAN;
    for (const q of quotes) {
      const outcome = getProformaOutcome(q);
      if (isTerminalOutcome(outcome) || outcome === "پیش‌نویس") continue;
      const toExpiry = q.expiryDateJalali ? getShamsiDaysDifference(today, q.expiryDateJalali) : null;
      const expiry = quoteExpirySignal(toExpiry, t);
      if (!expiry) continue;
      signals.push({
        kind: expiry.kind,
        severity: expiry.severity,
        fact: expiry.kind === "EXPIRING_QUOTE"
          ? `اعتبار پیش‌فاکتور ${q.proformaNumber} ${toExpiry} روز دیگر (${q.expiryDateJalali}) تمام می‌شود.`
          : `اعتبار پیش‌فاکتور ${q.proformaNumber} ${-(toExpiry ?? 0)} روز پیش تمام شده و هنوز تعیین‌تکلیف نشده.`,
        days: toExpiry === null ? null : Math.abs(toExpiry),
        owner: q.project?.salesExpert ?? null,
        ref: {
          type: "proforma", id: q.id, label: q.proformaNumber,
          projectCode: q.project?.code ?? null, customerName: q.customer?.companyName ?? null,
        },
      });
    }
  } else withheld.push("proformas");

  /*
   * 5. Sales-stage projects nobody has touched — no write and no feed message.
   * No permission check: `projectVisibility` narrows to the caller's own jobs.
   */
  {
    const cutoff = jalaliToDate(addDaysToShamsi(today, -t.quietProjectDays))!;
    const candidates = await db.project.findMany({
      where: and(projectVisibility(user), {
        status: { in: OPEN_SALES_STATUSES },
        updatedAt: { lt: cutoff },
      }) as never,
      orderBy: { updatedAt: "asc" },
      take: SCAN,
      select: {
        id: true, code: true, name: true, status: true, stage: true, updatedAt: true, salesExpert: true,
        customer: { select: { companyName: true } },
      },
    });
    truncated ||= candidates.length === SCAN;
    const lastActivity = await lastActivityByProject(candidates.map((p) => p.id));
    for (const p of candidates) {
      const latest = maxDate(p.updatedAt, lastActivity.get(p.id));
      if (latest >= cutoff) continue;
      const quiet = daysFrom(dateToJalali(latest), today) ?? 0;
      signals.push({
        kind: "QUIET_PROJECT",
        severity: quiet >= t.quietProjectDays * 2 ? "HIGH" : "MEDIUM",
        fact: `پروژه‌ی ${p.code} «${p.name}» (${p.status}) ${quiet} روز است هیچ فعالیت یا ویرایشی نداشته.`,
        days: quiet,
        owner: p.salesExpert,
        ref: { type: "project", id: p.id, label: p.code, projectCode: p.code, customerName: p.customer?.companyName ?? null },
      });
    }
  }

  /* 6. Valuable customers who have stopped buying. */
  if (hasPermission(user, "customers")) {
    const dormant = await db.customerValueMetrics.findMany({
      where: {
        customerValueRank: { in: ["A", "B"] },
        daysSinceLastPurchase: { gte: t.dormantCustomerDays },
        ...(customerVisibility(user) ? { customer: customerVisibility(user) } : {}),
      } as never,
      orderBy: { daysSinceLastPurchase: "desc" },
      take: 50,
      select: {
        customerId: true, customerValueRank: true, daysSinceLastPurchase: true, lastPurchaseDateJalali: true,
        customer: { select: { companyName: true } },
      },
    });
    for (const m of dormant) {
      signals.push({
        kind: "DORMANT_CUSTOMER",
        severity: m.customerValueRank === "A" ? "HIGH" : "MEDIUM",
        fact: `مشتری رتبه‌ی ${m.customerValueRank} «${m.customer.companyName}» ${m.daysSinceLastPurchase} روز است`
          + ` خریدی نداشته (آخرین خرید ${m.lastPurchaseDateJalali ?? "نامشخص"}).`,
        days: m.daysSinceLastPurchase,
        ref: { type: "customer", id: m.customerId, label: m.customer.companyName, customerName: m.customer.companyName },
      });
    }
  } else withheld.push("customers");

  const ranked = rankSignals(signals);
  return {
    measured: `تا امروز ${today}: کارهای متوقف بیش از زمان مجاز، وظایف عقب‌افتاده (به‌جز پیگیری فروش)،`
      + ` ارجاع‌های باز بیش از ${t.staleReferralDays} روز، پیش‌فاکتورهای باز با اعتبار رو به اتمام`
      + ` (${t.expiringQuoteDays} روز آینده) یا منقضی (${t.lapsedQuoteDays} روز گذشته)، پروژه‌های فروش بدون`
      + ` فعالیت بیش از ${t.quietProjectDays} روز، و مشتریان رتبه‌ی A/B بدون خرید بیش از ${t.dormantCustomerDays} روز.`
      + ` فقط رکوردهایی که این کاربر اجازه‌ی دیدنشان را دارد.`,
    today,
    thresholds: t,
    counts: countSignals(ranked),
    labels: SIGNAL_LABELS,
    followUps,
    signals: ranked.slice(0, TOP),
    withheld,
    truncated: truncated || ranked.length > TOP,
  };
}

function maxDate(a: Date, b: Date | undefined): Date {
  return b && b > a ? b : a;
}

/** The latest feed message per project, one query for the whole set. */
async function lastActivityByProject(projectIds: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (projectIds.length === 0) return out;
  const groups = await getDb().projectCategoryGroup.findMany({
    where: { projectId: { in: projectIds } },
    select: {
      projectId: true,
      activities: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });
  for (const g of groups) {
    const at = g.activities[0]?.createdAt;
    if (at && (!out.get(g.projectId) || at > out.get(g.projectId)!)) out.set(g.projectId, at);
  }
  return out;
}

/* ------------------------------ bottlenecks ------------------------------ */

export async function processBottlenecks(user: AuthUser, today: string) {
  const db = getDb();
  const t = await loadThresholds();
  const withheld: string[] = [];

  const stuck = await stuckWorkReport(user, { includeWarning: true, todayJalali: today });
  for (const section of stuck.sections) if (!section.visible) withheld.push(`stuck:${section.section}`);
  const states = bottlenecksByState(stuck.rows.map((r) => ({
    section: r.section, state: r.state, dwellDays: r.dwellDays, overdue: r.severity === "OVERDUE",
  })));

  let overdueTasksByOwner: { owner: string; count: number }[] | null = null;
  if (hasPermission(user, "tasks")) {
    const late = await db.task.findMany({
      where: and(taskVisibility(user), {
        dueDate: { lt: jalaliToDate(today)! },
        status: { notIn: [TASK_DONE, TASK_CANCELLED] },
      }) as never,
      take: 1000,
      select: { assignedToName: true },
    });
    overdueTasksByOwner = tallyByOwner(late.map((x) => x.assignedToName));
  } else withheld.push("tasks");

  /* Why jobs were lost over the last six months — where a process can change. */
  let lossReasons: ReturnType<typeof tallyReasons> | null = null;
  let lostProjects = 0;
  if (hasPermission(user, "projects")) {
    const lost = await db.project.findMany({
      where: and(projectVisibility(user), {
        status: "باخته",
        statusChangedAt: { gte: jalaliToDate(addDaysToShamsi(today, -t.lossWindowDays))! },
      }) as never,
      take: 1000,
      select: { lossReason: true },
    });
    lostProjects = lost.length;
    lossReasons = tallyReasons(lost.map((p) => p.lossReason));
  } else withheld.push("projects");

  return {
    measured: `مراحلی که کار در آن‌ها انباشته شده (بر اساس آستانه‌های «کارهای متوقف»، با میانه‌ی روزهای ماندن)،`
      + ` وظایف عقب‌افتاده به تفکیک مسئول، و دلایل باخت پروژه‌ها در ${t.lossWindowDays} روز گذشته (${lostProjects} پروژه).`
      + ` تا امروز ${today}.`,
    today,
    bottlenecks: states.slice(0, 15),
    overdueTasksByOwner: overdueTasksByOwner?.slice(0, 15) ?? null,
    lossReasons,
    followUps: hasPermission(user, "proformas") ? await followUpSummary(user, today) : null,
    withheld,
    truncated: stuck.truncated,
  };
}

/* ----------------------- one customer's opportunities ---------------------- */

export async function customerOpportunities(customerId: string, user: AuthUser, today: string) {
  const db = getDb();
  const t = await loadThresholds();
  if (!hasPermission(user, "customers")) return { error: "این کاربر اجازه دیدن مشتریان را ندارد." };
  const customer = await db.customer.findFirst({
    where: and({ id: customerId }, customerVisibility(user)) as never,
    select: { id: true, companyName: true, customerType: true, industry: true },
  });
  if (!customer) return { error: "این مشتری پیدا نشد یا این کاربر اجازه دیدنش را ندارد." };

  const metrics = await db.customerValueMetrics.findUnique({
    where: { customerId },
    select: { customerValueRank: true, daysSinceLastPurchase: true, lastPurchaseDateJalali: true, purchaseFrequency: true },
  });

  const withheld: string[] = [];
  const canQuotes = hasPermission(user, "proformas");
  const docs = canQuotes
    ? await db.proforma.findMany({
      where: and(proformaVisibility(user), { customerId }) as never,
      orderBy: { issueDate: "desc" },
      take: 100,
      select: {
        id: true, proformaNumber: true, status: true, isCancelled: true, proformaType: true,
        issueDateJalali: true, sentDateJalali: true, expiryDateJalali: true, followUpState: true,
        lossReason: true, finalAmount: true, currency: true,
        competitor: { select: { name: true } },
        project: { select: { code: true } },
        items: { select: { status: true, lossReason: true, productName: true } },
      },
    })
    : [];
  if (!canQuotes) withheld.push("proformas");

  const openIds = docs.map((d) => d.id);
  const chases = openIds.length
    ? await db.task.findMany({
      where: {
        taskKind: FOLLOW_UP_KIND, relatedToType: "proforma", relatedToId: { in: openIds },
        status: { notIn: [TASK_DONE, TASK_CANCELLED] },
      },
      select: { relatedToId: true, dueDateJalali: true, assignedToName: true },
    })
    : [];
  const chaseByDoc = new Map(chases.map((c) => [c.relatedToId, c]));

  const quotes = docs
    .filter((d) => d.proformaType !== "TECHNICAL")
    .map((d) => {
      const outcome = getProformaOutcome(d);
      const settled = isTerminalOutcome(outcome);
      const lineReasons = d.items.map((i) => i.lossReason).filter(Boolean) as string[];
      return {
        id: d.id,
        number: d.proformaNumber,
        outcome,
        settled,
        ageDays: daysFrom(d.sentDateJalali ?? d.issueDateJalali, today),
        daysToExpiry: d.expiryDateJalali ? getShamsiDaysDifference(today, d.expiryDateJalali) : null,
        hasNextAction: chaseByDoc.has(d.id),
        nextAction: chaseByDoc.get(d.id) ?? null,
        followUpState: d.followUpState,
        lossReason: d.lossReason ?? lineReasons[0] ?? null,
        competitor: d.competitor?.name ?? null,
        projectCode: d.project?.code ?? null,
        amount: Number(d.finalAmount),
        currency: d.currency,
      };
    });

  const asked = askedNeverBought(
    docs.filter((d) => d.proformaType !== "TECHNICAL").flatMap((d) => {
      const settledDocument = isTerminalOutcome(getProformaOutcome(d));
      return d.items.map((i) => ({ name: i.productName, status: i.status, settledDocument }));
    }),
    ITEM_WON,
  );

  const canProjects = hasPermission(user, "projects");
  const projects = canProjects
    ? await db.project.findMany({
      where: and(projectVisibility(user), { customerId, status: { in: OPEN_SALES_STATUSES } }) as never,
      take: 50,
      select: { id: true, code: true, name: true, stage: true, status: true, updatedAt: true },
    })
    : [];
  if (!canProjects) withheld.push("projects");
  const lastActivity = await lastActivityByProject(projects.map((p) => p.id));

  const canService = hasPermission(user, "packagingDelivery");
  const services = canService
    ? await db.afterSalesService.findMany({
      where: { project: and({ customerId }, projectVisibility(user)) } as never,
      take: 50,
      select: { itemName: true, status: true, project: { select: { code: true } } },
    })
    : [];
  if (!canService) withheld.push("afterSales");
  const openServices = services.filter((s) => afterSalesIsOpen(s.status));

  const openProjects = projects.map((p) => ({
    id: p.id, code: p.code, name: p.name, stage: p.stage ?? p.status,
    quietDays: daysFrom(dateToJalali(maxDate(p.updatedAt, lastActivity.get(p.id))), today),
  }));

  const hints = customerOpportunityHints({
    customerName: customer.companyName,
    rank: metrics?.customerValueRank ?? null,
    daysSinceLastPurchase: metrics?.daysSinceLastPurchase ?? null,
    everPurchased: !!metrics?.lastPurchaseDateJalali,
    quotes,
    askedNeverBought: asked,
    openAfterSales: openServices.map((s) => ({ label: s.itemName, status: s.status, projectCode: s.project?.code ?? null })),
    openProjects,
  }, t);

  return {
    measured: `پرونده‌ی مشتری «${customer.companyName}» تا امروز ${today}: آخرین ${docs.length} پیش‌فاکتور،`
      + ` پروژه‌های باز فروش، پرونده‌های خدمات پس از فروش و شاخص ارزش مشتری.`
      + ` پیشنهادها (hints) قواعد ثابتی روی همین داده‌اند و باید با کاربر بررسی شوند.`,
    customer,
    value: metrics,
    openQuotes: quotes.filter((q) => !q.settled),
    recentSettled: quotes.filter((q) => q.settled).slice(0, 15),
    askedNeverBought: asked.slice(0, 10),
    openProjects,
    openAfterSales: openServices,
    hints,
    withheld,
  };
}
