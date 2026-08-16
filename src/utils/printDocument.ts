/**
 * Turning a generated document into a PDF, in one step.
 *
 * The documents this application produces — a proforma, a packing list — are
 * built as a self-contained HTML page and then printed. What the user had to do
 * with that was download an `.html` file, find it, open it, and print it; four
 * steps to get one PDF, and the file left behind in Downloads was of no use to
 * anybody.
 *
 * This prints the same page directly. The document goes into a hidden iframe on
 * the current page and that iframe is printed, so the browser's own print
 * engine renders it — real vector text, real fonts, selectable and searchable in
 * the resulting PDF. Nothing is rasterised, which is the trap the obvious
 * alternative (html2canvas into jsPDF) falls into: it photographs the page, and
 * Persian text photographed at screen resolution is exactly the poor quality
 * this replaces.
 *
 * The one thing it cannot do is skip the browser's print dialog — no page can,
 * for good reason. What it can do is arrive there in one click, with the page
 * already laid out for A4 by the document's own `@page` rule.
 */

/** How long to let images and fonts settle before printing. */
const SETTLE_MS = 350;

/**
 * The name the browser suggests for the saved PDF.
 *
 * Chrome takes it from the **top-level** document's title, not the iframe's, so
 * every document this application printed was offered as «پنل کاری ارشیا.pdf» —
 * the application's own tab title. The title is swapped for the document's
 * number while the dialog is open and put back afterwards.
 */
function swapDocumentTitle(title: string | undefined): () => void {
  if (!title || typeof document === "undefined") return () => {};
  const previous = document.title;
  document.title = title;
  return () => { document.title = previous; };
}

/**
 * Prints a complete HTML document.
 *
 * `html` must be a whole page, with its own `<style>` — that is what these
 * documents already are, and it is why an iframe is used rather than a print
 * stylesheet on the application itself.
 */
export function printHtmlDocument(html: string, title?: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") { resolve(); return; }

    const frame = document.createElement("iframe");
    // Off-screen rather than `display: none`: a hidden iframe is not laid out
    // in some browsers, and an unlaid-out document prints blank.
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.right = "-10000px";
    frame.style.bottom = "0";
    frame.style.width = "210mm";
    frame.style.height = "297mm";
    frame.style.border = "0";
    document.body.appendChild(frame);

    let restoreTitle = () => {};
    let cleaned = false;
    /*
     * The frame and the title live until the print dialog is finished with
     * them.
     *
     * They used to be torn down a second after `print()` returned, which in
     * Chrome is while the preview is still open — and the preview reads the
     * document it is printing when the user finally clicks Save. With the frame
     * already gone, the file-name box came up **empty** and had to be typed by
     * hand. So cleanup waits for `afterprint`, with a long fallback for the
     * browsers that never fire it.
     */
    const cleanUp = () => {
      if (cleaned) return;
      cleaned = true;
      frame.remove();
      restoreTitle();
    };
    const done = () => {
      window.addEventListener("afterprint", cleanUp, { once: true });
      frame.contentWindow?.addEventListener("afterprint", cleanUp, { once: true });
      // Nothing may keep an invisible iframe on the page for ever.
      setTimeout(cleanUp, 5 * 60 * 1000);
      resolve();
    };

    const doc = frame.contentDocument;
    if (!doc) { frame.remove(); resolve(); return; }

    /*
     * The document carries a `window.onload -> print()` script of its own, for
     * when it is opened as a standalone file. Inside the iframe that would fire
     * as well and the user would face two print dialogs, so it is taken out.
     */
    doc.open();
    doc.write(html.replace(/<script>[\s\S]*?window\.print\(\)[\s\S]*?<\/script>/gi, ""));
    doc.close();

    let printed = false;
    const go = () => {
      if (printed) return;
      printed = true;
      try {
        const win = frame.contentWindow;
        if (!win) { done(); return; }
        if (title) {
          try { win.document.title = title; } catch { /* same-origin only */ }
          restoreTitle = swapDocumentTitle(title);
        }
        win.focus();
        win.print();
      } catch {
        /* A refused print is the browser's decision, not an error to report. */
      }
      done();
    };

    // Whichever comes first: the load event, or the fallback for the browsers
    // where a document written with document.write never fires one. `printed`
    // makes sure only one of them acts.
    if (frame.contentWindow?.document.readyState === "complete") {
      setTimeout(go, SETTLE_MS);
    } else {
      frame.onload = () => setTimeout(go, SETTLE_MS);
      // A document written with document.write does not always fire onload.
      setTimeout(go, SETTLE_MS + 900);
    }
  });
}
