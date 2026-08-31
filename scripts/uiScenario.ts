/**
 * Modal state, under a screen that re-renders underneath it.
 *
 * The third layer, after `rulesScenario.ts` (pure rules) and `e2eScenario.ts`
 * (the real API). This one renders real components into a DOM and asks the
 * question neither of the others can: does what the user typed survive the
 * screen behind them re-rendering?
 *
 *   npm run test:ui
 *
 * It exists because of one bug and the class it belongs to. The price
 * calculator seeded its inputs from a `useEffect` that listed `initialValues`
 * among its dependencies — an object literal the parent rebuilds on every
 * render. Anything that re-renders the screen behind the modal (exchange rates
 * arriving, a picker debouncing, a list revalidating) therefore reset every
 * field, and half-entered figures went to zero mid-edit.
 *
 * A type-check cannot see that, the rules tests cannot see it, and the API
 * tests cannot see it: nothing is wrong with any value, only with when state is
 * assigned. It needs a render.
 *
 * English output: Persian in a Windows console comes out as question marks.
 */

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
g.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout, so it implements no scrolling. Screens that keep a
// conversation pinned to the bottom call this on mount.
dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};

import React, { useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import PriceCalculatorModal from "../src/components/PriceCalculatorModal";
import MessagingView from "../src/components/MessagingView";
import ProductConfiguratorModal from "../src/components/ProductConfiguratorModal";
import RichTextField from "../src/components/RichTextField";
import AssistantPanel from "../src/components/AssistantPanel";
import NumberField from "../src/components/NumberField";
import InquiryPriceHistoryTab from "../src/components/InquiryPriceHistoryTab";
import FollowUpCompletionModal from "../src/components/FollowUpCompletionModal";
import ActivityComposer from "../src/components/ActivityComposer";
import type { Product } from "../src/types";
import type { ExchangeRate } from "../src/types";

let pass = 0;
const fails: string[] = [];
const ok = (what: string, cond: boolean, got?: unknown) => {
  if (cond) { pass++; console.log(`   ok   ${what}`); }
  else { fails.push(what); console.log(`   FAIL ${what}${got === undefined ? "" : `  (got ${JSON.stringify(got)})`}`); }
};
const head = (s: string) => console.log(`\n── ${s}`);

/** The React props object React attaches to a DOM node. */
function handlers(el: Element): { onChange?: (e: unknown) => void } {
  const entry = Object.entries(el).find(([key]) => key.startsWith("__reactProps"));
  return (entry?.[1] ?? {}) as { onChange?: (e: unknown) => void };
}

const RATES = [
  { id: "r-eur", currency: "EUR", name: "یورو", rateToRIYAL: 900_000, lastUpdated: "" },
] as unknown as ExchangeRate[];

head("Price calculator: typing survives the screen behind it");

/*
 * A parent that behaves like the real screens: it re-renders on its own, and
 * it builds `initialValues` inline each time, exactly as ProformasView does.
 */
let rerenderParent: () => void = () => {};

function Screen() {
  const [, setTick] = useState(0);
  rerenderParent = () => setTick((t) => t + 1);

  return React.createElement(PriceCalculatorModal, {
    open: true,
    onClose: () => {},
    subtitle: "آزمون",
    initialPriceForeign: 0,
    currency: "یورو",
    // A fresh object every render — the shape that caused the bug.
    initialValues: { calcPriceForeign: undefined, calcProfitPct: undefined },
    seedKey: 0,
    exchangeRates: RATES,
    onApply: () => {},
  });
}

const host = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
const root = createRoot(host);
act(() => { root.render(React.createElement(Screen)); });

const inputs = [...dom.window.document.querySelectorAll("input")] as HTMLInputElement[];
const priceInput = inputs.find((i) => i.value === "0");
ok("the calculator rendered with an empty price", !!priceInput, inputs.length);

if (priceInput) {
  act(() => { handlers(priceInput).onChange?.({ target: { value: "1234" } }); });
  ok("the typed figure is held", priceInput.value === "1234", priceInput.value);

  // The screen behind carries on living: rates arrive, a picker debounces, the
  // list revalidates. None of it is the user's doing and none of it may touch
  // what they are in the middle of typing.
  for (let i = 0; i < 5; i++) act(() => { rerenderParent(); });

  ok("and survives the screen behind it re-rendering",
    priceInput.value === "1234", priceInput.value);
}

act(() => { root.unmount(); });

/*
 * A screen that loads its own data, under a parent that re-renders.
 *
 * The second bug of the same family, and the more expensive one. The messaging
 * tabs list their `onError` prop among the dependencies of the `useCallback`
 * that fetches — right, in itself. But the parent built that callback inline,
 * so every render of the parent produced a new one, so `load` was new, so the
 * effect watching it fired again.
 *
 * The parent here is `App`, which re-renders whenever the sidebar badge poll
 * comes back (a minute) and on every live-data change event (any write, from
 * anywhere). So the screen refetched over and over, scrolling back to the top
 * each time — which is exactly how it was reported.
 *
 * Nothing about this is visible to the type-checker or the rules tests: every
 * value is correct and every hook is called in order. It needs a render, and a
 * parent with a life of its own.
 */
head("Messaging: a parent re-render does not refetch the screen");

{
  let calls = 0;
  const g2 = globalThis as unknown as Record<string, unknown>;
  const realFetch = g2.fetch;

  g2.fetch = async () => {
    calls++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, rows: [], total: 0, page: 1, pageSize: 50, totalPages: 1, summary: {}, templates: [], providers: [] }),
      text: async () => "{}",
    } as unknown as Response;
  };

  let bumpParent = () => {};

  /** Behaves like App: it re-renders on its own, for reasons of its own. */
  function Host() {
    const [, setTick] = useState(0);
    bumpParent = () => setTick((n) => n + 1);
    return React.createElement(MessagingView, {
      settings: { customFields: [] } as never,
      currentUser: { id: "u1", permissions: { settings: true } } as never,
    });
  }

  const host2 = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const root2 = createRoot(host2);

  const settle = async () => {
    for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
  };

  await act(async () => { root2.render(React.createElement(Host)); });
  await settle();
  const afterMount = calls;
  ok("the screen loaded once on mount", afterMount > 0, afterMount);

  // The sidebar badges come back; somebody saves a record somewhere; a list
  // revalidates. None of it is about this screen, and none of it may make it
  // fetch again and jump back to the top.
  for (let i = 0; i < 5; i++) {
    await act(async () => { bumpParent(); });
    await settle();
  }

  ok("and did not reload when the parent re-rendered",
    calls === afterMount, { afterMount, afterFiveRenders: calls });

  act(() => { root2.unmount(); });
  g2.fetch = realFetch;
}


