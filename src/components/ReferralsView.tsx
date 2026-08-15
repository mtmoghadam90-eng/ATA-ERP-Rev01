import React, { useState, useEffect } from 'react';
import { 
  Inbox, 
  CheckCircle2, 
  Clock, 
  Send, 
  User as UserIcon, 
  Briefcase, 
  MessageSquare, 
  ChevronLeft,
  FileCheck2,
  Calendar,
  Paperclip,
  ChevronDown,
  ChevronUp,
  RefreshCcw,
  Bell
} from 'lucide-react';
import { ERPSettings } from '../types';
import type { User } from '../types';
import { compressImage } from '../imageUtils';
import { toShamsiStr } from '../dateUtils';
import { ApiError } from '../api/client';
import { NotificationRow, ReferralRow, inboxApi } from '../api/inbox';
import { useRevalidate } from '../api/liveData';
import { useUserDirectory } from '../api/useUserDirectory';

/**
 * The inbox: referrals to and from the signed-in user, plus their notices.
 *
 * Everything here is scoped to the caller by the server, so nothing is filtered
 * by name in the browser any more — which also fixes two things the document
 * store got wrong: notices were addressed by display name, so people sharing a
 * name shared an inbox, and "read" was one shared array for the whole company.
 */
interface ReferralsViewProps {
  initialTab?: 'toMe' | 'fromMe' | 'notifications';
  settings: ERPSettings;
  currentUser: User | null;
  onViewProjectActivities?: (projectId: string) => void;
  onViewCustomerDetails?: (customerName: string) => void;
}

