import { useEffect, useRef, useState } from "react";
import { tasksApi, type TaskWorkLog } from "../api/tasks";

export default function TaskWorkHistory({ taskId, version = 0 }: { taskId: string; version?: number }) {
  const [rows, setRows] = useState<TaskWorkLog[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const request = useRef(0);

  useEffect(() => {
    setRows([]); setPage(1); setHasMore(false);
    const controller = new AbortController();
    const seq = ++request.current;
    setLoading(true); setError("");
    tasksApi.workLogs(taskId, 1, controller.signal).then((result) => {
      if (seq !== request.current) return;
      setRows(result.rows); setHasMore(result.hasMore);
    }).catch((err) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "دریافت سابقه ممکن نشد.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); request.current++; };
  }, [taskId, version, retry]);

  const more = async () => {
    const seq = request.current;
    setLoading(true); setError("");
    try {
      const result = await tasksApi.workLogs(taskId, page + 1);
      if (seq !== request.current) return;
      setRows((prev) => [...prev, ...result.rows.filter((r) => !prev.some((p) => p.id === r.id))]);
      setHasMore(result.hasMore); setPage((p) => p + 1);
    } catch (err) {
      if (seq === request.current) setError(err instanceof Error ? err.message : "دریافت سابقه ممکن نشد.");
    } finally { if (seq === request.current) setLoading(false); }
  };

  return (
    <section className="border border-slate-200 rounded-xl p-3 space-y-3" data-task-work-history>
      <h4 className="text-xs font-bold text-slate-700">سابقهٔ شرح کار و پیام‌ها</h4>
      {rows.map((row) => (
        <article key={row.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0 space-y-1.5" data-work-log={row.id}>
          <div className="flex flex-wrap justify-between gap-1 text-[11px] text-slate-500">
            <span className="font-medium text-slate-700">{row.authorName} · {row.kind === "COMPLETION" ? "اتمام کار" : "شرح کار"}</span>
            <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>
          </div>
          {row.text && <p className="text-xs whitespace-pre-wrap break-words text-slate-700">{row.text}</p>}
          {row.attachments.map((file) => (
            <a key={file.url} href={file.url} target="_blank" rel="noreferrer" className="block text-xs text-sky-700 hover:underline break-all">{file.name} {file.size && `(${file.size})`}</a>
          ))}
        </article>
      ))}
      {!loading && !error && rows.length === 0 && <p className="text-xs text-slate-400">هنوز شرح کاری ثبت نشده است.</p>}
      {error && <div role="alert" className="text-xs text-red-700">{error} <button type="button" onClick={() => setRetry((n) => n + 1)} className="underline">تلاش دوباره</button></div>}
      {loading && <p className="text-xs text-slate-400">در حال دریافت سابقه…</p>}
      {hasMore && <button type="button" onClick={() => void more()} disabled={loading} className="text-xs text-sky-700 disabled:opacity-50">نمایش سوابق قدیمی‌تر</button>}
    </section>
  );
}
