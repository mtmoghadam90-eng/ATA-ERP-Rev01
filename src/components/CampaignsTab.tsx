import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Megaphone, Play, Send, Trash2, Users, X } from "lucide-react";
import { CHANNEL_LABELS, isChannel, smsLength } from "../utils/messaging";
import {
  CAMPAIGN_MEASUREMENT_NOTE, CAMPAIGN_STATUS, CAMPAIGN_STATUS_LABELS,
  SKIP_REASON_LABELS, SkipReason, campaignProgressPercent, describeCampaignResult,
} from "../utils/campaigns";
import {
  CampaignRow, SegmentPreview, SegmentRow, SendCampaignResult, campaignsApi,
} from "../api/campaigns";
import { MessageTemplateRow, messagingApi } from "../api/messaging";

/**
 * Segments and campaigns, on the messaging screen.
 *
 * There is no filter form here on purpose: a segment is made on the customers
 * screen, out of the filters that are already there. This screen names one,
 * shows how many people it currently reaches, and sends to it.
 *
 * The send is two presses. The first shows the resolved recipient count and the
 * message as one of them would receive it; the second queues. Writing to a
 * hundred customers is not something a form submit should do on the way past.
 */

interface Props {
  onError: (err: unknown, fallback: string) => void;
  onNotice: (text: string) => void;
}

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  SENDING: "bg-amber-100 text-amber-700",
  SENT: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-rose-100 text-rose-700",
};

