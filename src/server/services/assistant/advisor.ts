import { getDb } from "../../db";
import { AuthUser, canSeeCosts, checkKeyAccess } from "../../auth";
import { loadSettings } from "../../settings";
import { getTodayShamsi } from "../../../dateUtils";
import { landedUnitCostOf } from "../../../utils/costOfGoods";
import { ChatContentPart, ChatMessage, ChatToolDefinition, chat } from "./provider";
import { loadApiKey, loadAssistantConfig } from "./assistantService";
import { ReadableAttachment, readAttachments } from "./attachments";
import { normalizeSuggestion } from "../../../utils/advisorSuggestion";

/**
 * The product adviser behind the proforma form.
 *
 * A customer sends an enquiry — «a turbine flow meter for xylene, 2 inch,
 * Ex-proof» — and somebody has to turn that into lines on a quotation. This
 * reads the enquiry and its files, looks through the catalogue, and proposes
 * items in the shape a proforma line takes.
 *
 * Two decisions hold it up:
 *
 *  - **The catalogue is searched by feature, not by name.** A flow meter is
 *    identified by «clamp-on, DN50~DN700, water», and no keyword match on a
 *    product name finds that. So the search hands the model each candidate's
 *    features and the SKUs already built from them, and the model matches
 *    against the requirement rather than against a title.
 *  - **Ids come from the catalogue, never from the model.** Every suggestion is
 *    resolved against the database before it leaves this file: a product id or
 *    SKU that does not exist is dropped and the suggestion downgraded to
 *    free text, rather than put on a line as a foreign key that references
 *    nothing.
 */

/** One line of the technical specification, as the printed document shows it. */
export interface SuggestedSpec {
  label: string;
  value: string;
}

export interface SuggestedItem {
  /** The heading of the card, and the line's product name. */
  productName: string;
  /** «Medium: xylene» and the rest, in the order they should be printed. */
  specs: SuggestedSpec[];
  /** Free notes printed under the specification, each starting with «*». */
  notes: string[];
  /** Why this answers the enquiry — shown to the user, never printed. */
  reason?: string;

  /** Resolved against the catalogue here; absent when nothing matched. */
  productId?: string;
  variantId?: string;
  sku?: string;
  productCode?: string;
  brand?: string;
  unit?: string;
  imageUrl?: string;
  stockLevel?: number;
  /** Suggested selling price, in rial, when the catalogue knows one. */
  priceRial?: number;
  /** What it costs, per unit, when this user may see costs. */
  unitCost?: number | null;

  /**
   * What the catalogue could supply.
   *
   * `exact` — an existing SKU with these values. `close` — the product exists
   * but not with this configuration. `new` — nothing in the catalogue answers
   * this, so the line would be free text until somebody adds the product.
   */
  match: "exact" | "close" | "new";
}

export interface AdvisorAnswer {
  ok: boolean;
  reply?: string;
  error?: string;
  items?: SuggestedItem[];
  /** What was read out of each attachment, or why nothing was. */
  attachments?: { name: string; read: boolean; problem?: string }[];
}

/* ------------------------------ the catalogue ----------------------------- */

/** Enough of a product for a model to judge whether it answers the enquiry. */
async function searchCatalogue(term: string, limit: number): Promise<unknown> {
  const db = getDb();
  const clean = String(term ?? "").trim();

  const where = clean
    ? {
        OR: [
          { name: { contains: clean } },
          { displayName: { contains: clean } },
          { code: { contains: clean } },
          { category: { contains: clean } },
          { brand: { contains: clean } },
          { description: { contains: clean } },
          // The features are a JSON column, so a value inside it is reachable
          // as text — which is the whole point: «clamp-on» is a feature value,
          // not part of any product's name.
          { features: { contains: clean } },
        ],
      }
    : {};

  const rows = await db.product.findMany({
    where,
    take: Math.min(20, Math.max(1, limit)),
    orderBy: { name: "asc" },
    select: {
      id: true, code: true, name: true, displayName: true, category: true,
      brand: true, unit: true, description: true, features: true,
      stockLevel: true, basePriceRial: true, supplyType: true,
      variants: {
        select: { id: true, sku: true, attributes: true, stockLevel: true },
        take: 40,
      },
    },
  });

  const parse = (raw: string | null): unknown => {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  };

  return rows.map((row) => ({
    productId: row.id,
    code: row.code,
    name: row.displayName || row.name,
    category: row.category,
    brand: row.brand,
    unit: row.unit,
    description: row.description,
    supplyType: row.supplyType,
    stockLevel: Number(row.stockLevel ?? 0),
    // Each feature with every value it may take, so the model can see what is
    // configurable and what is fixed.
    features: parse(row.features),
    variants: row.variants.map((v) => ({
      variantId: v.id,
      sku: v.sku,
      attributes: parse(v.attributes),
      stockLevel: Number(v.stockLevel ?? 0),
    })),
  }));
}

