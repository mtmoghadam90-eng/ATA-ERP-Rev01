import { api } from "./client";
import type {
  MeetingAssignee, MeetingItemKind, MeetingItemState, MeetingParticipant, MeetingStatus,
} from "../utils/meetingMinutes";
import type { ActivityAttachment } from "../utils/attachments";
import type { HandoffEntry } from "../utils/taskHandoff";

/** «صورتجلسات». Rows are what `meetingService.toRow` answers. */

export interface MeetingItemRow {
  id: string;
  topicId: string | null;
  lineNo: number;
  text: string;
  kind: MeetingItemKind;
  assignees: MeetingAssignee[];
  dueDateJalali: string | null;
  state: MeetingItemState;
  tasks: { userId: string; taskId: string; assigneeName: string; status: string | null }[];
}

export interface MeetingRow {
  id: string;
  code: string;
  title: string;
  meetingDateJalali: string | null;
  startTime: string | null;
  endTime: string | null;
  place: string | null;
  summary: string | null;
  /** The distinct projects its topics name; empty for an internal meeting. */
  projects: MeetingProjectRef[];
  status: MeetingStatus;
  attendees: MeetingParticipant[];
  absentees: MeetingParticipant[];
  nextMeetingDateJalali: string | null;
  attachments: ActivityAttachment[];
  createdByUserId: string | null;
  createdByName: string | null;
  finalizedByName: string | null;
  createdAt: string;
  canEdit: boolean;
  itemCount: number;
  actionCount: number;
  openActionCount: number;
  topicCount: number;
  topics: MeetingTopicRow[];
}

export interface MeetingProjectRef {
  id: string;
  code: string | null;
  name: string | null;
  customerName: string | null;
}

/** One subject on the agenda, with its project (null: internal) and its items. */
export interface MeetingTopicRow {
  /** Empty for the stand-in topic of a meeting stored before topics. */
  id: string;
  lineNo: number;
  title: string;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  customerName: string | null;
  discussion: string | null;
  conclusion: string | null;
  items: MeetingItemRow[];
}

export interface MeetingItemInput {
  id?: string | null;
  text: string;
  kind: MeetingItemKind;
  assignees: MeetingAssignee[];
  dueDate?: string | null;
}

export interface MeetingTopicInput {
  id?: string | null;
  title: string;
  projectId?: string | null;
  discussion?: string | null;
  conclusion?: string | null;
  items: MeetingItemInput[];
}

export interface MeetingInput {
  title: string;
  meetingDate: string;
  startTime?: string | null;
  endTime?: string | null;
  place?: string | null;
  summary?: string | null;
  attendees: MeetingParticipant[];
  absentees: MeetingParticipant[];
  nextMeetingDate?: string | null;
  attachments: ActivityAttachment[];
  topics: MeetingTopicInput[];
  finalize?: boolean;
}

export interface MeetingSaveResult {
  meeting: MeetingRow;
  createdTasks: number;
  cancelledTasks: number;
}

export interface CarryOverItem {
  meetingId: string;
  meetingCode: string;
  meetingTitle: string;
  meetingDateJalali: string | null;
  topicTitle: string;
  itemId: string;
  text: string;
  dueDateJalali: string | null;
  state: MeetingItemState;
  assignees: string[];
}

/** One action item, with the meeting it came from. */
export interface MeetingActionRow {
  itemId: string;
  lineNo: number;
  text: string;
  dueDateJalali: string | null;
  state: MeetingItemState;
  assignees: MeetingAssignee[];
  tasks: MeetingItemRow["tasks"];
  meetingId: string;
  meetingCode: string;
  meetingTitle: string;
  meetingDateJalali: string | null;
  meetingStatus: MeetingStatus;
  topicTitle: string;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
}

/** One task in an action row's trail (`meetingItemTrail` on the server). */
export interface MeetingTrailTask {
  id: string;
  previousTaskId: string | null;
  depth: number;
  title: string;
  description: string | null;
  status: string;
  assignedToName: string | null;
  createdByName: string | null;
  dueDateJalali: string | null;
  completedAtJalali: string | null;
  completionNote: string | null;
  attachments: ActivityAttachment[];
  completionAttachments: ActivityAttachment[];
  handoffs: HandoffEntry[];
}

export const meetingsApi = {
  get: (id: string) => api.get<{ meeting: MeetingRow }>(`/api/meetings/${id}`),
  create: (input: MeetingInput) => api.post<MeetingSaveResult>("/api/meetings", input),
  update: (id: string, input: MeetingInput) => api.put<MeetingSaveResult>(`/api/meetings/${id}`, input),
  remove: (id: string) => api.delete<Record<string, never>>(`/api/meetings/${id}`),
  /** «اقدامات انجام شده» — what was done on one action row, and what it led to. */
  itemTrail: (meetingId: string, itemId: string) =>
    api.get<{ trail: MeetingTrailTask[] }>(`/api/meetings/${meetingId}/items/${itemId}/trail`).then((r) => r.trail),
  openActions: (projectId: string, exclude?: string | null) =>
    api.get<{ items: CarryOverItem[] }>("/api/meetings/open-actions", {
      projectId, ...(exclude ? { exclude } : {}),
    }),
};
