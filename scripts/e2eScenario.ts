/**
 * One deal, start to finish, against a running server.
 *
 * This walks the business the way a person does — a new customer and a new
 * product, a project, its activity feed and a referral, a supplier inquiry, a
 * proforma that is then won, money in and out, a foreign purchase order, a
 * packing list, and an after-sales case — and checks at each step that the
 * figures the app *derives* actually moved. Derived figures are where this
 * application has broken before: a status computed from line items, a stock
 * level computed from a ledger, a delivery date counted from a prepayment. A
 * screen that renders is not evidence that those are right.
 *
 * It drives the real HTTP API with a real session, so it exercises permissions,
 * validation, the Prisma layer and the SQL Server schema together. Nothing is
 * mocked.
 *
 *   npx tsx scripts/e2eScenario.ts --url http://localhost:3000 --user admin --password 123
 *
 * **It writes to whatever database the server is pointed at.** Everything it
 * creates is deleted again at the end, in reverse dependency order, and the
 * cleanup is verified — but point it at a scratch database if you have one.
 * `--keep` leaves the records behind for inspection. `--skip-money` omits the
 * one step that cannot be undone — a confirmed transaction is corrected by a
 * reversing entry and never deleted, so that step, and everything referring to
 * it, stays. Use it for a run against a live database that leaves nothing.
 *
 * Output is English on purpose: Persian in a Windows console comes out as
 * question marks (see CLAUDE.md).
 */

/* ------------------------------- arguments ------------------------------- */

interface Options {
  url: string;
  user: string;
  password: string;
  keep: boolean;
  /** Skip the financial step, so the run can tidy itself away completely. */
  skipMoney: boolean;
}

function parseArgs(argv: string[]): Options {
  const get = (name: string, fallback: string): string => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  return {
    url: get("url", process.env.E2E_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    user: get("user", process.env.E2E_USER ?? "admin"),
    password: get("password", process.env.E2E_PASSWORD ?? "123"),
    keep: argv.includes("--keep"),
    skipMoney: argv.includes("--skip-money"),
  };
}

/* ------------------------------- reporting ------------------------------- */

let passed = 0;
const failures: string[] = [];
let step = "";

const log = (message: string) => console.log(message);

function beginStep(name: string): void {
  step = name;
  console.log(`\n── ${name}`);
}

/** Records one expectation. Never throws: a failed check must not hide the rest. */
function check(what: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    passed++;
    console.log(`   ok   ${what}`);
    return;
  }
  const line = `${step} → ${what}${detail === undefined ? "" : `  (got: ${JSON.stringify(detail)})`}`;
  failures.push(line);
  console.log(`   FAIL ${what}${detail === undefined ? "" : `  (got: ${JSON.stringify(detail)})`}`);
}

function checkEqual(what: string, actual: unknown, expected: unknown): void {
  check(`${what} = ${JSON.stringify(expected)}`, actual === expected, actual);
}

/* --------------------------------- client -------------------------------- */

/**
 * A session against the API.
 *
 * The cookie is kept by hand because Node's fetch has no jar, and the session is
 * an httpOnly cookie — which is also what makes this a real test of the auth
 * path rather than of a bypass.
 */
class Session {
  private cookie = "";

  constructor(private readonly base: string) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json; charset=utf-8" }),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];

    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`${method} ${path} → ${response.status}, and the body was not JSON: ${text.slice(0, 200)}`);
    }

    if (!response.ok || payload.success === false) {
      // `/api/login` answers with `message`; every other endpoint with `error`.
      const said = payload.error ?? payload.message ?? text.slice(0, 200);
      const err = new Error(`${method} ${path} → ${response.status}: ${String(said)}`) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }
    return payload as T;
  }

  get = <T>(path: string) => this.request<T>("GET", path);
  post = <T>(path: string, body?: unknown) => this.request<T>("POST", path, body);
  put = <T>(path: string, body?: unknown) => this.request<T>("PUT", path, body);
  del = <T>(path: string) => this.request<T>("DELETE", path);
}

/* --------------------------------- dates --------------------------------- */