export default function ReferralsView({
  settings,
  initialTab,
  currentUser,
  onViewProjectActivities,
  onViewCustomerDetails
}: ReferralsViewProps) {
  const currentUserName = currentUser?.fullName || '';
  const { users } = useUserDirectory();

  const [activeTab, setActiveTab] = useState<'toMe' | 'fromMe' | 'notifications'>(initialTab || 'toMe');
  React.useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [replyAttachments, setReplyAttachments] = useState<Record<string, { name: string; size: string; content?: string } | null>>({});
  const [forwardToMap, setForwardToMap] = useState<Record<string, string>>({});
  const [filterProject, setFilterProject] = useState<string>('all');
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [expandedNotificationGroups, setExpandedNotificationGroups] = useState<Record<string, boolean>>({});

  /* ------------------------------- data ------------------------------- */

  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [notificationsUnread, setNotificationsUnread] = useState(0);
  const [readItemsSet, setReadItemsSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const refresh = () => setReloadToken(n => n + 1);

  /** Reports a failed call using the server's own Persian sentence. */
  const reportError = (err: unknown, fallback: string) => {
    if (err instanceof ApiError) {
      alert(err.message);
      return;
    }
    // Not a refusal from the server: a bug on this side, and until now it read
    // exactly like one — the same generic sentence, with the real cause only in
    // a console nobody has open. The detail goes on the alert too.
    console.error(fallback, err);
    alert(`${fallback}\n\n${(err as Error)?.message ?? String(err)}`);
  };

  /**
   * Timestamps arrive as real datetimes now, not the Shamsi strings the
   * document store kept, so they are converted for display — otherwise the
   * cards read "2026-08-03T03:23:08.158Z".
   */
  const shamsi = (iso: string | undefined | null) => (iso ? toShamsiStr(new Date(iso)) : '');

  /* The two referral tabs are one query with a different scope. The server
     decides what "mine" means from the session, so no name is compared here. */
  useEffect(() => {
    if (activeTab === 'notifications') return;
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    inboxApi.referrals({
      scope: activeTab, pageSize: 200, sort: 'createdAt', order: 'desc',
    }, controller.signal)
      .then((data) => {
        if (cancelled) return;
        setReferrals(data.rows);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof ApiError ? err.message : 'دریافت ارجاعات با خطا مواجه شد.');
        setReferrals([]);
        setLoading(false);
      });

    return () => { cancelled = true; controller.abort(); };
  }, [activeTab, reloadToken]);

  /* Notices, and which inbox items this user has already seen. */
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    inboxApi.notifications({ pageSize: 200 }, controller.signal)
      .then((data) => {
        if (cancelled) return;
        setNotifications(data.rows);
        setNotificationsUnread(data.unread);
      })
      .catch(() => { /* the badge simply stays as it was */ });

    return () => { cancelled = true; controller.abort(); };
  }, [reloadToken]);

  /* Both lists above re-run on `reloadToken`, so keeping them current is one
     subscription: a referral filed or answered anywhere in the app, by this
     user or picked up when the tab is looked at again. */
  useRevalidate(["referrals", "notifications", "activities"], () => setReloadToken(n => n + 1));

  const toggleCard = (groupId: string) => {
    // Cards render collapsed, so an untouched one has to open on the first
    // click. This set it to `false` instead — already its state — so the first
    // click on any card did nothing at all and it took two to open.
    setExpandedCards(prev => ({
      ...prev,
      [groupId]: !(prev[groupId] ?? false)
    }));
  };

  const toggleNotificationGroup = (groupId: string, items: any[]) => {
    const isExpanded = expandedNotificationGroups[groupId] ?? false;
    if (!isExpanded) {
      const toMark: string[] = [];
      items.forEach(item => {
        const id = item.type === 'message' ? (item.message.id || `${item.activity.id}-msg-${item.timestamp}`) : item.activity.id;
        if (!readItemsSet.has(id)) toMark.push(id);
      });
      if (toMark.length > 0) markItemsAsRead(toMark);
    }
    setExpandedNotificationGroups(prev => ({
      ...prev,
      [groupId]: !isExpanded
    }));
  };

  /**
   * The rows, grouped by the category they belong to.
   *
   * Rebuilt from the flat list the server returns rather than walked out of a
   * nested tree, and ordered by `createdAt`. The old code ordered by digits
   * pulled out of the record id — which was a timestamp once, and is now an
   * arbitrary run of digits inside a UUID.
   */
  const groupedReferrals = React.useMemo(() => {
    const visible = referrals.filter(
      r => filterProject === 'all' || r.activity?.group?.project?.id === filterProject,
    );

    const byGroup = new Map<string, { group: any; referrals: { activity: any; referral: any }[] }>();
    for (const row of visible) {
      const g = row.activity?.group;
      const key = g?.id ?? 'بدون دسته';
      if (!byGroup.has(key)) {
        byGroup.set(key, {
          group: {
            id: key,
            categoryName: g?.categoryName ?? 'بدون دسته‌بندی',
            projectId: g?.project?.id ?? '',
            projectName: g?.project?.name ?? '',
            projectCode: g?.project?.code ?? '',
            customerName: g?.project?.customer?.companyName ?? '',
          },
          referrals: [],
        });
      }
      byGroup.get(key)!.referrals.push({
        activity: {
          id: row.activity?.id ?? row.activityId,
          text: row.activity?.text ?? '',
          createdAt: row.activity?.createdAt ?? row.createdAt,
        },
        referral: {
          id: row.id,
          status: row.status,
          actionRequired: row.actionRequired ?? '',
          assignedTo: row.assignedToName ?? '',
          assignedBy: row.assignedByName ?? '',
          /*
           * Who these people actually are.
           *
           * Which buttons a card offers used to be decided by comparing the
           * signed-in user's *full name* with the name stored on the referral.
           * That is not an identity: two colleagues can share a name, a renamed
           * account stops matching its own past referrals, and a referral whose
           * `assignedByName` was never filled in matched nobody — so the person
           * who raised it saw no way to carry on the conversation, which is
           * exactly what was reported.
           */
          assignedToUserId: row.assignedToUserId ?? null,
          assignedByUserId: row.assignedByUserId ?? null,
          createdAt: row.createdAt,
          messages: row.messages.map(m => ({
            id: m.id,
            text: m.text,
            responder: m.responderName ?? '',
            createdAt: m.createdAt,
            attachment: m.attachmentUrl
              ? { name: m.attachmentName ?? '', size: m.attachmentSize ?? '', url: m.attachmentUrl }
              : null,
          })),
        },
      });
    }

    const time = (v: string | undefined) => (v ? new Date(v).getTime() : 0);

    return [...byGroup.values()]
      .map(g => ({
        ...g,
        // Oldest first inside a group, so a thread reads downwards.
        referrals: [...g.referrals].sort((a, b) => time(a.referral.createdAt) - time(b.referral.createdAt)),
      }))
      .sort((a, b) => {
        const pendingA = a.referrals.some(r => (r.referral.status || 'در انتظار اقدام') === 'در انتظار اقدام');
        const pendingB = b.referrals.some(r => (r.referral.status || 'در انتظار اقدام') === 'در انتظار اقدام');
        if (pendingA && !pendingB) return -1;
        if (!pendingA && pendingB) return 1;

        const latestA = Math.max(...a.referrals.map(r => time(r.referral.createdAt)));
        const latestB = Math.max(...b.referrals.map(r => time(r.referral.createdAt)));
        return latestB - latestA;
      });
  }, [referrals, filterProject]);

  /** Waiting on me. Only meaningful on the toMe tab, which is where it shows. */
  const pendingToMeCount = React.useMemo(
    () => (activeTab === 'toMe'
      ? referrals.filter(r => (r.status || 'در انتظار اقدام') === 'در انتظار اقدام').length
      : 0),
    [referrals, activeTab],
  );

  /** Projects present in the current result, for the filter dropdown. */
  const projectOptions = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of referrals) {
      const p = r.activity?.group?.project;
      if (p && !seen.has(p.id)) seen.set(p.id, p.name);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [referrals]);

  /** Replies from other people, grouped by the referral they belong to. */
  const groupedNotifications = React.useMemo(() => {
    const groups = referrals
      .filter(r => filterProject === 'all' || r.activity?.group?.project?.id === filterProject)
      .map(r => ({
        group: {
          id: r.id,
          categoryName: r.activity?.group?.categoryName ?? 'بدون دسته‌بندی',
          projectId: r.activity?.group?.project?.id ?? '',
        },
        project: r.activity?.group?.project ?? null,
        items: r.messages
          // Your own reply is not news to you.
          .filter(m => m.responderUserId !== currentUser?.id)
          .map(m => ({
            type: 'message' as const,
            activity: { id: r.activity?.id ?? r.activityId, text: r.activity?.text ?? '' },
            message: { id: m.id, text: m.text, responder: m.responderName ?? '', createdAt: m.createdAt },
            timestamp: new Date(m.createdAt).getTime(),
          })),
      }))
      .filter(g => g.items.length > 0);

    return groups.sort((a, b) =>
      (b.items[b.items.length - 1]?.timestamp || 0) - (a.items[a.items.length - 1]?.timestamp || 0));
  }, [referrals, filterProject, currentUser?.id]);

  const myModuleNotifications = React.useMemo(
    () => notifications.map(n => ({
      id: n.id, module: n.module, title: n.title, description: n.description,
      timestamp: new Date(n.createdAt).getTime(), read: n.isRead, responsibleName: currentUserName,
    })),
    [notifications, currentUserName],
  );

  const unreadCount =
    groupedNotifications.reduce(
      (acc, g) => acc + g.items.filter(item => !readItemsSet.has(item.message.id)).length, 0,
    ) + notificationsUnread;

  /* Which of the visible inbox items this user has already seen. Asked for by
     id, so it reflects this user only — the store's read list was shared. */
  useEffect(() => {
    const ids = groupedNotifications.flatMap(g => g.items.map(i => i.message.id));
    if (ids.length === 0) return;
    let cancelled = false;
    const controller = new AbortController();
    inboxApi.readReceipts(ids, controller.signal)
      .then((read) => { if (!cancelled) setReadItemsSet(new Set(read)); })
      .catch(() => { /* unread is the safe default */ });
    return () => { cancelled = true; controller.abort(); };
  }, [groupedNotifications]);

  const markItemsAsRead = async (ids: string[]) => {
    if (ids.length === 0) return;
    setReadItemsSet(prev => new Set([...prev, ...ids]));
    try {
      await inboxApi.markItemsRead(ids);
    } catch {
      // Put them back rather than showing them as read when they are not.
      setReadItemsSet(prev => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    }
  };

  const markModuleNotificationAsRead = async (id: string) => {
    try {
      await inboxApi.markNotificationRead(id);
      refresh();
    } catch (err) {
      reportError(err, 'ثبت خوانده‌شدن اعلان با خطا مواجه شد.');
    }
  };

  const markAllModuleNotificationsAsRead = async () => {
    try {
      await inboxApi.markAllNotificationsRead();
      refresh();
    } catch (err) {
      reportError(err, 'ثبت خوانده‌شدن اعلان‌ها با خطا مواجه شد.');
    }
  };

  /**
   * Records the response to a referral.
   *
   * What was one store call is three distinct operations on the server — a
   * reply, a status change, a reassignment — because each has its own rule
   * about who may do it. They are applied in that order so that forwarding
   * leaves the thread reading correctly: the reply is already there when the
   * next person opens it.
   */
  const handleReplySubmit = async (
    referralId: string,
    outcome: 'none' | 'done' | 'reopen' = 'none',
  ) => {
    const text = replyText[referralId] || '';
    const attachment = replyAttachments[referralId] || null;
    const forwardTo = forwardToMap[referralId] || undefined;

    let textToSave = text.trim();
    if (!textToSave && !attachment && !forwardTo) {
      if (outcome !== 'none') {
        const next = outcome === 'done' ? 'انجام شده' : 'در انتظار اقدام';
        try {
          await inboxApi.setReferralStatus(referralId, next);
          refresh();
          alert(outcome === 'done'
            ? 'وضعیت اقدام با موفقیت به انجام شده تغییر یافت.'
            : 'ارجاع مجدداً در وضعیت در انتظار اقدام قرار گرفت.');
        } catch (err) {
          reportError(err, 'تغییر وضعیت ارجاع با خطا مواجه شد.');
        }
        return;
      }
      alert('لطفاً پیام، پیوست یا شخص ارجاع شونده را مشخص کنید.');
      return;
    }

    if (forwardTo && !textToSave) {
      textToSave = 'ارجاع به همکار';
    }

    try {
      await inboxApi.replyToReferral(referralId, {
        text: textToSave,
        attachmentName: attachment?.name ?? null,
        attachmentSize: attachment?.size ?? null,
        attachmentUrl: attachment?.content ?? null,
        // Forwarding puts the thread in the next person's referral inbox, so
        // the reply must not also raise a notice about itself.
        andForwarded: !!forwardTo,
      });

      // Forwarding sets its own status, so only apply an outcome when not
      // forwarding. `reopen` is the person who raised it saying the work is
      // not what they meant: the reply is already on the thread, and putting
      // the referral back to "در انتظار اقدام" is what puts it back in the
      // assignee's inbox and back into their counter.
      if (outcome === 'done' && !forwardTo) {
        await inboxApi.setReferralStatus(referralId, 'انجام شده', true);
      } else if (outcome === 'reopen' && !forwardTo) {
        await inboxApi.setReferralStatus(referralId, 'در انتظار اقدام', true);
      }
      if (forwardTo) {
        await inboxApi.reassignReferral(referralId, forwardTo);
      }

      setReplyText(prev => ({ ...prev, [referralId]: '' }));
      setReplyAttachments(prev => ({ ...prev, [referralId]: null }));
      setForwardToMap(prev => ({ ...prev, [referralId]: '' }));
      refresh();

      if (forwardTo) alert('ارجاع به همکار انتخاب‌شده منتقل شد.');
      else if (outcome === 'done') alert('نتیجه اقدام با موفقیت ثبت شد.');
      else if (outcome === 'reopen') alert('پاسخ شما ثبت شد و ارجاع دوباره در انتظار اقدام قرار گرفت.');
    } catch (err) {
      reportError(err, 'ثبت پاسخ ارجاع با خطا مواجه شد.');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in text-right" dir="rtl">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">کارتابل ارجاعات و اقدام‌ها</h1>
          <p className="text-slate-500 text-sm mt-1">مدیریت کارهای ارجاع‌شده بین همکاران، ثبت نتایج کارها و پیگیری وضعیت اقدامات پروژه‌ها</p>
        </div>
      </div>

      {/* Controls: Tabs & Project Filter */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-1">
        {/* Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('toMe')}
            className={`py-3 px-6 text-sm font-bold border-b-2 transition flex items-center gap-2 ${
              activeTab === 'toMe'
                ? 'border-sky-500 text-sky-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Inbox size={16} />
            ارجاع‌شده به من
            {pendingToMeCount > 0 && (
              <span className="bg-rose-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold animate-pulse">
                {pendingToMeCount} کار جدید
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('fromMe')}
            className={`py-3 px-6 text-sm font-bold border-b-2 transition flex items-center gap-2 ${
              activeTab === 'fromMe'
                ? 'border-sky-500 text-sky-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Send size={16} />
            ارجاع‌شده توسط من
          </button>
          <button
            onClick={() => setActiveTab('notifications')}
            className={`py-3 px-6 text-sm font-bold border-b-2 transition flex items-center gap-2 relative ${
              activeTab === 'notifications'
                ? 'border-sky-500 text-sky-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Bell size={16} />
            اعلان‌های دسته‌بندی‌ها
            {unreadCount > 0 && (
              <span className="absolute top-2 left-2 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500 text-[9px] text-white items-center justify-center font-mono pt-[1px]">{unreadCount > 9 ? '9+' : unreadCount}</span>
              </span>
            )}
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-slate-500 whitespace-nowrap">فیلتر پروژه:</span>
          <select
            value={filterProject}
            onChange={(e) => setFilterProject(e.target.value)}
            className="border border-slate-200 rounded-lg text-xs py-2 px-3 bg-white text-right outline-none focus:ring-2 focus:ring-sky-500/20"
          >
            <option value="all">همه پروژه‌ها</option>
            {/* Only the projects actually present in this inbox — the whole
                project list is neither loaded here nor useful as a filter. */}
            {projectOptions.map(proj => {
              return (
                <option key={proj.id} value={proj.id}>
                  {proj.name}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {/* Referrals List */}
      <div className="space-y-4">
        {activeTab === 'notifications' ? (
          groupedNotifications.length === 0 && myModuleNotifications.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-slate-100 shadow-sm space-y-3">
              <Bell className="mx-auto text-slate-300" size={48} />
              <p className="text-sm text-slate-500 font-medium">هیچ اعلانی یافت نشد.</p>
            </div>
          ) : (
            <>
            {myModuleNotifications.map((notif) => (
              <div 
                key={`mnotif-${notif.id}`} 
                className={`bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md ${!notif.read ? 'border-r-4 border-r-rose-400 bg-rose-50/10' : 'border-r-4 border-r-slate-300'}`}
              >
                <div className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Bell size={16} className={notif.read ? "text-slate-400" : "text-rose-500 animate-pulse"} />
                      <h4 className={`text-sm font-bold ${notif.read ? 'text-slate-600' : 'text-slate-800'}`}>
                        {notif.title}
                      </h4>
                      {!notif.read && (
                        <span className="bg-rose-100 text-rose-600 text-[10px] px-2 py-0.5 rounded-full font-bold">
                          جدید
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 pr-6 leading-relaxed">
                      {notif.description}
                    </p>
                    <div className="text-[10px] text-slate-400 pr-6 pt-1">
                      {new Date(notif.timestamp).toLocaleDateString('fa-IR', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  
                  {!notif.read && (
                    <button
                      onClick={() => markModuleNotificationAsRead(notif.id)}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-lg transition"
                    >
                      علامت خوانده شده
                    </button>
                  )}
                </div>
              </div>
            ))}
            
            {groupedNotifications.map(({ group, project, items }, idx) => {
              const isExpanded = expandedNotificationGroups[group.id] ?? false;
              
              // Count unread in this group
              const unreadInGroup = items.filter((item: any) => {
                const id = item.type === 'message' ? (item.message.id || `${item.activity.id}-msg-${item.timestamp}`) : item.activity.id;
                return !readItemsSet.has(id);
              }).length;

              return (
              <div 
                key={`notif-${group.id}-${idx}`} 
                className={`bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md ${unreadInGroup > 0 ? 'border-r-4 border-r-rose-400' : 'border-r-4 border-r-slate-300'}`}
              >
                <div 
                  onClick={() => toggleNotificationGroup(group.id, items)}
                  className="bg-slate-50/80 hover:bg-slate-100 px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 cursor-pointer select-none transition-colors"
                >
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5 font-bold text-slate-700">
                      <Briefcase size={14} className="text-sky-500" />
                      <span
                        onClick={(e) => {
                          if (onViewProjectActivities) {
                            e.stopPropagation();
                            onViewProjectActivities(group.projectId);
                          }
                        }}
                        className="text-sky-600 hover:text-sky-800 hover:underline cursor-pointer transition-colors"
                        title="مشاهده فعالیت‌های پروژه"
                      >
                        {project ? `${project.name} (${project.code})` : (group.projectId === 'proj-1' ? 'مخازن اهواز ۳' : 'پروژه')}
                      </span>
                    </div>
                    <div className="hidden sm:block w-1 h-1 rounded-full bg-slate-300"></div>
                    <div className="flex items-center gap-1.5 font-bold text-slate-600 bg-white px-2.5 py-1 rounded-md border border-slate-150 shadow-sm">
                      <Clock size={13} className="text-amber-500" />
                      {group.categoryName}
                    </div>
                    {unreadInGroup > 0 && (
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-100 relative">
                        <span className="flex h-2 w-2 relative">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                        </span>
                        {unreadInGroup} اعلان جدید
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-bold">
                      {items.length} اعلان
                    </span>
                    {isExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="p-4 sm:p-5 bg-white space-y-4">
                    {items.map((item: any, i: number) => (
                      <div key={`notif-item-${i}`} className={`flex flex-col gap-3 pb-4 ${i !== items.length - 1 ? 'border-b border-slate-100' : ''}`}>
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-2">
                            <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${item.type === 'message' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}`}>
                              {item.type === 'message' ? `ثبت شده توسط: ${item.message.responder}` : `ثبت شده توسط: ${item.activity.createdBy || 'کاربر سیستم'}`}
                            </div>
                            {item.type === 'message' && (
                              <div className="flex items-center gap-1 text-[10px] font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded border border-sky-100">
                                <MessageSquare size={12} />
                                پاسخ به ارجاع
                              </div>
                            )}
                          </div>
                          <span className="text-slate-400 font-mono flex items-center gap-1 bg-slate-50 px-2 py-1 rounded border border-slate-100 text-[10px]">
                            <Calendar size={12} />
                            {shamsi(item.type === "message" ? item.message.createdAt : item.activity.createdAt)}
                          </span>
                        </div>

                        <div className="text-sm text-slate-700 font-medium whitespace-pre-wrap leading-relaxed px-1">
                          {item.type === 'message' ? item.message.text : item.activity.text}
                        </div>
                        
                        {((item.type === 'message' && item.message.attachment) || (item.type === 'activity' && item.activity.attachment)) && (
                          <div className="mt-1 pt-2">
                            {(item.type === 'message' ? item.message.attachment : item.activity.attachment).content ? (
                              <a
                                href={(item.type === 'message' ? item.message.attachment : item.activity.attachment).content}
                                download={(item.type === 'message' ? item.message.attachment : item.activity.attachment).name}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold transition group"
                                title="دانلود فایل پیوست"
                              >
                                <Paperclip size={14} className="text-slate-400 group-hover:text-slate-600" />
                                <span>{(item.type === 'message' ? item.message.attachment : item.activity.attachment).name}</span>
                                <span className="text-slate-400">({(item.type === 'message' ? item.message.attachment : item.activity.attachment).size})</span>
                              </a>
                            ) : (
                              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 text-xs font-bold">
                                <Paperclip size={14} />
                                <span>{(item.type === 'message' ? item.message.attachment : item.activity.attachment).name}</span>
                                <span className="text-slate-400">({(item.type === 'message' ? item.message.attachment : item.activity.attachment).size})</span>
                              </div>
                            )}
                          </div>
                        )}
                        
                        {item.type === 'message' && (
                           <div className="mt-2 text-[10px] bg-slate-50 p-2.5 rounded-lg text-slate-500 border border-slate-100 flex gap-2 items-start">
                              <MessageSquare size={12} className="text-slate-400 mt-0.5 shrink-0" />
                              <div>
                                <span className="font-bold">ارجاع اصلی: </span>
                                <span>{item.activity.text}</span>
                              </div>
                           </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              );
            })}
            </>
          )
        ) : error ? (
          <div className="bg-rose-50 border border-rose-100 text-rose-600 text-xs font-bold rounded-2xl p-4 flex items-center justify-between gap-3" id="referrals-error">
            <span>{error}</span>
            <button
              type="button"
              onClick={refresh}
              className="px-3 py-1.5 bg-white border border-rose-200 hover:bg-rose-50 rounded-lg text-[11px] font-bold transition"
            >
              تلاش دوباره
            </button>
          </div>
        ) : loading ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-slate-100 shadow-sm text-xs text-slate-400" id="referrals-loading">
            در حال دریافت کارتابل…
          </div>
        ) : groupedReferrals.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-slate-100 shadow-sm space-y-3">
            <Inbox className="mx-auto text-slate-300" size={48} />
            <p className="text-sm text-slate-500 font-medium">هیچ اقدام یا ارجاعی در این کارتابل یافت نشد.</p>
          </div>
        ) : (
          groupedReferrals.map(({ group, referrals }, idx) => {
            const isPending = referrals.some(r => (r.referral.status || 'در انتظار اقدام') === 'در انتظار اقدام');
            // The project rides along with the row, joined by the server.
            const proj = group.projectId
              ? {
                  id: group.projectId, name: group.projectName,
                  code: group.projectCode, customerName: group.customerName,
                }
              : undefined;
            const isExpanded = expandedCards[group.id] ?? false; // Collapsed by default

            return (
              <div 
                key={`${group.id}-${idx}`} 
                className={`bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md ${
                  isPending ? 'border-r-4 border-r-sky-500' : 'border-r-4 border-r-emerald-500 bg-slate-50/20'
                }`}
              >
                {/* Header Context Bar */}
                <div 
                  onClick={() => toggleCard(group.id)}
                  className="cursor-pointer bg-slate-50/80 hover:bg-slate-100 px-6 py-3 border-b border-slate-100 flex flex-wrap justify-between items-center gap-3 transition-colors select-none"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <Briefcase size={14} className="text-slate-400" />
                      <span className="font-bold text-slate-700">پروژه:</span>
                      <span
                        onClick={(e) => {
                          if (onViewProjectActivities) {
                            e.stopPropagation();
                            onViewProjectActivities(group.projectId);
                          }
                        }}
                        className="font-bold text-sky-600 hover:text-sky-800 hover:underline cursor-pointer transition-colors"
                        title="مشاهده فعالیت‌های پروژه"
                      >
                        {proj ? `${proj.name} (${proj.code})` : (group.projectId === 'proj-1' ? 'نوسازی مخازن اهواز ۳' : group.projectId)}
                      </span>
                    </div>
                    {proj && (
                      <>
                        <span className="text-slate-300 hidden md:inline">|</span>
                        <div className="flex items-center gap-1">
                          <span className="font-bold text-slate-700">مشتری:</span>
                          <span 
                            onClick={(e) => {
                              if (onViewCustomerDetails) {
                                e.stopPropagation();
                                onViewCustomerDetails(proj.customerName);
                              }
                            }}
                            className="font-semibold text-sky-600 hover:text-sky-800 hover:underline cursor-pointer transition-colors"
                            title="مشاهده اطلاعات مشتری"
                          >
                            {proj.customerName}
                          </span>
                        </div>
                      </>
                    )}
                    <span className="text-slate-300">|</span>
                    <div className="flex items-center gap-1">
                      <span className="font-bold text-slate-700">دسته‌بندی:</span>
                      <span className="bg-slate-200/80 text-slate-700 px-2 py-0.5 rounded font-bold">{group.categoryName}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        isPending 
                          ? 'bg-sky-50 text-sky-700 border-sky-100 animate-pulse' 
                          : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                      }`}>
                        {isPending ? 'در انتظار اقدام' : 'انجام شده'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                        <Calendar size={12} />
                        {shamsi(referrals[referrals.length - 1]?.referral?.createdAt)}
                      </span>
                    </div>
                    <div className="text-slate-400 bg-white p-1 rounded-full shadow-sm border border-slate-100">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </div>
                </div>

                {/* Content */}
                {isExpanded && (
                  <div className="p-6 space-y-8 animate-fade-in">
                    {referrals.map((item, refIdx) => {
                    const { activity, referral } = item;
                    const isItemPending = (referral.status || 'در انتظار اقدام') === 'در انتظار اقدام';
                    /*
                     * By account, not by name.
                     *
                     * These were `currentUserName === referral.assignedBy`, a
                     * comparison of display names. A referral whose stored
                     * name did not match — an account since renamed, a name
                     * never filled in — matched nobody, and the person who
                     * raised it was left with no way to answer. The id is the
                     * identity; the name is a label.
                     */
                    const isAssignee = !!currentUser?.id && referral.assignedToUserId === currentUser.id;
                    const isReferrer = !!currentUser?.id && referral.assignedByUserId === currentUser.id;

                    return (
                      <div key={`${activity.id}-${refIdx}`} className={`${refIdx !== 0 ? 'pt-8 border-t-2 border-slate-100' : ''} space-y-4`}>
                        {/* Origin Activity */}
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-2">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
                            <MessageSquare size={14} className="text-slate-400" />
                            <span>فعالیت ثبت‌شده مرجع:</span>
                          </div>
                          <p className="text-sm text-slate-700 leading-relaxed">{activity.text}</p>
                          {activity.attachment && (
                            activity.attachment.content ? (
                              <a
                                href={activity.attachment.content}
                                download={activity.attachment.name}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-sky-50 hover:bg-sky-100 border border-sky-150 text-sky-700 hover:text-sky-800 text-[10px] font-bold mt-1 transition"
                                title="دانلود فایل پیوست"
                              >
                                <Paperclip size={11} />
                                <span>پیوست: {activity.attachment.name}</span>
                                <span className="text-sky-400">({activity.attachment.size})</span>
                              </a>
                            ) : (
                              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-sky-50 border border-sky-100 text-sky-700 text-[10px] font-bold mt-1">
                                <Paperclip size={11} />
                                <span>پیوست: {activity.attachment.name}</span>
                                <span className="text-sky-400">({activity.attachment.size})</span>
                              </div>
                            )
                          )}
                        </div>

                        {/* Referral specifics */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <UserIcon size={14} className="text-sky-500" />
                            <span>ارجاع‌دهنده: <strong className="text-slate-800">{referral.assignedBy}</strong></span>
                            <ChevronLeft size={12} className="text-slate-400" />
                            <span>ارجاع‌شونده (شما): <strong className="text-slate-800">{referral.assignedTo}</strong></span>
                          </div>

                          <div className="pt-2">
                            <span className="text-xs font-extrabold text-slate-400 block mb-1">اقدام خواسته‌شده:</span>
                            <p className="text-sm font-bold text-slate-800 bg-sky-50/40 p-3 rounded-lg border border-sky-100/50 leading-relaxed">
                              {referral.actionRequired}
                            </p>
                          </div>
                        </div>

                        {/* Reply section */}
                        <div className="pt-4 border-t border-slate-100 space-y-4">
                          {/* Messages List */}
                          {(referral.messages?.length ? referral.messages : (referral.response ? [referral.response] : [])).map((msg, msgIdx) => (
                            <div key={msgIdx} className="bg-emerald-50/30 p-4 rounded-xl border border-dashed border-emerald-200 animate-fade-in">
                              <div className="flex items-center justify-between text-xs font-bold text-emerald-800 mb-2">
                                <div className="flex items-center gap-1.5">
                                  <FileCheck2 size={16} className="text-emerald-600" />
                                  <span>{msg.responder} ({msg.responder === referral.assignedTo ? 'ارجاع شونده' : 'ارجاع دهنده'}):</span>
                                </div>
                                <span className="font-mono text-[10px] text-emerald-600">{shamsi(msg.createdAt)}</span>
                              </div>
                              <p className="text-sm text-slate-800 leading-relaxed font-medium bg-white/70 p-3 rounded-lg border border-emerald-100">
                                {msg.text}
                              </p>

                              {/* Response attachment if any */}
                              {msg.attachment && (
                                <div className="pt-2">
                                  {msg.attachment.content ? (
                                    <a
                                      href={msg.attachment.content}
                                      download={msg.attachment.name}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-100/60 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 hover:text-emerald-900 text-[10px] font-bold transition"
                                      title="دانلود فایل پیوست اقدام"
                                    >
                                      <Paperclip size={11} className="text-emerald-600" />
                                      <span>فایل پیوست: {msg.attachment.name}</span>
                                      <span className="text-emerald-500">({msg.attachment.size})</span>
                                    </a>
                                  ) : (
                                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-50 border border-emerald-100 text-emerald-700 text-[10px] font-bold">
                                      <Paperclip size={11} />
                                      <span>فایل پیوست: {msg.attachment.name}</span>
                                      <span className="text-emerald-500">({msg.attachment.size})</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}

                          {/* Active response form */}
                          <div className="pt-2">
                            <span className="text-xs font-extrabold text-slate-700 block mb-3">ارسال پیام یا ثبت نتیجه:</span>
                            <div className="flex flex-col gap-3">
                              <textarea
                                rows={2}
                                placeholder="لطفاً پیام یا نتیجه بررسی خود را به صورت متنی بنویسید..."
                                value={replyText[referral.id] || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setReplyText(prev => ({
                                    ...prev,
                                    [referral.id]: val
                                  }));
                                }}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right placeholder-slate-400"
                              />

                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <select
                                  value={forwardToMap[referral.id] || ''}
                                  onChange={(e) => setForwardToMap(prev => ({...prev, [referral.id]: e.target.value}))}
                                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-600 focus:border-sky-500 outline-none"
                                >
                                  <option value="">-- ارجاع به همکار (اختیاری) --</option>
                                  {users.filter(u => u.fullName !== currentUserName).map(u => (
                                    <option key={u.id} value={u.id}>{u.fullName}{u.position ? ` - ${u.position}` : ""}</option>
                                  ))}
                                </select>
                                {/* File upload section */}
                                <div className="flex items-center gap-3">
                                  <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-bold transition">
                                    <Paperclip size={14} className="text-slate-400" />
                                    <span>افزودن فایل پیوست</span>
                                    <input
                                      type="file"
                                      className="hidden"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                          if (file.size > 2 * 1024 * 1024 && !file.type.startsWith('image/')) {
                                            alert('حداکثر حجم مجاز برای فایل‌های غیرتصویری ۲ مگابایت می‌باشد.');
                                            if (e.target) e.target.value = '';
                                            return;
                                          }
                                          compressImage(file, (dataUrl, sizeStr) => {
                                            setReplyAttachments(prev => ({
                                              ...prev,
                                              [referral.id]: {
                                                name: file.name,
                                                size: sizeStr,
                                                content: dataUrl
                                              }
                                            }));
                                          });
                                        }
                                        if (e.target) e.target.value = '';
                                      }}
                                    />
                                  </label>

                                  {replyAttachments[referral.id] && (
                                    <div className="flex items-center gap-2 bg-sky-50 text-sky-700 text-xs px-2.5 py-1 rounded-lg border border-sky-100 font-medium">
                                      <span>{replyAttachments[referral.id]?.name} ({replyAttachments[referral.id]?.size})</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setReplyAttachments(prev => ({
                                            ...prev,
                                            [referral.id]: null
                                          }));
                                        }}
                                        className="text-rose-500 hover:text-rose-700 font-bold px-1"
                                        title="حذف فایل"
                                      >
                                        ×
                                      </button>
                                    </div>
                                  )}
                                </div>

                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleReplySubmit(referral.id, 'none')}
                                    className="px-6 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-sky-500/15 flex items-center justify-center gap-1.5 min-h-[42px]"
                                  >
                                    <MessageSquare size={15} />
                                    ارسال پیام
                                  </button>
                                  {isItemPending && isAssignee && (
                                    <button
                                      type="button"
                                      onClick={() => handleReplySubmit(referral.id, 'done')}
                                      className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-500/15 flex items-center justify-center gap-1.5 min-h-[42px]"
                                    >
                                      <CheckCircle2 size={15} />
                                      ثبت اتمام کار
                                    </button>
                                  )}
                                  {/*
                                    The conversation does not end when the
                                    assignee calls it done.
                                    
                                    Often that is when it really starts: the
                                    person who raised the referral reads the
                                    result and finds it is not what they asked
                                    for. Sending a message alone left the
                                    referral closed, so the assignee was never
                                    told to look again and the counter did not
                                    move; reopening alone said nothing about
                                    what was wanted. This does both — the reply
                                    goes on the same thread and the referral
                                    goes back to «در انتظار اقدام».
                                  */}
                                  {!isItemPending && isReferrer && (
                                    <button
                                      type="button"
                                      onClick={() => handleReplySubmit(referral.id, 'reopen')}
                                      className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-amber-500/15 flex items-center justify-center gap-1.5 min-h-[42px]"
                                    >
                                      <RefreshCcw size={15} />
                                      ثبت پاسخ و ارجاع مجدد
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

    </div>
  );
}
