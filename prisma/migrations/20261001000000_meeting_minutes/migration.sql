-- «صورتجلسات»: meetings and their items.
--
-- An item is referenced by the tasks finalising raises (`taskLinks`), so it is
-- reconciled by id rather than rebuilt. Nothing is backfilled: there were no
-- meetings before this.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'meetings')
  CREATE TABLE [dbo].[meetings] (
    [id]                    NVARCHAR(36)  NOT NULL CONSTRAINT [PK_meetings] PRIMARY KEY,
    [code]                  NVARCHAR(40)  NOT NULL,
    [title]                 NVARCHAR(300) NOT NULL,
    [meetingDate]           DATE          NULL,
    [meetingDateJalali]     NVARCHAR(10)  NULL,
    [startTime]             NVARCHAR(5)   NULL,
    [endTime]               NVARCHAR(5)   NULL,
    [place]                 NVARCHAR(200) NULL,
    [summary]               NVARCHAR(MAX) NULL,
    [projectId]             NVARCHAR(36)  NULL,
    [status]                NVARCHAR(20)  NOT NULL CONSTRAINT [DF_meetings_status] DEFAULT 'DRAFT',
    [attendees]             NVARCHAR(MAX) NULL,
    [absentees]             NVARCHAR(MAX) NULL,
    [memberIndex]           NVARCHAR(MAX) NULL,
    [nextMeetingDate]       DATE          NULL,
    [nextMeetingDateJalali] NVARCHAR(10)  NULL,
    [attachments]           NVARCHAR(MAX) NULL,
    [createdByUserId]       NVARCHAR(36)  NULL,
    [createdByName]         NVARCHAR(200) NULL,
    [finalizedAt]           DATETIME2     NULL,
    [finalizedByName]       NVARCHAR(200) NULL,
    [createdAt]             DATETIME2     NOT NULL CONSTRAINT [DF_meetings_createdAt] DEFAULT SYSDATETIME(),
    [updatedAt]             DATETIME2     NOT NULL CONSTRAINT [DF_meetings_updatedAt] DEFAULT SYSDATETIME()
  );

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'meetings_code_key')
  CREATE UNIQUE INDEX [meetings_code_key] ON [dbo].[meetings] ([code]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'meetings_projectId_idx')
  CREATE INDEX [meetings_projectId_idx] ON [dbo].[meetings] ([projectId]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'meetings_meetingDate_idx')
  CREATE INDEX [meetings_meetingDate_idx] ON [dbo].[meetings] ([meetingDate]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'meetings_status_idx')
  CREATE INDEX [meetings_status_idx] ON [dbo].[meetings] ([status]);

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'meetings_projectId_fkey')
  ALTER TABLE [dbo].[meetings] ADD CONSTRAINT [meetings_projectId_fkey]
    FOREIGN KEY ([projectId]) REFERENCES [dbo].[projects] ([id])
    ON DELETE NO ACTION ON UPDATE NO ACTION;

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'meeting_items')
  CREATE TABLE [dbo].[meeting_items] (
    [id]            NVARCHAR(36)  NOT NULL CONSTRAINT [PK_meeting_items] PRIMARY KEY,
    [meetingId]     NVARCHAR(36)  NOT NULL,
    [lineNo]        INT           NOT NULL CONSTRAINT [DF_meeting_items_lineNo] DEFAULT 0,
    [text]          NVARCHAR(MAX) NOT NULL,
    [kind]          NVARCHAR(20)  NOT NULL CONSTRAINT [DF_meeting_items_kind] DEFAULT 'DECISION',
    [assignees]     NVARCHAR(MAX) NULL,
    [dueDate]       DATE          NULL,
    [dueDateJalali] NVARCHAR(10)  NULL,
    [taskLinks]     NVARCHAR(MAX) NULL
  );

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'meeting_items_meetingId_idx')
  CREATE INDEX [meeting_items_meetingId_idx] ON [dbo].[meeting_items] ([meetingId]);

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'meeting_items_meetingId_fkey')
  ALTER TABLE [dbo].[meeting_items] ADD CONSTRAINT [meeting_items_meetingId_fkey]
    FOREIGN KEY ([meetingId]) REFERENCES [dbo].[meetings] ([id])
    ON DELETE CASCADE ON UPDATE NO ACTION;
