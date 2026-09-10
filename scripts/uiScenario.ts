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
import MessageReactions from "../src/components/MessageReactions";
import WorkBoard from "../src/components/WorkBoard";
import FollowUpCompletionModal from "../src/components/FollowUpCompletionModal";
import ActivityComposer from "../src/components/ActivityComposer";
import StuckThresholdsPanel from "../src/components/StuckThresholdsPanel";
import ColumnResizeHandle from "../src/components/ColumnResizeHandle";
import NextActionModal from "../src/components/NextActionModal";
import SaveWithNextActionButton from "../src/components/SaveWithNextActionButton";
import LoginView from "../src/components/LoginView";
import Avatar from "../src/components/Avatar";
import TaskCalendarModal from "../src/components/TaskCalendarModal";
import type { NextActionDraft } from "../src/utils/nextAction";
import { resizeColumns } from "../src/utils/columnWidths";
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


head("Message reactions: the eye asks nobody until it is pressed");
{
  /*
   * The count travels with the feed; the *names* do not. Every reader of every
   * message would be the largest thing in a feed response and nobody is looking
   * at more than one at a time — so the readers are fetched when the eye is
   * pressed, and this is the only layer that can prove it.
   */
  const host7 = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const root7 = createRoot(host7);
  const settle7 = async () => {
    for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
  };

  let readerCalls = 0;
  const toggled: string[] = [];

  const props = {
    activityId: "act-1",
    reactions: [
      { emoji: "👍", userId: "u1", userName: "علی" },
      { emoji: "👍", userId: "u2", userName: "مریم" },
      { emoji: "✅", userId: "u2", userName: "مریم" },
    ],
    readCount: 2,
    currentUserId: "u2",
    onToggle: (emoji: string) => { toggled.push(emoji); },
    loadReaders: async () => {
      readerCalls++;
      return [{ userId: "u1", name: "علی رضایی", readAt: "2026-06-01T10:00:00Z" }];
    },
  };

  await act(async () => { root7.render(React.createElement(MessageReactions, props)); });
  await settle7();

  /*
   * Found by walking the attribute, not by a selector holding the emoji.
   *
   * An emoji is not a CSS identifier, and jsdom's selector engine also answers
   * `null` for an *attribute* selector whose value is outside the BMP — which
   * silently makes every check here pass vacuously. Reading the attribute back
   * has no such trap.
   */
  const byAttr = (host: Element, attr: string, value: string) =>
    ([...host.querySelectorAll(`[${attr}]`)] as HTMLElement[])
      .find((el) => el.getAttribute(attr) === value) ?? null;
  const chipFor = (emoji: string) => byAttr(host7, "data-reaction-chip", emoji);

  ok("a message with reactions draws one chip per emoji",
    !!chipFor("\u{1F44D}") && !!chipFor("\u2705"));
  // Grouped, so two people pressing 👍 is one chip reading 2.
  ok("...counting the people who pressed it",
    (chipFor("\u{1F44D}")?.textContent ?? "").includes("2"),
    chipFor("\u{1F44D}")?.textContent);
  // Read off the eye itself: the 👍 chip also says «2», and a check that took
  // the whole card's text would pass with the count missing entirely.
  ok("the eye shows how many have seen it",
    (host7.querySelector("#reaction-eye-act-1")?.textContent ?? "").includes("2"),
    host7.querySelector("#reaction-eye-act-1")?.textContent);
  ok("and nothing was asked of the server to draw it", readerCalls === 0, readerCalls);

  // Pressing a chip toggles — the server decides add or remove against the
  // unique index, so the client never sends which of the two it meant.
  const chip = chipFor("\u{1F44D}") as HTMLElement;
  await act(async () => { chip.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  ok("pressing a chip reports the emoji", toggled.join(",") === "👍", toggled);

  // The picker is not drawn until asked for: six emoji under every message
  // would be most of the feed.
  ok("the picker is closed to begin with", !host7.querySelector("#reaction-picker-act-1"));
  const opener = host7.querySelector("#reaction-open-act-1") as HTMLElement;
  await act(async () => { opener.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  ok("...and opens on the smiley", !!host7.querySelector("#reaction-picker-act-1"));

  const pick = byAttr(host7, "data-reaction-pick", "\u{1F64F}") as HTMLElement;
  await act(async () => { pick.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  ok("picking one reports it", toggled.join(",") === "👍,🙏", toggled);
  ok("...and closes the picker", !host7.querySelector("#reaction-picker-act-1"));

  /* -- the eye -- */
  const eye = host7.querySelector("#reaction-eye-act-1") as HTMLElement;
  await act(async () => { eye.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  await settle7();
  ok("pressing the eye asks who has read it", readerCalls === 1, readerCalls);
  ok("...and names them", (host7.textContent ?? "").includes("علی رضایی"), host7.textContent);

  await act(async () => { eye.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  ok("pressing it again closes the list", !host7.querySelector("#reaction-readers-act-1"));

  /*
   * Nobody yet is an answer and is said out loud: a blank panel reads as a
   * screen that failed rather than as a message nobody has opened, which is
   * exactly what the eye is for.
   */
  const host8 = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const root8 = createRoot(host8);
  await act(async () => {
    root8.render(React.createElement(MessageReactions, {
      ...props, activityId: "act-2", readCount: 0, reactions: [],
      loadReaders: async () => [],
    }));
  });
  const eye2 = host8.querySelector("#reaction-eye-act-2") as HTMLElement;
  await act(async () => { eye2.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  await settle7();
  ok("an unread message says so rather than drawing a blank panel",
    (host8.textContent ?? "").includes("هنوز کسی این پیام را ندیده است"), host8.textContent);

  act(() => { root7.unmount(); root8.unmount(); });
  host7.remove();
  host8.remove();
}

head("The work board: two kinds of card, three columns");
{
  /*
   * The merge, rendered. A referral is not copied into the tasks table — it
   * stays its own record — so the only thing that can prove the two end up in
   * one board, in the right columns, is a render.
   */
  const host9 = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const root9 = createRoot(host9);

  const moved: string[] = [];
  const opened: string[] = [];
  const selected = new Set<string>();

  const cards = [
    {
      kind: "task" as const, id: "t1", title: "ثبت سفارش خرید", createdAt: "2026-01-01",
      priority: "فوری", status: "برای انجام",
    },
    {
      // A chase whose date has come: its column is the date, not the status.
      kind: "task" as const, id: "t2", title: "تماس با مشتری", createdAt: "2026-02-01",
      priority: "متوسط", status: "در حال انجام", taskKind: "SALES_FOLLOW_UP",
      dueDate: "1405/01/10",
    },
    {
      // The same kind of card, parked: its date has not arrived, so it belongs
      // in «در انتظار مشتری» however its status reads.
      kind: "task" as const, id: "t4", title: "تماس مجدد بعد از نوروز",
      createdAt: "2026-02-20", priority: "بالا", status: "برای انجام",
      taskKind: "SALES_FOLLOW_UP", dueDate: "1405/02/20",
    },
    {
      kind: "task" as const, id: "t3", title: "کار تمام‌شده", createdAt: "2026-03-01",
      priority: "پایین", status: "انجام شده", completedAt: "1405/01/05",
    },
    {
      kind: "referral" as const, id: "r1", title: "لطفاً دیتاشیت را چک کن",
      createdAt: "2026-02-15", status: "در انتظار اقدام", replies: 2,
    },
  ];

  const render = () => act(() => {
    root9.render(React.createElement(WorkBoard, {
      cards,
      sort: "date" as const,
      today: "1405/01/10",
      load: { promoted: 0, active: 2, min: null, max: 4 },
      selected,
      moving: false,
      onToggleSelect: (key: string) => {
        if (selected.has(key)) selected.delete(key); else selected.add(key);
        render();
      },
      onMove: (lane: string) => { moved.push(lane); },
      onOpen: (card: { kind: string; id: string }) => { opened.push(`${card.kind}:${card.id}`); },
    }));
  });
  render();

  const lane = (name: string) => host9.querySelector(`#work-board-lane-${name}`);
  ok("all four columns are drawn",
    !!lane("TODO") && !!lane("WAITING") && !!lane("DOING") && !!lane("DONE"));
  // A referral and a task, in one column, from two tables.
  ok("a queued task and a fresh referral share the first column",
    (lane("TODO")?.textContent ?? "").includes("ثبت سفارش خرید")
    && (lane("TODO")?.textContent ?? "").includes("دیتاشیت"), lane("TODO")?.textContent);
  ok("...and the referral says how many replies it carries",
    (lane("TODO")?.textContent ?? "").includes("2 پاسخ"));
  ok("everything written before the board is in the middle column",
    (lane("DOING")?.textContent ?? "").includes("تماس با مشتری"));
  ok("...and it is marked as a sales follow-up, not an ordinary task",
    (lane("DOING")?.textContent ?? "").includes("پیگیری فروش"));

  /*
   * The reported behaviour, and the whole reason the fourth column exists: a
   * chase agreed for next month is neither «to do» nor «in progress», it is
   * sitting with the customer — and it comes back on its own the day it is
   * due, because nothing was stored saying it was parked.
   */
  ok("a chase whose date has not come is parked, whatever its status says",
    (lane("WAITING")?.textContent ?? "").includes("تماس مجدد بعد از نوروز"),
    lane("WAITING")?.textContent);
  ok("...and the column it left is not holding it too",
    !(lane("TODO")?.textContent ?? "").includes("تماس مجدد بعد از نوروز"));
  ok("...while the one due today sits in «در حال انجام»",
    (lane("DOING")?.textContent ?? "").includes("تماس با مشتری"));
  /*
   * It has no move button: there is nothing for a press to write, since the
   * column is a date somebody agreed with the customer. Explained on the
   * column rather than left as a button that appears to work and does not.
   */
  ok("the parked column offers no destination button",
    !host9.querySelector("#work-board-move-WAITING"));
  ok("...and says why instead",
    (lane("WAITING")?.textContent ?? "").includes("سررسید"));
  // A cap nobody can see reads as the board refusing things at random.
  ok("the middle column shows the limit it is held to",
    (lane("DOING")?.textContent ?? "").includes("از 4"), lane("DOING")?.textContent);
  ok("finished work is in the last column, with the date it closed",
    (lane("DONE")?.textContent ?? "").includes("کار تمام‌شده")
    && (lane("DONE")?.textContent ?? "").includes("1405/01/05"));

  /*
   * Moving is a toolbar press, not a drag: dragging needs a library to work at
   * all and is unusable on the phone this is read on. Nothing may move until
   * something is ticked.
   */
  const moveButton = host9.querySelector("#work-board-move-DOING") as HTMLButtonElement;
  ok("with nothing ticked, nothing can be moved", moveButton.disabled);

  const tick = host9.querySelector("#work-board-select-task:t1") as HTMLElement | null;
  // The id carries a colon, which is not a CSS identifier — found by attribute.
  const box = ([...host9.querySelectorAll("input[type=checkbox]")] as HTMLInputElement[])
    .find((el) => el.id === "work-board-select-task:t1")!;
  ok("the card has a tick box", !!box && !tick);
  act(() => { box.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

  const armed = host9.querySelector("#work-board-move-DOING") as HTMLButtonElement;
  ok("...and ticking one arms every column's button", !armed.disabled);
  act(() => { armed.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  ok("pressing a column moves the selection there", moved.join(",") === "DOING", moved);

  // Pressing the card is what opens the thread, the follow-up form or the edit
  // box — the whole reason the two screens were merged.
  const title = ([...host9.querySelectorAll("button")] as HTMLElement[])
    .find((el) => el.textContent === "لطفاً دیتاشیت را چک کن")!;
  act(() => { title.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  ok("pressing a referral opens it", opened.join(",") === "referral:r1", opened);

  act(() => { root9.unmount(); });
  host9.remove();
}

/*
 * The card summarises, and one press shows the rest — in place.
 *
 * A rule test reads the props; only a render can show that the description is
 * genuinely absent until the button is pressed, that pressing it does not open
 * the record (which is what the title does), and that a card with nothing to
 * add offers no button at all.
 */
head("The work board: a card keeps its description behind one press");
{
  const host10 = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const root10 = createRoot(host10);

  const opened: string[] = [];
  const longMessage = "سلام\nلطفاً دیتاشیت این فلومتر را با پیشنهاد سازنده مقایسه کن "
    + "و اگر اختلاف قیمت بیش از ده درصد بود به من خبر بده تا با مشتری صحبت کنم.";

  const cards = [
    {
      // A chase: its «شرح اقدام بعدی» is the one thing the person picking it up
      // needs, and the board used to print the quotation's name and nothing else.
      kind: "task" as const, id: "t1", title: "پیگیری پیش‌فاکتور ۱۴۰۴-۱۲",
      createdAt: "2026-01-01", priority: "فوری", status: "در حال انجام",
      taskKind: "SALES_FOLLOW_UP", dueDate: "1405/01/10",
      description: "قیمت رقیب را بگیر و ۵٪ تخفیف پیشنهاد کن",
    },
    {
      // Nothing behind the headline: no button, or the reader learns it says
      // nothing and stops pressing it where it says something.
      kind: "task" as const, id: "t2", title: "ثبت سفارش خرید",
      createdAt: "2026-01-02", priority: "متوسط", status: "برای انجام",
    },
    {
      // A referral's headline *is* the message, so the summary is what the
      // column shows and the press restores the writer's own text.
      kind: "referral" as const, id: "r1", title: longMessage,
      createdAt: "2026-01-03", status: "در انتظار اقدام", replies: 0,
    },
  ];

  act(() => {
    root10.render(React.createElement(WorkBoard, {
      cards,
      sort: "date" as const,
      today: "1405/01/10",
      load: null,
      selected: new Set<string>(),
      moving: false,
      onToggleSelect: () => {},
      onMove: () => {},
      onOpen: (card: { kind: string; id: string }) => { opened.push(`${card.kind}:${card.id}`); },
    }));
  });

  const button = (key: string) => ([...host10.querySelectorAll("button")] as HTMLButtonElement[])
    .find((el) => el.id === `work-board-detail-${key}`);
  const text = () => host10.textContent ?? "";

  ok("the description is not on the collapsed card",
    !text().includes("قیمت رقیب را بگیر"), text().slice(0, 120));
  ok("...but the card says there is something to see", !!button("task:t1"));
  ok("a card with nothing behind its title offers no button", !button("task:t2"));

  // The message is folded to one line and cut, so a column of referrals reads
  // as a column rather than as three paragraphs.
  ok("a long message is shown as a summary",
    text().includes("…") && !text().includes("خبر بده تا با مشتری صحبت کنم"));

  act(() => {
    button("task:t1")!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  ok("pressing it reveals the description", text().includes("قیمت رقیب را بگیر و ۵٪ تخفیف پیشنهاد کن"));
  ok("...under the name that column has on a chase", text().includes("شرح اقدام بعدی"));
  // In place: the record's own form is what the *title* opens, and a press
  // here must not be mistaken for that.
  ok("...and opens no record", opened.length === 0, opened);

  act(() => {
    button("referral:r1")!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  ok("a referral discloses its whole message", text().includes("خبر بده تا با مشتری صحبت کنم"));

  act(() => {
    button("task:t1")!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  ok("pressing again folds it back", !text().includes("قیمت رقیب را بگیر"));
  ok("...and leaves the other card open", text().includes("خبر بده تا با مشتری صحبت کنم"));

  act(() => { root10.unmount(); });
  host10.remove();
}

/*
 * «ویرایش» on a follow-up opens the form it was filled in on, carrying what is
 * already recorded.
 *
 * It used to open the ordinary task box — a title, a due date and a status,
 * none of which is what a chase records. Then it opened the completion form
 * with every box blank, which is right for *recording a call* and is not what
 * editing means. There are three shapes here and only a render can show that
 * each one arrives populated: a rule test sees the props, not the boxes.
 */
head("Follow-up editing: the form opens carrying the follow-up");

{
  const ROW = {
    id: "pf-1", proformaNumber: "PF-1405-08", customerId: "c1",
    customerName: "پالایش نفت اصفهان", projectId: "p1", projectCode: "PRJ-1",
    projectName: "ابزار دقیق", salesExpert: "کارشناس فروش",
    expectedCloseDateJalali: null, finalAmount: "1000", currency: "ریال",
    status: "ارسال شده", outcome: "جاری", sentDateJalali: "1405/06/01",
    issueDateJalali: "1405/06/01", ageDays: 9, followUpState: "OPEN" as const,
    deferredUntilJalali: null, nextAction: "تماس با مشتری",
    nextActionDueDateJalali: "1405/06/09", nextActionAssignee: "کارشناس فروش",
    nextActionTaskId: "task-NEXT", lastFollowUpDateJalali: null,
    lastFollowUpResult: null, followUpHealth: "OVERDUE" as const,
  };
  const settle = async () => {
    for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
  };

  const open = async (editing: unknown, rowOverrides: Record<string, unknown> = {}) => {
    const host = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
    const root = createRoot(host);
    await act(async () => {
      root.render(React.createElement(FollowUpCompletionModal, {
        row: { ...ROW, ...rowOverrides } as never,
        resultOptions: ["در حال بررسی فنی", "خرید به تعویق افتاد"],
        userNames: ["کارشناس فروش", "مریم کاظمی"],
        outcomeIsTerminal: false,
        lossReasons: [],
        onClose: () => {},
        onSubmit: async () => {},
        onSaveResult: async () => {},
        onSaveAction: async () => {},
        editing,
      } as never));
    });
    await settle();
    return {
      host,
      close: () => { act(() => { root.unmount(); }); host.remove(); },
      value: (sel: string) => (host.querySelector(sel) as HTMLInputElement | null)?.value,
      text: (sel: string) => (host.querySelector(sel)?.textContent ?? "").trim(),
    };
  };

  /* -- an open chase: its own fields, and nothing about a call that has not
        happened -- */
  {
    const m = await open({
      taskId: "t-open", closed: false, followUpResult: "", completionNote: "",
      title: "قیمت رقیب را بگیر", description: "با واحد فنی هماهنگ کن",
      dueDate: "1405/06/20", assignee: "مریم کاظمی", priority: "بالا",
    });
    ok("an open chase opens as an edit of the action", m.text("h3") === "ویرایش اقدام پیگیری");
    ok("...with its own title", m.value("#follow-up-action-title") === "قیمت رقیب را بگیر",
      m.value("#follow-up-action-title"));
    ok("...and its own description",
      m.value("#follow-up-action-description") === "با واحد فنی هماهنگ کن",
      m.value("#follow-up-action-description"));
    ok("...and the priority it carries",
      m.value("#follow-up-action-priority") === "بالا", m.value("#follow-up-action-priority"));
    /*
      And nothing about a call that has not happened. It briefly showed the
      whole completion form, which is the wrong answer twice over: it is not
      what «ویرایش» means, and picking a result while correcting a date would
      close the follow-up.
    */
    ok("...and no result box", m.value("#follow-up-note") === undefined);
    ok("...and no decision block", m.host.querySelector("#follow-up-decision-TERMINAL") === null);
    /*
      No next action either: the row's open task *is* this one, and offering it
      under a second heading would show the same fields twice.
    */
    ok("...and no next-action block", m.value("#next-action-title") === undefined);
    ok("...and the button is ready", !(m.host.querySelector("#follow-up-submit") as HTMLButtonElement).disabled);
    m.close();
  }

  /* -- a closed chase: the recorded answer, and nothing that may be re-run -- */
  {
    const m = await open({
      taskId: "t-done", closed: true, followUpResult: "در حال بررسی فنی",
      completionNote: "مشتری گفت تا هفته بعد",
      title: "تماس اول", description: "قیمت را اعلام کن",
      dueDate: "1405/06/09", assignee: "کارشناس فروش", priority: "متوسط",
      next: {
        taskId: "t-next", title: "تماس دوم", description: "تخفیف پیشنهاد بده",
        dueDate: "1405/06/20", assignee: "مریم کاظمی", priority: "فوری",
      },
    });
    ok("a closed chase opens as a correction", m.text("h3") === "ویرایش نتیجه پیگیری");
    ok("...carrying the note that was recorded",
      m.value("#follow-up-note") === "مشتری گفت تا هفته بعد", m.value("#follow-up-note"));
    /*
      The whole record, in one form: a person filled the action, the result and
      the next action in through this form and expects to correct them here.
    */
    ok("...and the chase's own words",
      m.value("#follow-up-action-title") === "تماس اول"
      && m.value("#follow-up-action-description") === "قیمت را اعلام کن",
      [m.value("#follow-up-action-title"), m.value("#follow-up-action-description")]);
    ok("...and the next action it raised",
      m.value("#next-action-title") === "تماس دوم"
      && m.value("#next-action-description") === "تخفیف پیشنهاد بده"
      && m.value("#next-action-priority") === "فوری",
      [m.value("#next-action-title"), m.value("#next-action-priority")]);
    // The value is real; the box renders the matching option, so a result the
    // dropdown no longer has would show the placeholder instead.
    ok("...and the result that was chosen",
      m.host.textContent?.includes("در حال بررسی فنی") === true);
    /*
     * The next action is its own task with its own card. Re-offering it here
     * would raise a second one, and re-offering the settlement would re-date a
     * sale the customer-value ranking counts from.
     */
    /*
      The decision, the deferral and the settlement already happened — the task
      is closed, the state moved, the replacement exists and the sale may be
      settled. Answering any again would raise a second next action or re-date
      a sale the ranking counts from.
    */
    /*
      The decision **is** re-asked, and that is the fix: nothing stores it, the
      task cannot be completed twice, and a chase recorded as «موکول به تاریخ
      دیگر» with the wrong date had no correction anywhere in the application.
      This row is a NEXT_ACTION — an open replacement on a quotation that is
      still OPEN — so the buttons open on that.
    */
    ok("...and asks the decision again, seeded from what was recorded",
      !!m.host.querySelector("#follow-up-decision-NEXT_ACTION")
      && (m.host.querySelector("#follow-up-decision-NEXT_ACTION") as HTMLElement)
        .className.includes("border-sky-400"));
    /*
      The settlement is the one question a correction never re-asks: it is what
      would re-date a sale the customer-value ranking counts from.
    */
    ok("...and never the settlement", !m.host.textContent?.includes("وضعیت تجاری پیش‌فاکتور را"));
    m.close();
  }

  /* -- a deferral: the stored date is what opens, and it is one field -- */
  {
    const m = await open({
      taskId: "t-deferred", closed: true, followUpResult: "خرید به تعویق افتاد",
      completionNote: "بعد از نوروز تماس بگیرید",
      title: "تماس اول", description: "", dueDate: "1405/06/09",
      assignee: "کارشناس فروش", priority: "متوسط",
      next: {
        taskId: "t-next", title: "پیگیری مجدد", description: "",
        dueDate: "1405/08/01", assignee: "کارشناس فروش", priority: "متوسط",
      },
    }, { followUpState: "DEFERRED", deferredUntilJalali: "1405/08/01" });
    /*
      The reported case, end to end: «خرید به تعویق افتاد تا فلان تاریخ» with
      the wrong date. The form has to open *on the deferral*, with the stored
      date in the box, or there is nothing to correct.
    */
    ok("a deferred chase opens on the deferral",
      (m.host.querySelector("#follow-up-decision-DEFER") as HTMLElement)
        ?.className.includes("border-sky-400") === true);
    const dates = [...m.host.querySelectorAll("#shamsi-datepicker-input")]
      .map((el) => (el as HTMLInputElement).value);
    ok("...carrying the date that is stored", dates.includes("1405/08/01"), dates);
    /*
      One date, not two. The deferral is stored both on the proforma and as the
      replacement's due date, and two boxes for one day is how those came to
      disagree — so the correcting form draws the chase's own date and the
      deferral, and no third box labelled «تاریخ اقدام بعدی».
    */
    ok("...and draws one date box for it, not two",
      !m.host.textContent?.includes("تاریخ اقدام بعدی"), dates);
    m.close();
  }

  /* -- no editing: the completion form, unchanged -- */
  {
    const m = await open(null);
    ok("completing still opens the completion form", m.text("h3") === "ثبت نتیجه پیگیری");
    ok("...with the decision block", !!m.host.querySelector("#follow-up-decision-TERMINAL"));
    ok("...and nothing to submit until a result is chosen",
      (m.host.querySelector("#follow-up-submit") as HTMLButtonElement).disabled === true);
    m.close();
  }
}

/*
 * A leg is threshold-able on one side only.
 *
 * Seven project stages are the same fact as a purchase-order status, and the
 * form used to offer a box on both sides of each — so a document naming «حمل و
 * ترانزیت» twice reported one container as two stalls. `thresholdFor` refuses
 * the copy whatever is stored, which the rule tests hold; this asks the other
 * half, which only a render can: that the box really is unreachable and the row
 * really is still drawn, saying where the leg is counted instead.
 */
head("Stuck thresholds: a leg is asked about once");

{
  const host = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(StuckThresholdsPanel, {
      // A document that already carries the double entry, which is the shape
      // that was reported.
      settings: {
        stuckThresholds: {
          purchaseOrder: { "حمل و ترانزیت": 45 },
          projectStage: { "حمل و ترانزیت": 20 },
        },
      },
      updateSettings: () => {},
    } as never));
  });
  const box = (section: string, state: string) =>
    host.querySelector(
      `[data-stuck-section="${section}"][data-stuck-state="${state}"]`,
    ) as HTMLInputElement | null;

  ok("the order's own leg can be typed into", box("purchaseOrder", "حمل و ترانزیت")?.disabled === false);
  ok("...and the project's copy of it cannot",
    box("projectStage", "حمل و ترانزیت")?.disabled === true);
  /*
   * Drawn, not hidden: somebody hunting for «ترخیص گمرک» under «پروژه‌ها» has
   * to find the answer where they are looking for it, and a row that is simply
   * absent answers nothing.
   */
  ok("...but the row is still there, naming where it is counted",
    !!box("projectStage", "ترخیص گمرک")
    && host.textContent?.includes("روی «سفارش‌های خرید» شمرده می‌شود") === true);
  // Both ends of the chain go the other way, so this is not «the order wins».
  ok("a draft order is the project's leg, not the order's",
    box("purchaseOrder", "پیش‌نویس")?.disabled === true
    && box("projectStage", "برنده — در انتظار تأمین")?.disabled === false);
  // The inert figure is not shown as if it were in force.
  ok("...and the refused value is not printed as a setting",
    box("projectStage", "حمل و ترانزیت")?.value === "");
  act(() => { root.unmount(); });
  host.remove();
}

/*
 * Dragging a column divider, in a right-to-left table.
 *
 * The pure arithmetic is held by `test:rules`; what only a render can show is
 * the **direction**, which is the whole of the risk here. This application is
 * RTL, so a column's start edge is its right one and the grip is on its left:
 * pulling that grip leftwards has to make the column *wider*. A sign written
 * the wrong way round type-checks, passes every pure rule, and resizes the
 * wrong column the wrong way.
 */
head("Column widths: the grip is on the left and pulling it left widens");

{
  const widths = [102, 250, 141, 102, 179, 115, 154, 166];
  const host = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const root = createRoot(host);
  let seen: number[] | null = null;
  let done = 0;

  await act(async () => {
    root.render(React.createElement(
      "table",
      null,
      React.createElement(
        "thead",
        null,
        React.createElement(
          "tr",
          null,
          React.createElement(
            "th",
            null,
            React.createElement(ColumnResizeHandle, {
              onResize: (widthPx: number) => {
                seen = resizeColumns(widths, 1, widthPx);
              },
              onDone: () => { done += 1; },
            }),
          ),
        ),
      ),
    ));
  });

  const grip = host.querySelector("[data-column-resizer]") as HTMLElement;
  ok("the grip is drawn", !!grip);
  /*
   * jsdom has no layout, so the two rectangles the component measures are
   * stubbed: a 1000px table whose second column runs from x=700 to x=950, i.e.
   * 250px — a quarter, which is what the list says.
   */
  const th = grip.closest("th") as HTMLElement;
  const table = grip.closest("table") as HTMLElement;
  th.getBoundingClientRect = () => ({ right: 950, left: 700, width: 250 }) as never;
  table.getBoundingClientRect = () => ({ right: 1000, left: 0, width: 1000 }) as never;
  grip.setPointerCapture = () => {};
  grip.releasePointerCapture = () => {};

  const send = (type: string, clientX: number, target: EventTarget) => {
    const ev = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clientX", { value: clientX });
    Object.defineProperty(ev, "pointerId", { value: 1 });
    act(() => { target.dispatchEvent(ev); });
  };

  send("pointerdown", 700, grip);
  /*
   * Pulled 50px to the **left** of where this column's left edge was: 250px
   * becomes 300px, a quarter becomes 30% of a 1000px table, and the neighbour
   * — which has 11 to give — comes down to 6.
   */
  send("pointermove", 650, dom.window);
  ok("pulling the grip leftwards widens this column",
    !!seen && (seen as never as number[])[1] > widths[1], seen);
  ok("...by exactly what the pointer says",
    Math.round((seen as never as number[])[1]) === 300, seen);
  ok("...without moving its neighbour",
    Math.round((seen as never as number[])[2]) === widths[2], seen);
  ok("...so widening increases the table width",
    (seen as never as number[]).reduce((a, b) => a + b, 0) > widths.reduce((a, b) => a + b, 0));
  /*
   * Pulled further than the neighbour can afford, it stops against the
   * neighbour's minimum rather than pushing it to nothing — which would leave a
   * column whose own grip could never be grabbed again.
   */
  send("pointermove", 500, dom.window);
  ok("a wide drag follows the pointer",
    Math.round((seen as never as number[])[1]) === 450, seen);
  ok("...and still leaves the neighbour alone",
    Math.round((seen as never as number[])[2]) === widths[2], seen);
  /*
   * And every move is measured from where the drag *started*, never from the
   * value it last wrote — so coming back lands on the figure it began with
   * rather than accumulating whatever the previous move clamped away.
   */
  send("pointermove", 700, dom.window);
  ok("coming back lands where it began",
    JSON.stringify(seen) === JSON.stringify(widths), seen);

  // And the other way: pushed right of where it started, the column narrows.
  send("pointermove", 800, dom.window);
  ok("pushing it rightwards narrows it",
    !!seen && (seen as never as number[])[1] < widths[1], seen);

  send("pointerup", 800, dom.window);
  ok("the drag reports once when it ends", done === 1, done);
  // And stops reporting: a move after the release must not keep resizing.
  const before = JSON.stringify(seen);
  send("pointermove", 500, dom.window);
  ok("...and nothing moves after that", JSON.stringify(seen) === before, seen);

  act(() => { root.unmount(); });
  host.remove();
}

head("Next action: the second save button arms, then submits");

/*
 * The one mechanic here a rules test cannot see.
 *
 * «ذخیره و اقدام بعدی» is a `type="submit"` with an `onClick` that only marks
 * the press. Everything depends on those two happening in that order: if the
 * form's submit handler ran before the click handler, `takeArmed()` would read
 * false on every press and the button would be an ordinary save — silently, in
 * every one of the ten forms. It type-checks either way and no pure rule can
 * tell. It needs a real DOM.
 */
{
  const order: string[] = [];
  let armedAtSubmit: boolean | null = null;
  let armed = false;

  function Form() {
    return React.createElement(
      'form',
      {
        onSubmit: (e: { preventDefault: () => void }) => {
          e.preventDefault();
          order.push('submit');
          // What the host's handler reads at the top of its own submit.
          armedAtSubmit = armed;
          armed = false;
        },
      },
      React.createElement(SaveWithNextActionButton, {
        onArm: () => { order.push('arm'); armed = true; },
      }),
      React.createElement('button', { type: 'submit', 'data-plain': true }, 'ذخیره'),
    );
  }

  const fHost = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const fRoot = createRoot(fHost);
  act(() => { fRoot.render(React.createElement(Form)); });

  const second = fHost.querySelector("[data-save-with-next-action]") as HTMLButtonElement | null;
  const plain = fHost.querySelector("[data-plain]") as HTMLButtonElement | null;
  ok("both save buttons are drawn", !!second && !!plain);

  act(() => { second?.click(); });
  ok("pressing it arms and then submits, in that order",
    order.join(">") === "arm>submit", order.join(">"));
  ok("...so the handler sees the press it was made for", armedAtSubmit === true, armedAtSubmit);

  /*
   * And the plain button is untouched: the great majority of saves are somebody
   * fixing a typo, and being asked for a next action then is the prompt people
   * learn to dismiss.
   */
  order.length = 0;
  act(() => { plain?.click(); });
  ok("the plain save asks nothing", order.join(">") === "submit" && armedAtSubmit === false,
    { order: order.join(">"), armedAtSubmit });

  act(() => { fRoot.unmount(); });
  fHost.remove();
}

head("Next action: the form survives the screen carrying on underneath it");

/*
 * The same family as the price calculator above, and the reason this modal
 * seeds on the record rather than on its `source` prop. All ten screens build
 * that object inline and re-render on their own — the sidebar badge poll comes
 * back every minute, and any write anywhere fires a live-data event.
 */
{
  const source = {
    relatedToType: 'مشتری', relatedToId: 'c-1', relatedToName: 'فولاد مبارکه',
    assignedTo: 'علی رضایی',
  };
  const saved: NextActionDraft[] = [];
  let rerender: () => void = () => {};

  function Host() {
    const [, setTick] = useState(0);
    rerender = () => setTick((t) => t + 1);
    return React.createElement(NextActionModal, {
      // A fresh object every render — the shape that caused the bug.
      source: { ...source },
      kinds: ["تماس تلفنی", "جلسه یا بازدید"],
      people: ["علی رضایی", "مریم احمدی"],
      onSubmit: (draft: NextActionDraft) => { saved.push(draft); },
      onClose: () => {},
    });
  }

  const nHost = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const nRoot = createRoot(nHost);
  act(() => { nRoot.render(React.createElement(Host)); });

  const kind = nHost.querySelector("[data-next-action-kind]") as HTMLSelectElement | null;
  const desc = nHost.querySelector("[data-next-action-description]") as HTMLTextAreaElement | null;
  const who = nHost.querySelector("[data-next-action-assignee]") as HTMLSelectElement | null;
  const save = nHost.querySelector("[data-next-action-save]") as HTMLButtonElement | null;
  ok("the form drew its fields", !!kind && !!desc && !!who && !!save);

  ok("the person who pressed save is carried over", who?.value === "علی رضایی", who?.value);
  ok("...while the kind starts empty", kind?.value === "", kind?.value);
  ok("...and the record is named rather than asked for again",
    nHost.textContent?.includes("فولاد مبارکه") === true);

  // An undated or unkinded next action is exactly the card that goes missing,
  // so the refusal is enforced where the person is standing.
  act(() => { save?.click(); });
  ok("saving with no kind is refused", saved.length === 0, saved.length);
  ok("...and says why", nHost.textContent?.includes("نوع اقدام") === true);

  act(() => { handlers(kind!).onChange?.({ target: { value: "تماس تلفنی" } }); });
  act(() => { handlers(desc!).onChange?.({ target: { value: "قیمت رقیب را بگیر" } }); });

  for (let i = 0; i < 5; i++) act(() => { rerender(); });
  ok("what was typed survives the screen behind it re-rendering",
    kind?.value === "تماس تلفنی" && desc?.value === "قیمت رقیب را بگیر",
    { kind: kind?.value, desc: desc?.value });

  act(() => { save?.click(); });
  ok("...and saves exactly once, carrying it", saved.length === 1, saved.length);
  ok("...with the kind, the description and the inherited assignee",
    saved[0]?.kind === "تماس تلفنی"
    && saved[0]?.description === "قیمت رقیب را بگیر"
    && saved[0]?.assignedTo === "علی رضایی"
    && !!saved[0]?.dueDate,
    saved[0]);

  act(() => { nRoot.unmount(); });
  nHost.remove();
}

/*
 * The login screen's mark.
 *
 * It cannot read `store.settings` — nobody has signed in — so it asks a
 * public endpoint for the one field it needs. Three things a rule test cannot
 * see, because all three are about *when* the value arrives:
 *
 *  - the screen draws before the request resolves, and must draw the fallback
 *    rather than an empty tile or a broken image;
 *  - the logo replaces it once it lands, without the form moving;
 *  - a server that cannot answer leaves the fallback standing, because a
 *    login screen that will not render is worse than one without a logo.
 */
head("Login screen: the company logo, with a mark to fall back to");

async function renderLogin(reply: () => Promise<unknown>) {
  const gl = globalThis as unknown as Record<string, unknown>;
  const realFetch = gl.fetch;
  const asked: string[] = [];
  gl.fetch = async (url: unknown) => {
    asked.push(String(url));
    return reply();
  };

  const lHost = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const lRoot = createRoot(lHost);
  act(() => {
    lRoot.render(React.createElement(LoginView, {
      onLogin: async () => ({ success: false }),
      onLoginSuccess: () => {},
    }));
  });

  const beforeMark = lHost.querySelector("[data-brand-mark]")?.getAttribute("data-brand-mark");

  // Let the fetch and its `.then` settle, then let React commit the state.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  return {
    asked, lHost,
    beforeMark,
    done: () => { act(() => { lRoot.unmount(); }); lHost.remove(); gl.fetch = realFetch; },
  };
}

{
  const okJson = (body: unknown) => Promise.resolve({
    ok: true, status: 200, json: async () => body,
  });

  // 1. A configured logo.
  const withLogo = await renderLogin(() => okJson({ success: true, logoUrl: "/uploads/logo.png" }));
  ok("it asks the public brand endpoint, not the settings document",
    withLogo.asked.some((u) => u.includes("/api/brand"))
    && !withLogo.asked.some((u) => u.includes("/api/settings")),
    withLogo.asked);
  ok("...drawing its own mark until the answer lands",
    withLogo.beforeMark === "fallback", withLogo.beforeMark);
  const img = withLogo.lHost.querySelector("[data-brand-mark=\"logo\"]");
  ok("...then the logo itself", img?.getAttribute("src") === "/uploads/logo.png",
    img?.getAttribute("src"));
  ok("...on a white ground, since a mark drawn for paper can be dark",
    !!withLogo.lHost.querySelector("div.bg-white"));
  ok("...and no clock is left on the screen",
    !withLogo.lHost.querySelector(".animate-spin-slow"));
  withLogo.done();

  // 2. A fresh installation: no logo uploaded yet. This is most databases on
  //    their first day, so it is the state that has to look deliberate.
  const noLogo = await renderLogin(() => okJson({ success: true, logoUrl: null }));
  ok("no logo configured leaves the mark standing",
    !!noLogo.lHost.querySelector("[data-brand-mark=\"fallback\"]")
    && !noLogo.lHost.querySelector("[data-brand-mark=\"logo\"]"));
  noLogo.done();

  // 3. The endpoint is unreachable. Signing in must not depend on it.
  const broken = await renderLogin(() => Promise.reject(new Error("down")));
  ok("an unreachable endpoint leaves the mark standing too",
    !!broken.lHost.querySelector("[data-brand-mark=\"fallback\"]")
    && !broken.lHost.querySelector("[data-brand-mark=\"logo\"]"));
  ok("...and the form is still there to sign in with",
    broken.lHost.querySelectorAll("input").length >= 2,
    broken.lHost.querySelectorAll("input").length);
  broken.done();
}

/*
 * The avatar, at the size the feed draws it.
 *
 * The ask carried a constraint as firm as the feature — a screen already full
 * of messages must not get busier — and a rule test cannot see a rendered box.
 * What it can see: that the disc is exactly the size the table says, that it is
 * one element rather than a wrapper full of them, and that an account with no
 * photograph still gets something that separates it from the next person.
 */
head("Avatar: one element, at the size the table says");

{
  const aHost = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const aRoot = createRoot(aHost);

  // 1. A photograph, at the feed's size.
  act(() => {
    aRoot.render(React.createElement(Avatar, {
      size: "xs", name: "محمد رضایی", url: "/uploads/user-avatars/m.png",
    }));
  });
  const photo = aHost.querySelector('[data-avatar="photo"]') as HTMLElement | null;
  ok("a photograph draws the image", !!photo, aHost.innerHTML.slice(0, 120));
  ok("...at exactly 16px, the size the table names",
    photo?.style.width === "16px" && photo?.style.height === "16px",
    photo?.style.width);
  ok("...and is one element, not a wrapper of them",
    aHost.children.length === 1 && (photo?.children.length ?? 0) === 0);
  ok("...carrying the name for anybody who cannot see it",
    photo?.getAttribute("alt") === "محمد رضایی");

  // 2. No photograph — most accounts, on the day this ships.
  act(() => {
    aRoot.render(React.createElement(Avatar, { size: "xs", name: "محمد رضایی" }));
  });
  const disc = aHost.querySelector('[data-avatar="initials"]') as HTMLElement | null;
  ok("no photograph still draws a disc", !!disc);
  ok("...with one letter at the feed's size, not two",
    disc?.textContent === "م", disc?.textContent);
  ok("...still 16px, so the row cannot move when a photo arrives later",
    disc?.style.width === "16px", disc?.style.width);
  const firstInk = disc?.style.color ?? "";
  ok("...on a colour of its own", !!firstInk);

  // 3. A different colleague must look different — that is the whole feature.
  act(() => {
    aRoot.render(React.createElement(Avatar, { size: "xs", name: "سارا کریمی" }));
  });
  const other = aHost.querySelector('[data-avatar="initials"]') as HTMLElement | null;
  ok("a different person gets a different colour",
    (other?.style.color ?? "") !== firstInk, [firstInk, other?.style.color]);

  // 4. The larger sizes take two letters, and the size really changes.
  act(() => {
    aRoot.render(React.createElement(Avatar, { size: "md", name: "محمد رضایی" }));
  });
  const big = aHost.querySelector('[data-avatar="initials"]') as HTMLElement | null;
  ok("the sidebar's size draws both initials", big?.textContent === "مر", big?.textContent);
  ok("...and is bigger than the feed's", big?.style.width === "40px", big?.style.width);

  // 5. Nobody at all — an activity row whose author was removed.
  act(() => {
    aRoot.render(React.createElement(Avatar, { size: "xs", name: null }));
  });
  const nameless = aHost.querySelector('[data-avatar="initials"]') as HTMLElement | null;
  ok("a nameless author still draws a disc rather than collapsing", !!nameless);
  ok("...with no letter in it, and hidden from a screen reader",
    nameless?.textContent === "" && nameless?.getAttribute("aria-hidden") === "true");

  act(() => { aRoot.unmount(); });
  aHost.remove();
}

/*
 * The calendar's close control, and where it sits.
 *
 * It was inside the *day-details* panel — a `md:hidden` X and a `hidden
 * md:block` button, exact complements, so there was only ever one and at both
 * widths it was at the bottom. jsdom has no media queries and no layout, so
 * neither the breakpoint nor the pixels can be asserted here; what it can see
 * is the thing that actually decides the reading order on a phone, where the
 * panels stack — **document order**. The close button coming before the month
 * grid is what «at the top» means once the two panels are stacked.
 */
head("Calendar: the close control is above the month, not below it");

{
  const gc = globalThis as unknown as Record<string, unknown>;
  const realFetch = gc.fetch;
  gc.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, rows: [], page: 1, pageSize: 50, total: 0, totalPages: 0 }),
  });

  const cHost = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const cRoot = createRoot(cHost);
  await act(async () => {
    cRoot.render(React.createElement(TaskCalendarModal, {
      isOpen: true,
      onClose: () => {},
      currentUser: { id: "u1", fullName: "محمد رضایی" } as never,
    }));
    await Promise.resolve();
  });

  const closers = [...cHost.querySelectorAll("button")]
    .filter((b) => (b.getAttribute("title") ?? "") === "بستن");
  ok("there is exactly one close control, not one per breakpoint",
    closers.length === 1, closers.length);

  const closeBtn = closers[0];
  /*
   * The *deepest* element carrying the weekday, not the first.
   *
   * `querySelectorAll("*").find(textContent includes …)` answers the outermost
   * ancestor — the modal itself — and `compareDocumentPosition` then reports
   * CONTAINS rather than FOLLOWING, so the check failed while the markup was
   * perfectly correct. It was written that way first and this is what it cost.
   */
  const grid = [...cHost.querySelectorAll("*")]
    .filter((el) => (el.textContent ?? "").trim() === "شنبه")
    .pop();
  ok("the month grid rendered", !!grid);

  if (closeBtn && grid) {
    /*
     * DOCUMENT_POSITION_FOLLOWING on the button's comparison means the grid
     * comes after it — which is «the X is above the calendar», the whole ask.
     */
    const rel = closeBtn.compareDocumentPosition(grid);
    ok("...and the close control comes before it in the document",
      (rel & dom.window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0, rel);
  }

  ok("the close control is not hidden at any width",
    !(closeBtn?.className ?? "").includes("md:hidden")
    && !(closeBtn?.className ?? "").includes("hidden"),
    closeBtn?.className);

  act(() => { cRoot.unmount(); });
  cHost.remove();
  gc.fetch = realFetch;
}

console.log(`\n${"─".repeat(56)}\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) {
  console.log("Failures:");
  fails.forEach((f) => console.log("  • " + f));
  process.exitCode = 1;
}
