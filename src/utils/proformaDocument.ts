import type { Customer, Product, Proforma, ProformaTemplate } from "../types";
import { formatMoney } from "../numUtils";
import { escapeHtml, renderRichText } from "./richText";
import { familyNameOnly } from "./customerLabel";

/**
 * The proforma, as a standalone A4 document.
 *
 * Extracted from `ProformasView` for one reason: a printed document can only be
 * judged by printing it. It was six hundred lines of template literal inside a
 * component that needs a browser, a session and a database to render at all, so
 * the only way to look at the result was to open the application and press the
 * button — which is how an eight-item proforma came to print its first page
 * empty and start the goods on the second without anyone catching it before a
 * customer did. As a pure function of its inputs it can be rendered to a real
 * PDF by a real browser in a script, and looked at.
 *
 * ## Multi-page rules this document has to obey
 *
 * A proforma here routinely runs to several sheets, and three things decide
 * whether those sheets read as one document:
 *
 *  - **The letterhead repeats on every page.** It is the `<thead>` of an outer
 *    layout table, which is the one mechanism a browser implements natively for
 *    this: 'display: table-header-group' is drawn again at the top of each
 *    fragment *and* the space for it is reserved, which a 'position: fixed'
 *    banner does not do — that paints over the second page's content instead.
 *
 *  - **The goods table flows across pages, and a row never splits.** The table
 *    used to sit in a container marked 'break-inside: avoid', so the browser
 *    was being told to keep the entire list of items on one sheet. Eight rows
 *    do not fit on one sheet, so the whole block was pushed to the next page
 *    and page one printed with no goods on it at all. The avoidance belongs on
 *    the a <tr> — one product's box, its photograph and its specification stay
 *    together, and the next row starts where it fits.
 *
 *  - **Nothing that must stay whole is wider than a page.** The totals panel,
 *    the terms and the signature block each carry 'break-inside: avoid', which
 *    is only safe because each is short; a block taller than the printable area
 *    with that rule on it reproduces the empty-first-page bug exactly.
 *
 * Everything is inline `<style>` and inline attributes because the file has to
 * stand alone: `printHtmlDocument` writes it into an iframe, and
 * `inlineDocumentAssets` turns its `/uploads/…` paths into data URIs, so the
 * document carries its own fonts, images and rules wherever it is opened.
 */

export interface ProformaDocumentInput {
  proforma: Proforma;
  template: ProformaTemplate;
  /** The buying company, for the honorific and the buyer block. */
  customer?: Customer;
  /** The named contact, when the document has one. */
  contactRecord?: Customer;
  /**
   * Who issued it — their name and signature go on the seal.
   *
   * Deliberately not `User`: the document needs a name and an image, and the
   * screen has only the directory projection (no username, no permissions),
   * which is all a printed signature block has any business seeing.
   */
  creator?: { fullName: string; signatureImage?: string | null } | null;
  /** The catalogue, for a line's photograph and unit when the line omits them. */
  products: Product[];
  /** Whether a line prints its brand beside the product name. */
  showBrand: boolean;
}

/**
 * Builds the document. Pure: no fetching, no `/uploads` resolution — the caller
 * passes that through `inlineDocumentAssets`.
 */
