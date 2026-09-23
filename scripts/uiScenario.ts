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
import { RICH_COLOURS, RICH_MARKS, TABLE_SKELETON } from "../src/utils/richText";
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
import WebRfqPanel from "../src/components/WebRfqPanel";
import Avatar from "../src/components/Avatar";
import TaskCompletionModal from "../src/components/TaskCompletionModal";
import ModuleNotesSection from "../src/components/ModuleNotesSection";
import AfterSalesServicesView from "../src/components/AfterSalesServicesView";
import ReferralsView from "../src/components/ReferralsView";
import ProjectFollowUpTab from "../src/components/ProjectFollowUpTab";
import { LANE_LABELS } from "../src/utils/workBoard";
import { DEFAULT_SETTINGS } from "../src/seedData";
import { RelationPicker } from "../src/components/RelationPicker";
import { ConditionValueField } from "../src/components/ConditionValueField";
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
function handlers(el: Element): {
  onChange?: (e: unknown) => void;
  onPaste?: (e: unknown) => void;
} {
  const entry = Object.entries(el).find(([key]) => key.startsWith("__reactProps"));
  return (entry?.[1] ?? {}) as {
    onChange?: (e: unknown) => void;
    onPaste?: (e: unknown) => void;
  };
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

head("WhatsApp: the link button is unreachable while a code is on the screen");

/*
 * Pressing «اتصال دستگاه» repeatedly is not a harmless retry: each press opens a
 * socket and raises a fresh pairing code, and machine-paced handshakes are part
 * of what gets a number blocked. The control that stops it is
 * `disabled={busy || waiting}` — one word, which type-checks whether it is there
 * or not and reads perfectly either way, so nothing but a render can say whether
 * the button is really dead while a code is up.
 *
 * The second half is the code itself disappearing once the phone has scanned it:
 * a square left on the screen after the link is made is an invitation to scan a
 * code that no longer means anything.
 */
{
  const g3 = globalThis as unknown as Record<string, unknown>;
  const realFetch = g3.fetch;

  /** What the status endpoint is currently answering. */
  let waState = "AWAITING_SCAN";
  let linkCalls = 0;

  g3.fetch = async (url: unknown, init?: { method?: string }) => {
    const path = String(url);
    const body = (() => {
      if (path.includes("/whatsapp/status")) {
        return {
          success: true,
          linked: waState !== "UNLINKED",
          state: waState,
          qr: waState === "AWAITING_SCAN" ? "2@abc" : null,
          qrImage: waState === "AWAITING_SCAN" ? "data:image/png;base64,AAA" : null,
          linkedNumber: waState === "CONNECTED" ? "989121234567" : null,
          lastError: null,
          since: new Date().toISOString(),
        };
      }
      if (path.includes("/whatsapp/link")) {
        linkCalls++;
        return { success: true, state: waState, linked: true, qr: null, qrImage: null, linkedNumber: null, lastError: null, since: new Date().toISOString() };
      }
      if (path.includes("/messaging/providers")) {
        return {
          success: true,
          providers: [
            { channel: "WHATSAPP", active: true, config: {}, secrets: {}, lastTestAt: null, lastTestOk: null, lastTestError: null },
          ],
        };
      }
      return {
        success: true, rows: [], total: 0, page: 1, pageSize: 50, totalPages: 1,
        summary: {}, templates: [], providers: [],
      };
    })();
    void init;
    return {
      ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body),
    } as unknown as Response;
  };

  const host3 = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const root3 = createRoot(host3);
  const settle = async () => {
    for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); });
  };
  const buttonSaying = (text: string) =>
    [...dom.window.document.querySelectorAll("button")]
      .find((b) => (b.textContent ?? "").includes(text)) as HTMLButtonElement | undefined;

  await act(async () => {
    root3.render(React.createElement(MessagingView, {
      settings: { customFields: [] } as never,
      currentUser: { id: "u1", permissions: { settings: true, messaging: true } } as never,
    }));
  });
  await settle();

  // Onto the providers tab, which is where a line is linked.
  const providersTab = buttonSaying("تنظیمات درگاه‌ها");
  ok("the providers tab is offered", !!providersTab);
  await act(async () => { providersTab?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  await settle();

  ok("the WhatsApp card is drawn",
    (host3.textContent ?? "").includes("واتس‌اپ"));
  ok("the pairing code is on the screen",
    !!host3.querySelector('img[alt="کد اتصال واتس‌اپ"]'));

  const linkButton = buttonSaying("اتصال مجدد") ?? buttonSaying("اتصال دستگاه");
  ok("the link button is drawn", !!linkButton);
  ok("...and is dead while the code is waiting to be scanned",
    linkButton?.disabled === true);
  /*
   * Pressing it anyway must reach nothing. A disabled button in jsdom still
   * dispatches a click if one is dispatched at it by hand, so this asserts the
   * request rather than the attribute — which is the thing that matters.
   */
  await act(async () => { linkButton?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  await settle();
  ok("...so pressing it opens no socket", linkCalls === 0, linkCalls);

  // The phone scans it. The code goes, the button comes back.
  waState = "CONNECTED";
  const refreshButton = buttonSaying("بازخوانی وضعیت");
  await act(async () => { refreshButton?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  await settle();

  ok("once connected the code is gone",
    !host3.querySelector('img[alt="کد اتصال واتس‌اپ"]'));
  ok("...the line says which number it is",
    (host3.textContent ?? "").includes("989121234567"));
  ok("...and «قطع اتصال» is offered", !!buttonSaying("قطع اتصال"));
  const reconnect = buttonSaying("اتصال مجدد");
  ok("...with the link button live again", reconnect?.disabled === false);

  /* ---------- the staff notification channel: a control that writes -------- */

  /*
   * Which medium tells a colleague they have been handed work is a `<select>`
   * that the rule tests cannot see the other half of: a chip group that draws
   * perfectly and calls nothing back is the exact «switch that does nothing»
   * this codebase keeps repairing, and it type-checks. So this presses it and
   * asserts what was written.
   *
   * The fallback switch is asserted by its *absence* under SMS. That is not the
   * `stuckStateOwner` case — there a disowned row is still counted next door
   * and hiding it strands the reader — because a fallback from SMS to SMS is
   * not a question anybody can mean.
   */
  const host4 = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const root4 = createRoot(host4);
  let staffSettings: Record<string, unknown> = { customFields: [], messaging: {} };
  let lastSaved: Record<string, unknown> | null = null;

  const renderStaff = async () => {
    await act(async () => {
      root4.render(React.createElement(MessagingView, {
        settings: staffSettings as never,
        currentUser: { id: "u1", permissions: { settings: true, messaging: true } } as never,
        onUpdateSettings: ((next: Record<string, unknown>) => {
          lastSaved = next;
          staffSettings = next;
        }) as never,
      }));
    });
    await settle();
    const tab = [...host4.querySelectorAll("button")]
      .find((b) => (b.textContent ?? "").includes("تنظیمات درگاه‌ها")) as HTMLButtonElement | undefined;
    await act(async () => { tab?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
    await settle();
  };
  const chip = (option: string) =>
    host4.querySelector(`[data-staff-channel="${option}"]`) as HTMLButtonElement | null;

  await renderStaff();
  ok("both channels are offered for a staff notification",
    !!chip("SMS") && !!chip("WHATSAPP"));
  /*
   * And the third, which is the half of «هم برای مشتری هم برای ارجاع همکاران»
   * that lives on this screen. Held here rather than only in the rule checks
   * because `STAFF_CHANNELS` gaining an entry and the chip group drawing it are
   * two different things: the group is a `.map`, so a channel the *type* offers
   * and the screen filters out would type-check perfectly.
   */
  ok("...including Telegram", !!chip("TELEGRAM"));
  ok("...with SMS chosen on a settings document that has never said",
    chip("SMS")?.getAttribute("aria-pressed") === "true");
  ok("...and no fallback switch, because SMS has nothing to fall back to",
    !host4.querySelector("#staff-notify-fallback"));

  await act(async () => {
    chip("WHATSAPP")?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await settle();
  const savedChannel = ((lastSaved as never as {
    messaging?: { staffSms?: { channel?: string } };
  } | null)?.messaging?.staffSms?.channel) ?? null;
  ok("pressing واتس‌اپ really writes the choice", savedChannel === "WHATSAPP", savedChannel);

  await renderStaff();
  const fallbackBox = host4.querySelector("#staff-notify-fallback") as HTMLInputElement | null;
  ok("...and the fallback switch appears once WhatsApp is the channel", !!fallbackBox);
  ok("...on by default, so a down line still reaches the colleague",
    fallbackBox?.checked === true);

  /*
   * Telegram writes its own choice, not WhatsApp's.
   *
   * The chip group is one `.map` over `STAFF_CHANNELS` and each button closes
   * over its own `option`, so this looks impossible — which is exactly why it is
   * worth one check: a group that wrote the *first* channel whatever was pressed
   * would draw perfectly, pass every rule check, and silently send every
   * handover notice on the wrong medium.
   */
  await act(async () => {
    chip("TELEGRAM")?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await settle();
  const tgChannel = ((lastSaved as never as {
    messaging?: { staffSms?: { channel?: string } };
  } | null)?.messaging?.staffSms?.channel) ?? null;
  ok("pressing تلگرام writes Telegram, not the first chip", tgChannel === "TELEGRAM", tgChannel);

  act(() => { root4.unmount(); });

  act(() => { root3.unmount(); });
  g3.fetch = realFetch;
}


head("Messenger panels: one component, and each asks about its own channel");

/*
 * `MessengerLinkPanel` draws WhatsApp's link card and Telegram's, from one spec
 * each. A second near-copy was the alternative and is how the two come to
 * disagree about what «قطع شده» looks like — but sharing one component has a
 * failure of its own that no type-check can see: a spec whose `status` closure
 * points at the *other* channel's endpoint. The panel would render perfectly,
 * poll happily, and report the WhatsApp line's state under the Telegram card.
 *
 * So this renders the Telegram card over a stubbed fetch and asserts which URL
 * it actually asked for.
 */
{
  const g5 = globalThis as unknown as Record<string, unknown>;
  const realFetch5 = g5.fetch;

  const asked: string[] = [];
  const posted: { path: string; body: string }[] = [];
  g5.fetch = (async (url: string, init?: { method?: string; body?: unknown }) => {
    const path = String(url);
    asked.push(path);
    if ((init?.method ?? "GET") !== "GET") {
      posted.push({ path, body: String(init?.body ?? "") });
    }
    const body = /\/(whatsapp|telegram)\/(status|link)/.test(path)
      ? {
        success: true,
        /*
         * Nothing linked and no code up, which is the state the link button is
         * live in — `disabled={busy || waiting}` makes it dead while a code is
         * waiting, which is its own render test above.
         */
        state: "UNLINKED",
        linked: false,
        qr: null,
        qrImage: null,
        linkedAccount: null,
        linkedNumber: null,
        lastError: null,
        since: new Date().toISOString(),
      }
      : path.includes("/messaging/providers")
        ? {
          success: true,
          providers: [
            { channel: "WHATSAPP", active: true, config: {}, secrets: {}, lastTestAt: null, lastTestOk: null, lastTestError: null },
            { channel: "TELEGRAM", active: true, config: {}, secrets: {}, lastTestAt: null, lastTestOk: null, lastTestError: null },
          ],
        }
        : {
          success: true, rows: [], total: 0, page: 1, pageSize: 50, totalPages: 1,
          summary: {}, templates: [], providers: [],
        };
    return {
      ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body),
    };
  }) as never;

  const host5 = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const root5 = createRoot(host5);
  const settle5 = async () => {
    for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); });
  };

  await act(async () => {
    root5.render(React.createElement(MessagingView, {
      settings: { customFields: [], messaging: {} } as never,
      currentUser: { id: "u1", permissions: { settings: true, messaging: true } } as never,
    }));
  });
  await settle5();
  const providersTab5 = [...host5.querySelectorAll("button")]
    .find((b) => (b.textContent ?? "").includes("تنظیمات درگاه‌ها")) as HTMLButtonElement | undefined;
  await act(async () => {
    providersTab5?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await settle5();

  const panels = [...host5.querySelectorAll("[data-messenger-panel]")]
    .map((el) => el.getAttribute("data-messenger-panel"));
  ok("both messenger panels are drawn, by one component",
    panels.includes("whatsapp") && panels.includes("telegram"), panels);

  /*
   * The half that matters: each one polled **its own** endpoint. Written with
   * the wrong closure the Telegram card would show the WhatsApp line's state and
   * nothing anywhere would say so.
   */
  ok("the WhatsApp panel asks the WhatsApp endpoint",
    asked.some((u) => u.includes("/api/messaging/whatsapp/status")));
  ok("...and the Telegram panel asks the Telegram one",
    asked.some((u) => u.includes("/api/messaging/telegram/status")));

  /*
   * **The two-step password is typed, not stored**, and this is where that claim
   * is either true or a comment. The box belongs to the channel that needs one:
   * WhatsApp has no such secret, and a field drawn on both cards teaches the
   * reader to skip the row it is in.
   */
  const secretBoxIn = (id: string) => (host5.querySelector(
    `[data-messenger-panel="${id}"] [data-messenger-link-secret]`) as HTMLInputElement | null);
  ok("the Telegram card asks for the two-step password", secretBoxIn("telegram") !== null);
  ok("...and the WhatsApp card does not", secretBoxIn("whatsapp") === null);

  /*
   * And what is typed **reaches the request**. `onClick={() => act(spec.link, …)}`
   * — the shape this replaced — type-checks perfectly, renders perfectly, and
   * drops the password on the floor: the sign-in then fails for an account with
   * two-step verification on, saying nothing about the box that was filled in.
   */
  const box5 = secretBoxIn("telegram")!;
  await act(async () => {
    handlers(box5).onChange?.({ target: { value: "hunter2" } });
  });
  const linkButton5 = [...host5.querySelectorAll('[data-messenger-panel="telegram"] button')]
    .find((b) => (b.textContent ?? "").includes("اتصال حساب")) as HTMLButtonElement | undefined;
  ok("the Telegram card has a link button", !!linkButton5);
  await act(async () => {
    linkButton5?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await settle5();

  const link5 = posted.find((r) => r.path.includes("/api/messaging/telegram/link"));
  ok("pressing اتصال حساب posts to the Telegram link endpoint", !!link5);
  ok("...carrying exactly what was typed", (link5?.body ?? "").includes("hunter2"), link5?.body);
  /*
   * Cleared as the request goes, which is what makes «typed once» a fact rather
   * than a description: a box still holding the password is a password sitting
   * on a screen in an open office.
   */
  ok("...and the box is cleared afterwards",
    (secretBoxIn("telegram")?.value ?? "") === "", secretBoxIn("telegram")?.value);

  act(() => { root5.unmount(); });
  g5.fetch = realFetch5;
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
  /*
   * Four symmetric marks, plus the colour opener and the table — the colour
   * swatches are behind the opener and are not counted until it is pressed.
   */
  ok("a button per mark, and one each for the colour and the table",
    document.querySelectorAll("button").length === RICH_MARKS.length + 2,
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
  let sentDue: { dueDate: string; dueDateByAssignee: boolean } | null = null;
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
      onSend: async (
        text: string,
        due: { dueDate: string; dueDateByAssignee: boolean },
      ) => { sent = text; sentDue = due; },
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

  /*
   * **The deadline control appears with the request and not before it.**
   *
   * A date box on an ordinary message would be asking about a promise nobody
   * is making — this feed was stripped of a checkbox, a colleague picker and a
   * "what should they do" box for exactly that reason — so it is drawn inside
   * the block that already says «برای … ارجاع ثبت می‌شود», and a message that
   * names nobody looks exactly as it always did.
   */
  ok("the deadline control is drawn once somebody is named",
    !!host.querySelector("[data-referral-due]"));

  const byAssignee = host.querySelector("[data-referral-due-by-assignee]") as HTMLInputElement;
  ok("...with «مهلت را ارجاع‌شونده تعیین کند» beside it", !!byAssignee);

  /*
   * A checkbox that draws perfectly and calls nothing back type-checks and
   * reads perfectly — the «switch that does nothing» fault, which is why this
   * is asserted against what actually reaches the caller rather than against
   * the markup.
   */
  await act(async () => {
    handlers(byAssignee).onChange?.({ target: { checked: true } });
  });
  await settle();

  await act(async () => {
    sendNow?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await settle();

  ok("the answer reaches the caller with the message",
    sentDue?.dueDateByAssignee === true);
  ok("...and no date beside it, since the two are alternatives",
    sentDue?.dueDate === "");

  act(() => { root.unmount(); });
  host.remove();
}

head("Activity composer: an ordinary message asks about no deadline");
{
  const settle = async () => {
    for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
  };
  const host = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(ActivityComposer, {
      users: [{ id: "u1", fullName: "علی رضایی" }],
      replyTo: null,
      onCancelReply: () => {},
      attachments: [],
      onAttachmentsChange: () => {},
      onPickFiles: () => {},
      uploading: false,
      onSend: async () => {},
    }));
  });
  await settle();

  /*
   * The negative half, and the one that keeps the feature honest: drawn
   * unconditionally the bar would grow a date box on every note anybody writes
   * about a job, which is the clutter the messenger was made out of.
   */
  ok("no deadline control on a message that names nobody",
    !host.querySelector("[data-referral-due]"));

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
  /* -- «تأیید پیشنهاد فنی» says what it will do to the project, and that it is
        not a win; any other result says nothing of the kind -- */
  {
    const note = "[data-technical-approval-note]";
    const approved = await open({
      taskId: "t-tech", closed: true, followUpResult: "تأیید پیشنهاد فنی",
      completionNote: "", title: "تماس", description: "", dueDate: "1405/06/09",
      assignee: "کارشناس فروش", priority: "متوسط",
    }, { proformaType: "TECHNICAL" });
    const said = approved.text(note);
    ok("the approval explains itself before it is saved", !!approved.host.querySelector(note));
    ok("...naming the project status and the stage it moves to",
      said.includes("تأیید پیشنهاد فنی") && said.includes("تهیه پیش‌فاکتور"), said);
    ok("...and that it is not a win", said.includes("برنده شدن پروژه نیست"), said);
    approved.close();

    const other = await open({
      taskId: "t-other", closed: true, followUpResult: "در حال بررسی فنی",
      completionNote: "", title: "تماس", description: "", dueDate: "1405/06/09",
      assignee: "کارشناس فروش", priority: "متوسط",
    });
    ok("any other result draws no such note", !other.host.querySelector(note));
    other.close();

    /*
      The same result on a financial quotation: its destination is the win, so
      the form says so and the button is dead — the server refuses it too, and
      a button that submits into a refusal reads as the form being broken.
    */
    const financial = await open({
      taskId: "t-fin", closed: true, followUpResult: "تأیید پیشنهاد فنی",
      completionNote: "", title: "تماس", description: "", dueDate: "1405/06/09",
      assignee: "کارشناس فروش", priority: "متوسط",
    }, { proformaType: "FINANCIAL" });
    const submitFin = financial.host.querySelector("#follow-up-submit") as HTMLButtonElement | null;
    ok("on a financial quotation the approval draws no promise",
      !financial.host.querySelector(note));
    ok("...but the reason it is refused",
      (financial.host.textContent ?? "").includes("فقط برای پیش‌فاکتور فنی"));
    ok("...and the button is dead", submitFin?.disabled === true, submitFin?.disabled);
    financial.close();
  }

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

/*
 * «شرح اقدام» as the task is ticked off.
 *
 * Two things a rule check cannot see and that both type-check perfectly while
 * doing nothing: a box whose `onChange` is never wired, so the note is always
 * blank whatever was typed; and a confirm button that draws and calls back with
 * something other than what is in the box. The whole feature is one string
 * reaching one write.
 */
/*
 * The print preview folds, and starts folded where it was asked to.
 *
 * A disclosure is two things that both type-check while doing nothing: a
 * heading that is not a button, and a button whose state never reaches the
 * block it is meant to hide. Both read perfectly in the source.
 */
/*
 * A colour, a table, and a table pasted out of a spreadsheet.
 *
 * The pure rules are held by `test:rules`; what only a rendered field can say
 * is whether the controls reach them — a swatch that draws the right colour and
 * writes nothing, and a paste handler that never sees the clipboard, both
 * type-check and read perfectly.
 */
head("Rich text: colour, table, and a table pasted in");
{
  const tHost = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const tRoot = createRoot(tHost);
  let text = "جنس بدنه: استیل";
  const Screen = () => {
    const [value, setValue] = React.useState(text);
    text = value;
    return React.createElement(RichTextField, { value, onChange: setValue });
  };
  act(() => { tRoot.render(React.createElement(Screen)); });
  const area = tHost.querySelector("textarea") as HTMLTextAreaElement;

  /* -- the colour is behind one opener, and the swatches are the allowlist -- */
  ok("the swatches are not drawn until the opener is pressed",
    tHost.querySelectorAll("[data-rich-colour]").length === 0);
  const opener = tHost.querySelector("#rich-colour-open") as HTMLElement | null;
  ok("the opener is drawn", !!opener);
  act(() => { opener!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  const swatches = Array.from(tHost.querySelectorAll("[data-rich-colour]"));
  ok("one swatch per allowed colour, and no more",
    swatches.length === Object.keys(RICH_COLOURS).length, swatches.length);
  /*
   * A swatch offering a colour `renderRichText` does not know would write
   * brackets that print as brackets — a control that draws text nobody meant.
   */
  ok("...and every one of them is a colour the renderer answers",
    swatches.every((b) => !!RICH_COLOURS[b.getAttribute("data-rich-colour") ?? ""]));

  // Selected text is wrapped, which is what the four marks beside it do.
  const word = "استیل";
  const at = text.indexOf(word);
  act(() => { area.setSelectionRange(at, at + word.length); });
  const red = tHost.querySelector('[data-rich-colour="قرمز"]') as HTMLElement | null;
  act(() => { red!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  ok("a swatch wraps the selection in its own colour",
    text === "جنس بدنه: {{قرمز:استیل}}", text);
  ok("...and the palette closes behind it",
    tHost.querySelectorAll("[data-rich-colour]").length === 0);

  /* -- the table skeleton lands on lines of its own -- */
  act(() => { area.setSelectionRange(text.length, text.length); });
  const tableBtn = tHost.querySelector("#rich-table") as HTMLElement | null;
  act(() => { tableBtn!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  ok("the table button writes a skeleton", text.includes(TABLE_SKELETON), text);
  ok("...starting a line, or the renderer cannot see it as a table",
    text.includes(`\n${TABLE_SKELETON.split("\n")[0]}`), text);

  /*
   * And the paste. The clipboard's `text/plain` from a spreadsheet is
   * tab-separated and would land as one run-on line.
   */
  act(() => { tRoot.render(React.createElement(Screen)); });
  const fresh = tHost.querySelector("textarea") as HTMLTextAreaElement;
  text = "";
  act(() => { tRoot.render(React.createElement(Screen)); });
  let defaultPrevented = 0;
  const paste = (clip: string) => act(() => {
    handlers(fresh).onPaste?.({
      clipboardData: { getData: () => clip },
      preventDefault: () => { defaultPrevented += 1; },
    });
  });

  paste("شرح\tتعداد\nفلومتر\t۲");
  ok("a tab-separated paste becomes pipe rows",
    text.includes("شرح | تعداد") && text.includes("فلومتر | ۲"), text);
  ok("...and the browser's own paste is stopped exactly once",
    defaultPrevented === 1, defaultPrevented);

  // Anything that is not a table is left to the browser, untouched.
  const before = text;
  paste("یک خط ساده");
  ok("ordinary text is not intercepted", defaultPrevented === 1, defaultPrevented);
  ok("...and nothing was written over it", text === before, text);

  act(() => { tRoot.unmount(); });
  tHost.remove();
}

head("Rich text: the print preview folds where it is asked to");
{
  const rHost = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const rRoot = createRoot(rHost);
  // Formatted, or the preview is not drawn at all — which is its own rule.
  const body = "شرایط: **۱۰ روز** اعتبار";

  const draw = (collapsible: boolean) => act(() => {
    rRoot.render(React.createElement(RichTextField, {
      value: body, onChange: () => {}, dir: "rtl" as const,
      ...(collapsible ? { collapsiblePreview: true } : {}),
    }));
  });

  // 1. The line specification: unchanged, open, no control.
  draw(false);
  ok("an ordinary field still draws the preview",
    !!rHost.querySelector("[data-rich-preview]"));
  ok("...with nothing to press", !rHost.querySelector("#rich-preview-toggle"));

  // 2. The proforma's notes: folded, and the heading is the control.
  draw(true);
  const toggle = rHost.querySelector("#rich-preview-toggle") as HTMLElement | null;
  ok("a collapsible field draws the control", !!toggle);
  ok("...and starts folded, so twelve rows are not repeated under twelve rows",
    !rHost.querySelector("[data-rich-preview]"));
  ok("...saying so to a reader who cannot see it",
    toggle?.getAttribute("aria-expanded") === "false");

  act(() => { toggle!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  ok("pressing it shows the preview", !!rHost.querySelector("[data-rich-preview]"));
  ok("...and the rendered markers are really in it",
    /<strong>/.test(rHost.querySelector("[data-rich-preview]")?.innerHTML ?? ""));
  const reopened = rHost.querySelector("#rich-preview-toggle") as HTMLElement | null;
  act(() => { reopened!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  ok("...and pressing it again folds it back",
    !rHost.querySelector("[data-rich-preview]"));

  /*
   * It sits inside the proforma form, so a bare <button> would submit it —
   * which is a save nobody asked for, from a control that looks like a
   * heading.
   */
  ok("the control never submits the form it sits in",
    (rHost.querySelector("#rich-preview-toggle") as HTMLButtonElement | null)?.type === "button");

  act(() => { rRoot.unmount(); });
  rHost.remove();
}

head("Completing a task: the note reaches the caller");
{
  const nHost = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const nRoot = createRoot(nHost);
  const task = {
    id: "t-1", title: "تماس با پتروشیمی", status: "برای انجام",
    taskKind: "GENERAL", priority: "متوسط",
  };
  let confirmed: string | null = null;
  let confirmedNext: boolean | null = null;
  let cancelled = 0;

  const draw = (t: unknown) => act(() => {
    nRoot.render(React.createElement(TaskCompletionModal, {
      task: t as never,
      onCancel: () => { cancelled += 1; },
      onConfirm: (note: string, withNextAction: boolean) => {
        confirmed = note;
        confirmedNext = withNextAction;
      },
    }));
  });

  // Nothing is drawn until a task is being ticked.
  draw(null);
  ok("no task, no dialog", nHost.innerHTML === "", nHost.innerHTML.slice(0, 80));

  draw(task);
  const box = nHost.querySelector("#task-completion-note") as HTMLTextAreaElement | null;
  ok("the box is drawn", !!box);
  ok("...empty for a task nobody has answered yet", box?.value === "", box?.value);
  ok("...and the task being ticked is named on it",
    nHost.textContent?.includes("تماس با پتروشیمی") === true);

  // Through the control's own handler, which is the wiring under test.
  act(() => {
    box!.value = "قیمت رقیب گرفته شد و ۵٪ تخفیف پیشنهاد شد";
    handlers(box!).onChange?.({ target: box });
  });
  ok("typing reaches the control", box?.value === "قیمت رقیب گرفته شد و ۵٪ تخفیف پیشنهاد شد",
    box?.value);

  const confirm = nHost.querySelector("#task-completion-confirm") as HTMLElement | null;
  ok("the confirm button is drawn", !!confirm);
  ok("...and drawing it has written nothing", confirmed === null);
  act(() => { confirm!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  ok("...pressing it hands over exactly what was typed",
    confirmed === "قیمت رقیب گرفته شد و ۵٪ تخفیف پیشنهاد شد", confirmed);
  ok("...and asks for no next action", confirmedNext === false, String(confirmedNext));

  /*
   * **«ثبت و اقدام بعدی» is the same completion plus one answer.**
   *
   * The choice is in the button rather than in a dialog after every tick — the
   * `SaveWithNextActionButton` rule — and it travels as an argument rather than
   * through a ref, so this is what says the second button is not simply the
   * first one drawn twice. A button that renders perfectly and hands over the
   * same `false` as its neighbour type-checks and reads correctly, and the
   * follow-on question would then never be asked from the one gesture people
   * finish a task with.
   */
  const confirmNext = nHost.querySelector("#task-completion-confirm-next") as HTMLElement | null;
  ok("the second answer is offered beside the first", !!confirmNext);
  act(() => { confirmNext!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  ok("...and says so to the caller", confirmedNext === true, String(confirmedNext));
  ok("...carrying the same note, since it is the same completion",
    confirmed === "قیمت رقیب گرفته شد و ۵٪ تخفیف پیشنهاد شد", confirmed);

  /*
   * A note already on the task seeds the box: re-completing a card that was
   * reopened should let somebody add to what they wrote rather than retype it.
   */
  draw({ ...task, id: "t-2", completionNote: "نصب انجام شد" });
  const seeded = nHost.querySelector("#task-completion-note") as HTMLTextAreaElement | null;
  ok("an existing note is seeded, not lost", seeded?.value === "نصب انجام شد", seeded?.value);

  // And the way out writes nothing at all.
  const cancel = nHost.querySelector("#task-completion-cancel") as HTMLElement | null;
  act(() => { cancel!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  ok("cancelling asks the caller to close and writes nothing",
    cancelled === 1 && confirmed === "قیمت رقیب گرفته شد و ۵٪ تخفیف پیشنهاد شد", cancelled);

  act(() => { nRoot.unmount(); });
  nHost.remove();
}

head("A document's notes: a file is content, and the delete is only where it is allowed");

/*
 * `ModuleNotesSection` is one component on four screens, and three of the
 * things asked of it here are invisible to a source scan: whether the submit
 * really carries the files it drew, whether a note with *only* a file can be
 * sent at all, and whether the delete is absent rather than merely styled away
 * on a note this reader may not remove.
 */
{
  const mHost = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const mRoot = createRoot(mHost);

  let added: { text: string; files: unknown[] | undefined } | null = null;
  let deleted: string | null = null;

  const file = { name: "confirm.pdf", size: "342 KB", url: "/uploads/note-files/a.pdf" };
  const notes = [
    {
      id: "n-1", text: "قیمت نهایی تأیید شد", author: "محمد مقدم",
      createdAt: new Date(Date.UTC(2026, 8, 16, 7, 5, 0)).toISOString(),
      attachments: [file], canDelete: true,
    },
    {
      id: "n-2", text: "یادداشت همکار", author: "رضا رضایی",
      createdAt: new Date(Date.UTC(2026, 8, 15, 7, 5, 0)).toISOString(),
      attachments: [], canDelete: false,
    },
  ];

  act(() => {
    mRoot.render(React.createElement(ModuleNotesSection, {
      notes: notes as never,
      // The argument is recorded **as given**, not defaulted: `files ?? []`
      // here would make the assertion below pass on a component that never
      // sends them, which is the check asserting nothing.
      onAddNote: (text: string, files?: unknown[]) => { added = { text, files }; },
      onDeleteNote: (id: string) => { deleted = id; },
    }));
  });

  /*
   * **The delete is absent, not hidden.** `opacity-0` plus a hover rule is how
   * this card already reveals the button, so a check that only asked whether it
   * was styled away would pass whatever the permission says.
   */
  const bins = [...mHost.querySelectorAll('button[title="حذف یادداشت"]')];
  ok("one delete for two notes", bins.length === 1, bins.length);
  act(() => { bins[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  ok("...and it is the one this reader wrote", deleted === "n-1", deleted);

  /* The stored files are drawn as links to where the bytes are. */
  const links = [...mHost.querySelectorAll("[data-note-files] a")] as HTMLAnchorElement[];
  ok("the note's file is drawn", links.length === 1, links.length);
  ok("...pointing at the uploaded path",
    links[0]?.getAttribute("href") === file.url, links[0]?.getAttribute("href"));
  ok("...named, so it can be recognised",
    mHost.textContent?.includes("confirm.pdf") === true);

  /*
   * **No Gregorian instant reaches the screen.** The card printed `createdAt`
   * exactly as it came off the wire, so a Persian screen carried
   * «2026-09-16T07:05:00.000Z».
   */
  const text = mHost.textContent ?? "";
  ok("no ISO timestamp is printed", !/\d{4}-\d{2}-\d{2}T/.test(text), text.slice(0, 200));
  ok("...a Shamsi date is", /1[34]\d{2}\/\d{2}\/\d{2}/.test(text), text.slice(0, 200));
  ok("...with the hour beside it", /ساعت \d{2}:\d{2}/.test(text), text.slice(0, 200));

  /*
   * **A file on its own is a note.** The submit is disabled with an empty box
   * and nothing attached, and has to come alive on the file alone — written the
   * other way it type-checks, renders perfectly, and refuses exactly the note
   * somebody meant to record.
   */
  const submit = [...mHost.querySelectorAll("button")]
    .find((b) => (b.textContent ?? "").includes("ثبت یادداشت")) as HTMLButtonElement;
  ok("the submit is drawn", !!submit);
  ok("...dead with nothing written and nothing attached", submit.disabled === true);

  const draft = mHost.querySelector("textarea") as HTMLTextAreaElement;
  act(() => {
    draft.value = "تأیید تلفنی مشتری";
    handlers(draft).onChange?.({ target: draft });
  });
  ok("...and alive once something is typed", submit.disabled === false);
  act(() => { submit.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  ok("pressing it hands the words over",
    (added as { text: string } | null)?.text === "تأیید تلفنی مشتری",
    (added as { text: string } | null)?.text);
  /*
   * And an empty list rather than nothing, so the caller never has to tell
   * «no files» from «this build does not send files».
   */
  ok("...with a list of files beside them",
    Array.isArray((added as { files: unknown[] | undefined } | null)?.files),
    JSON.stringify(added));

  /* The picker is a real input the button reaches, not a decorative icon. */
  const picker = mHost.querySelector("[data-note-file-input]") as HTMLInputElement | null;
  ok("there is a file input to pick with", !!picker);
  ok("...taking more than one file", picker?.hasAttribute("multiple") === true);

  act(() => { mRoot.unmount(); });
  mHost.remove();
}


head("The relationship picker asks the server for the opposite type");

/*
 * «تعریف ارتباط» is one component shared by the two customer forms — it had
 * been two, and the quick-add form's copy had no search box at all. Sharing it
 * closes that, and opens one failure no type-check can see: a picker that
 * queries **its own** customer type renders perfectly, searches perfectly, and
 * offers exactly the wrong half of the directory. Both answers are full of
 * plausible names, so nothing on the screen would say so.
 *
 * So this renders it over a stubbed fetch and reads the URL it really asked
 * for, and then types into the box and reads the URL again — because a search
 * input whose `onChange` never reaches the query is the «switch that does
 * nothing» fault, and it type-checks.
 */
{
  const gR = globalThis as unknown as Record<string, unknown>;
  const realFetchR = gR.fetch;
  const askedR: string[] = [];
  gR.fetch = (async (url: string) => {
    askedR.push(String(url));
    const body = {
      success: true,
      rows: [
        { id: "c1", customerType: "حقیقی", companyName: "علی رضایی", firstName: "علی", lastName: "رضایی", position: "مدیر خرید", industry: null },
        { id: "c2", customerType: "حقیقی", companyName: "زهرا احمدی", firstName: "زهرا", lastName: "احمدی", position: "کارشناس", industry: null },
      ],
      total: 2, page: 1, pageSize: 25, totalPages: 1,
    };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  }) as never;

  const hostR = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const rootR = createRoot(hostR);
  const settleR = async () => {
    for (let i = 0; i < 12; i++) await act(async () => { await Promise.resolve(); });
  };

  const toggled: string[] = [];
  await act(async () => {
    rootR.render(React.createElement(RelationPicker, {
      // A company's form, so the picker must go looking for **people**.
      customerType: "حقوقی",
      selected: [],
      onToggle: (id: string) => { toggled.push(id); },
    }));
  });
  await settleR();

  ok("the picker queries the customers endpoint",
    askedR.some((u) => u.includes("/api/customers")), askedR.join(" | "));
  /*
   * The half that matters. A link joins the opposite type, so a company's form
   * asks for حقیقی — encoded, since it travels in a query string.
   */
  ok("...for the opposite customer type",
    askedR.some((u) => u.includes(encodeURIComponent("حقیقی"))),
    askedR.join(" | "));
  ok("...and never for its own",
    !askedR.some((u) => u.includes(encodeURIComponent("حقوقی"))),
    askedR.join(" | "));

  /* The search box has to reach the query, or it narrows nothing. */
  const boxR = hostR.querySelector("input[type=\"text\"]") as HTMLInputElement | null;
  ok("there is a search box to type in", !!boxR);
  const beforeR = askedR.length;
  await act(async () => {
    // Driven through the control's own handler, the way every typing test in
    // this file does — jsdom dispatches the event but React 19 reads its props.
    boxR!.value = "رضایی";
    handlers(boxR!).onChange?.({ target: boxR });
  });
  // The term is debounced, so the request lands a moment later.
  await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
  await settleR();
  ok("typing reaches the server query",
    askedR.slice(beforeR).some((u) => u.includes(encodeURIComponent("رضایی"))),
    askedR.slice(beforeR).join(" | "));

  /*
   * The results list is the one element in this application allowed a scrollbar
   * inside a form, and it is allowed it *by name*. Drawn without the marker the
   * exemption in `test:rules` stops matching and the rule goes back to being
   * enforced, which is the behaviour wanted — but the marker also has to be on
   * the element that really scrolls, which only a render can say.
   */
  const resultsR = hostR.querySelector("[data-relation-results]") as HTMLElement | null;
  ok("the results list is marked as a picker's results", !!resultsR);
  ok("...and it is the element carrying the scroll",
    (resultsR?.className ?? "").includes("overflow-y-auto"), resultsR?.className);

  /* And a tick reaches the caller, rather than being a checkbox that draws. */
  const firstBox = hostR.querySelector("input[type=\"checkbox\"]") as HTMLInputElement | null;
  ok("the candidates are drawn as ticks", !!firstBox);
  await act(async () => {
    firstBox?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await settleR();
  ok("ticking one reaches the caller", toggled.length === 1, JSON.stringify(toggled));

  act(() => { rootR.unmount(); });
  hostR.remove();
  gR.fetch = realFetchR;
}


head("A condition on «یکی از این‌ها باشد» names more than one value");

/*
 * Reported as a rule the assistant refused to build: «اگر پروژه در وضعیت جدید
 * **یا** در حال مذاکره بود». Conditions are ANDed and there were four
 * operators, so two values of one field was not a condition at all.
 *
 * The operator alone is not the whole of it: a single dropdown beside `in`
 * would be a control that contradicts the operator it answers — pick «یکی از
 * این‌ها باشد», then be able to name exactly one. That is the failure this
 * renders for, because ticks that draw perfectly and never call back
 * type-check, read perfectly and leave the rule holding one value.
 */
{
  const hostC = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const rootC = createRoot(hostC);
  const OPTIONS = ["جدید", "در حال مذاکره", "برنده (موفق)"];

  let stored = "";
  const draw = (operator: string, value: string, options: readonly string[] = OPTIONS) =>
    act(() => {
      rootC.render(React.createElement(ConditionValueField, {
        field: "status",
        operator,
        value,
        options,
        onChange: (next: string) => { stored = next; },
      }));
    });

  /* -- `equals` keeps the single dropdown it always had -- */
  draw("equals", "جدید");
  ok("an ordinary condition draws one dropdown",
    !!hostC.querySelector("select") && !hostC.querySelector("[data-condition-values]"));

  /* -- `in` draws a tick per value -- */
  draw("in", "");
  const ticks = [...hostC.querySelectorAll("[data-condition-values] input[type=\"checkbox\"]")];
  ok("«یکی از این‌ها باشد» draws a tick per value", ticks.length === OPTIONS.length, ticks.length);
  ok("...and no single-value dropdown beside it", !hostC.querySelector("select"));

  /*
   * The half a type-check cannot see: the tick has to reach the caller, and
   * with the value the rule will be stored under.
   */
  await act(async () => {
    (ticks[0] as HTMLInputElement).dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }));
  });
  ok("ticking one writes it back", stored === "جدید", stored);

  /* And a second tick **adds** rather than replacing — the whole point. */
  draw("in", stored);
  const ticks2 = [...hostC.querySelectorAll("[data-condition-values] input[type=\"checkbox\"]")];
  await act(async () => {
    (ticks2[1] as HTMLInputElement).dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }));
  });
  ok("ticking a second adds to the list", stored === "جدید، در حال مذاکره", stored);

  /* What is already stored is drawn as ticked, or the form forgets on reopen. */
  draw("in", "جدید، در حال مذاکره");
  const ticks3 = [...hostC.querySelectorAll("[data-condition-values] input[type=\"checkbox\"]")]
    .map((el) => (el as HTMLInputElement).checked);
  ok("a stored list comes back ticked",
    JSON.stringify(ticks3) === JSON.stringify([true, true, false]), ticks3);

  /* Unticking removes just that one. */
  const boxes4 = [...hostC.querySelectorAll("[data-condition-values] input[type=\"checkbox\"]")];
  await act(async () => {
    (boxes4[0] as HTMLInputElement).dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }));
  });
  ok("unticking removes only that value", stored === "در حال مذاکره", stored);

  /*
   * A field with no closed list — a figure, a free-text value — still gets a
   * typed box under `in`, where the person's own comma is the separator. A tick
   * grid over no options would be an empty row saying nothing.
   */
  draw("in", "الف، ب", []);
  ok("a field with no list falls back to a typed box",
    !!hostC.querySelector("input[type=\"text\"]")
    && !hostC.querySelector("[data-condition-values]"));

  act(() => { rootC.unmount(); });
  hostC.remove();
}

/*
 * The website price-request panel.
 *
 * Two failures here are invisible to every other layer. A save button whose
 * handler never sends the token — or sends the masked hint it was shown — is
 * a control that draws, reads and does nothing, which type-checks perfectly;
 * and the token box must never be *seeded* from what the server sent back,
 * because the server sends a hint («••••3456») and seeding from it would post
 * those characters as the real token the next time somebody pressed save.
 */
{
  const gW = globalThis as unknown as Record<string, unknown>;
  const realFetchW = gW.fetch;
  const askedW: { url: string; method: string; body: unknown }[] = [];
  gW.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    const method = String(init?.method ?? "GET");
    let parsed: unknown = null;
    try { parsed = init?.body ? JSON.parse(init.body) : null; } catch { parsed = null; }
    askedW.push({ url: String(url), method, body: parsed });

    /*
     * The configuration answers for whichever source the URL named. A card
     * whose calls pointed at the *other* source would render perfectly and
     * report the wrong feed's state — which no type-check can see, so the
     * stub echoes the source back and the assertions read it.
     */
    const source = String(url).includes("/FORM/") ? "FORM" : "ADVISOR";
    const config = {
      source,
      feedUrl: source === "FORM"
        ? "https://site.ir/wp-json/ata-rfq/v1/erp-feed"
        : "https://site.ir/wp-json/ata/v1/rfq/erp-feed",
      tokenHint: "••••3456", active: true, ownerUserId: "u1",
      startAfterId: 47, refusal: null,
    };
    const report = {
      lastRunAt: 0, lastOkAt: 0, lastError: null, lastImported: 0,
      baselineDrawnAt: null, running: false,
    };
    const body = String(url).includes("/imports")
      ? { success: true, imports: [] }
      : String(url).includes("/api/users")
        ? { success: true, rows: [{ id: "u1", fullName: "محمد مقدم", isActive: true }], total: 1, page: 1, pageSize: 200, totalPages: 1 }
        : { success: true, config, report };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  }) as never;

  const hostW = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const rootW = createRoot(hostW);
  const settleW = async () => {
    for (let i = 0; i < 12; i++) await act(async () => { await Promise.resolve(); });
  };

  await act(async () => { rootW.render(React.createElement(WebRfqPanel, { source: "ADVISOR" })); });
  await settleW();

  ok("the panel reads its configuration",
    askedW.some((r) => r.url.includes("/api/web-rfq/ADVISOR/config") && r.method === "GET"));
  ok("...and the log of what has arrived",
    askedW.some((r) => r.url.includes("/api/web-rfq/ADVISOR/imports")));
  ok("...and asks about no other source",
    !askedW.some((r) => r.url.includes("/FORM/")));

  /*
   * The stored token comes back as a hint and nothing else. If the box were
   * seeded from it, the bullets would be posted as the token and the feed
   * would start refusing on the next save — silently, since the panel would
   * report a successful write.
   */
  const boxes = Array.from(hostW.querySelectorAll("input")) as HTMLInputElement[];
  const tokenBox = boxes.find((b) => b.getAttribute("type") === "password");
  ok("the token box is never seeded from the masked hint", tokenBox?.value === "");
  ok("...and the hint is shown so the stored token is recognisable",
    hostW.textContent?.includes("••••3456") === true);

  const before = askedW.length;
  const saveBtn = hostW.querySelector("[data-web-rfq-save]") as HTMLButtonElement | null;
  await act(async () => { saveBtn?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  await settleW();

  const saved = askedW.slice(before).find((r) => r.method === "PUT");
  ok("pressing save really writes", !!saved);
  const body = (saved?.body ?? {}) as Record<string, unknown>;
  ok("...to this card's own source", saved?.url.includes("/api/web-rfq/ADVISOR/config") === true);
  ok("...sending the address that is in the box", body.feedUrl === "https://site.ir/wp-json/ata/v1/rfq/erp-feed");
  ok("...and a blank token, which the server reads as «unchanged»", body.token === "");
  ok("...never the masked hint", body.token !== "••••3456");
  /*
   * The line the site's history sits below. Sent back as the number it is —
   * a save that dropped it would leave it null, and the next poll would draw
   * it again from wherever the site had got to by then.
   */
  ok("...and the line, as a number", body.startAfterId === 47);

  /*
   * Blank is «draw it again», zero is «import everything», and the two must
   * not collapse into each other: a falsy check would turn an emptied box
   * into a request for the site's whole history, which is the one thing the
   * line exists to prevent.
   */
  const lineBox = hostW.querySelector("[data-web-rfq-line]") as HTMLInputElement | null;
  ok("the line is drawn in a box somebody can correct", !!lineBox && lineBox.value === "47");

  // React 19 does not observe the native value setter here, so the component's
  // own handler is driven — which is what is under test anyway.
  const setLine = (value: string) => {
    const box = hostW.querySelector("[data-web-rfq-line]") as HTMLInputElement;
    box.value = value;
    handlers(box).onChange?.({ target: box });
  };

  const beforeBlank = askedW.length;
  await act(async () => { setLine(""); });
  await act(async () => { saveBtn?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  await settleW();
  const blanked = askedW.slice(beforeBlank).find((r) => r.method === "PUT");
  ok("an emptied box asks for the line to be drawn again",
    (blanked?.body as Record<string, unknown>)?.startAfterId === null);

  const beforeZero = askedW.length;
  await act(async () => { setLine("0"); });
  await act(async () => { saveBtn?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  await settleW();
  const zeroed = askedW.slice(beforeZero).find((r) => r.method === "PUT");
  ok("...and a typed zero is a decision, not the same as blank",
    (zeroed?.body as Record<string, unknown>)?.startAfterId === 0);

  const beforeSync = askedW.length;
  const syncBtn = hostW.querySelector("[data-web-rfq-sync]") as HTMLButtonElement | null;
  await act(async () => { syncBtn?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  await settleW();
  ok("«همگام‌سازی حالا» reaches the server",
    askedW.slice(beforeSync).some((r) => r.url.includes("/api/web-rfq/ADVISOR/sync") && r.method === "POST"));

  act(() => { rootW.unmount(); });
  hostW.remove();

  /*
   * The second card, and the one assertion this whole block exists for.
   *
   * One component draws both, so a spec whose calls pointed at the other
   * source would render perfectly, fill in perfectly, and report the wrong
   * plugin's last error under this plugin's name. Nothing but driving it can
   * see that — the prop is a string either way — so the second card is
   * rendered and every URL it asked for is read.
   */
  {
    const hostF = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
    const rootF = createRoot(hostF);
    const before2 = askedW.length;
    await act(async () => { rootF.render(React.createElement(WebRfqPanel, { source: "FORM" })); });
    await settleW();
    const mine = askedW.slice(before2).filter((r) => r.url.includes("/api/web-rfq/"));
    ok("the second card asks about the second source",
      mine.some((r) => r.url.includes("/api/web-rfq/FORM/config"))
      && mine.some((r) => r.url.includes("/api/web-rfq/FORM/imports")));
    ok("...and about no other, whatever the first card asked",
      mine.length > 0 && mine.every((r) => r.url.includes("/api/web-rfq/FORM/")));
    ok("...and draws its own plugin's address as the placeholder",
      (Array.from(hostF.querySelectorAll("input")) as HTMLInputElement[])
        .some((b) => b.value.includes("ata-rfq/v1/erp-feed")));
    /*
     * The markers carry the source too, so a render test cannot press the
     * wrong card's button and report the right one as working.
     */
    ok("its own controls are addressable as its own",
      !!hostF.querySelector("[data-web-rfq-save='FORM']")
      && !!hostF.querySelector("[data-web-rfq-sync='FORM']"));
    act(() => { rootF.unmount(); });
    hostF.remove();
  }

  gW.fetch = realFetchW;
}


/*
 * The after-sales list is a row that opens.
 *
 * Two things here cannot be seen from the source. A disclosure whose state
 * never reaches the block reads perfectly and type-checks — `prev.add(id)` on
 * a Set returns the same object, so React compares it equal and nothing
 * redraws — and the fault this replaced was the opposite shape: the detail was
 * always drawn, which is what made a dozen open cases fill two screens.
 *
 * And «دلیل برگشت» is the field that was blank on every card in the module,
 * because the list query never selected it and the adapter wrote `""` over it.
 * A render test is the only thing that can say it now arrives: both halves
 * type-check either way.
 */
{
  const gA = globalThis as unknown as Record<string, unknown>;
  const realFetchA = gA.fetch;
  const askedA: string[] = [];

  const serviceRow = {
    id: "svc-1", projectId: "p-1", itemName: "فلومتر التراسونیک",
    status: "در حال بررسی",
    proformaNumber: "QT-ATA-05-38-P1", proformaItemName: null,
    issueDescription: "نشتی از محل اتصال",
    actionsTaken: "باز شد\nواشر تعویض شد",
    customerRequest: "دستگاه از روز اول نشتی دارد",
    requestDateJalali: "1405/06/20",
    startDateJalali: "1405/06/25", endDateJalali: null, returnDateJalali: null,
    createdBy: "محمد مقدم",
    // A real ISO instant, which is what the column answers with — and what the
    // card used to print verbatim on a Persian screen.
    createdAt: "2026-09-21T14:03:11.000Z",
    project: { id: "p-1", code: "ATA-05-38", name: "پتروشیمی نمونه" },
    _count: { items: 2 },
    customValues: null,
  };

  gA.fetch = (async (url: string) => {
    askedA.push(String(url));
    const body = String(url).includes("/api/after-sales")
      ? { success: true, rows: [serviceRow], total: 1, page: 1, pageSize: 50, totalPages: 1 }
      : { success: true, rows: [], total: 0, page: 1, pageSize: 25, totalPages: 1 };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  }) as never;

  const hostA = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const rootA = createRoot(hostA);
  const settleA = async () => {
    for (let i = 0; i < 14; i++) await act(async () => { await Promise.resolve(); });
  };

  await act(async () => {
    rootA.render(React.createElement(AfterSalesServicesView, {
      settings: DEFAULT_SETTINGS as never,
      currentUser: { id: "u-1", fullName: "محمد مقدم" } as never,
    }));
  });
  await settleA();

  const toggle = () => hostA.querySelector("[data-after-sales-toggle='svc-1']") as HTMLElement | null;
  const detail = () => hostA.querySelector("[data-after-sales-detail='svc-1']");

  ok("the record is drawn as a row", !!toggle());
  ok("...naming the goods and the job on one line",
    (toggle()?.textContent ?? "").includes("فلومتر التراسونیک")
    && (toggle()?.textContent ?? "").includes("پتروشیمی نمونه"));
  /*
   * Closed by default. Opened, a list of a dozen cases is the wall of cards
   * this replaced — which was the whole of the report.
   */
  ok("nothing is expanded until it is pressed", detail() === null);
  ok("...so the reason is genuinely absent rather than merely hidden",
    !(hostA.textContent ?? "").includes("نشتی از محل اتصال"));

  await act(async () => {
    toggle()?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await settleA();

  ok("pressing the row opens it", !!detail());
  /*
   * The three free-text blocks. «دلیل برگشت» is the one that was blank on
   * every card: selected by nobody, blanked by the adapter, drawn as an empty
   * paragraph. It arrives now, and so does the customer's own account, which
   * the record had nowhere to keep at all.
   */
  ok("...showing the reason the goods came back",
    (detail()?.textContent ?? "").includes("نشتی از محل اتصال"));
  ok("...and what the customer said",
    (detail()?.textContent ?? "").includes("دستگاه از روز اول نشتی دارد"));
  ok("...and every line of what was done, not only the first",
    (detail()?.textContent ?? "").includes("باز شد")
    && (detail()?.textContent ?? "").includes("واشر تعویض شد"));
  ok("...and the day the request arrived, beside the day the goods did",
    (detail()?.textContent ?? "").includes("1405/06/20")
    && (detail()?.textContent ?? "").includes("1405/06/25"));
  /*
   * The timestamp. `.split(' ')[0]` on an ISO instant finds no space, so the
   * whole «2026-09-21T14:03:11.000Z» was printed; and the fold has to read the
   * **local** calendar fields, or the date is a day out on this UTC+03:30 host.
   */
  ok("the record's own timestamp is Shamsi, not the ISO instant",
    !(detail()?.textContent ?? "").includes("2026-09-21T"));
  ok("...and reads as a Persian date", /14\d\d\/\d\d\/\d\d/.test(detail()?.textContent ?? ""));

  /*
   * Pressing the row opens nothing else. The edit button beside it is what
   * fetches the record; a disclosure that also opened the form would make the
   * list unreadable with one press.
   */
  ok("opening a row fetches no record",
    !askedA.some((u) => /\/api\/after-sales\/svc-1$/.test(u)));

  await act(async () => {
    toggle()?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await settleA();
  ok("pressing it again closes it", detail() === null);

  act(() => { rootA.unmount(); });
  hostA.remove();
  gA.fetch = realFetchA;
}

/**
 * A notification leads somewhere, and «اعلان‌ها» has something to lead from.
 *
 * Two faults a type-check cannot see, one behind the other. The panel's rows
 * were not clickable at all, and the one thing on them that was — the project
 * name — called a handler the embedding screen never passed in. And the tab
 * **returned early out of the only query that fills it**, so in the embed it
 * showed the module notices alone: a list that never loads renders exactly
 * like a list with nothing in it.
 *
 * The click target is the other half: a reply must lead to the **referral**,
 * not to the reply — the feed draws no row of its own for an answer, so a
 * jump naming one would scroll to an element that is not there, and both
 * spellings compile and read perfectly.
 */
{
  const gN = globalThis as unknown as Record<string, unknown>;
  const realFetchN = gN.fetch;
  const askedN: string[] = [];

  const referralRow = {
    id: "ref-1",
    status: "در انتظار اقدام",
    actionRequired: "لطفاً دیتاشیت را بررسی کن",
    assignedByUserId: "u-1", assignedByName: "محمد مقدم",
    assignedToUserId: "u-2", assignedToName: "مهندس رضایی",
    createdAt: "2026-09-20T08:00:00.000Z",
    activityId: "act-1",
    messages: [{
      id: "msg-1", text: "بررسی شد، مشکلی ندارد",
      responderUserId: "u-2", responderName: "مهندس رضایی",
      createdAt: "2026-09-21T09:00:00.000Z",
    }],
    activity: {
      id: "act-1", text: "لطفاً دیتاشیت را بررسی کن",
      createdAt: "2026-09-20T08:00:00.000Z",
      group: {
        id: "grp-1", categoryName: "پیش‌فاکتور",
        project: { id: "proj-1", code: "ATA-05-38", name: "پتروشیمی نمونه", customer: null },
      },
    },
  };

  gN.fetch = (async (url: string) => {
    askedN.push(String(url));
    const body = String(url).includes("/api/referrals")
      ? { success: true, rows: [referralRow], total: 1, page: 1, pageSize: 200, totalPages: 1 }
      : { success: true, rows: [], unread: 0, total: 0, page: 1, pageSize: 200, totalPages: 1 };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  }) as never;

  const hostN = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const rootN = createRoot(hostN);
  const settleN = async () => {
    for (let i = 0; i < 14; i++) await act(async () => { await Promise.resolve(); });
  };
  const jumps: unknown[] = [];

  await act(async () => {
    rootN.render(React.createElement(ReferralsView, {
      embedded: true,
      notificationsOnly: true,
      settings: DEFAULT_SETTINGS as never,
      currentUser: { id: "u-1", fullName: "محمد مقدم" } as never,
      onOpenNotification: (jump: unknown) => { jumps.push(jump); },
    } as never));
  });
  await settleN();

  /*
   * The query the tab used to skip. Asserted on the URL rather than on the
   * rows, because «no rows» is what the fault looked like from the screen.
   */
  ok("the notices tab asks for the referrals behind it",
    askedN.some((u) => /\/api\/referrals\?/.test(u)));
  ok("...for both directions, since a reply either way is news to the other",
    askedN.some((u) => /\/api\/referrals\?[^"]*scope=mine/.test(u)));

  /* The group is folded until somebody opens it, exactly as the feed is. */
  const headers = Array.from(hostN.querySelectorAll<HTMLElement>("div"))
    .filter((el) => (el.textContent ?? "").includes("۱ اعلان")
      || (el.textContent ?? "").includes("1 اعلان"));
  ok("a notice group is drawn", headers.length > 0);
  await act(async () => {
    headers[headers.length - 1]?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await settleN();

  const item = hostN.querySelector<HTMLElement>("[id^='notification-item-']");
  ok("...and opens to the reply", item !== null);

  await act(async () => {
    item?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await settleN();

  ok("pressing a notice leads somewhere", jumps.length === 1);
  /*
   * The referral's own message, not the reply — and its category, or the feed
   * would open the job and leave the reader hunting for the conversation.
   */
  ok("...to the referral's message rather than the answer",
    (jumps[0] as { activityId?: string })?.activityId === "act-1");
  ok("...in the category it was raised under",
    (jumps[0] as { groupId?: string })?.groupId === "grp-1");
  ok("...in its own project",
    (jumps[0] as { projectId?: string })?.projectId === "proj-1");

  act(() => { rootN.unmount(); });
  hostN.remove();
  gN.fetch = realFetchN;
}

/**
 * A project's tab shows the job's own work, and ticks it off from there.
 *
 * Two things only a render can say. The rows are columned with the board's own
 * `taskBoardLane`, so a **next action parked until its day** belongs in «در
 * انتظار» here exactly as it does there — a comparator written for this screen
 * would type-check and read perfectly while putting it in the wrong column.
 * And the tick has to reach the server with **two keys**: a whole-record write
 * compiles just as well and silently writes the list's copy back over anything
 * changed since.
 */
{
  const gP = globalThis as unknown as Record<string, unknown>;
  const realFetchP = gP.fetch;
  const askedP: { url: string; body: unknown }[] = [];

  const reportBody = {
    success: true,
    projectId: "p-1",
    quotes: [],
    tasksWithheld: false,
    tasksTruncated: false,
    tasks: [
      {
        id: "t-open", title: "تماس با سازنده", description: "قیمت نهایی را بگیر",
        status: "برای انجام", taskKind: "GENERAL", priority: "بالا",
        dueDateJalali: "1405/07/10", createdAt: "2026-09-20T08:00:00.000Z",
        assignedToName: "مهندس رضایی", createdByName: "محمد مقدم",
        relatedToType: "project", relatedToId: "p-1", relatedToName: "پتروشیمی نمونه",
        proformaNumber: null, completionNote: null, completedAtJalali: null,
      },
      {
        // Parked until its day: the board puts this in «در انتظار مشتری», and
        // so must this screen.
        id: "t-parked", title: "پیگیری ارسال مدارک", description: null,
        status: "برای انجام", taskKind: "NEXT_ACTION", priority: "متوسط",
        dueDateJalali: "1499/01/01", createdAt: "2026-09-21T08:00:00.000Z",
        assignedToName: "محمد مقدم", createdByName: "محمد مقدم",
        relatedToType: "پروژه", relatedToId: "p-1", relatedToName: "پتروشیمی نمونه",
        proformaNumber: null, completionNote: null, completedAtJalali: null,
      },
      {
        id: "t-done", title: "ارسال نقشه‌ها", description: null,
        status: "انجام شده", taskKind: "GENERAL", priority: "متوسط",
        dueDateJalali: null, createdAt: "2026-09-10T08:00:00.000Z",
        assignedToName: "محمد مقدم", createdByName: "محمد مقدم",
        relatedToType: "project", relatedToId: "p-1", relatedToName: "پتروشیمی نمونه",
        proformaNumber: null, completionNote: "به ایمیل مشتری ارسال شد", completedAtJalali: "1405/07/01",
      },
    ],
    summary: {
      quotes: 0, chaseable: 0, settled: 0, withoutNextAction: 0, overdue: 0,
      followUps: 0, lastFollowUpDateJalali: null, lastFollowUpResult: null, openTasks: 2,
    },
  };

  gP.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    askedP.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    const body = String(url).includes("/api/sales-follow-up/project/")
      ? reportBody
      : { success: true, rows: [], total: 0, page: 1, pageSize: 50, totalPages: 1 };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  }) as never;

  const hostP = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const rootP = createRoot(hostP);
  const settleP = async () => {
    for (let i = 0; i < 14; i++) await act(async () => { await Promise.resolve(); });
  };

  await act(async () => {
    rootP.render(React.createElement(ProjectFollowUpTab, {
      projectId: "p-1",
      settings: DEFAULT_SETTINGS as never,
      currentUser: { fullName: "محمد مقدم" },
    } as never));
  });
  await settleP();

  const row = (id: string) => hostP.querySelector<HTMLElement>(`#project-task-${id}`);
  ok("the job's ordinary work is drawn on its follow-up tab", row("t-open") !== null);
  ok("...with what it is for, not only its title",
    (row("t-open")?.textContent ?? "").includes("قیمت نهایی را بگیر"));
  ok("...and who it is on",
    (row("t-open")?.textContent ?? "").includes("مهندس رضایی"));

  /*
   * The board's own column rule, on a card whose *status* says «برای انجام»
   * while its date says otherwise — which is exactly the pair a comparator
   * written here would get wrong.
   */
  ok("a next action parked until its day reads as waiting",
    (row("t-parked")?.textContent ?? "").includes(LANE_LABELS.WAITING),
    row("t-parked")?.textContent);
  /*
   * And the card beside it, whose *status* is the same word, does not — which
   * is the pair that says the column really came from `taskBoardLane` rather
   * than from the status a comparator here would have read.
   */
  ok("...while work that can be picked up now reads as to-do",
    (row("t-open")?.textContent ?? "").includes(LANE_LABELS.TODO)
    && !(row("t-open")?.textContent ?? "").includes(LANE_LABELS.WAITING));

  /* Finished work is behind one press, so the list is what is still to do. */
  ok("finished work is not drawn until it is asked for", row("t-done") === null);
  await act(async () => {
    hostP.querySelector<HTMLElement>("#project-tasks-toggle-done")
      ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await settleP();
  ok("...and is, once it is", row("t-done") !== null);
  ok("...carrying what was done", (row("t-done")?.textContent ?? "").includes("به ایمیل مشتری"));

  /* The tick: the modal opens, and the write carries two keys. */
  await act(async () => {
    hostP.querySelector<HTMLElement>("#project-task-complete-t-open")
      ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await settleP();
  const noteBox = hostP.querySelector<HTMLTextAreaElement>("#task-completion-note");
  ok("the tick opens the board's own completion modal", noteBox !== null);

  const before = askedP.length;
  await act(async () => {
    hostP.querySelector<HTMLElement>("#task-completion-confirm")
      ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await settleP();
  const write = askedP.slice(before).find((a) => /\/api\/tasks\/t-open$/.test(a.url));
  ok("...and the tick reaches the task", !!write, askedP.slice(before).map((a) => a.url));
  ok("...writing the status and the note and nothing else",
    Object.keys((write?.body ?? {}) as Record<string, unknown>).sort().join(",")
      === "completionNote,status",
    Object.keys((write?.body ?? {}) as Record<string, unknown>).sort().join(","));

  act(() => { rootP.unmount(); });
  hostP.remove();
  gP.fetch = realFetchP;
}

/*
 * The board's headline is the tick, so the record needs a door of its own.
 *
 * The screen decides what a press is *for* (`cardPressTarget`), which a rule
 * test holds; what only a render can show is that the board draws the way back
 * to the record, that it is drawn on a task and not on a referral — which has
 * no edit box here and is answered in its own thread — and that the two
 * controls really hand over different things. `onClick={() => onOpen(card)}`
 * on the pencil type-checks and reads perfectly.
 */
head("The work board: the record is one press away from the headline");
{
  const hostE = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
  const rootE = createRoot(hostE);

  const openedE: string[] = [];
  const editedE: string[] = [];

  const cardsE = [
    {
      kind: "task" as const, id: "t1", title: "ثبت سفارش خرید",
      createdAt: "2026-01-01", priority: "متوسط", status: "برای انجام",
    },
    {
      kind: "referral" as const, id: "r1", title: "لطفاً دیتاشیت را چک کن",
      createdAt: "2026-01-02", status: "در انتظار اقدام", replies: 0,
    },
  ];

  const renderE = (withEdit: boolean) => act(() => {
    rootE.render(React.createElement(WorkBoard, {
      cards: cardsE,
      sort: "date" as const,
      today: "1405/01/10",
      load: null,
      selected: new Set<string>(),
      moving: false,
      onToggleSelect: () => {},
      onMove: () => {},
      onOpen: (card: { kind: string; id: string }) => { openedE.push(`${card.kind}:${card.id}`); },
      ...(withEdit
        ? { onEdit: (card: { kind: string; id: string }) => { editedE.push(`${card.kind}:${card.id}`); } }
        : {}),
    }));
  });

  // A caller with no edit box draws no button, rather than one that does
  // nothing — the switch-that-does-nothing fault, on a control.
  renderE(false);
  ok("a board given no edit handler draws no edit button",
    !hostE.querySelector("#work-board-edit-task:t1"));

  renderE(true);
  const buttonE = (id: string) => ([...hostE.querySelectorAll("button")] as HTMLButtonElement[])
    .find((el) => el.id === id);

  ok("the task card offers the record beside its badges", !!buttonE("work-board-edit-task:t1"));
  // A referral is answered on its thread, which the headline opens; an edit
  // button there would be a control onto a form it does not have.
  ok("...and a referral card does not", !buttonE("work-board-edit-referral:r1"));

  act(() => {
    buttonE("work-board-edit-task:t1")!
      .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  ok("pressing it asks for the record", editedE.join(",") === "task:t1", editedE);
  ok("...and completes nothing", openedE.length === 0, openedE);

  act(() => {
    buttonE("work-board-open-task:t1")!
      .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  ok("the headline is still the press the screen routes", openedE.join(",") === "task:t1", openedE);
  ok("...and opens no edit box of its own", editedE.join(",") === "task:t1", editedE);

  act(() => { rootE.unmount(); });
  hostE.remove();
}

console.log(`\n${"─".repeat(56)}\n${pass} checks passed, ${fails.length} failed`);

if (fails.length) {
  console.log("Failures:");
  fails.forEach((f) => console.log("  • " + f));
  process.exitCode = 1;
}
