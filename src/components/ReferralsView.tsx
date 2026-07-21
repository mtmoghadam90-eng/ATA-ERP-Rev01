import React, { useState } from 'react';
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
import { ProjectCategoryGroup, Project, ERPSettings, ModuleNotification } from '../types';
import type { User } from '../types';
import { compressImage } from '../imageUtils';

interface ReferralsViewProps {
  initialTab?: 'toMe' | 'fromMe' | 'notifications';
  projectCategoryGroups: ProjectCategoryGroup[];
  projects: Project[];
  settings: ERPSettings;
  moduleNotifications: ModuleNotification[];
  markModuleNotificationAsRead: (id: string) => void;
  markAllModuleNotificationsAsRead: () => void;
  respondToReferral: (
    categoryGroupId: string,
    activityId: string,
    responseText: string,
    responderName: string,
    attachment?: { name: string; size: string; content?: string } | null,
    markAsDone?: boolean,
    forwardTo?: string
  ) => void;
  toggleReferralStatus: (categoryGroupId: string, activityId: string) => void;
  currentUser: User | null;
  users: User[];
  readItems: string[];
  markItemsAsRead: (items: string[]) => void;
  onViewProjectActivities?: (projectId: string) => void;
  onViewCustomerDetails?: (customerName: string) => void;
}

