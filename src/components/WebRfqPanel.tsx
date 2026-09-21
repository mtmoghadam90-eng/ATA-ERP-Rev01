import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Globe, Loader2, RefreshCw } from "lucide-react";
import { WebRfqConfig, WebRfqImportRow, WebRfqReport, webRfqApi } from "../api/webRfq";
import { useUserDirectory } from "../api/useUserDirectory";
import { toShamsiStr } from "../dateUtils";
import { WebRfqSourceId, webRfqSourceSpec } from "../utils/webRfq";

/**
 * «استعلام‌های وب‌سایت» — the card that switches one plugin's import on and
 * shows what has arrived through it.
 *
 * Its own component rather than another branch of `SettingsView`, which is far
 * too large to render: this one fetches, so it needs to be drivable by
 * `test:ui`.
 *
 * **One component, one card per source**, the `MessengerLinkPanel` rule: a
 * second near-copy of three hundred lines is how the two come to disagree
 * about what «ناموفق» looks like, which is a screen somebody then has to learn
 * twice. Its own failure mode is one no type-check can see — a card whose
 * calls point at the *other* source would render perfectly and report the
 * wrong feed's state — so `test:ui` renders both and asserts which URL each
 * one asked for.
 *
 * Two things it deliberately draws that nothing else could. **The last poll's
 * result**, because the failure mode of a poller is silence — a feed that
 * stopped answering looks exactly like a quiet week — and **the failed
 * imports with their reasons**, because a request that could not be turned
 * into a project is the one case where the email is now the only copy.
 */