export function renderProformaDocument(input: ProformaDocumentInput): string {
  const {
    proforma: pf, template, customer: customerObj, contactRecord, creator: creatorUser,
    products, showBrand: overrideShowBrand,
  } = input;

  // The document addresses the contact by family name only — see familyNameOnly.
  const contactFamilyName =
    familyNameOnly(pf.contactName, contactRecord?.lastName)
    || familyNameOnly(customerObj?.contactName, customerObj?.contactLastName);
  const targetCurrency = pf.currency || "ریال";
  // The document no longer prints an exchange rate or a rial equivalent, so
  // nothing here needs today's rate — see the totals panel below.
  /*
   * The price columns are as wide as the longest amount on the document.
   *
   * Sized by eye, they were fine for a figure in a foreign currency — 1,620 —
   * and wrong for the same document priced in rials, where 1,250,000,000 is
   * thirteen characters and broke over two lines inside a fixed column. An
   * amount split across two lines stops being a number you can read at a
   * glance, so the column is measured from the longest figure instead.
   *
   * Monospace, so this is arithmetic rather than measurement: a character is
   * 0.6 of the font size. Past ten characters the figure is set a size
   * smaller rather than the column growing further — widening it enough for
   * twelve digits would take the width straight back off the specification,
   * which is the column that needs it.
   */
  const amountChars = Math.max(
    6,
    ...pf.items.flatMap((i) => [
      formatMoney(i.unitPriceRIYAL).length,
      formatMoney(i.totalPriceRIYAL).length,
    ]),
  );
  const priceFontPx = amountChars <= 10 ? 12 : amountChars <= 13 ? 11 : 10;
  // The floor is what gives the money columns their presence: a short figure
  // in a hairline column next to a very wide specification looked lopsided,
  // so they keep a decent width even when the amount does not need it.
  const priceColWidth = Math.min(
    128,
    Math.max(96, Math.round(amountChars * priceFontPx * 0.6) + 18),
  );

  const itemsRows = pf.items
    .map((item, index) => {
      const prod = products.find((p) => p.id === item.productId);
      const imgToRender =
        item.selectedImage && item.selectedImage !== "none"
          ? item.selectedImage
          : item.selectedImage !== "none" &&
              prod?.images &&
              prod.images.length > 0
            ? prod.images[0]
            : undefined;
      return `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 10px; text-align: center; font-family: monospace; vertical-align: middle;">${index + 1}</td>
      <!-- The picture has a column of its own, and the name heads the
           specification it belongs to — the same shape as the preview on
           screen. Side by side, the name crowded a 48px thumbnail and the
           specs read as though they belonged to nothing. -->
      <td style="padding: 10px; text-align: center; vertical-align: middle;">
        ${
          imgToRender
            ? `<img src="${imgToRender}" alt="${item.productName}" style="width: 92px; height: 92px; object-fit: contain; border-radius: 8px; border: 1px solid #e2e8f0; background-color: #ffffff;" referrerPolicy="no-referrer" />`
            : `<div style="width: 92px; height: 92px; border: 1px dashed #e2e8f0; border-radius: 8px; background-color: #f8fafc; color: #94a3b8; font-size: 10px; display: flex; align-items: center; justify-content: center; margin: 0 auto;">بدون تصویر</div>`
        }
      </td>
      <!-- The specification is the one column that stays top-aligned: it is a
           block of text, and centring it against a short neighbour would
           leave the product name floating in the middle of the row. -->
      <td style="padding: 10px; vertical-align: top;">
        <!-- Left-aligned, like the specification beneath it: the names are
             Latin product names, and hanging them off the right-hand edge of
             an RTL cell put them at the opposite side of the text they
             belong to. -->
        <div style="font-weight: bold; color: #1e293b; padding-bottom: 6px; margin-bottom: 6px; border-bottom: 1px solid #f1f5f9; text-align: left; direction: ltr;">
          ${item.productName}${overrideShowBrand && item.brand ? ` <span style="color: #4f46e5; font-size: 11px;">(${item.brand})</span>` : ""}${item.tagNumber ? ` <span style="font-family: monospace; font-size: 10px; color: #dc2626; background-color: #fef2f2; border: 1px solid #fee2e2; padding: 1px 5px; border-radius: 4px;">تگ: ${item.tagNumber}</span>` : ""}
        </div>
        <!-- On one line on purpose: 'white-space: pre-line' keeps newlines, so
             a line break between the tag and the value printed a blank line
             above every specification and left the name floating. -->
        <div style="font-size: 11px; color: #475569; white-space: pre-line; line-height: 1.5; text-align: left; direction: ltr;">${item.techSpecs ? renderRichText(item.techSpecs) : "-"}</div>
      </td>
      <td style="padding: 10px; text-align: center; font-family: monospace; vertical-align: middle;">${item.quantity}</td>
      <td style="padding: 10px; text-align: center; vertical-align: middle;">${item.unit || prod?.unit || "عدد"}</td>
      ${
        pf.proformaType !== "TECHNICAL"
          ? `
      <!-- Bold: the figures are what the reader is looking for, and beside a
           block of specifications they were the lightest thing on the row. -->
      <td style="padding: 10px 6px; text-align: left; font-family: monospace; font-size: ${priceFontPx}px; font-weight: bold; color: #0f172a; vertical-align: middle; white-space: nowrap;">${formatMoney(item.unitPriceRIYAL)}</td>
      <td style="padding: 10px 6px; text-align: left; font-family: monospace; font-size: ${priceFontPx}px; font-weight: bold; color: #0f172a; vertical-align: middle; white-space: nowrap;">${formatMoney(item.totalPriceRIYAL)}</td>
      `
          : ""
      }
    </tr>
    `;
    })
    .join("");
  /*
   * The address bar, defined once and placed twice — on purpose.
   *
   * The copy inside the frame table's <tfoot> is what *reserves* the strip at
   * the foot of every page; the copy after the table is what *paints* it. A
   * repeated footer group alone puts the bar immediately under the content on
   * the final sheet, which on a page carrying only the signature leaves it
   * floating in the middle of the paper; a fixed bar alone sits at the bottom
   * of every page and reserves room on none, which is what used to let the last
   * row of goods print underneath it. One measures, the other draws.
   */
  const footerBar = `
      <div class="print-footer">
          <div class="print-footer-info">
              <div><strong>آدرس شرکت:</strong> ${template.address || "-"}</div>
              <div><strong>تلفن تماس:</strong> ${template.phone || "-"}</div>
              <div><strong>پست الکترونیکی:</strong> ${template.email || "-"}</div>
              ${template.website
                ? `<div class="print-footer-site">${escapeHtml(template.website)}</div>`
                : ""}
          </div>
      </div>`;

  const htmlContent = `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>پیش‌فاکتور ${pf.proformaNumber}</title>
  <style>
      @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;700&display=swap');
      body {
          font-family: 'Vazirmatn', Tahoma, sans-serif;
          background-color: #f8fafc;
          color: #1e293b;
          margin: 0;
          padding: 40px;
          direction: rtl;
      }
      /*
       * The whole document is one layout table, and that is load-bearing.
       *
       * Its <thead> is the letterhead and its <tfoot> the address bar, because
       * 'display: table-header-group' / 'table-footer-group' is the one
       * mechanism a browser implements for "repeat this on every printed page"
       * — and, unlike a 'position: fixed' banner, it *reserves* the space on
       * every page instead of painting over the content there. The fixed footer
       * this replaces was doing exactly that: on a two-page proforma the last
       * row of goods ran underneath it.
       */
      .doc-frame {
          width: 100%;
          max-width: 900px;
          margin: 0 auto;
          border-collapse: collapse;
          background-color: #ffffff;
          border-radius: 12px;
          box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
      }
      .doc-frame > thead > tr > td,
      .doc-frame > tbody > tr > td,
      .doc-frame > tfoot > tr > td {
          padding: 0 40px;
          vertical-align: top;
      }
      .doc-frame > thead > tr > td { padding-top: 40px; }
      .doc-frame > tfoot > tr > td { padding: 10px 40px 40px; }
      /* The repeated groups are drawn again on each page; a break inside one
         would tear the letterhead in half. */
      .doc-frame > thead,
      .doc-frame > tfoot {
          page-break-inside: avoid;
          break-inside: avoid;
      }
      .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 2px solid ${template.titleColor};
          padding-bottom: 20px;
          /* Repeated on every page, so every point here is a point off every
             sheet. Twelve reads the same as twenty under a rule that already
             has twenty above it. */
          margin-bottom: 12px;
      }
      .logo-box {
          display: flex;
          align-items: center;
          gap: 12px;
      }
      .logo {
          width: 48px;
          height: 48px;
          background-color: #0ea5e9;
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 20px;
          border-radius: 8px;
      }
      .company-name {
          font-weight: bold;
          font-size: 16px;
          color: #1e293b;
          margin: 0;
      }
      .subtitle {
          font-size: 11px;
          color: #94a3b8;
          margin: 0;
      }
      .title-box {
          text-align: center;
      }
      .title {
          font-size: 22px;
          font-weight: 800;
          color: ${template.titleColor};
          margin: 0;
      }
      .doc-specs {
          font-size: 13px;
          color: #475569;
          text-align: left;
      }
      .specs-item {
          margin-bottom: 4px;
      }
      .specs-label {
          font-weight: bold;
          color: #0f172a;
      }
      .section-card {
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 10px 12px;
          background-color: #f8fafc;
          page-break-inside: avoid;
          break-inside: avoid;
      }
      .section-title {
          font-weight: bold;
          font-size: 12px;
          color: #334155;
          padding-bottom: 6px;
          border-bottom: 1px dashed #cbd5e1;
          margin-top: 0;
          margin-bottom: 10px;
      }
      .details-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          margin-bottom: 14px;
          page-break-inside: avoid;
          break-inside: avoid;
      }
      .grid-compact {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 6px 10px;
          font-size: 11px;
          line-height: 1.5;
      }
      .full-width {
          grid-column: span 2;
      }
      /*
       * The goods table flows across pages, and this box must let it.
       *
       * It used to carry 'break-inside: avoid' and 'overflow: hidden', which
       * together told the browser to keep the *entire* list of items on one
       * sheet. Eight rows do not fit on one sheet, so the whole block was moved
       * to the next page and page one printed with a letterhead, a buyer panel
       * and no goods at all — which is exactly how it was reported. Keeping a
       * row whole is the a <tr>'s job, below; keeping the table whole was never
       * anybody's.
       */
      /*
       * The border belongs to the table, not to a box around it.
       *
       * A bordered wrapper around a table that splits leaves an empty outlined
       * rectangle at the foot of the page — the part of the box the rows that
       * moved on would have filled. On the table itself the browser closes the
       * frame at each break, so the goods read as a complete panel on every
       * sheet.
       */
      .table-container {
          margin-bottom: 10px;
      }
      .table-container > table {
          border: 1px solid #e2e8f0;
      }
      table {
          width: 100%;
          border-collapse: collapse;
          text-align: right;
          font-size: 12px;
          page-break-inside: auto;
      }
      thead {
          display: table-header-group;
      }
      /*
       * A product's whole box stays together — its number, its photograph, its
       * name and every line of its specification — and the next one starts
       * where it fits. That is what "avoid" means on a row and it is the
       * correct place for it.
       *
       * Scoped to the goods table on purpose. The document frame's own rows are
       * a <tr>s too, and an unbreakable row there would mean the entire body of
       * the document had to fit on one page — the same fault as before, moved
       * one level out and made worse.
       */
      .table-container tr {
          page-break-inside: avoid;
          break-inside: avoid;
          page-break-after: auto;
      }
      .doc-frame > tbody > tr,
      .doc-frame > tbody > tr > td {
          page-break-inside: auto;
          break-inside: auto;
      }
      /* A column width means the whole column.
         With the default content-box sizing every one of these cells came out
         20px wider than asked for — its padding — and six columns quietly
         took 120px off the specification column. */
      th, td {
          box-sizing: border-box;
      }
      th {
          background-color: #f1f5f9;
          color: #475569;
          font-weight: bold;
          padding: 10px 6px;
          border-bottom: 1px solid #e2e8f0;
          /* Headings are centred over their column — the values below keep
             their own alignment (figures left, text right). */
          text-align: center;
      }
      /*
       * No 'break-inside: avoid' here, deliberately.
       *
       * This grid holds the terms — free text of no fixed length — beside the
       * totals. A block that must not break and is taller than the printable
       * area reproduces the empty-page bug above precisely, and the terms are
       * the one part of this document a user can make arbitrarily long. The
       * totals panel keeps its own avoidance because it is six short rows.
       */
      .financial-grid {
          display: grid;
          grid-template-columns: 1.2fr 0.8fr;
          gap: 14px;
          /* Was 20px of plain air between the totals and the seal below them,
             which is most of what used to push the seal onto a sheet of its
             own. */
          margin-bottom: 2px;
      }
      /* Same reason as the grid around it: the terms have no fixed length. */
      .notes-card {
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 12px;
          background-color: #f8fafc;
          font-size: 12px;
          color: #475569;
      }
      .totals-card {
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 10px 12px;
          background-color: #f8fafc;
          font-size: 12px;
          page-break-inside: avoid;
          break-inside: avoid;
      }
      /* An amount stays on one line here too; the label beside it gives way
         instead, which costs nothing. */
      .totals-row strong,
      .totals-row .final-amount-value {
          white-space: nowrap;
      }
      .totals-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          padding: 3px 0;
          border-bottom: 1px solid #e2e8f0;
      }
      .totals-row:last-child {
          border-bottom: none;
      }
      .final-amount {
          font-weight: bold;
          font-size: 14px;
          color: ${template.titleColor};
          border-top: 2px solid #e2e8f0;
          padding-top: 8px;
          margin-top: 4px;
      }
      /*
       * The seal and signature, kept small on purpose — and now in one place.
       *
       * Every dimension here used to be an inline style, written out twice: once
       * for a template with a company seal and once for a template without. Two
       * copies of a height is how a block comes to be a different size depending
       * on a setting nobody connected to it, and it is why the sizes below could
       * not be tuned without editing four places.
       *
       * The sizes themselves are the answer to a specific fault. A proforma with
       * a single item once printed on two pages with nothing on the second but
       * this block; more recently a three-item and an eight-item document each
       * ended with a sheet carrying the seal and nothing else, because the block
       * stood about 48pt tall and the space left under the totals was 36. It is
       * now short enough to land on the page its document ends on — verified by
       * printing eleven documents of different lengths and looking at the last
       * page of each.
       */
      .signatures {
          display: flex;
          justify-content: flex-end;
          margin-top: 0;
          text-align: center;
          page-break-inside: avoid;
          break-inside: avoid;
          /*
           * And never alone at the top of a sheet.
           *
           * Shrinking the block buys room but cannot win the argument: whatever
           * height it is, some document ends a point short and the seal goes
           * over on its own — which is a page carrying a stamp and nothing
           * else. This asks the browser to keep it with what comes before it,
           * so the last sheet is the totals, the terms and the seal together.
           * It is a preference, not a demand: when the block before it genuinely
           * cannot move, the break happens anyway, which is what stops this from
           * becoming the "must not break, taller than a page" trap that emptied
           * page one.
           */
          page-break-before: avoid;
          break-before: avoid;
      }
      .signature-box {
          width: 178px;
          border: 1px solid #f1f5f9;
          border-radius: 8px;
          padding: 2px 6px;
          background-color: #fafafa;
          page-break-inside: avoid;
          break-inside: avoid;
      }
      .signature-name {
          font-weight: bold;
          font-size: 9px;
          color: #334155;
          margin-bottom: 2px;
      }
      /* The strip holding the signature, and the seal beside it when the
         template carries one. */
      .seal-panel {
          display: flex;
          justify-content: space-evenly;
          align-items: center;
          gap: 4px;
          height: 24px;
          background-color: #ffffff;
          border-radius: 6px;
          border: 1px dashed #cbd5e1;
          padding: 2px;
      }
      .seal-cell {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          flex: 1;
      }
      /* The rule between the two, on the side that separates them in RTL. */
      .seal-cell + .seal-cell {
          border-right: 1px solid #f1f5f9;
          padding-right: 6px;
      }
      .seal-label {
          font-size: 6px;
          color: #94a3b8;
          font-weight: bold;
      }
      .seal-img {
          max-height: 20px;
          max-width: 62px;
          object-fit: contain;
      }
      .seal-img-stamp {
          max-width: 56px;
          transform: rotate(-3deg);
      }
      /* Alone in the strip, the signature has the whole width to itself. */
      .seal-panel-single .seal-img {
          max-height: 22px;
          max-width: 130px;
      }
      .seal-missing {
          font-size: 9px;
          color: #cbd5e1;
          font-weight: bold;
      }
      .buyer-horizontal-row {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          align-items: center;
          gap: 10px 15px;
          font-size: 11px;
          line-height: 1.5;
      }
      .buyer-horizontal-row > div {
          flex: 1;
          min-width: 140px;
      }
      /*
       * The address bar at the foot of every page.
       *
       * It used to be 'position: fixed', which does repeat it on each sheet and
       * reserves room for it on none — so the goods ran underneath it. It is
       * the frame table's <tfoot> now: the browser repeats it and leaves the
       * space, which is the whole difference.
       */
      .print-footer {
          background-color: #ffffff;
          border-top: 1px solid #cbd5e1;
          /*
           * No margin, and six pixels of slack at the bottom.
           *
           * A repeated footer group is given very slightly less room than it
           * occupies, and whatever does not fit is painted at the top of the
           * *next* sheet, above the letterhead — a sliver of the address line
           * appeared there on every page but the first. A margin makes it
           * worse; bottom padding keeps the ink clear of the edge so the slice
           * that spills is blank. Six is what a sweep of twenty page shapes
           * needed; zero failed eleven of them.
           */
          padding: 8px 0 6px;
          font-size: 10px;
          color: #64748b;
          display: flex;
          justify-content: space-between;
          align-items: center;
      }
      /*
       * The website, printed in bold beside the rest of the bar.
       *
       * Latin text inside an RTL line, so it carries its own direction: without
       * it a trailing dot or a path segment is reordered and the address is
       * printed wrong on a document that goes to a customer.
       */
      .print-footer-site {
          font-weight: 700;
          color: #334155;
          direction: ltr;
          unicode-bidi: isolate;
      }
      .print-footer-info {
          display: flex;
          gap: 20px;
          align-items: center;
          flex-wrap: wrap;
      }
      /* On screen the table's own copy is the visible one. */
      .print-footer-painted {
          display: none;
      }
      /*
       * «صفحه ۲ از ۳», printed in the page margin.
       *
       * Every sheet used to print "صفحه 1" — twice wrong. A page counter
       * reset sat in both the @page rule and the print body rule, and @page
       * applies to *each* page, so it was set back to one before every sheet
       * was numbered; and a counter read from a position-fixed element is 0
       * in Chromium regardless, because the element is painted once and
       * repeated rather than laid out per page. The number belongs in the
       * page's own margin box, which is the one place the browser resolves
       * counter(page) and counter(pages) per sheet.
       */
      /*
       * A real A4 page, with the margins the document wants.
       *
       * There was no size and no margin here, so every print used whatever
       * the browser felt like — which is where "the PDF quality is bad" came
       * from: default margins, the browser's own URL-and-date header across
       * the top, and page breaks landing in the middle of table rows.
       */
      @page {
          size: A4;
          margin: 12mm 10mm 16mm 10mm;
          @bottom-center {
              content: "صفحه " counter(page) " از " counter(pages);
              font-family: 'Vazirmatn', Tahoma, sans-serif;
              font-size: 9pt;
              color: #64748b;
          }
      }
      @media print {
          body {
              background-color: #ffffff;
              padding: 0;
              /* Without this the browser drops every background colour and
                 the document prints as grey text on white. */
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
          }
          .doc-frame {
              max-width: none;
              box-shadow: none;
              border-radius: 0;
          }
          /* The 40px card padding is the screen's; on paper the @page margin
             is what holds the document off the edge. */
          .doc-frame > thead > tr > td,
          .doc-frame > tbody > tr > td {
              padding: 0;
          }
          .doc-frame > tfoot > tr > td {
              padding: 10px 0 0;
          }
          /* A product row, a signature block or a totals panel split across two
             pages reads as a mistake. Each is short; nothing of unbounded
             length is in this list. */
          .table-container tr, .signature-box, .totals-card, .terms-box {
              page-break-inside: avoid;
              break-inside: avoid;
          }
          .doc-frame > tbody > tr,
          .doc-frame > tbody > tr > td {
              page-break-inside: auto;
              break-inside: auto;
          }
          /* What makes the letterhead and the address bar repeat on every page. */
          thead {
              display: table-header-group;
          }
          tfoot {
              display: table-footer-group;
          }
          /* The footer group keeps its size — that is the reservation — and
             gives up its ink to the fixed copy, which reaches the bottom of the
             last sheet as well as of the full ones. */
          .doc-frame > tfoot .print-footer {
              visibility: hidden;
          }
          .print-footer-painted {
              display: block;
              position: fixed;
              bottom: 0;
              left: 0;
              right: 0;
              background-color: #ffffff;
          }
          img {
              max-width: 100% !important;
          }
      }
  </style>
</head>
<body>
  <!--
      One layout table wraps the whole document.

      The letterhead is its <thead> and the address bar its <tfoot>, which
      is what makes both repeat on every printed sheet — and, unlike a
      fixed banner, reserves the room for them there. Everything else is
      one <tbody> cell, deliberately breakable, so the goods flow onto as
      many pages as they need.
  -->
  <table class="doc-frame">
      <thead>
          <tr><td>
              <!-- Header -->
              <div class="header">
                  <div class="logo-box">
                      ${
                        template.showLogo
                          ? `
                      ${
                        template.logoUrl
                          ? `
                          <img src="${template.logoUrl}" alt="${template.companyName}" style="width: 48px; height: 48px; object-fit: contain; border-radius: 8px; border: 1px solid #cbd5e1; background-color: #ffffff;" referrerPolicy="no-referrer" />
                      `
                          : `
                          <div class="logo">ATA</div>
                      `
                      }
                      <div>
                          <h4 class="company-name">${template.companyName}</h4>
                          <p class="subtitle">تامین تجهیزات اتوماسیون و ابزاردقیق</p>
                      </div>
                      `
                          : ""
                      }
                  </div>
                  <div class="title-box">
                      <h1 class="title">${(template.documentTitle || "").replace("رسمی", "").trim()}</h1>
                  </div>
                  <div class="doc-specs">
                      <div class="specs-item"><span class="specs-label">شماره پیش‌فاکتور:</span> ${pf.proformaNumber}</div>
                      <div class="specs-item"><span class="specs-label">تاریخ صدور:</span> ${pf.issueDate}</div>
                      <div class="specs-item"><span class="specs-label">تاریخ اعتبار:</span> ${pf.expiryDate}</div>
                  </div>
              </div>
          </td></tr>
      </thead>
      <tfoot>
          <tr><td>
          <!-- Reserves the strip at the foot of every page. Its ink is
               hidden when printing; the copy below the table draws it. -->
          ${footerBar}
          </td></tr>
      </tfoot>
      <tbody>
          <tr><td>
              <!-- Buyer details horizontally in a single row -->
              <div class="section-card" style="margin-bottom: 14px;">
                  <h4 class="section-title">مشخصات خریدار</h4>
                  <div class="buyer-horizontal-row">
                      <div><span style="color: #64748b;">نام خریدار / شرکت:</span> <strong>${customerObj?.customerType === "حقیقی" && pf.contactPrefix ? pf.contactPrefix + " " : ""}${pf.customerName}</strong></div>
                      <div><span style="color: #64748b;">مخاطب:</span> ${customerObj?.customerType === "حقوقی" && pf.contactPrefix ? pf.contactPrefix + " " : ""}${contactFamilyName || "نماینده خریدار"}</div>
                  </div>
              </div>
              <!-- Items Table -->
              <div class="table-container">
                  <!--
                      The specification column is the widest one, deliberately.
                      It holds the product name and a dozen lines of technical
                      detail, while every other column holds a short known value —
                      but the row number, the photograph and the two price columns
                      were sized generously and the text got whatever was left, so
                      a specification line wrapped two or three times beside half
                      empty neighbours. A fixed table layout makes these widths the
                      real ones rather than suggestions.
                  -->
                  <table style="table-layout: fixed;">
                      <thead>
                          <tr>
                              <th style="width: 34px;">ردیف</th>
                              <th style="width: 118px;">تصویر کالا</th>
                              <th>نوع کالا و مشخصات فنی</th>
                              <th style="width: 52px;">تعداد</th>
                              <th style="width: 56px;">واحد</th>
                              ${
                                pf.proformaType !== "TECHNICAL"
                                  ? `
                              <th style="width: ${priceColWidth}px;">بهای واحد (${targetCurrency})</th>
                              <th style="width: ${priceColWidth}px;">بهای کل (${targetCurrency})</th>
                              `
                                  : ""
                              }
                          </tr>
                      </thead>
                      <tbody>
                          ${itemsRows}
                      </tbody>
                  </table>
              </div>
              <!-- Financial Calculations -->
              <div class="${pf.proformaType === "TECHNICAL" ? "" : "financial-grid"}">
                  <div class="notes-card" style="${pf.proformaType === "TECHNICAL" ? "width: 100%;" : ""}">
                      <div style="font-weight: bold; color: #334155; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">توضیحات و شرایط فروش</div>
                      <div style="white-space: pre-line; line-height: 1.6; font-size: 12px;">${renderRichText(pf.notes)}</div>
                  </div>
                  ${
                    pf.proformaType !== "TECHNICAL"
                      ? `
                  <div class="totals-card">
                      <div class="totals-row">
                          <span style="color: #64748b;">جمع ناخالص ردیف‌ها:</span>
                          <strong style="font-family: monospace;">${formatMoney(pf.totalAmount)} ${targetCurrency}</strong>
                      </div>
                      <div class="totals-row">
                          <span style="color: #64748b;">تخفیف کلی (${pf.discountPercent}%):</span>
                          <strong style="font-family: monospace; color: #dc2626;">-${formatMoney(pf.discountAmount)} ${targetCurrency}</strong>
                      </div>
                      <div class="totals-row">
                          <span style="color: #64748b;">مالیات بر ارزش افزوده (${pf.taxPercent}%):</span>
                          <strong style="font-family: monospace;">+${formatMoney(pf.taxAmount)} ${targetCurrency}</strong>
                      </div>
                      <div class="totals-row final-amount">
                          <span>مبلغ قابل پرداخت نهایی:</span>
                          <span class="final-amount-value" style="font-family: monospace; font-weight: bold;">${formatMoney(pf.finalAmount)} ${targetCurrency}</span>
                      </div>
                      <!--
                          No exchange rate and no rial equivalent.

                          They were printed under the total, and on a document quoted
                          in a foreign currency that reads as a second price: the rate
                          is the one of the day the document was produced, the invoice
                          will settle at the rate of the day the money moves, and a
                          customer comparing the two numbers is being confused by us.
                          The payment terms already say which rate governs.
                      -->
                  </div>
                  `
                      : ""
                  }
              </div>
              <!-- Signatures -->
              ${
                template.showSignatures
                  ? `
              <div class="signatures">
                  <div class="signature-box">
                      <div class="signature-name">${creatorUser ? creatorUser.fullName : template.signatureLabel1}</div>
                      <!-- One strip, one set of dimensions. With a company seal
                           it holds two cells; without, the signature has it to
                           itself — the difference is a class, not a second copy
                           of the block. -->
                      <div class="seal-panel${template.companySealUrl ? "" : " seal-panel-single"}">
                          <div class="seal-cell">
                              <span class="seal-label">امضای صادرکننده</span>
                              ${
                                creatorUser && creatorUser.signatureImage
                                  ? `<img class="seal-img" src="${creatorUser.signatureImage}" alt="Signature" referrerPolicy="no-referrer" />`
                                  : `<span class="seal-missing">فاقد امضا</span>`
                              }
                          </div>
                          ${
                            template.companySealUrl
                              ? `
                          <div class="seal-cell">
                              <span class="seal-label">مهر شرکت</span>
                              <img class="seal-img seal-img-stamp" src="${template.companySealUrl}" alt="Company Seal" referrerPolicy="no-referrer" />
                          </div>
                          `
                              : ""
                          }
                      </div>
                  </div>
              </div>
              `
                  : ""
              }
          </td></tr>
      </tbody>
  </table>
  <!-- Draws the address bar at the foot of every printed page. Hidden on
       screen, where the copy inside the table is the visible one. -->
  <div class="print-footer-painted">${footerBar}</div>
  <!-- Auto Print Script -->
  <script>
      window.onload = function() {
          setTimeout(function() {
              window.print();
          }, 300);
      };
  </script>
</body>
</html>
  `;
  return htmlContent;
}
