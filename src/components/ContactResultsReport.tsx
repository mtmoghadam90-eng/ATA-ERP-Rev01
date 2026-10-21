import React, { useEffect, useState } from "react";
import { PhoneCall, AlertTriangle } from "lucide-react";
import ShamsiDatePicker from "./ShamsiDatePicker";
import { useUserDirectory } from "../api/useUserDirectory";
import { tasksApi, type ContactResultReport } from "../api/tasks";
import { getTodayShamsi } from "../dateUtils";
import { CONTACT_RESULT_UNRECORDED } from "../utils/contactResults";

/** A count in prose, in Persian digits — these are calls, never money. */
const fa = (n: number): string => n.toLocaleString("fa-IR");

/**
 * «نتایج تماس» — what the calls to customers came to, over a period.
 *
 * Every figure is the server's, counted over the whole bounded scan
 * (`contactResultService.ts`), never over the rows drawn below: pressing a
 * result narrows the *list* and leaves the counts whole, because a total that
 * changed with the filter would read as calls disappearing.
 */
export default function ContactResultsReport(): React.ReactElement {
  const today = getTodayShamsi();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [result, setResult] = useState("");
  const [report, setReport] = useState<ContactResultReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { users } = useUserDirectory();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    tasksApi.contactResults({
      from: from || undefined, to: to || undefined,
      assigneeUserId: assigneeUserId || undefined, result: result || undefined,
    }, controller.signal)
      .then((r) => setReport(r))
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "خواندن گزارش با خطا مواجه شد.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [from, to, assigneeUserId, result]);

  const summary = report?.summary;
  const resultKeys = summary?.byResult.map((r) => r.result) ?? [];

  return (
    <div className="space-y-4" data-contact-report>
      <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-end gap-3">
        <div className="w-40"><ShamsiDatePicker label="از تاریخ" value={from} onChange={setFrom} compact /></div>
        <div className="w-40"><ShamsiDatePicker label="تا تاریخ" value={to} onChange={setTo} compact /></div>
        <div>
          <label htmlFor="contact-report-assignee" className="block text-xs font-medium text-slate-700 mb-1">مسئول</label>
          <select
            id="contact-report-assignee"
            value={assigneeUserId}
            onChange={(e) => setAssigneeUserId(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="">همه</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </select>
        </div>
        <p className="text-xs text-muted basis-full">
          وظایف انجام‌شدهٔ مرتبط با مشتری در این بازه، بر اساس تاریخ انجام. نتیجه هنگام زدن تیک «ثبت انجام کار» انتخاب می‌شود.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {summary && (
        <>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-1.5 font-bold text-slate-800">
                <PhoneCall size={16} /> {fa(summary.total)} تماس
              </span>
              <span className="text-muted">
                با نتیجهٔ ثبت‌شده: {fa(summary.recorded)}
              </span>
              {loading && <span className="text-faint text-xs">در حال به‌روزرسانی…</span>}
            </div>
            {report?.truncated && (
              <p className="text-xs text-amber-700 inline-flex items-center gap-1">
                <AlertTriangle size={13} /> بازه بیش از حد بزرگ است و فقط جدیدترین تماس‌ها شمرده شدند؛ بازه را کوتاه‌تر کنید.
              </p>
            )}
            {summary.total === 0 ? (
              <p className="text-sm text-muted">در این بازه تماسی ثبت نشده است.</p>
            ) : (
              <div className="space-y-1.5">
                {summary.byResult.map((r) => (
                  <button
                    key={r.result}
                    type="button"
                    data-contact-result={r.result}
                    onClick={() => setResult(result === r.result ? "" : r.result)}
                    className={`w-full text-right rounded-lg px-3 py-2 border transition ${
                      result === r.result ? "border-sky-400 bg-sky-50" : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className={r.result === CONTACT_RESULT_UNRECORDED ? "text-muted" : "text-slate-800 font-medium"}>
                        {r.result}
                      </span>
                      <span className="text-slate-700 whitespace-nowrap">
                        {fa(r.count)} ({fa(r.percent)}٪)
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-sky-500" style={{ width: `${r.percent}%` }} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {summary.byAssignee.length > 1 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 overflow-x-auto">
              <h4 className="text-sm font-bold text-slate-800 mb-2">به تفکیک مسئول</h4>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted">
                    <th className="text-right py-1 px-2">مسئول</th>
                    <th className="text-right py-1 px-2">کل</th>
                    {resultKeys.map((k) => <th key={k} className="text-right py-1 px-2 whitespace-nowrap">{k}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {summary.byAssignee.map((p) => (
                    <tr key={p.name} className="border-t border-slate-100">
                      <td className="py-1 px-2 font-medium text-slate-800 whitespace-nowrap">{p.name}</td>
                      <td className="py-1 px-2">{fa(p.total)}</td>
                      {resultKeys.map((k) => (
                        <td key={k} className="py-1 px-2">{fa(p.counts[k] ?? 0)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {report && report.rows.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 overflow-x-auto">
              <h4 className="text-sm font-bold text-slate-800 mb-2">
                {result ? `تماس‌ها با نتیجهٔ «${result}»` : "تماس‌ها"}
                {report.listedTotal > report.rows.length && (
                  <span className="text-xs text-muted font-normal mr-2">
                    ({fa(report.rows.length)} مورد جدیدتر از {fa(report.listedTotal)})
                  </span>
                )}
              </h4>
              <table className="w-full text-xs min-w-[640px]" data-contact-rows>
                <thead>
                  <tr className="text-muted">
                    <th className="text-right py-1 px-2">تاریخ</th>
                    <th className="text-right py-1 px-2">مشتری</th>
                    <th className="text-right py-1 px-2">مسئول</th>
                    <th className="text-right py-1 px-2">نتیجه</th>
                    <th className="text-right py-1 px-2">شرح اقدام</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100 align-top">
                      <td className="py-1.5 px-2 whitespace-nowrap">{row.completedAtJalali ?? "—"}</td>
                      <td className="py-1.5 px-2 text-slate-800">{row.customerName || "—"}</td>
                      <td className="py-1.5 px-2 whitespace-nowrap">{row.assignedToName || "—"}</td>
                      <td className="py-1.5 px-2">{row.contactResult || <span className="text-faint">{CONTACT_RESULT_UNRECORDED}</span>}</td>
                      <td className="py-1.5 px-2 whitespace-pre-line break-words">{row.completionNote || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