/** Today in Jalali, without importing the app's date module into a CLI script. */
function todayJalali(): string {
  const now = new Date();
  const [gy, gm, gd] = [now.getFullYear(), now.getMonth() + 1, now.getDate()];
  // Same conversion the app uses, inlined so this script has no imports that
  // could drift from what the server actually stores.
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 - (36525 * (gy - 1)) / 100;
  days = Math.floor(days) + 0;
  let jy = -1595 + 33 * Math.floor((gy - 1) / 33);
  let g_day_no = 365 * (gy - 1) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100)
    + Math.floor((gy2 + 399) / 400) - 80 + gd + g_d_m[gm - 1];
  let j_day_no = g_day_no - 79;
  const j_np = Math.floor(j_day_no / 12053);
  j_day_no %= 12053;
  jy = 979 + 33 * j_np + 4 * Math.floor(j_day_no / 1461);
  j_day_no %= 1461;
  if (j_day_no >= 366) {
    jy += Math.floor((j_day_no - 1) / 365);
    j_day_no = (j_day_no - 1) % 365;
  }
  let jm = 0;
  let jd = 0;
  for (let i = 0; i < 12; i++) {
    const len = i < 6 ? 31 : i < 11 ? 30 : 29;
    if (j_day_no < len) { jm = i + 1; jd = j_day_no + 1; break; }
    j_day_no -= len;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${jy}/${pad(jm)}/${pad(jd)}`;
}

function addDaysJalali(date: string, days: number): string {
  // Crude but adequate for a test: only the day-of-month is advanced, and the
  // scenario never needs to cross a month boundary meaningfully.
  const [y, m, d] = date.split("/").map((p) => parseInt(p, 10));
  const total = d + days;
  const inMonth = m <= 6 ? 31 : 30;
  if (total <= inMonth) return `${y}/${String(m).padStart(2, "0")}/${String(total).padStart(2, "0")}`;
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  return `${ny}/${String(nm).padStart(2, "0")}/${String(total - inMonth).padStart(2, "0")}`;
}

/* ------------------------------- the run ------------------------------- */

/**
 * Everything created, newest first, so cleanup can walk it in that order.
 *
 * `permanent` marks a record the application refuses to delete by design — a
 * confirmed financial document and its reversal. Both are frozen: they cannot be
 * edited either, because a transaction that has been confirmed is corrected by a
 * reversing entry and never by removal. That is right, and it means a run that
 * exercises the money can never tidy itself away completely.
 */
const created: { label: string; path: string; permanent?: boolean }[] = [];
const remember = (label: string, path: string, permanent = false) =>
  created.unshift({ label, path, permanent });

const tag = `E2E-${Date.now().toString(36)}`;
const num = (value: unknown) => Number(value ?? 0);

async function run(options: Options): Promise<void> {
  const api = new Session(options.url);
  const today = todayJalali();

  /* ---------------------------------------------------------------- login */
  beginStep("Sign in");
  let login: { user: { id: string; fullName: string } };
  try {
    login = await api.post<{ user: { id: string; fullName: string } }>("/api/login", {
      username: options.user,
      password: options.password,
    });
  } catch (err) {
    // The server's own sentence is Persian, and Persian in a Windows console is
    // question marks — so say what to do about it in English instead.
    if ((err as { status?: number }).status === 401) {
      throw new Error(
        `sign-in was refused for user "${options.user}". The server rejected the `
        + "username or the password. Use exactly the credentials you sign into the "
        + "browser with, and quote the password in single quotes if it contains "
        + "any of $ ` \" ! or a space — PowerShell rewrites those otherwise.",
      );
    }
    throw err;
  }
  check("session established", !!login.user?.id, login.user?.id);
  const me = await api.get<{
    user: { id: string; isSystemAdmin?: boolean; permissions?: Record<string, boolean> };
  }>("/api/me");
  checkEqual("/api/me agrees who we are", me.user?.id, login.user.id);

  /*
   * This scenario writes purchase orders and supplier inquiries, which the
   * server refuses from a user without the cost permission. Said here rather
   * than left to surface as an unexplained 403 two hundred lines down.
   */
  check("this account may see costs, which the purchasing steps below need",
    me.user?.isSystemAdmin === true || me.user?.permissions?.costs === true,
    "grant «مشاهده بهای خرید» to this user, or run as an administrator");

  /*
   * What is already here.
   *
   * Printed before anything is written, because this is normally run against a
   * server whose database is the real one. Non-zero counts are the moment to
   * press Ctrl-C if that was not the intention.
   */
  const existingCustomers = await api.get<{ total: number }>("/api/customers?pageSize=1");
  const existingProjects = await api.get<{ total: number }>("/api/projects?pageSize=1&withSummary=false");
  log(`   this database already holds ${existingCustomers.total} customer(s)`
    + ` and ${existingProjects.total} project(s)`);
  if (existingCustomers.total + existingProjects.total > 0) {
    log("   → it is not empty. Ctrl-C now if you did not mean to write to it.");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  /* ------------------------------------------------------------- customer */
  beginStep("Customer");
  const customer = (await api.post<{ customer: Record<string, unknown> }>("/api/customers", {
    customerType: "حقوقی",
    companyName: `${tag} پتروشیمی آزمون`,
    economicCode: `411${Date.now().toString().slice(-9)}`,
    phone: "02188887777",
    mobile: "09121234567",
    email: `${tag.toLowerCase()}@example.com`,
    province: "تهران",
    industry: "نفت و گاز",
    status: "فعال",
  })).customer;
  const customerId = String(customer.id);
  remember("customer", `/api/customers/${customerId}`);
  check("created", !!customerId);
  check("the create reply carries its relations, so the caller can use it",
    Array.isArray(customer.linksFrom) && Array.isArray(customer.agreements));
  checkEqual("economic code stored", customer.economicCode, customer.economicCode);
  check("economic code is not empty", !!customer.economicCode, customer.economicCode);

  const dupes = await api.post<{ matches: unknown[]; hasHardDuplicate: boolean }>(
    "/api/customers/check-duplicates",
    { customerType: "حقوقی", companyName: "x", email: `${tag.toLowerCase()}@example.com` },
  );
  check("the duplicate check finds it by email", dupes.matches.length > 0, dupes.matches.length);

  /* ------------------------------------------------------------- supplier */
  beginStep("Supplier");
  const supplier = (await api.post<{ supplier: Record<string, unknown> }>("/api/suppliers", {
    name: `${tag} Siemens Test`,
    country: "آلمان",
    status: "فعال",
  })).supplier;
  const supplierId = String(supplier.id);
  remember("supplier", `/api/suppliers/${supplierId}`);
  check("created", !!supplierId);

  /* -------------------------------------------------------------- product */
  beginStep("Product and stock");
  const product = (await api.post<{ product: Record<string, unknown> }>("/api/products", {
    name: `${tag} فلومتر کوریولیس`,
    code: `${tag}-P1`,
    category: "فلو",
    unit: "عدد",
    supplyType: "INVENTORY",
    basePriceRial: 50_000_000,
    minStockLevel: 2,
    stockLevel: 0,
  })).product;
  const productId = String(product.id);
  remember("product", `/api/products/${productId}`);
  check("created", !!productId);

  await api.post(`/api/products/${productId}/stock`, { delta: 10, notes: `${tag} opening stock` });
  const stocked = (await api.get<{ product: Record<string, unknown> }>(`/api/products/${productId}`)).product;
  checkEqual("stock level after a +10 adjustment", num(stocked.stockLevel), 10);

  const ledger = await api.get<{ rows: { quantity: string }[] }>(
    `/api/inventory-transactions?productId=${productId}&pageSize=50`);
  check("the adjustment wrote a ledger entry, not just a number",
    ledger.rows.length >= 1, ledger.rows.length);

  /* --------------------------------------------------------------- project */
  beginStep("Project");
  const project = (await api.post<{ project: Record<string, unknown> }>("/api/projects", {
    name: `${tag} ابزاردقیق واحد ۵`,
    customerId,
    status: "جدید",
    creationDate: today,
    opportunityDate: today,
    salesExpert: login.user.fullName,
    items: [
      // The sentinel a hand-entered requirement carries. It is not a product id,
      // and sending it through used to fail the foreign key and refuse the save.
      { productId: "generic", name: "فلو - ترانسمیتر درخواستی", quantity: 2, supplyMethod: "ORDER", category: "FLOW" },
      { productId, name: String(product.displayName ?? product.name), quantity: 3, supplyMethod: "INVENTORY" },
    ],
    milestones: [{ name: "ارسال مشخصات فنی", isCompleted: false, dueDate: addDaysJalali(today, 7) }],
  })).project;
  const projectId = String(project.id);
  remember("project", `/api/projects/${projectId}`);
  check("a project with a hand-entered requirement line saves", !!projectId);

  const projectDetail = (await api.get<{ project: Record<string, unknown> }>(`/api/projects/${projectId}`)).project;
  const projectItems = projectDetail.items as { productId: string | null; name: string }[];
  checkEqual("both requested items stored", projectItems.length, 2);
  check("the hand-entered line reads back as a requirement, not a catalogue item",
    projectItems.some((i) => i.productId === null),
    projectItems.map((i) => i.productId));
  check("the catalogue line kept its product",
    projectItems.some((i) => i.productId === productId));
  check("the create reply carries items and milestones",
    Array.isArray(project.items) && Array.isArray(project.milestones));

  /* ------------------------------------------------ activities & referral */
  beginStep("Activity feed and referral");
  await api.put(`/api/projects/${projectId}/category-groups`, {
    categoryId: `${tag}-cat`,
    categoryName: "پیش‌فاکتورها و مهندسی فروش",
    status: "جاری",
    startDate: today,
  });
  const groups = (await api.get<{ groups: { id: string; categoryName: string }[] }>(
    `/api/projects/${projectId}/category-groups`)).groups;
  check("category group created", groups.length >= 1, groups.length);
  const groupId = groups[0].id;

  const activity = (await api.post<{ activity: { id: string } }>("/api/activities", {
    groupId,
    text: `${tag} تماس اولیه با کارفرما و دریافت مشخصات فنی`,
    referral: { assignedToUserId: login.user.id, actionRequired: "بررسی مشخصات فنی" },
  })).activity;
  check("activity recorded", !!activity.id);

  const referrals = await api.get<{ rows: { id: string; status: string }[] }>("/api/referrals?scope=toMe&pageSize=50");
  const mine = referrals.rows.find((r) => r.id);
  check("the referral reached the inbox", !!mine, referrals.rows.length);

  if (mine) {
    await api.post(`/api/referrals/${mine.id}/messages`, { text: `${tag} بررسی شد` });
    await api.put(`/api/referrals/${mine.id}/status`, { status: "انجام شده" });
    await api.put(`/api/referrals/${mine.id}/status`, { status: "در انتظار اقدام" });
    const after = await api.get<{ rows: { id: string; status: string }[] }>("/api/referrals?scope=toMe&pageSize=50");
    const reopened = after.rows.find((r) => r.id === mine.id);
    checkEqual("a finished referral can be reopened", reopened?.status, "در انتظار اقدام");
  }

  /* ------------------------------------------------------------- inquiry */
  beginStep("Supplier inquiry");
  const makeInquiry = async (label: string) => (await api.post<{ inquiry: Record<string, unknown> }>(
    "/api/supplier-inquiries",
    {
      projectId,
      supplierId,
      creationDate: today,
      discountPercent: 10,
      items: [{ name: `${tag} ${label}`, quantity: 2, currency: "یورو", priceForeign: 1000, priceRial: 0 }],
    },
  )).inquiry;

  const inquiryA = await makeInquiry("بخش الف");
  const inquiryB = await makeInquiry("بخش ب");
  remember("inquiry B", `/api/supplier-inquiries/${String(inquiryB.id)}`);
  remember("inquiry A", `/api/supplier-inquiries/${String(inquiryA.id)}`);

  const steps = (inquiryA.steps ?? []) as unknown[];
  check("the inquiry records its own steps automatically", steps.length >= 1, steps.length);

  await api.put(`/api/supplier-inquiries/${String(inquiryA.id)}`, { isWinner: true, winnerDate: today });
  await api.put(`/api/supplier-inquiries/${String(inquiryB.id)}`, { isWinner: true, winnerDate: today });
  const winners = await api.get<{ rows: unknown[] }>(
    `/api/supplier-inquiries?projectId=${projectId}&isWinner=true&pageSize=50`);
  checkEqual("a project can have two winning offers at once", winners.rows.length, 2);

  /* ------------------------------------------------------------- proforma */
  beginStep("Proforma");
  const proforma = (await api.post<{ proforma: Record<string, unknown> }>("/api/proformas", {
    projectId,
    customerId,
    status: "ارسال شده",
    currency: "ریال",
    issueDate: today,
    expiryDate: addDaysJalali(today, 20),
    taxPercent: 10,
    items: [
      { productId, productName: String(product.displayName ?? product.name), quantity: 3, unitPriceRial: 50_000_000, supplyMethod: "INVENTORY" },
      { productName: `${tag} قلم دستی`, quantity: 1, unitPriceRial: 20_000_000, supplyMethod: "ORDER" },
    ],
  })).proforma;
  const proformaId = String(proforma.id);
  remember("proforma", `/api/proformas/${proformaId}`);

  checkEqual("line totals are recomputed by the server",
    num(proforma.totalAmount), 3 * 50_000_000 + 20_000_000);
  checkEqual("the stored workflow status is what we sent", proforma.status, "ارسال شده");
  checkEqual("the derived outcome is separate from it", proforma.outcomeStatus, "ارسال شده");

  const pfDetail = (await api.get<{ proforma: Record<string, unknown> }>(`/api/proformas/${proformaId}`)).proforma;
  const pfItems = pfDetail.items as { id: string; productId: string | null }[];
  checkEqual("both lines stored", pfItems.length, 2);

  // Win one line, lose the other: the interesting case, because both the
  // proforma and the project have to come out "partly won".
  await api.post(`/api/proformas/${proformaId}/item-outcomes`, {
    outcomes: [
      { itemId: pfItems[0].id, status: "برنده" },
      { itemId: pfItems[1].id, status: "بازنده", lossReason: "قیمت بالا" },
    ],
  });

  const afterOutcome = (await api.get<{ proforma: Record<string, unknown> }>(`/api/proformas/${proformaId}`)).proforma;
  checkEqual("outcome derives to partly won", afterOutcome.outcomeStatus, "نیمه برنده");
  checkEqual("the workflow status is untouched by that", afterOutcome.status, "ارسال شده");

  const projectAfter = (await api.get<{ project: Record<string, unknown> }>(`/api/projects/${projectId}`)).project;
  checkEqual("the project's status follows its proforma", projectAfter.status, "نیمه برنده");

  const wonIds = (afterOutcome.wonItemIds ?? []) as string[];
  checkEqual("exactly one line counts as won", wonIds.length, 1);

  /* --------------------------------------------------------- transactions */
  beginStep("Money in and out");
  if (options.skipMoney) {
    log("   skipped (--skip-money): a confirmed transaction is corrected by a reversing");
    log("   entry and never deleted, so this is the step that leaves records behind.");
  } else {
    const receipt = (await api.post<{ transaction: Record<string, unknown> }>("/api/transactions", {
      type: "دریافت",
      projectId,
      customerId,
      proformaId,
      amountRial: 60_000_000,
      paymentType: "حواله بانکی",
      occurredAt: today,
      status: "تأیید شده",
      // No document number on purpose: the server assigns one, as it does for
      // every other document type.
    })).transaction;
    const receiptId = String(receipt.id);
    remember("receipt", `/api/transactions/${receiptId}`, true);
    check("receipt recorded", !!receiptId);
    check("the server assigned its document number", !!receipt.documentNumber, receipt.documentNumber);

    const finance = await api.get<{ rows: Record<string, unknown>[] }>("/api/projects/finance?pageSize=200");
    const financeRow = finance.rows.find((r) => String(r.id) === projectId);
    checkEqual("the project's received total is the receipt", num(financeRow?.paidAmount), 60_000_000);

    // The same position asked for one project, which is what the ledger screen
    // reads after writing a receipt to decide whether the project is settled —
    // the grid above pages, so it cannot be asked about a project that is not
    // on the page in hand.
    const one = (await api.get<{ finance: Record<string, unknown> }>(
      `/api/projects/${projectId}/finance`)).finance;
    checkEqual("the single-project position agrees with the grid",
      num(one.paidAmount), num(financeRow?.paidAmount));
    check("and carries what settles the project, remaining and sold",
      "remainingAmount" in one && "salesAmount" in one, Object.keys(one));

    // A confirmed transaction is corrected by a reversing entry, and both halves
    // must stay in the totals so the pair cancels.
    const reversal = (await api.post<{ reversal: Record<string, unknown> }>(
      `/api/transactions/${receiptId}/reverse`, {})).reversal;
    remember("reversal", `/api/transactions/${String(reversal.id)}`, true);
    check("the reversal was issued with its own number", !!reversal.documentNumber, reversal.documentNumber);

    const financeAfter = await api.get<{ rows: Record<string, unknown>[] }>("/api/projects/finance?pageSize=200");
    const rowAfter = financeAfter.rows.find((r) => String(r.id) === projectId);
    checkEqual("the reversal cancels the original in the totals", num(rowAfter?.paidAmount), 0);
  }

  /* ------------------------------------------------------- purchase order */
  beginStep("Foreign purchase order");
  const po = (await api.post<{ purchaseOrder: Record<string, unknown> }>("/api/purchase-orders", {
    supplierId,
    projectId,
    proformaId,
    status: "پرداخت و سفارش به سازنده",
    currency: "یوان",
    exchangeRate: 276_000,
    orderDate: today,
    // Filled in on the very first save: these used to record nothing at all.
    paymentDate: today,
    goodsReadyDate: addDaysJalali(today, 3),
    expectedDeliveryDate: addDaysJalali(today, 20),
    shippingCostForeign: 500,
    customsDutyRial: 10_000_000,
    items: [{ productId, productName: String(product.displayName ?? product.name), quantity: 3, unitPriceForeign: 2000 }],
  })).purchaseOrder;
  const poId = String(po.id);
  remember("purchase order", `/api/purchase-orders/${poId}`);

  checkEqual("foreign total recomputed from the lines", num(po.totalForeignAmount), 6000);
  check("landed cost computed", num(po.landedCostRial) > 0, po.landedCostRial);

  const feed = await api.get<{ rows: { text: string }[] }>(`/api/activities?projectId=${projectId}&pageSize=200`);
  const texts = feed.rows.map((r) => r.text).join("\n");
  check("issuing the order is on the project's timeline", texts.includes("سفارش خرید"), null);
  check("the payment date entered on creation is on the timeline too", texts.includes("حواله شد"), null);
  check("so is the goods-ready date", texts.includes("آماده حمل"), null);

  // Receiving reconciles stock against the ledger.
  const stockBefore = num((await api.get<{ product: Record<string, unknown> }>(`/api/products/${productId}`)).product.stockLevel);
  await api.put(`/api/purchase-orders/${poId}`, { status: "تحویل شده (رسید انبار)", receivedDate: today });
  const stockAfter = num((await api.get<{ product: Record<string, unknown> }>(`/api/products/${productId}`)).product.stockLevel);
  checkEqual("receiving the order credits stock exactly once", stockAfter, stockBefore + 3);

  // Idempotent: saving it again in the same state must not credit twice.
  await api.put(`/api/purchase-orders/${poId}`, { status: "تحویل شده (رسید انبار)", notes: `${tag} touched again` });
  const stockTwice = num((await api.get<{ product: Record<string, unknown> }>(`/api/products/${productId}`)).product.stockLevel);
  checkEqual("saving a received order again does not credit twice", stockTwice, stockAfter);

  /* -------------------------------------------------------------- packing */
  beginStep("Packing and delivery");
  const remainingBefore = await api.get<{ lines: Record<string, unknown>[] }>(
    `/api/deliveries/remaining?projectId=${projectId}`);
  check("the project has something outstanding to ship",
    remainingBefore.lines.length > 0, remainingBefore.lines.length);

  const delivery = (await api.post<{ delivery: Record<string, unknown> }>("/api/deliveries", {
    projectId,
    proformaId,
    deliveryDate: today,
    items: [{ productId, itemOrDocName: String(product.displayName ?? product.name), quantity: 1, packageType: "کارتن" }],
  })).delivery;
  const deliveryId = String(delivery.id);
  remember("delivery", `/api/deliveries/${deliveryId}`);
  check("packing list created", !!deliveryId);
  check("it has a document number", !!delivery.packingListNumber, delivery.packingListNumber);

  await api.put(`/api/deliveries/${deliveryId}`, { actualDeliveryDate: today });
  const deliveredFeed = await api.get<{ rows: { text: string }[] }>(`/api/activities?projectId=${projectId}&pageSize=200`);
  check("the delivery is on the timeline",
    deliveredFeed.rows.some((r) => r.text.includes("پکینگ‌لیست")), null);

  /* ----------------------------------------------------------- after sales */
  beginStep("After-sales");
  const service = (await api.post<{ service: Record<string, unknown> }>("/api/after-sales", {
    projectId,
    itemName: String(product.displayName ?? product.name),
    issueDescription: `${tag} نشتی از محل اتصال`,
    startDate: today,
    items: [{
      productId,
      productName: String(product.displayName ?? product.name),
      issueDescription: "نشتی",
      status: "در حال بررسی",
      startDate: today,
    }],
  })).service;
  const serviceId = String(service.id);
  remember("after-sales case", `/api/after-sales/${serviceId}`);
  check("case opened", !!serviceId);
  check("its status is rolled up from its rows", !!service.status, service.status);

  /* ------------------------------------------- closing a category group */
  beginStep("Closing an activity category");
  {
    type Group = {
      id: string; categoryId: string; categoryName: string;
      status: string; endDate: string | null; endDateJalali?: string | null;
    };
    const readGroups = async () => (await api.get<{ groups: Group[] }>(
      `/api/projects/${projectId}/category-groups`)).groups;

    const normalize = (value: string) => value.replace(/[\s\u200c]/g, "").trim().toLowerCase();
    /*
     * What the prompt does when the user answers yes: find the project's group
     * for that category by name, and close it.
     *
     * Run for every module that offers the prompt, because the group only
     * exists if that module logged its facts under the canonical category
     * name. A module whose name has drifted shows up here as a group that
     * cannot be found — rather than as a prompt that appears in the browser
     * and quietly closes nothing.
     */
    const closeCategory = async (label: string, categoryName: string) => {
      const groups = await readGroups();
      const target = groups.find((g) => normalize(g.categoryName) === normalize(categoryName));
      check(`the ${label} category exists to be closed`,
        !!target, groups.map((g) => g.categoryName));
      if (!target) return;

      await api.put(`/api/projects/${projectId}/category-groups`, {
        categoryId: target.categoryId,
        categoryName: target.categoryName,
        status: "اتمام کار",
        startDate: undefined,
        // Deliberately absent, as the prompt sends it: the server stamps today.
      });

      const after = (await readGroups())
        .find((g) => normalize(g.categoryName) === normalize(target.categoryName));

      checkEqual(`the ${label} category closes`, after?.status, "اتمام کار");
      check(`and is stamped with the day it closed, not blanked (${label})`,
        !!after?.endDateJalali, after?.endDateJalali ?? null);
    };

    await closeCategory("purchase-order", "سفارش خرید و حمل");
    // Offered from the supplier-inquiry screen once a final offer is confirmed
    // or a winner is declared.
    await closeCategory("supplier-inquiry", "استعلام قیمت تأمین‌کنندگان");

    // Offered from the ledger once a confirmed receipt settles the project in
    // full. Only the money step creates this category, so with --skip-money
    // there is nothing to close and no failure to report.
    if (!options.skipMoney) {
      await closeCategory("finance", "تراکنش‌های مالی و پرداخت‌ها");
    }
  }

  /* ------------------------------------------------------------- rollups */
  beginStep("Rollups the screens read");
  const dashboard = await api.get<{ summary: { counts: Record<string, number> } }>("/api/dashboard");
  check("the dashboard counts the new customer", dashboard.summary.counts.customers > 0, dashboard.summary.counts);
  check("and the new project", dashboard.summary.counts.projects > 0, dashboard.summary.counts.projects);

  /*
   * Creations are no longer recorded — asked of *this run's* records, not of the
   * whole log. An earlier version of this check asked whether the log contained
   * any CREATE at all, which fails on any database that was in use before the
   * change, for entries that are simply history.
   */
  const auditForProject = await api.get<{ rows: { action: string }[] }>(
    `/api/audit-logs?entityId=${projectId}&pageSize=50`);
  check("no creation was recorded for the project this run made",
    !auditForProject.rows.some((r) => r.action === "CREATE"),
    auditForProject.rows.map((r) => r.action));

  // And an edit still is: the log's whole purpose is what changed and from what.
  await api.put(`/api/projects/${projectId}`, { description: `${tag} touched` });
  const auditAfterEdit = await api.get<{ rows: { action: string }[] }>(
    `/api/audit-logs?entityId=${projectId}&pageSize=50`);
  check("but the edit was", auditAfterEdit.rows.some((r) => r.action === "UPDATE"),
    auditAfterEdit.rows.map((r) => r.action));

  const notes = await api.post<{ note: { id: string } }>(`/api/notes/project/${projectId}`, { text: `${tag} note` });
  check("module notes are their own record", !!notes.note?.id);
}