const stamp = (value: number | string | null): string => {
  if (!value) return "—";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const day = toShamsiStr(date);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${day} — ${time}`;
};

export default function WebRfqPanel({ source }: { source: WebRfqSourceId }) {
  const spec = webRfqSourceSpec(source);
  const { users } = useUserDirectory();
  const [config, setConfig] = useState<WebRfqConfig | null>(null);
  const [report, setReport] = useState<WebRfqReport | null>(null);
  const [rows, setRows] = useState<WebRfqImportRow[]>([]);

  const [feedUrl, setFeedUrl] = useState("");
  const [token, setToken] = useState("");
  const [active, setActive] = useState(false);
  const [ownerUserId, setOwnerUserId] = useState("");
  /** Kept as text: an empty box is «not drawn yet», which is not zero. */
  const [startAfter, setStartAfter] = useState("");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  const apply = useCallback((next: WebRfqConfig) => {
    setConfig(next);
    setFeedUrl(next.feedUrl);
    setActive(next.active);
    setOwnerUserId(next.ownerUserId ?? "");
    setStartAfter(next.startAfterId === null ? "" : String(next.startAfterId));
    // Never seeded from the stored value — there is no stored value to seed
    // from, only a hint. A blank box means «unchanged» on save.
    setToken("");
  }, []);

  const load = useCallback(async () => {
    try {
      const [cfg, list] = await Promise.all([
        webRfqApi.config(source), webRfqApi.imports(source),
      ]);
      apply(cfg.config);
      setReport(cfg.report);
      setRows(list.imports);
    } catch (err) {
      setMessage({ kind: "bad", text: err instanceof Error ? err.message : "خطا در خواندن تنظیمات." });
    }
  }, [apply, source]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const typed = startAfter.trim();
      const answer = await webRfqApi.save(source, {
        feedUrl, token, active, ownerUserId: ownerUserId || null,
        // Blank is «draw it again on the next poll», which is not zero —
        // zero would mean «import everything», the opposite answer.
        startAfterId: typed === "" ? null : Math.max(0, Math.trunc(Number(typed) || 0)),
      });
      apply(answer.config);
      setReport(answer.report);
      setMessage({ kind: "ok", text: "تنظیمات ذخیره شد." });
    } catch (err) {
      setMessage({ kind: "bad", text: err instanceof Error ? err.message : "ذخیره نشد." });
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const answer = await webRfqApi.sync(source);
      setReport(answer.report);
      /*
       * A baseline pass imports nothing on purpose, and «۰ استعلام منتقل شد»
       * with no explanation reads as a feature that does not work — which is
       * exactly how a correct-but-unconfigured thing gets reported as broken.
       */
      setMessage(answer.report.lastError
        ? { kind: "bad", text: answer.report.lastError }
        : answer.report.baselineDrawnAt !== null
          ? {
            kind: "ok",
            text: `استعلام‌های موجود سایت (تا شمارهٔ ${answer.report.baselineDrawnAt}) منتقل نشدند؛ از این پس فقط درخواست‌های تازه می‌آیند.`,
          }
          : { kind: "ok", text: `همگام‌سازی انجام شد؛ ${answer.imported} استعلام تازه منتقل شد.` });
      await load();
    } catch (err) {
      setMessage({ kind: "bad", text: err instanceof Error ? err.message : "همگام‌سازی ناموفق بود." });
    } finally {
      setBusy(false);
    }
  };

  const retry = async (id: string) => {
    setBusy(true);
    try {
      await webRfqApi.retry(id);
      await load();
    } catch (err) {
      setMessage({ kind: "bad", text: err instanceof Error ? err.message : "تلاش دوباره ناموفق بود." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6" data-web-rfq-panel={source}>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-5">
        <div className="flex items-start gap-3">
          <Globe size={20} className="text-sky-500 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-lg font-bold text-slate-900">{spec.label}</h3>
            <p className="text-xs text-secondary mt-0.5">{spec.hint}</p>
            <p className="text-secondary text-sm mt-1 leading-6">
              هر درخواست استعلام قیمتی که از این راه در سایت ثبت می‌شود، اینجا به یک مشتری و یک
              پروژهٔ جدید تبدیل می‌شود تا بتوانید برایش پیش‌فاکتور صادر کنید. ایمیلی که تا امروز
              می‌گرفتید سر جای خودش می‌ماند.
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-sky-50 border border-sky-200 p-4 text-sm text-slate-700 leading-6">
          سرور ERP روی شبکهٔ داخلی است و سایت عمومی، پس سایت نمی‌تواند چیزی به اینجا بفرستد؛
          ERP هر پنج دقیقه خودش سایت را می‌خواند. <strong>اولین همگام‌سازی هیچ چیزی منتقل
          نمی‌کند</strong> و فقط شمارهٔ فعلی سایت را به‌عنوان خط ثبت می‌کند؛ استعلام‌های قبلی
          که پروژه‌شان را دستی ساخته‌اید دست‌نخورده می‌مانند و فقط درخواست‌های بعد از آن می‌آیند.
          هر افزونه شمارهٔ خودش را دارد، پس آدرس، توکن و خطِ این کارت فقط به همین افزونه مربوط است
          و <strong>یک آدرس نباید در دو کارت وارد شود</strong>.
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">آدرس فید</label>
            <input
              type="text" dir="ltr" value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              placeholder={spec.samplePath}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-sky-400"
            />
            <p className="text-xs text-secondary mt-1.5">باید https باشد؛ توکن نباید روی اتصال رمزنشده برود.</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              توکن مشترک
              {config?.tokenHint ? <span className="text-xs font-normal text-secondary mr-2">ذخیره‌شده: {config.tokenHint}</span> : null}
            </label>
            <input
              type="password" dir="ltr" value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={config?.tokenHint ? "برای تغییر، مقدار تازه را وارد کنید" : "همان مقدار ATA_ERP_FEED_TOKEN در سایت"}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-sky-400"
            />
            <p className="text-xs text-secondary mt-1.5">خالی گذاشتن یعنی «تغییر نکند».</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">مسئول پروژه‌های واردشده</label>
            <select
              value={ownerUserId}
              onChange={(e) => setOwnerUserId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-sky-400"
            >
              <option value="">انتخاب کنید…</option>
              {users.filter((u) => u.isActive !== false).map((u) => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
            </select>
            <p className="text-xs text-secondary mt-1.5">
              پروژه به نام این حساب ثبت می‌شود؛ پروژه‌ای که به کسی تعلق نداشته باشد در هیچ تخته‌ای دیده نمی‌شود.
            </p>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              انتقال فقط از شمارهٔ بعد از
            </label>
            <input
              type="text" inputMode="numeric" dir="ltr" value={startAfter}
              onChange={(e) => setStartAfter(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="در اولین همگام‌سازی خودکار پر می‌شود"
              data-web-rfq-line={source}
              className="w-full md:w-48 px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-sky-400"
            />
            <p className="text-xs text-secondary mt-1.5 leading-5">
              استعلام‌هایی با این شماره و پایین‌تر هرگز منتقل نمی‌شوند. خالی بگذارید تا در
              همگام‌سازی بعدی دوباره از روی وضعیت فعلی سایت تعیین شود؛ <span className="font-mono">0</span>
              {" "}یعنی «همه‌چیز منتقل شود»، که با خالی یکی نیست.
            </p>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          انتقال خودکار فعال باشد
        </label>

        {config?.refusal ? (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{config.refusal}</span>
          </div>
        ) : null}

        {message ? (
          <div className={`rounded-xl p-3 text-sm flex items-start gap-2 border ${
            message.kind === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-rose-50 border-rose-200 text-rose-800"
          }`}>
            {message.kind === "ok" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
            <span>{message.text}</span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button" onClick={() => void save()} disabled={busy}
            data-web-rfq-save={source}
            className="px-4 py-2 rounded-xl bg-sky-500 text-white text-sm font-semibold hover:bg-sky-600 disabled:opacity-50"
          >
            ذخیره تنظیمات
          </button>
          <button
            type="button" onClick={() => void syncNow()} disabled={busy}
            data-web-rfq-sync={source}
            className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-2"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            همگام‌سازی حالا
          </button>
        </div>

        {/* The report. A poller that goes quiet is indistinguishable from a
            quiet week unless the screen says which. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="text-xs text-secondary">آخرین تلاش</div>
            <div className="font-semibold text-slate-800 mt-0.5">{stamp(report?.lastRunAt ?? 0)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="text-xs text-secondary">آخرین موفقیت</div>
            <div className="font-semibold text-slate-800 mt-0.5">{stamp(report?.lastOkAt ?? 0)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="text-xs text-secondary">وضعیت</div>
            <div className={`font-semibold mt-0.5 ${report?.lastError ? "text-rose-600" : "text-emerald-600"}`}>
              {report?.lastError ? report.lastError : "بدون خطا"}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <h4 className="font-bold text-slate-900 mb-4">آخرین استعلام‌های منتقل‌شده</h4>
        {rows.length === 0 ? (
          <p className="text-sm text-secondary">هنوز استعلامی منتقل نشده است.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[840px]">
              <thead>
                <tr className="text-right text-xs text-secondary border-b border-slate-200">
                  <th className="py-2 px-2 font-semibold">شماره سایت</th>
                  <th className="py-2 px-2 font-semibold">کد پیگیری</th>
                  <th className="py-2 px-2 font-semibold">درخواست‌کننده</th>
                  <th className="py-2 px-2 font-semibold">تجهیز</th>
                  <th className="py-2 px-2 font-semibold">کد پروژه</th>
                  <th className="py-2 px-2 font-semibold">وضعیت</th>
                  <th className="py-2 px-2 font-semibold">تاریخ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 align-top">
                    <td className="py-2 px-2 font-mono text-xs">#{row.rfqId}</td>
                    <td className="py-2 px-2 font-mono text-[11px] break-all">{row.reference || "—"}</td>
                    <td className="py-2 px-2">{row.fullName || "—"}</td>
                    <td className="py-2 px-2 break-words">{row.productName || "—"}</td>
                    <td className="py-2 px-2 font-mono text-xs">{row.projectCode || "—"}</td>
                    <td className="py-2 px-2">
                      {row.status === "IMPORTED" ? (
                        <span className="text-emerald-600 font-semibold">منتقل شد</span>
                      ) : (
                        <div className="space-y-1">
                          <span className="text-rose-600 font-semibold">ناموفق ({row.attempts})</span>
                          {row.error ? <div className="text-xs text-secondary break-words">{row.error}</div> : null}
                          <button
                            type="button" onClick={() => void retry(row.id)} disabled={busy}
                            className="text-xs text-sky-600 hover:underline disabled:opacity-50"
                          >
                            تلاش دوباره
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-2 text-xs text-secondary">{stamp(row.importedAt ?? row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
