import { escapeHtml } from "./richText";
import {
  MEETING_ITEM_KIND_LABELS, MEETING_ITEM_STATE_LABELS, MEETING_STATUS_LABELS,
  type MeetingAssignee, type MeetingItemKind, type MeetingItemState, type MeetingParticipant,
  type MeetingStatus,
} from "./meetingMinutes";

/**
 * A meeting's minutes as a printed document — the same shape as a proforma.
 *
 * A whole standalone page, printed by the browser into its own PDF (real text,
 * embedded font), never photographed: `printHtmlDocument` prints it and
 * `DocumentPreview` shows exactly this string, so the screen and the paper
 * cannot disagree. Pure, so a throwaway script can print it and look.
 *
 * The rules it keeps are the proforma's, for the proforma's reasons:
 * - **The letterhead repeats** because it is the frame table's `<thead>`
 *   (`display: table-header-group`), which reserves its space on every sheet.
 * - **A row is kept whole and the table is not** — `break-inside: avoid` on a
 *   `<tr>`, never on the table, or a long agenda moves its whole list to the
 *   next page and leaves the first one empty.
 * - **The signature block never starts a page alone** (`break-before: avoid`),
 *   since a sheet carrying nothing but signatures reads as a stray page.
 *
 * One line per **colleague or guest who attended** in the signature block:
 * minutes are signed by the people who were there, and the absentees are named
 * above but have nothing to sign.
 */

export interface MeetingDocumentItem {
  lineNo: number;
  text: string;
  kind: MeetingItemKind;
  assignees: MeetingAssignee[];
  dueDateJalali: string | null;
  state: MeetingItemState;
}

export interface MeetingDocumentInput {
  meeting: {
    code: string;
    title: string;
    meetingDateJalali: string | null;
    startTime: string | null;
    endTime: string | null;
    place: string | null;
    summary: string | null;
    projectCode: string | null;
    projectName: string | null;
    customerName: string | null;
    status: MeetingStatus;
    attendees: MeetingParticipant[];
    absentees: MeetingParticipant[];
    nextMeetingDateJalali: string | null;
    createdByName: string | null;
    items: MeetingDocumentItem[];
  };
  /** The active proforma template — the company's letterhead. */
  template?: {
    companyName?: string;
    phone?: string;
    email?: string;
    website?: string;
    address?: string;
    logoUrl?: string;
    titleColor?: string;
  } | null;
}

const text = (value: unknown) => escapeHtml(String(value ?? ""));
/** Line breaks the writer typed survive, after the text is escaped. */
const multiline = (value: unknown) => text(value).replace(/\n/g, "<br>");

const personLabel = (p: MeetingParticipant) =>
  p.organization ? `${text(p.name)} <span class="org">(${text(p.organization)})</span>` : text(p.name);

/** The filename-and-tab title: what the PDF is saved under. */
export function meetingDocumentTitle(meeting: { code: string; title: string }): string {
  return `صورتجلسه ${meeting.code}`;
}

