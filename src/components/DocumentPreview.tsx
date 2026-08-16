import { useEffect, useRef, useState } from "react";

/**
 * A document, previewed as exactly the thing that will be printed.
 *
 * Every module used to draw its preview twice: once as the standalone HTML that
 * `printHtmlDocument` prints, and once again as React markup inside a modal —
 * several hundred lines each, saying roughly the same thing. "Roughly" is the
 * problem. Every change to a document had to be made in both, and when it was
 * not, the screen and the PDF disagreed: different column widths, a signature
 * block of a different size, an amount in Persian digits on one and Latin on
 * the other. The printed file was right and the preview was a rumour about it.
 *
 * So the preview *is* the document: the same HTML string, in an iframe. There
 * is nothing left to keep in step.
 *
 * The page is written at its true width (A4 less its margins) and scaled down
 * to whatever the panel gives it, so what is on screen is the printed layout
 * rather than a reflowed one — a narrow window shows a smaller page, never a
 * different page.
 */

/** A4 (210mm) less the 10mm side margins the documents set, at 96dpi. */
const PAGE_WIDTH_PX = Math.round(((210 - 20) / 25.4) * 96);

/**
 * The screen rules the printer would have applied.
 *
 * These documents style themselves for paper inside `@media print` — no page
 * padding, no card shadow — and for a browser window outside it. Shown as a
 * preview the second set applies, which puts a grey border and a drop shadow
 * around a page that will have neither. This is the print half, restated for
 * the screen; nothing about the document's own layout is touched.
 */
const PREVIEW_STYLE = `<style>
  @media screen {
    body { background-color: #ffffff !important; padding: 0 !important; }
    .container { box-shadow: none !important; padding: 0 !important; }
  }
</style>`;

/** Puts those rules last, so they win over the document's own. */
function asPreview(html: string): string {
  if (!html) return html;
  const at = html.indexOf("</head>");
  return at < 0
    ? html + PREVIEW_STYLE
    : html.slice(0, at) + PREVIEW_STYLE + html.slice(at);
}

export function DocumentPreview({ html }: { html: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(600);
  const [scale, setScale] = useState(1);

  // The page keeps its width; the panel decides how much it is shrunk by.
  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const fit = () => {
      const available = element.clientWidth;
      setScale(available > 0 ? Math.min(1, available / PAGE_WIDTH_PX) : 1);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Grow to the document rather than scrolling inside a box: the surrounding
  // modal already scrolls, and a second scrollbar inside a sheet of paper reads
  // as a bug.
  useEffect(() => {
    if (!html) return;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const doc = frame.current?.contentDocument;
      const body = doc?.body;
      if (!body) return;
      const measured = Math.max(
        body.scrollHeight,
        doc?.documentElement?.scrollHeight ?? 0,
      );
      if (measured > 0) setHeight(measured);
    };
    // Three passes: the document itself, then once its images have decoded,
    // then a late one for a webfont that changed the line count.
    const timers = [50, 400, 1200].map((ms) => window.setTimeout(measure, ms));
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [html]);

  return (
    <div ref={holder} className="w-full overflow-hidden" dir="rtl">
      {html ? (
        <div style={{ height: height * scale }}>
          <iframe
            ref={frame}
            title="پیش‌نمایش سند"
            srcDoc={asPreview(html)}
            // Nothing in these documents needs to reach out: they are already
            // self-contained, with their images inlined as data URIs.
            sandbox="allow-same-origin"
            scrolling="no"
            style={{
              width: PAGE_WIDTH_PX,
              height,
              border: 0,
              transform: `scale(${scale})`,
              transformOrigin: "top right",
              backgroundColor: "#ffffff",
            }}
          />
        </div>
      ) : (
        <div className="flex items-center justify-center h-64 text-xs text-slate-400">
          در حال آماده‌سازی پیش‌نمایش سند…
        </div>
      )}
    </div>
  );
}