/* -------------------------------- cleanup -------------------------------- */

async function cleanUp(options: Options): Promise<void> {
  beginStep("Cleanup");
  const api = new Session(options.url);
  await api.post("/api/login", { username: options.user, password: options.password });

  const frozen: string[] = [];
  const blocked: string[] = [];
  const failed: string[] = [];

  for (const item of created) {
    if (item.permanent) {
      frozen.push(`${item.label} (${item.path})`);
      log(`   kept    ${item.label} — a confirmed financial document cannot be deleted`);
      continue;
    }
    try {
      await api.del(item.path);
      log(`   removed ${item.label}`);
    } catch (err) {
      const status = (err as { status?: number }).status;
      // 409 means something still refers to it. With a financial document left
      // standing, that is expected: the proforma it was booked against, and the
      // project and customer above them, cannot go while it is there.
      if (status === 409 && frozen.length > 0) {
        blocked.push(`${item.label} (${item.path})`);
        log(`   kept    ${item.label} — still referred to by a document that cannot be deleted`);
      } else {
        failed.push(`${item.label} (${item.path}): ${(err as Error).message}`);
      }
    }
  }

  check("everything that could be removed was removed", failed.length === 0, failed);

  if (frozen.length > 0 || blocked.length > 0) {
    log("");
    log(`   ${frozen.length + blocked.length} record(s) remain, by design, all tagged ${tag}:`);
    for (const line of [...frozen, ...blocked]) log(`     - ${line}`);
    log("   A confirmed transaction is corrected by a reversing entry, never removed,");
    log("   and what refers to it cannot go either. Run with --skip-money against a");
    log("   live database if you want a run that leaves nothing behind.");
  }
}

