import { api } from "./client";
import type {
  MeetingAssignee, MeetingItemKind, MeetingItemState, MeetingParticipant, MeetingStatus,
} from "../utils/meetingMinutes";
import type { ActivityAttachment } from "../utils/attachments";

/** «صورتجلسات». Rows are what `meetingService.toRow` answers. */

export interface MeetingItemRow {
  id: string;
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
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  customerName: string | null;
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
  items?: MeetingItemRow[];
}

export interface MeetingItemInput {
  id?: string | null;
  text: string;
  kind: MeetingItemKind;
  assignees: MeetingAssignee[];
  dueDate?: string | null;
}

export interface MeetingInput {
  title: string;
  meetingDate: string;
  startTime?: string | null;
  endTime?: string | null;
  place?: string | null;
  summary?: string | null;
  projectId?: string | null;
  attendees: MeetingParticipant[];
  absentees: MeetingParticipant[];
  nextMeetingDate?: string | null;
  attachments: ActivityAttachment[];
  items: MeetingItemInput[];
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
  itemId: string;
  text: string;
  dueDateJalali: string | null;
  state: MeetingItemState;
  assignees: string[];
}

export const meetingsApi = {
  get: (id: string) => api.get<{ meeting: MeetingRow }>(`/api/meetings/${id}`),
  create: (input: MeetingInput) => api.post<MeetingSaveResult>("/api/meetings", input),
  update: (id: string, input: MeetingInput) => api.put<MeetingSaveResult>(`/api/meetings/${id}`, input),
  remove: (id: string) => api.delete<Record<string, never>>(`/api/meetings/${id}`),
  openActions: (projectId: string, exclude?: string | null) =>
    api.get<{ items: CarryOverItem[] }>("/api/meetings/open-actions", {
      projectId, ...(exclude ? { exclude } : {}),
    }),
};