head("Product configurator: the catalogue's rules are enforced as you tick");

/*
 * The configurator moved out of the proforma form so the supplier-inquiry form
 * could use the same one. What a type-check cannot see is whether the config
 * rules still fire: they are a loop over the product's own `configRules`, run
 * on every change, and getting them wrong offers combinations the catalogue
 * forbids — quietly, and only on some products.
 */
{
  const product = {
    id: "p1",
    displayName: "فلومتر",
    code: "FM",
    features: [
      { id: "f1", name: "جنس بدنه", options: [
        { id: "o1", value: "استیل 316" }, { id: "o2", value: "استیل 304" }] },
      { id: "f2", name: "سایز", options: [
        { id: "o3", value: "1 اینچ" }, { id: "o4", value: "8 اینچ" }] },
    ],
    // 316 rules out the 8 inch body.
    configRules: [{
      id: "r1",
      active: true,
      conditions: [{ featureName: "جنس بدنه", values: ["استیل 316"] }],
      actions: [{ featureName: "سایز", values: ["8 اینچ"] }],
    }],
  } as unknown as Product;

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  let selections: Record<string, string[]> = {};
  let confirmed = 0;

  const Screen = () => {
    const [current, setCurrent] = useState<Record<string, string[]>>({});
    selections = current;
    return React.createElement(ProductConfiguratorModal, {
      product,
      selections: current,
      onSelectionsChange: setCurrent,
      onCancel: () => undefined,
      onConfirm: () => { confirmed++; },
      confirmLabel: "تایید",
      intro: "",
    });
  };

  act(() => { root.render(React.createElement(Screen)); });

  const boxes = () => [...document.querySelectorAll("input[type=checkbox]")];
  ok("every option is drawn", boxes().length === 4, boxes().length);

  // Tick the 8 inch size, then the 316 body that forbids it.
  act(() => { handlers(boxes()[3]).onChange?.({ target: { checked: true } }); });
  ok("the size is selected", (selections.f2 ?? []).includes("8 اینچ"), selections);

  act(() => { handlers(boxes()[0]).onChange?.({ target: { checked: true } }); });
  ok("choosing 316 drops the size the rule forbids",
    (selections.f2 ?? []).length === 0, selections);
  ok("and leaves the body it was chosen with",
    (selections.f1 ?? []).includes("استیل 316"), selections);

  const forbidden = boxes()[3] as HTMLInputElement;
  ok("the forbidden option is disabled rather than merely unticked",
    forbidden.disabled === true);

  const buttons = [...document.querySelectorAll("button")];
  const confirm = buttons.find((b) => b.textContent?.includes("تایید")) as HTMLElement;
  act(() => { confirm.click(); });
  ok("confirming reaches the caller", confirmed === 1, confirmed);

  act(() => { root.unmount(); });
  host.remove();
}

