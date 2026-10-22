/**
 * The typeface a printed document carries, served by this application.
 *
 * The proforma, the meeting minutes and the project's document preview each
 * imported Vazirmatn from fonts.googleapis.com — a request the *browser* makes
 * while printing. On a network that cannot reach Google (an internal-only
 * internet, a filtered line) it silently fell back to Tahoma, and a document
 * proofed in one typeface paginated in another: different line heights,
 * different page breaks, on a page a customer reads.
 *
 * The file is `public/fonts/`, the same one the interface reads (`index.css`),
 * so Vite serves it in development and copies it into `dist/` for the
 * production server's static handler. The URL is root-relative: a document
 * printed through `printHtmlDocument` is written into an iframe that inherits
 * the application's address, and one saved as a standalone file has it
 * replaced by a `data:` URI in `inlineDocumentAssets`, so it carries the font
 * rather than pointing at a server it may never see.
 */
export const PRINT_FONT_URL = "/fonts/Vazirmatn-Variable.woff2";

/** The `@font-face` rule to put at the top of a printed document's `<style>`. */
export const PRINT_FONT_FACE = `@font-face {
      font-family: 'Vazirmatn';
      src: url('${PRINT_FONT_URL}') format('woff2');
      font-weight: 100 900;
      font-style: normal;
      font-display: block;
    }`;