/* ------------------------------- resolution ------------------------------- */

/**
 * A suggestion, checked against the catalogue.
 *
 * The model names a product id and a SKU; neither is taken on trust. What comes
 * back carries the image, the price and the cost read from the record itself,
 * so the card shows what the line will actually contain.
 */
async function resolveSuggestion(
  raw: Record<string, unknown>,
  user: AuthUser,
): Promise<SuggestedItem> {
  const db = getDb();
  const str = (v: unknown) => String(v ?? "").trim();

  // The shape is settled by a pure rule; only what follows needs the database.
  const item: SuggestedItem = { ...normalizeSuggestion(raw) };

  const productId = item.productId ?? "";
  if (!productId) {
    item.match = "new";
    return item;
  }

  const product = await db.product.findUnique({
    where: { id: productId },
    select: {
      id: true, code: true, name: true, displayName: true, brand: true, unit: true,
      images: true, stockLevel: true, basePriceRial: true, priceCalc: true,
      variants: {
        select: { id: true, sku: true, stockLevel: true, priceRial: true, priceCalc: true },
      },
    },
  });

  // A product the model invented is not a link, it is a dangling reference.
  if (!product) {
    item.match = "new";
    return item;
  }

  item.productId = product.id;
  item.productCode = product.code;
  item.brand = product.brand ?? undefined;
  item.unit = product.unit ?? undefined;
  item.stockLevel = Number(product.stockLevel ?? 0);
  item.priceRial = Number(product.basePriceRial ?? 0) || undefined;

  try {
    const images = JSON.parse(product.images ?? "[]") as string[];
    if (Array.isArray(images) && images[0]) item.imageUrl = images[0];
  } catch {
    // A corrupt image list is not worth failing a suggestion over.
  }

  const variantId = str(raw.variantId);
  const variant = variantId
    ? product.variants.find((v) => v.id === variantId)
    : product.variants.find((v) => v.sku === str(raw.sku));

  if (variant) {
    item.variantId = variant.id;
    item.sku = variant.sku;
    item.stockLevel = Number(variant.stockLevel ?? 0);
    if (Number(variant.priceRial ?? 0) > 0) item.priceRial = Number(variant.priceRial);
  } else if (item.match === "exact") {
    // It claimed an existing SKU and there is not one.
    item.match = "close";
  }

  if (canSeeCosts(user)) {
    const parse = (raw2: string | null) => {
      if (!raw2) return null;
      try { return JSON.parse(raw2); } catch { return null; }
    };
    item.unitCost = landedUnitCostOf(
      parse(variant?.priceCalc ?? null),
      parse(product.priceCalc),
    );
  }

  return item;
}

/* --------------------------------- the loop ------------------------------- */