export default function CampaignsTab({ onError, onNotice }: Props) {
  const [segments, setSegments] = useState<SegmentRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [templates, setTemplates] = useState<MessageTemplateRow[]>([]);
  const [editing, setEditing] = useState<CampaignRow | "new" | null>(null);
  const [confirming, setConfirming] = useState<CampaignRow | null>(null);

  const load = useCallback(async () => {
    try {
      const [segmentRows, campaignPage, templateRows] = await Promise.all([
        campaignsApi.segments(),
        campaignsApi.campaigns({ pageSize: 50 }),
        messagingApi.templates(),
      ]);
      setSegments(segmentRows);
      setCampaigns(campaignPage.rows);
      setTemplates(templateRows);
    } catch (err) {
      onError(err, "بارگذاری کمپین‌ها با خطا مواجه شد.");
    }
  }, [onError]);

  useEffect(() => { void load(); }, [load]);

  const handleDeleteSegment = async (segment: SegmentRow) => {
    try {
      await campaignsApi.deleteSegment(segment.id);
      onNotice(`سگمنت «${segment.name}» حذف شد.`);
      void load();
    } catch (err) {
      onError(err, "حذف سگمنت با خطا مواجه شد.");
    }
  };

  return (
    <div className="space-y-5">
      {/* ------------------------------ segments ----------------------------- */}
      <section className="bg-white border border-edge rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Users size={16} className="text-sky-600" />
            سگمنت‌های مشتری
          </h3>
          <span className="text-[11px] text-slate-500">
            سگمنت در صفحه «مشتریان» و از روی فیلترهای همان فهرست ساخته می‌شود.
          </span>
        </div>

        {segments.length === 0 ? (
          <p className="text-[11px] text-slate-500 py-4 text-center">
            هنوز سگمنتی ذخیره نشده است. در صفحه «بانک اطلاعات مشتریان» فهرست را فیلتر کنید
            و دکمه «ذخیره به‌عنوان سگمنت» را بزنید.
          </p>
        ) : (
          <div className="space-y-2">
            {segments.map((segment) => (
              <SegmentCard
                key={segment.id}
                segment={segment}
                onDelete={() => handleDeleteSegment(segment)}
                onError={onError}
              />
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------ campaigns ---------------------------- */}
      <section className="bg-white border border-edge rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Megaphone size={16} className="text-sky-600" />
            کمپین‌ها
          </h3>
          <button
            type="button"
            onClick={() => setEditing("new")}
            disabled={segments.length === 0}
            className="px-3 py-1.5 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-lg text-[11px] font-bold"
          >
            کمپین جدید
          </button>
        </div>

        <p className="text-[11px] text-slate-500 mb-3">{CAMPAIGN_MEASUREMENT_NOTE}</p>

        {campaigns.length === 0 ? (
          <p className="text-[11px] text-slate-500 py-4 text-center">هنوز کمپینی ساخته نشده است.</p>
        ) : (
          <div className="space-y-2">
            {campaigns.map((campaign) => (
              <div key={campaign.id} className="border border-edge rounded-xl p-3">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span className="font-bold text-xs text-slate-800">{campaign.name}</span>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${STATUS_STYLE[campaign.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {CAMPAIGN_STATUS_LABELS[campaign.status as keyof typeof CAMPAIGN_STATUS_LABELS] ?? campaign.status}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {isChannel(campaign.channel) ? CHANNEL_LABELS[campaign.channel] : campaign.channel}
                  </span>
                  {campaign.segmentName && (
                    <span className="text-[10px] text-slate-500">· {campaign.segmentName}</span>
                  )}
                </div>

                <p className="text-[11px] text-slate-600 whitespace-pre-line line-clamp-2">
                  {campaign.body}
                </p>

                {campaign.status !== CAMPAIGN_STATUS.DRAFT && (
                  <div className="mt-2 text-[10px] text-slate-500">
                    {describeCampaignResult(campaign.counts)}
                    <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${campaignProgressPercent(campaign.counts)}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex gap-2 mt-2">
                  {/*
                    * SENDING keeps the button, and it says «continue»: a send is
                    * bounded per press, so a large segment finishes over two or
                    * three of them and a campaign left half done with no way to
                    * carry on would be the worst state this screen can be in.
                    */}
                  {(campaign.status === CAMPAIGN_STATUS.DRAFT
                    || campaign.status === CAMPAIGN_STATUS.SENDING) && (
                    <>
                      <button
                        type="button"
                        onClick={() => setConfirming(campaign)}
                        className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold flex items-center gap-1"
                      >
                        <Play size={11} />
                        {campaign.status === CAMPAIGN_STATUS.SENDING ? "ادامه ارسال" : "ارسال"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(campaign)}
                        disabled={campaign.status !== CAMPAIGN_STATUS.DRAFT}
                        className="px-2.5 py-1 border border-edge rounded-lg text-[10px] text-slate-600 disabled:opacity-40"
                      >
                        ویرایش
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await campaignsApi.deleteCampaign(campaign.id);
                            void load();
                          } catch (err) { onError(err, "حذف کمپین با خطا مواجه شد."); }
                        }}
                        disabled={campaign.status !== CAMPAIGN_STATUS.DRAFT}
                        className="px-2.5 py-1 border border-edge rounded-lg text-[10px] text-rose-600 flex items-center gap-1 disabled:opacity-40"
                      >
                        <Trash2 size={11} /> حذف
                      </button>
                    </>
                  )}
                  {campaign.status !== CAMPAIGN_STATUS.DRAFT && campaign.counts.queued > 0 && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const { cancelled } = await campaignsApi.cancel(campaign.id);
                          onNotice(`${cancelled} پیام ارسال‌نشده لغو شد.`);
                          void load();
                        } catch (err) { onError(err, "لغو کمپین با خطا مواجه شد."); }
                      }}
                      className="px-2.5 py-1 border border-edge rounded-lg text-[10px] text-rose-600"
                    >
                      لغو پیام‌های ارسال‌نشده
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {editing && (
        <CampaignForm
          campaign={editing === "new" ? null : editing}
          segments={segments}
          templates={templates}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
          onError={onError}
        />
      )}

      {confirming && (
        <SendConfirmation
          campaign={confirming}
          onClose={() => setConfirming(null)}
          onSent={(result) => {
            setConfirming(null);
            onNotice(`${result.queued} پیام در صف ارسال قرار گرفت.`);
            void load();
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

/* ------------------------------- segment card ------------------------------ */

/**
 * A segment names how many people it currently reaches, fetched rather than
 * stored — the whole point of a saved query is that the number moves.
 */
function SegmentCard({
  segment, onDelete, onError,
}: { segment: SegmentRow; onDelete: () => void; onError: Props["onError"] }) {
  const [preview, setPreview] = useState<SegmentPreview | null>(null);

  useEffect(() => {
    let cancelled = false;
    campaignsApi.previewSegment({ segmentId: segment.id })
      .then((result) => { if (!cancelled) setPreview(result); })
      .catch((err) => { if (!cancelled) onError(err, "شمارش سگمنت با خطا مواجه شد."); });
    return () => { cancelled = true; };
  }, [segment.id, onError]);

  return (
    <div className="border border-edge rounded-xl p-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="font-bold text-xs text-slate-800">{segment.name}</div>
        {segment.description && (
          <p className="text-[11px] text-slate-500 mt-0.5">{segment.description}</p>
        )}
        <div className="text-[10px] text-slate-500 mt-1">
          {preview ? `${preview.total} مشتری هم‌اکنون` : "در حال شمارش..."}
          {segment.campaignCount > 0 && ` · ${segment.campaignCount} کمپین`}
        </div>
      </div>
      {segment.campaignCount === 0 && (
        <button
          type="button"
          onClick={onDelete}
          className="text-rose-500 hover:text-rose-700 shrink-0"
          title="حذف سگمنت"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------ campaign form ------------------------------ */

function CampaignForm({
  campaign, segments, templates, onClose, onSaved, onError,
}: {
  campaign: CampaignRow | null;
  segments: SegmentRow[];
  templates: MessageTemplateRow[];
  onClose: () => void;
  onSaved: () => void;
  onError: Props["onError"];
}) {
  const [name, setName] = useState(campaign?.name ?? "");
  const [segmentId, setSegmentId] = useState(campaign?.segmentId ?? segments[0]?.id ?? "");
  const [channel, setChannel] = useState(campaign?.channel ?? "SMS");
  const [templateId, setTemplateId] = useState(campaign?.templateId ?? "");
  const [subject, setSubject] = useState(campaign?.subject ?? "");
  const [body, setBody] = useState(campaign?.body ?? "");
  const [saving, setSaving] = useState(false);

  const length = smsLength(body);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const template = templates.find((t) => t.id === id);
    if (!template) return;
    // The template's text is copied in rather than referred to, because a
    // campaign is one message sent once: a template edited next month must not
    // rewrite what a campaign says it sent.
    setBody(template.body);
    setSubject(template.subject ?? "");
    setChannel(template.channel);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const input = { name, segmentId, channel, templateId: templateId || null, subject, body };
      if (campaign) await campaignsApi.updateCampaign(campaign.id, input);
      else await campaignsApi.createCampaign(input);
      onSaved();
    } catch (err) {
      onError(err, "ذخیره کمپین با خطا مواجه شد.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-edge sticky top-0 bg-white">
          <h3 className="font-bold text-sm text-slate-800">
            {campaign ? "ویرایش کمپین" : "کمپین جدید"}
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-3.5">
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">نام کمپین *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-edge rounded-xl text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">سگمنت *</label>
              <select
                value={segmentId}
                onChange={(e) => setSegmentId(e.target.value)}
                className="w-full px-3 py-2 border border-edge rounded-xl text-xs"
              >
                {segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">کانال *</label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                className="w-full px-3 py-2 border border-edge rounded-xl text-xs"
              >
                {Object.entries(CHANNEL_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              شروع از یک قالب (اختیاری)
            </label>
            <select
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
              className="w-full px-3 py-2 border border-edge rounded-xl text-xs"
            >
              <option value="">—</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          {channel === "EMAIL" && (
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">موضوع</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-3 py-2 border border-edge rounded-xl text-xs"
              />
            </div>
          )}

          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">متن پیام *</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              className="w-full px-3 py-2 border border-edge rounded-xl text-xs"
              placeholder="{addressee} گرامی، ..."
            />
            {channel === "SMS" && (
              <p className="text-[10px] text-slate-500 mt-1">
                {length.characters} کاراکتر · {length.parts} پیامک
              </p>
            )}
            <p className="text-[10px] text-slate-500 mt-1">
              متغیرها برای هر مشتری جداگانه جایگزین می‌شوند؛ مثلاً <code>{"{addressee}"}</code> و <code>{"{customerName}"}</code>.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-edge sticky bottom-0 bg-white">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600">
            انصراف
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !name.trim() || !segmentId || !body.trim()}
            className="px-4 py-1.5 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold"
          >
            {saving ? "در حال ذخیره..." : "ذخیره پیش‌نویس"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- send confirmation --------------------------- */

/**
 * The count, and then the send.
 *
 * The number is fetched here rather than read off the campaign, because a
 * segment is a live query: what it matched when the campaign was written is not
 * what it matches this morning, and the figure somebody agrees to has to be the
 * one that is about to be used.
 */
function SendConfirmation({
  campaign, onClose, onSent, onError,
}: {
  campaign: CampaignRow;
  onClose: () => void;
  onSent: (result: SendCampaignResult) => void;
  onError: Props["onError"];
}) {
  const [preview, setPreview] = useState<SegmentPreview | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendCampaignResult | null>(null);

  useEffect(() => {
    if (!campaign.segmentId) return;
    let cancelled = false;
    campaignsApi.previewSegment({ segmentId: campaign.segmentId })
      .then((r) => { if (!cancelled) setPreview(r); })
      .catch((err) => { if (!cancelled) onError(err, "شمارش گیرندگان با خطا مواجه شد."); });
    return () => { cancelled = true; };
  }, [campaign.segmentId, onError]);

  const handleSend = async () => {
    setSending(true);
    try {
      const outcome = await campaignsApi.send(campaign.id);
      setResult(outcome);
    } catch (err) {
      onError(err, "ارسال کمپین با خطا مواجه شد.");
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-edge">
          <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
            <Send size={15} className="text-emerald-600" />
            ارسال کمپین «{campaign.name}»
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-3">
          {result ? (
            <>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-[11px] text-emerald-800">
                {result.queued} پیام در صف ارسال قرار گرفت.
              </div>
              {Object.entries(result.skipped)
                .filter(([, count]) => count > 0)
                .map(([reason, count]) => (
                  <div key={reason} className="text-[11px] text-slate-600">
                    {count} نفر: {SKIP_REASON_LABELS[reason as SkipReason]}
                  </div>
                ))}
              {result.otherReasons.map((reason) => (
                <div key={reason} className="text-[10px] text-slate-500">— {reason}</div>
              ))}
              {result.remaining > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800 flex gap-2">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  {result.remaining} گیرنده باقی مانده است. برای ادامه، دوباره «ادامه ارسال» را بزنید؛
                  کسانی که پیام گرفته‌اند دوباره پیام نمی‌گیرند.
                </div>
              )}
              {result.truncated && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800 flex gap-2">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  تعداد مشتریان این سگمنت از سقف یک کمپین بیشتر است؛ فقط بخشی از آن‌ها پیام گرفتند.
                </div>
              )}
            </>
          ) : (
            <>
              <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 text-[11px] text-slate-700">
                {preview
                  ? <>این پیام برای <b>{preview.total}</b> مشتری در سگمنت «{campaign.segmentName}» ساخته می‌شود.</>
                  : "در حال شمارش گیرندگان..."}
              </div>
              {preview?.overLimit && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800">
                  سقف هر کمپین {preview.limit} گیرنده است.
                </div>
              )}
              <div>
                <div className="text-[11px] font-bold text-slate-700 mb-1">متن پیام</div>
                <div className="border border-edge rounded-xl p-3 text-[11px] text-slate-700 whitespace-pre-line bg-slate-50">
                  {campaign.body}
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  متغیرها هنگام ارسال برای هر مشتری جایگزین می‌شوند.
                </p>
              </div>
              <p className="text-[10px] text-slate-500">{CAMPAIGN_MEASUREMENT_NOTE}</p>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-edge">
          {result ? (
            <button
              type="button"
              onClick={() => onSent(result)}
              className="px-4 py-1.5 bg-sky-500 text-white rounded-xl text-xs font-bold"
            >
              بستن
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600">
                انصراف
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !preview || preview.total === 0}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold"
              >
                {sending ? "در حال ساخت پیام‌ها..." : `تایید و ارسال به ${preview?.total ?? 0} نفر`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