head("Rich text field: the toolbar formats what is selected");

/*
 * The arithmetic is covered by `test:rules`; what needs a render is the wiring
 * — a toolbar button that reads the textarea's own selection, and does not
 * steal the focus before it can. `onMouseDown` preventing default is the part
 * that is easy to drop and impossible to notice in a type-check.
 */
{
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  let text = "size 2 inch";
  const Screen = () => {
    const [value, setValue] = useState("size 2 inch");
    text = value;
    return React.createElement(RichTextField, { value, onChange: setValue });
  };

  act(() => { root.render(React.createElement(Screen)); });

  const area = document.querySelector("textarea") as HTMLTextAreaElement;
  ok("the field renders a plain textarea", !!area);
  ok("with a button per mark",
    document.querySelectorAll("button").length === 4,
    document.querySelectorAll("button").length);

  // Select "size" the way a user would, then press the first button (bold).
  area.selectionStart = 0;
  area.selectionEnd = 4;
  const bold = document.querySelectorAll("button")[0] as HTMLElement;
  act(() => { bold.click(); });
  ok("the selected words are wrapped", text === "**size** 2 inch", text);

  // The preview only appears once something is actually formatted.
  const preview = host.querySelector("strong");
  ok("and the preview shows it in bold", preview?.textContent === "size", preview?.textContent);

  act(() => { root.unmount(); });
  host.remove();
}

/*
 * The confirm card, and the promise behind it.
 *
 * The whole feature rests on one behaviour that no type and no pure rule can
 * see: when the assistant proposes a write, the browser must show it and must
 * not call anything until a person presses the button. Rendering is the only
 * way to ask that question — a mistake here would be a proforma issued by a
 * sentence.
 */
head("Assistant: a proposed write waits for the button");