const SUGGEST_TOOL: ChatToolDefinition = {
  name: "suggest_items",
  description:
    "ارائه‌ی فهرست نهایی اقلام پیشنهادی. این تنها راه تحویل پیشنهاد است؛"
    + " پیشنهادها را در متن پاسخ ننویس. برای هر قلم، مشخصات فنی را به صورت"
    + " «برچسب/مقدار» بده، دقیقاً همان‌طور که باید روی پیش‌فاکتور چاپ شود.",
  parameters: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description: "اقلام پیشنهادی، به ترتیب اولویت",
        items: {
          type: "object",
          properties: {
            productName: { type: "string", description: "نام قلم، مثلاً Turbine Flow Meter (Liquids)" },
            specs: {
              type: "array",
              description: "مشخصات فنی، هر کدام یک برچسب و یک مقدار",
              items: {
                type: "object",
                properties: {
                  label: { type: "string", description: "مثلاً Medium یا Size" },
                  value: { type: "string", description: "مثلاً xylene یا 2\"" },
                },
                required: ["label", "value"],
                additionalProperties: false,
              },
            },
            notes: {
              type: "array",
              description: "توضیحات آزاد که زیر مشخصات چاپ می‌شود",
              items: { type: "string" },
            },
            reason: { type: "string", description: "چرا این قلم پاسخ درخواست است" },
            productId: { type: "string", description: "شناسه کالای انبار، فقط اگر از search_catalogue آمده" },
            variantId: { type: "string", description: "شناسه SKU، فقط اگر از search_catalogue آمده" },
            sku: { type: "string" },
            match: {
              type: "string",
              description: "exact: همین SKU موجود است | close: کالا هست ولی با این پیکربندی نه | new: در انبار نیست",
            },
          },
          required: ["productName", "specs", "match"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
};

const SEARCH_TOOL: ChatToolDefinition = {
  name: "search_catalogue",
  description:
    "جستجو در کالاهای انبار. عبارت جستجو در نام، کد، دسته‌بندی، برند، توضیحات"
    + " و **مقادیر ویژگی‌ها** جستجو می‌شود — پس با یک مقدار فنی مثل «Clamp on» یا"
    + " «PTFE» هم می‌توان کالا پیدا کرد. برای هر کالا، ویژگی‌های قابل تنظیم و"
    + " SKUهای ساخته‌شده برگردانده می‌شود. چند بار با عبارت‌های مختلف بگرد.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "عبارت جستجو" },
      limit: { type: "number", description: "حداکثر تعداد نتیجه، تا ۲۰" },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

function systemPrompt(companyName: string, today: string, extra: string): string {
  const lines = [
    `تو کارشناس فنی فروش شرکت «${companyName}» هستی و ابزار دقیق صنعتی می‌فروشی.`,
    `امروز ${today} است.`,
    "",
    "کار تو: درخواست مشتری را بخوان و اقلام مناسب را برای درج در پیش‌فاکتور پیشنهاد بده.",
    "",
    "روش کار:",
    "۱. اول با search_catalogue بگرد. با نام عمومی کالا بگرد، و جداگانه با مقادیر"
    + " فنی کلیدی (جنس، اتصال، رنج، نوع سیگنال). چند جستجوی کوتاه بهتر از یکی است.",
    "۲. اگر کالای مناسب در انبار بود، همان را با شناسه و SKU واقعی‌اش پیشنهاد بده"
    + " و match را exact بگذار. اگر کالا هست ولی با این پیکربندی ساخته نشده،"
    + " شناسه کالا را بده و match را close بگذار.",
    "۳. اگر هیچ کالای مناسبی نبود، match را new بگذار و شناسه‌ای نده.",
    "",
    "قواعد سختگیرانه:",
    "- شناسه کالا و SKU را **هرگز نساز**. فقط آنچه از search_catalogue آمده معتبر است.",
    "- مشخصات فنی را کامل و به شکل «برچسب: مقدار» بده — همان چیزی که باید روی"
    + " پیش‌فاکتور چاپ شود. برچسب‌ها را به انگلیسی بنویس (Medium, Size, Accuracy,"
    + " Connection, Body material, …) چون سند فنی این‌طور چاپ می‌شود.",
    "- هر چیزی که مشخصات فنی نیست ولی باید چاپ شود را در notes بگذار.",
    "- اگر درخواست مشتری مبهم است، به‌جای حدس زدن سوال بپرس.",
    "- پیشنهاد نهایی را فقط با ابزار suggest_items بده، نه در متن.",
  ];
  const houseRules = extra.trim();
  if (houseRules) lines.push("", "دستورالعمل اختصاصی این شرکت:", houseRules);
  return lines.join("\n");
}

export interface AdvisorTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * One question to the adviser.
 *
 * The attachments belong to the newest question, so they are read once and
 * attached to it — an enquiry re-sent with every follow-up would be paid for
 * again on every follow-up.
 */
export async function askAdvisor(
  history: AdvisorTurn[],
  attachmentUrls: string[],
  user: AuthUser,
): Promise<AdvisorAnswer> {
  const denied = checkKeyAccess(user, "erp_products", "read");
  if (denied) return { ok: false, error: denied };

  const config = await loadAssistantConfig();
  const apiKey = await loadApiKey();
  if (!config.enabled) return { ok: false, error: "دستیار هوشمند در تنظیمات فعال نیست." };
  if (!apiKey) return { ok: false, error: "کلید API سرویس هوش مصنوعی ثبت نشده است." };

  const settings = await loadSettings() as { companyInfo?: { name?: string } } | undefined;
  const attachments: ReadableAttachment[] = attachmentUrls.length > 0
    ? await readAttachments(attachmentUrls)
    : [];

  const messages: ChatMessage[] = [{
    role: "system",
    content: systemPrompt(
      settings?.companyInfo?.name ?? "ما",
      getTodayShamsi(),
      config.systemPrompt,
    ),
  }];

  history.forEach((turn, index) => {
    const last = index === history.length - 1;
    if (turn.role === "assistant") {
      messages.push({ role: "assistant", content: turn.content });
      return;
    }

    // The files ride with the newest question and nothing else.
    if (!last || attachments.length === 0) {
      messages.push({ role: "user", content: turn.content });
      return;
    }

    const parts: ChatContentPart[] = [{ type: "text", text: turn.content }];
    for (const file of attachments) {
      if (file.imageDataUrl) {
        parts.push({ type: "text", text: `--- فایل پیوست: ${file.name} ---` });
        parts.push({ type: "image_url", image_url: { url: file.imageDataUrl } });
      } else if (file.text) {
        parts.push({
          type: "text",
          text: `--- فایل پیوست: ${file.name} ---\n${file.text}`,
        });
      } else if (file.problem) {
        parts.push({
          type: "text",
          text: `--- فایل پیوست: ${file.name} — خوانده نشد: ${file.problem} ---`,
        });
      }
    }
    messages.push({ role: "user", content: parts });
  });

  const readReport = attachments.map((file) => ({
    name: file.name,
    read: !!(file.text || file.imageDataUrl),
    problem: file.problem,
  }));

  let items: SuggestedItem[] | undefined;

  for (let round = 0; round < config.maxToolCalls; round++) {
    const result = await chat({
      baseUrl: config.baseUrl,
      apiKey,
      model: config.model,
      messages,
      tools: [SEARCH_TOOL, SUGGEST_TOOL],
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      timeoutSeconds: config.timeoutSeconds,
    });

    if (!result.ok) return { ok: false, error: result.error, attachments: readReport };

    const calls = result.toolCalls ?? [];
    if (calls.length === 0) {
      return {
        ok: true,
        reply: result.content?.trim() || "پاسخی تولید نشد.",
        items,
        attachments: readReport,
      };
    }

    messages.push({
      role: "assistant",
      content: result.content ?? "",
      tool_calls: calls,
    });

    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }

      if (call.name === SEARCH_TOOL.name) {
        const found = await searchCatalogue(
          String(args.query ?? ""),
          Number(args.limit ?? 8),
        );
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(found).slice(0, 24_000),
        });
        continue;
      }

      if (call.name === SUGGEST_TOOL.name) {
        const rawItems = Array.isArray(args.items) ? args.items : [];
        items = [];
        for (const rawItem of rawItems.slice(0, 12)) {
          items.push(await resolveSuggestion(rawItem as Record<string, unknown>, user));
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            status: "ok",
            shown: items.length,
            note: "پیشنهادها به کاربر نشان داده شد. حالا فقط یک جمله‌ی کوتاه"
              + " بنویس و منتظر بمان.",
          }),
        });
        continue;
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify({ error: `ابزار ناشناخته: ${call.name}` }),
      });
    }
  }

  return {
    ok: true,
    reply: "بررسی طولانی شد. اگر پیشنهادها کامل نیست، درخواست را دقیق‌تر بگویید.",
    items,
    attachments: readReport,
  };
}