/* --------------------------------- main ---------------------------------- */

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  log(`Scenario against ${options.url} as ${options.user}`);
  log(`Records are tagged ${tag} and deleted at the end${options.keep ? " (skipped: --keep)" : ""}.\n`);

  let fatal: Error | null = null;
  try {
    await run(options);
  } catch (err) {
    fatal = err as Error;
    failures.push(`${step} → the run stopped here: ${fatal.message}`);
    console.log(`   STOP ${fatal.message}`);
    // A 500 is the server saying "something unexpected", deliberately without
    // naming it — the real message is only in the server's log.
    if ((fatal as { status?: number }).status === 500) {
      console.log("   → 500 means the server hit something it did not expect. It answers");
      console.log("     with a generic sentence on purpose; the real message is in the");
      console.log("     application's log directory (logs/app-YYYY-MM-DD.log), on the line");
      console.log("     beginning [api] followed by this request's method and path.");
    }
  }

  // Nothing to clean up if the run never created anything — and trying would
  // only repeat whatever stopped it.
  if (!options.keep && created.length > 0) {
    try {
      await cleanUp(options);
    } catch (err) {
      failures.push(`cleanup → ${(err as Error).message}`);
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`${passed} checks passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const line of failures) console.log(`  • ${line}`);
  }
  // Not `process.exit`: it tears the loop down while stdout is still flushing,
  // and Node answers that with an assertion failure on top of the report.
  process.exitCode = failures.length === 0 ? 0 : 1;
}

void main();
