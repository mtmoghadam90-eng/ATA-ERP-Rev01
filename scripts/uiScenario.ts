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

import React, { useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import PriceCalculatorModal from "../src/components/PriceCalculatorModal";
import MessagingView from "../src/components/MessagingView";
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


console.log(`\n${"─".repeat(56)}\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) {
  console.log("Failures:");
  fails.forEach((f) => console.log("  • " + f));
  process.exitCode = 1;
}