export function renderMeetingDocument(input: MeetingDocumentInput): string {
  const m = input.meeting;
  const t = input.template ?? {};
  const accent = /^#[0-9a-fA-F]{3,8}$/.test(String(t.titleColor ?? "")) ? t.titleColor! : "#0f172a";

  const when = [
    m.meetingDateJalali ?? "",
    m.startTime ? `ساعت ${m.startTime}${m.endTime ? ` تا ${m.endTime}` : ""}` : "",
  ].filter(Boolean).join(" — ");

  // Each half drops on its own: a heading with nothing under it reads as
  // something that failed to load.
  const infoRows: [string, string][] = [
    ["تاریخ و ساعت", text(when) || "-"],
    ["مکان", text(m.place) || "-"],
    ["پروژه", m.projectCode ? `${text(m.projectCode)} — ${text(m.projectName)}` : "جلسه داخلی"],
  ];
  if (m.customerName) infoRows.push(["کارفرما", text(m.customerName)]);
  if (m.nextMeetingDateJalali) infoRows.push(["جلسه بعدی", text(m.nextMeetingDateJalali)]);

  const people = (list: MeetingParticipant[]) =>
    list.length === 0 ? '<span class="muted">-</span>' : list.map(personLabel).join("، ");

  const rows = m.items.map((item, idx) => {
    const isAction = item.kind === "ACTION";
    return `<tr>
      <td class="num">${idx + 1}</td>
      <td class="kind kind-${item.kind}">${text(MEETING_ITEM_KIND_LABELS[item.kind])}</td>
      <td class="desc">${multiline(item.text)}</td>
      <td class="who">${isAction ? text(item.assignees.map((a) => a.name).join("، ")) || "-" : "-"}</td>
      <td class="nowrap">${isAction ? text(item.dueDateJalali) || "-" : "-"}</td>
      <td class="nowrap">${isAction ? text(MEETING_ITEM_STATE_LABELS[item.state]) || "-" : "-"}</td>
    </tr>`;
  }).join("");

  const signers = m.attendees;
  const signatures = signers.length === 0 ? "" : `
    <div class="signatures">
      <div class="section-title">امضای حاضرین</div>
      <div class="sign-grid">
        ${signers.map((p) => `<div class="sign-box"><div class="sign-name">${personLabel(p)}</div><div class="sign-line"></div></div>`).join("")}
      </div>
    </div>`;

  const contact = [t.address, t.phone ? `تلفن: ${t.phone}` : "", t.email].filter(Boolean).map(text).join(" | ");

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>${text(meetingDocumentTitle(m))}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;700&display=swap');
    * { box-sizing: border-box; }
    body { font-family: 'Vazirmatn', Tahoma, sans-serif; color: #0f172a; margin: 0; background: #f1f5f9; font-size: 10.5pt; line-height: 1.7; }
    .doc-frame { width: 100%; max-width: 820px; margin: 0 auto; background: #ffffff; border-collapse: collapse; }
    .doc-frame > thead > tr > td, .doc-frame > tbody > tr > td { padding: 0 32px; }
    .letterhead { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 0 12px; border-bottom: 2px solid ${accent}; }
    .letterhead img { max-height: 64px; max-width: 160px; }
    .company { font-weight: 700; font-size: 13pt; }
    .doc-title { text-align: left; }
    .doc-title .title { font-size: 15pt; font-weight: 700; color: ${accent}; }
    .doc-title .code { direction: ltr; unicode-bidi: isolate; font-size: 9.5pt; color: #475569; }
    h1 { font-size: 13pt; margin: 18px 0 8px; }
    .status { font-size: 9pt; color: #475569; font-weight: 400; }
    .info { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    .info th { text-align: right; width: 110px; color: #475569; font-weight: 400; padding: 3px 0; vertical-align: top; }
    .info td { padding: 3px 0; }
    .section-title { font-weight: 700; margin: 14px 0 6px; font-size: 10.5pt; color: ${accent}; }
    .org, .muted { color: #475569; }
    .summary { white-space: normal; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; }
    .items { width: 100%; border-collapse: collapse; margin-top: 4px; }
    .items th { background: #f1f5f9; border: 1px solid #94a3b8; padding: 5px 6px; font-size: 9.5pt; }
    .items td { border: 1px solid #94a3b8; padding: 5px 6px; vertical-align: top; font-size: 9.5pt; }
    .items .num { text-align: center; width: 34px; }
    .items .kind { width: 58px; text-align: center; font-weight: 700; }
    .items .who { width: 110px; }
    .kind-DECISION { color: #3730a3; }
    .kind-ACTION { color: #92400e; }
    .kind-INFO { color: #334155; }
    .nowrap { white-space: nowrap; }
    .signatures { margin-top: 22px; break-before: avoid; page-break-before: avoid; break-inside: avoid; page-break-inside: avoid; }
    .sign-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px 18px; }
    .sign-box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 10px; min-height: 64px; display: flex; flex-direction: column; justify-content: space-between; }
    .sign-name { font-size: 9.5pt; }
    .sign-line { border-bottom: 1px dashed #94a3b8; height: 26px; }
    .footer { border-top: 1px solid #cbd5e1; padding: 8px 0 6px; font-size: 8.5pt; color: #475569; text-align: center; }
    @page {
      size: A4;
      margin: 12mm 10mm 14mm 10mm;
      @bottom-center {
        content: "صفحه " counter(page) " از " counter(pages);
        font-family: 'Vazirmatn', Tahoma, sans-serif;
        font-size: 9pt;
        color: #64748b;
      }
    }
    @media print {
      body { background: #ffffff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .doc-frame { max-width: none; }
      .doc-frame > thead > tr > td, .doc-frame > tbody > tr > td { padding: 0; }
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
      .items tr { break-inside: avoid; page-break-inside: avoid; }
      .doc-frame > tbody > tr, .doc-frame > tbody > tr > td { break-inside: auto; page-break-inside: auto; }
    }
  </style>
</head>
<body>
  <table class="doc-frame">
    <thead><tr><td>
      <div class="letterhead">
        <div>
          ${t.logoUrl ? `<img src="${text(t.logoUrl)}" alt="">` : ""}
          <div class="company">${text(t.companyName)}</div>
        </div>
        <div class="doc-title">
          <div class="title">صورتجلسه</div>
          <div class="code">${text(m.code)}</div>
        </div>
      </div>
    </td></tr></thead>
    <tbody><tr><td>
      <h1>${text(m.title)} <span class="status">(${text(MEETING_STATUS_LABELS[m.status])})</span></h1>
      <table class="info">
        ${infoRows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}
        <tr><th>حاضرین</th><td>${people(m.attendees)}</td></tr>
        <tr><th>غایبین</th><td>${people(m.absentees)}</td></tr>
      </table>
      ${m.summary ? `<div class="section-title">دستور جلسه / خلاصه مذاکرات</div><div class="summary">${multiline(m.summary)}</div>` : ""}
      <div class="section-title">مصوبات و اقدامات</div>
      ${m.items.length === 0
        ? '<div class="muted">بندی ثبت نشده است.</div>'
        : `<table class="items">
            <thead><tr><th>ردیف</th><th>نوع</th><th>شرح</th><th>مسئول</th><th>مهلت</th><th>وضعیت</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`}
      ${signatures}
    </td></tr></tbody>
    <tfoot><tr><td>
      <div class="footer">${contact}${m.createdByName ? `${contact ? " — " : ""}تنظیم: ${text(m.createdByName)}` : ""}</div>
    </td></tr></tfoot>
  </table>
</body>
</html>`;
}