export default function ReferralsView({
  projectCategoryGroups,
  projects,
  settings,
  moduleNotifications,
  markModuleNotificationAsRead,
  markAllModuleNotificationsAsRead,
  respondToReferral,
  toggleReferralStatus,
  initialTab,
  currentUser,
  users,
  readItems,
  markItemsAsRead,
  onViewProjectActivities,
  onViewCustomerDetails
}: ReferralsViewProps) {
  const readItemsSet = new Set(readItems);
  const currentUserName = currentUser?.fullName || 'محمد توکل مقدم';
  const isManagerOrAdmin = currentUser?.role === 'admin' || currentUser?.isSystemAdmin;

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



  const toggleCard = (groupId: string) => {
    setExpandedCards(prev => ({
      ...prev,
      [groupId]: prev[groupId] === undefined ? false : !prev[groupId]
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

  // Group referrals by category group
  const groupedReferrals = projectCategoryGroups.map(group => {
    const groupReferrals = (group.activities || [])
      .filter(act => act.referral !== null && act.referral !== undefined)
      .map(act => ({
        activity: act,
        referral: act.referral!
      }))
      .filter(item => {
        const matchesTab = activeTab === 'toMe' 
          ? item.referral.assignedTo === currentUserName
          : item.referral.assignedBy === currentUserName;

        const matchesProject = filterProject === 'all' || group.projectId === filterProject;

        return matchesTab && matchesProject;
      })
      // Sort referrals inside the group chronologically (older first, newer below)
      .sort((a, b) => {
        const timeA = parseInt((a.referral.id || '').split('-')[1] || '0', 10);
        const timeB = parseInt((b.referral.id || '').split('-')[1] || '0', 10);
        return timeA - timeB;
      });

    return {
      group,
      referrals: groupReferrals
    };
  }).filter(g => g.referrals.length > 0)
  .sort((a, b) => {
    // Sort groups: groups with pending actions first, then by most recent activity
    const hasPendingA = a.referrals.some(r => (r.referral.status || 'در انتظار اقدام') === 'در انتظار اقدام');
    const hasPendingB = b.referrals.some(r => (r.referral.status || 'در انتظار اقدام') === 'در انتظار اقدام');
    
    if (hasPendingA && !hasPendingB) return -1;
    if (!hasPendingA && hasPendingB) return 1;

    const latestTimeA = Math.max(...a.referrals.map(r => parseInt((r.referral.id || '').split('-')[1] || '0', 10)));
    const latestTimeB = Math.max(...b.referrals.map(r => parseInt((r.referral.id || '').split('-')[1] || '0', 10)));

    return latestTimeB - latestTimeA;
  });

  // Calculate pending count for badge
  const pendingToMeCount = projectCategoryGroups.flatMap(g => 
    (g.activities || []).filter(a => a.referral?.assignedTo === currentUserName && (a.referral?.status || 'در انتظار اقدام') === 'در انتظار اقدام')
  ).length;

  // Extract unique projects for filter dropdown
  const uniqueProjects = Array.from(
    new Set(projectCategoryGroups.filter(g => g.activities?.some(a => a.referral)).map(g => g.projectId))
  );

  // Notifications for category groups where current user is responsible
  const groupedNotifications = projectCategoryGroups
    .filter(group => filterProject === 'all' || group.projectId === filterProject)
    .map(group => {
      const cat = settings?.activityCategories?.find(c => c.id === group.categoryId);
      const isResponsible = isManagerOrAdmin || cat?.responsibleUserId === currentUserName;
      
      const project = projects.find(p => p.id === group.projectId);
      const items: any[] = [];
      
      (group.activities || []).forEach(act => {
        // Base Activity - only visible if responsible
        if (isResponsible && act.createdBy !== currentUserName) {
          items.push({
            type: 'activity',
            activity: act,
            timestamp: parseInt((act.id || '').split('-').pop() || '0', 10)
          });
        }

        // Referral responses (if any)
        if (act.referral) {
          let messages = act.referral.messages ? [...act.referral.messages] : [];
          if (messages.length === 0 && act.referral.response) {
            messages = [act.referral.response];
          }
          
          messages.forEach((msg, idx) => {
             // Visible if responsible, OR if the current user is the one who assigned the referral
             if ((isResponsible || act.referral?.assignedBy === currentUserName) && msg.responder !== currentUserName) {
               items.push({
                 type: 'message',
                 activity: act,
                 message: msg,
                 timestamp: msg.id ? parseInt((msg.id || '').split('-').pop() || '0', 10) : parseInt((act.id || '').split('-').pop() || '0', 10) + idx + 1
               });
             }
          });
        }
      });
      items.sort((a, b) => a.timestamp - b.timestamp);
      return { group, project, items };
    })
    .filter(g => g.items.length > 0)
    .sort((a, b) => {
      const latestA = a.items[a.items.length - 1]?.timestamp || 0;
      const latestB = b.items[b.items.length - 1]?.timestamp || 0;
      return latestB - latestA;
    });

  const myModuleNotifications = moduleNotifications.filter(n => n.responsibleName === currentUserName);
  
  const unreadCount = groupedNotifications.reduce((acc, g) => {
    return acc + g.items.filter((item: any) => {
      const id = item.type === 'message' ? (item.message.id || `${item.activity.id}-msg-${item.timestamp}`) : item.activity.id;
      return !readItemsSet.has(id);
    }).length;
  }, 0) + myModuleNotifications.filter(n => !n.read).length;

  const handleReplySubmit = (groupId: string, activityId: string, markAsDone: boolean) => {
    const text = replyText[`${groupId}-${activityId}`] || '';
    const attachment = replyAttachments[`${groupId}-${activityId}`] || null;
    const forwardTo = forwardToMap[`${groupId}-${activityId}`] || undefined;

    let textToSave = text.trim();
    if (!textToSave && !attachment && !forwardTo) {
      if (markAsDone) {
        toggleReferralStatus(groupId, activityId);
        alert('وضعیت اقدام با موفقیت به انجام شده تغییر یافت.');
        return;
      }
      alert('لطفاً پیام، پیوست یا شخص ارجاع شونده را مشخص کنید.');
      return;
    }
    
    if (forwardTo && !textToSave) {
      textToSave = 'ارجاع به همکار';
    }

    respondToReferral(groupId, activityId, textToSave, currentUserName, attachment, markAsDone, forwardTo);
    setReplyText(prev => ({
      ...prev,
      [`${groupId}-${activityId}`]: ''
    }));
    setReplyAttachments(prev => ({
      ...prev,
      [`${groupId}-${activityId}`]: null
    }));
    if (markAsDone) {
      alert('نتیجه اقدام با موفقیت ثبت شد.');
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
            {uniqueProjects.map(projId => {
              const proj = projects.find(p => p.id === projId);
              return (
                <option key={projId} value={projId}>
                  {proj ? `${proj.name} (${proj.code})` : (projId === 'proj-1' ? 'مخازن اهواز ۳' : `کد ${projId}`)}
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
                            {item.type === 'message' ? item.message.createdAt : item.activity.createdAt}
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
        ) : groupedReferrals.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-slate-100 shadow-sm space-y-3">
            <Inbox className="mx-auto text-slate-300" size={48} />
            <p className="text-sm text-slate-500 font-medium">هیچ اقدام یا ارجاعی در این کارتابل یافت نشد.</p>
          </div>
        ) : (
          groupedReferrals.map(({ group, referrals }, idx) => {
            const isPending = referrals.some(r => (r.referral.status || 'در انتظار اقدام') === 'در انتظار اقدام');
            const proj = projects.find(p => p.id === group.projectId);
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
                        {referrals[referrals.length - 1]?.referral?.createdAt || ''}
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
                                <span className="font-mono text-[10px] text-emerald-600">{msg.createdAt}</span>
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
                                value={replyText[`${group.id}-${activity.id}`] || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setReplyText(prev => ({
                                    ...prev,
                                    [`${group.id}-${activity.id}`]: val
                                  }));
                                }}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none text-right placeholder-slate-400"
                              />

                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <select
                                  value={forwardToMap[`${group.id}-${activity.id}`] || ''}
                                  onChange={(e) => setForwardToMap(prev => ({...prev, [`${group.id}-${activity.id}`]: e.target.value}))}
                                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-600 focus:border-sky-500 outline-none"
                                >
                                  <option value="">-- ارجاع به همکار (اختیاری) --</option>
                                  {users.filter(u => u.fullName !== currentUserName).map(u => (
                                    <option key={u.id} value={u.fullName}>{u.fullName} - {u.position || u.role}</option>
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
                                              [`${group.id}-${activity.id}`]: {
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

                                  {replyAttachments[`${group.id}-${activity.id}`] && (
                                    <div className="flex items-center gap-2 bg-sky-50 text-sky-700 text-xs px-2.5 py-1 rounded-lg border border-sky-100 font-medium">
                                      <span>{replyAttachments[`${group.id}-${activity.id}`]?.name} ({replyAttachments[`${group.id}-${activity.id}`]?.size})</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setReplyAttachments(prev => ({
                                            ...prev,
                                            [`${group.id}-${activity.id}`]: null
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
                                    onClick={() => handleReplySubmit(group.id, activity.id, false)}
                                    className="px-6 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-sky-500/15 flex items-center justify-center gap-1.5 min-h-[42px]"
                                  >
                                    <MessageSquare size={15} />
                                    ارسال پیام
                                  </button>
                                  {isItemPending && currentUserName === referral.assignedTo && (
                                    <button
                                      type="button"
                                      onClick={() => handleReplySubmit(group.id, activity.id, true)}
                                      className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-500/15 flex items-center justify-center gap-1.5 min-h-[42px]"
                                    >
                                      <CheckCircle2 size={15} />
                                      ثبت اتمام کار
                                    </button>
                                  )}
                                  {!isItemPending && currentUserName === referral.assignedBy && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        toggleReferralStatus(group.id, activity.id);
                                        alert('ارجاع مجدداً در وضعیت در انتظار اقدام قرار گرفت.');
                                      }}
                                      className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-amber-500/15 flex items-center justify-center gap-1.5 min-h-[42px]"
                                    >
                                      <RefreshCcw size={15} />
                                      بازگشایی ارجاع مجدد
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