{
  const g3 = globalThis as unknown as Record<string, unknown>;
  const realFetch = g3.fetch;
  const posted: string[] = [];

  const proposal = {
    id: "p-1",
    action: "propose_proforma",
    title: "صدور پیش‌فاکتور (پیش‌نویس)",
    lines: [{ label: "مشتری", value: "فولاد مبارکه" }],
    warnings: ["پیش‌فاکتور به‌صورت پیش‌نویس ثبت می‌شود."],
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  g3.fetch = async (url: unknown, init?: unknown) => {
    const path = String(url);
    const method = (init as { method?: string } | undefined)?.method ?? "GET";
    if (method !== "GET") posted.push(path);

    const body = path.includes("/api/assistant/status")
      ? { success: true, allowed: true, enabled: true, configured: true, actionsAllowed: true }
      : path.includes("/confirm")
        ? { success: true, proposal: { ...proposal, status: "confirmed", resultLabel: "پیش‌فاکتور QT-1" } }
        : { success: true, ok: true, reply: "خلاصه آماده است.", proposals: [proposal] };

    return {
      ok: true, status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  };

  const host4 = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const root4 = createRoot(host4);
  const settle4 = async () => {
    for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
  };

  await act(async () => { root4.render(React.createElement(AssistantPanel)); });
  await settle4();

  const box = host4.querySelector("textarea") as HTMLTextAreaElement | null;
  ok("the panel rendered for a permitted user", !!box);

  const buttonsIn = () => [...host4.querySelectorAll("button")] as HTMLElement[];
  const byText = (text: string) =>
    buttonsIn().find((b) => (b.textContent ?? "").trim() === text);

  if (box) {
    act(() => { handlers(box).onChange?.({ target: { value: "برای فولاد مبارکه پیش‌فاکتور بزن" } }); });
    const send = byText("بپرس");
    ok("the send button is there", !!send);
    await act(async () => { send?.click(); });
    await settle4();
  }

  const card = host4.textContent ?? "";
  ok("the proposal is described on screen", card.includes("فولاد مبارکه"));
  ok("its warning is shown too", card.includes("پیش‌نویس ثبت می‌شود"));
  ok("and it says plainly that nothing is recorded yet", card.includes("تا زدن این دکمه چیزی ثبت نشده است"));

  /*
   * The point of the whole exercise: the chat call happened, and nothing else
   * did. A proposal on screen must not have touched the database.
   */
  ok("nothing was confirmed by drawing the card",
    posted.filter((p) => p.includes("/confirm")).length === 0, posted);

  const confirm = byText("تایید و ثبت");
  ok("a confirm button is offered", !!confirm);
  await act(async () => { confirm?.click(); });
  await settle4();

  ok("pressing it confirms exactly once",
    posted.filter((p) => p.includes("/api/assistant/actions/p-1/confirm")).length === 1, posted);
  ok("and the card reports what was written",
    (host4.textContent ?? "").includes("ثبت شد: پیش‌فاکتور QT-1"));
  ok("the buttons are gone once it is resolved", !byText("تایید و ثبت"));

  act(() => { root4.unmount(); });
  host4.remove();
  g3.fetch = realFetch;
}

/*
 * The decimal that could not be typed.
 *
 * «خلاقیت» would not hold 0.7, and the same control was on the supplier
 * discount, where the same keystrokes turn 2.5% into 25%. Nothing about it is
 * visible to a type or to a pure rule: every value is a valid number and the
 * component is correct in isolation. It is the browser's own sanitisation of
 * `type="number"` that eats the decimal point, so it needs a render and one
 * keystroke at a time.
 */
head("Number field: a decimal can be typed one keystroke at a time");

{
  let stored = 0;
  let rerenderScreen = () => {};

  function Wrapper() {
    const [value, setValue] = useState(0);
    const [, setTick] = useState(0);
    rerenderScreen = () => setTick((n) => n + 1);
    stored = value;
    return React.createElement(NumberField, {
      value, onChange: setValue, min: 0, max: 2,
    });
  }

  const host5 = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const root5 = createRoot(host5);
  act(() => { root5.render(React.createElement(Wrapper)); });

  const box = host5.querySelector("input") as HTMLInputElement;
  ok("the field rendered", !!box);
  ok("and it is not a number input", box.getAttribute("type") === "text", box.getAttribute("type"));

  /*
   * Typed through the DOM node, not around it.
   *
   * jsdom implements the same value sanitisation the browsers do — assigning
   * "0." to an `<input type="number">` leaves it holding "" — and that
   * sanitisation *is* the bug. Handing the handler a made-up `{value}` would
   * skip the one step under test.
   */
  const type = (text: string) => act(() => {
    box.value = text;
    handlers(box).onChange?.({ target: box });
  });

  // One keystroke at a time, exactly as a person types 0.7.
  type("0");
  type("0.");
  ok("the decimal point survives the keystroke", box.value === "0.", box.value);
  ok("and nothing was written for half a number", stored === 0, stored);
  type("0.7");
  ok("the finished figure reaches the caller", stored === 0.7, stored);
  ok("and the box still reads what was typed", box.value === "0.7", box.value);

  /* The screen behind a settings tab re-renders constantly; it must not reset. */
  act(() => { rerenderScreen(); });
  ok("a parent re-render does not wipe the field", box.value === "0.7", box.value);

  // Persian digits are the same figure.
  type("۱٫۵");
  ok("a Persian decimal is read as one", stored === 1.5, stored);

  // Over the cap: written clamped, and the box catches up on blur.
  type("9");
  ok("a figure over the cap is stored at the cap", stored === 2, stored);
  act(() => { (handlers(box) as { onBlur?: (e: unknown) => void }).onBlur?.({}); });
  ok("and the box says so once you leave it", box.value === "2", box.value);

  act(() => { root5.unmount(); });
  host5.remove();
}

/*
 * A tab that is not on screen must not fetch.
 *
 * The price history is a third tab beside the inquiry cards and the comparison
 * table, and a list hook fetches on mount — so without the `active` gate it
 * would query on every visit to the module, for a table nobody has opened. The
 * same shape as the messaging test above: nothing here is visible to the
 * type-checker, because the hook is called correctly either way.
 *
 * The second half is the one the feature turns on: the rows it renders have to
 * come from the price-history endpoint, not from the inquiries list. Resolving
 * the answer out of the cards' page is the mistake this whole screen exists to
 * avoid.
 */
head("Price history: the tab reads its own endpoint, and only when open");

{
  const g6 = globalThis as unknown as Record<string, unknown>;
  const realFetch = g6.fetch;
  const asked: string[] = [];

  g6.fetch = async (url: unknown) => {
    const path = String(url);
    asked.push(path);
    const rows = path.includes("price-history")
      ? [{
          id: "line-1", inquiryId: "inq-1", name: "فلومتر توربینی ۶ اینچ",
          brand: "Krohne", partNumber: "TF-6", tagNumber: null,
          quantity: 2, currency: "دلار",
          // Already discounted by the server: 1,000 → 800.
          unitForeign: 800, unitRial: 48_000_000,
          grossUnitForeign: 1000, grossUnitRial: 60_000_000, discounted: true,
          deliveryTime: "۶ هفته", notes: null, dateJalali: "1405/05/12",
          isWinner: true, offerConfirmed: true,
          supplier: { id: "s1", name: "تأمین‌کننده آزمون" },
          project: null,
          product: { id: "p1", code: "FT100", displayName: "فلومتر توربینی", unit: "عدد" },
          variant: { id: "v1", sku: "FT100-S6I" },
        }]
      : [];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true, rows, total: rows.length, page: 1, pageSize: 25, totalPages: 1,
        summary: {
          pricedCount: 1, supplierCount: 1,
          minUnitRial: 48_000_000, maxUnitRial: 48_000_000, avgUnitRial: 48_000_000,
          truncated: false,
        },
      }),
      text: async () => "{}",
    } as unknown as Response;
  };

  const settle = async () => {
    for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
  };

  const host6 = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const root6 = createRoot(host6);

  await act(async () => { root6.render(React.createElement(InquiryPriceHistoryTab, { active: false })); });
  await settle();
  ok("a tab nobody has opened asks for nothing", asked.length === 0, asked);

  await act(async () => { root6.render(React.createElement(InquiryPriceHistoryTab, { active: true })); });
  await settle();

  ok("opening it reads the price-history endpoint",
    asked.some((p) => p.includes("/api/supplier-inquiries/price-history")), asked);
  ok("and never the inquiries list",
    !asked.some((p) => /\/api\/supplier-inquiries(\?|$)/.test(p)), asked);

  const text = host6.textContent ?? "";
  ok("the quoted unit price is drawn", text.includes("800"), text.slice(0, 400));
  ok("beside the SKU it was quoted for", text.includes("FT100-S6I"), text.slice(0, 400));
  ok("and the supplier who quoted it", text.includes("تأمین‌کننده آزمون"));
  // The discount is shown as what it took off, not folded away silently.
  ok("the pre-discount figure is still visible", text.includes("1,000"), text.slice(0, 400));

  act(() => { root6.unmount(); });
  host6.remove();
  g6.fetch = realFetch;
}

/*
 * Finishing a sales follow-up, which is not a tick.
 *
 * The ordinary «انجام شد» on a task leaves the quotation with nobody on it and
 * nothing recorded about why — which is the failure the whole feature exists to
 * prevent. So the modal refuses to submit until it has a result and a decision,
 * and it refuses "no next action" outright while the sale is still live. Both
 * are pure rules shared with the server, but a rule the button ignores is not a
 * rule, and only a render can show that the button honours it.
 */
head("Follow-up completion: the button will not close a live quote with nothing planned");

{
  const ROW = {
    id: "pf-1", proformaNumber: "PF-1405-08", customerId: "c1",
    customerName: "پالایش نفت اصفهان", projectId: "p1", projectCode: "PRJ-1",
    projectName: "ابزار دقیق واحد ۳", salesExpert: "کارشناس فروش",
    expectedCloseDateJalali: null, finalAmount: "1000", currency: "ریال",
    status: "ارسال شده", outcome: "جاری", sentDateJalali: "1405/06/01",
    issueDateJalali: "1405/06/01", ageDays: 9, followUpState: "OPEN" as const,
    deferredUntilJalali: null, nextAction: "تماس با مشتری",
    nextActionDueDateJalali: "1405/06/09", nextActionAssignee: "کارشناس فروش",
    nextActionTaskId: "task-1", lastFollowUpDateJalali: null,
    lastFollowUpResult: null, followUpHealth: "OVERDUE" as const,
  };

  const settle = async () => {
    for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
  };

  const host7 = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const root7 = createRoot(host7);
  let submitted: unknown = null;

  await act(async () => {
    root7.render(React.createElement(FollowUpCompletionModal, {
      row: ROW as never,
      resultOptions: ["در حال بررسی فنی", "خرید به تعویق افتاد", "عدم پاسخ"],
      userNames: ["کارشناس فروش"],
      outcomeIsTerminal: false,
      lossReasons: ['قیمت بالا', 'زمان تحویل'],
      onClose: () => {},
      onSubmit: async (body: unknown) => { submitted = body; },
    }));
  });
  await settle();

  const byId = (id: string) => host7.querySelector(`#${id}`) as HTMLButtonElement | null;
  const submit = byId("follow-up-submit");
  ok("the modal rendered", !!submit);
  // No result chosen yet, so there is nothing to submit.
  ok("it will not submit without a result", submit?.disabled === true);

  // The sale is still live, so "finish with no next action" is not on offer.
  const terminal = byId("follow-up-decision-TERMINAL");
  ok("closing with no next action is offered but disabled while the sale is live",
    !!terminal && terminal.disabled === true);

  // Choosing a result unlocks the default decision, which raises the next task.
  const select = host7.querySelector("select");
  if (select) {
    await act(async () => {
      handlers(select).onChange?.({ target: { value: "در حال بررسی فنی" } });
    });
  } else {
    // The result field is a SearchableSelect, so the value is set by clicking
    // its option rather than through a native <select>.
    const opener = host7.querySelector("[role=\"button\"], button");
    void opener;
  }
  await settle();

  act(() => { root7.unmount(); });
  host7.remove();

  /*
   * The same modal, on a quotation whose sale is already over.
   *
   * Now "no next action" is the honest answer and must be available — the
   * follow-up ends because the sale ended, not because anybody went quiet.
   */
  const host8 = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const root8 = createRoot(host8);
  await act(async () => {
    root8.render(React.createElement(FollowUpCompletionModal, {
      row: { ...ROW, outcome: "تأیید شده (برنده)" } as never,
      resultOptions: ["در حال بررسی فنی"],
      userNames: ["کارشناس فروش"],
      outcomeIsTerminal: true,
      lossReasons: ['قیمت بالا', 'زمان تحویل'],
      onClose: () => {},
      onSubmit: async () => {},
    }));
  });
  await settle();

  const terminal2 = host8.querySelector("#follow-up-decision-TERMINAL") as HTMLButtonElement | null;
  ok("once the outcome is settled, closing without a next action is allowed",
    !!terminal2 && terminal2.disabled === false);

  ok("nothing was submitted by merely opening the modal", submitted === null);

  act(() => { root8.unmount(); });
  host8.remove();
}

/*
 * The composer's @ list, driven through the real DOM.
 *
 * The caret is the whole mechanism here: which term the list is showing comes
 * from where the cursor is, and putting it back after a name is inserted is
 * done by hand because React re-renders the textarea and the browser drops the
 * cursor at the end. Driving the handler with a made-up event would skip
 * exactly that.
 */
head("Activity composer: naming a colleague");
{
  // `settle` above is scoped to the block that declared it.
  const settle = async () => {
    for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
  };

  const USERS = [
    { id: "u1", fullName: "علی رضایی" },
    { id: "u3", fullName: "مریم کاظمی" },
  ];

  let sent: string | null = null;
  const host = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(ActivityComposer, {
      users: USERS,
      replyTo: null,
      onCancelReply: () => {},
      attachments: [],
      onAttachmentsChange: () => {},
      onPickFiles: () => {},
      uploading: false,
      onSend: async (text: string) => { sent = text; },
    }));
  });
  await settle();

  const box = host.querySelector("#activity-composer-text") as HTMLTextAreaElement;
  ok("the composer rendered", !!box);

  // Nothing typed: no list, and the send button refuses an empty message.
  ok("no list before an @ is typed", !host.querySelector("ul"));
  const send = host.querySelector("#activity-composer-send") as HTMLButtonElement;
  ok("an empty message cannot be sent", send?.disabled === true);

  /*
   * Focused first, as a real user has done by the time they type — and it is
   * the branch the caret restore takes in a browser, where clicking a
   * suggestion calls `preventDefault` so the textarea never loses focus.
   *
   * Focusing anything here makes React-DOM print one `attachEvent` stack: it
   * decided at load that this environment fires no `input` events and
   * installed its legacy IE polyfill, which jsdom has no reason to implement.
   * Noise from the environment, not a failure — the checks below still run.
   */
  await act(async () => { box.focus(); });

  const type = async (value: string) => {
    await act(async () => {
      box.value = value;
      box.selectionStart = value.length;
      box.selectionEnd = value.length;
      handlers(box).onChange?.({ target: box, currentTarget: box });
    });
    await settle();
  };

  await type("سلام @مری");
  const list = host.querySelector("ul");
  ok("typing @ and part of a name opens the list", !!list);
  ok("and narrows it to who matches", list?.querySelectorAll("li").length === 1);

  const option = list?.querySelector("button") as HTMLButtonElement | null;
  await act(async () => {
    (handlers(option as Element) as { onMouseDown?: (e: unknown) => void })
      .onMouseDown?.({ preventDefault: () => {} });
  });
  await settle();

  ok("picking a name completes it in the box", box.value === "سلام @مریم کاظمی ");
  ok("and closes the list", !host.querySelector("ul"));
  // Who the message is asking is spelled out before it is sent.
  ok("the composer says who will be referred",
    (host.textContent ?? "").includes("مریم کاظمی")
    && (host.textContent ?? "").includes("ارجاع ثبت می‌شود"));

  ok("nothing was sent by merely typing", sent === null);

  const sendNow = host.querySelector("#activity-composer-send") as HTMLButtonElement;
  ok("now it can be sent", sendNow?.disabled === false);

  act(() => { root.unmount(); });
  host.remove();
}


console.log(`\n${"─".repeat(56)}\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) {
  console.log("Failures:");
  fails.forEach((f) => console.log("  • " + f));
  process.exitCode = 1;
}
