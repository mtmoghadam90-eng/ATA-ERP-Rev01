-- «صورتجلسات»: a meeting is a list of topics, and each topic belongs to a
-- project or to none (internal). The items move under a topic.
--
-- Every meeting already on disk gets exactly one topic, titled as the meeting
-- and carrying the meeting's project, and its items are moved under it — so a
-- project keeps its meetings and no task is raised twice. The meeting's own
-- projectId is then dropped: a meeting no longer belongs to one project.
--
-- `meeting_items.topicId` deliberately has no foreign key: SQL Server refuses
-- two cascade paths to one table (meetings -> items and meetings -> topics ->
-- items), and the service reconciles the two by id inside one transaction.
-- The backfill runs through EXEC because the table and the column it writes do
-- not exist when this batch is compiled.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'meeting_topics')
  CREATE TABLE [dbo].[meeting_topics] (
    [id]         NVARCHAR(36)  NOT NULL CONSTRAINT [PK_meeting_topics] PRIMARY KEY,
    [meetingId]  NVARCHAR(36)  NOT NULL,
    [lineNo]     INT           NOT NULL CONSTRAINT [DF_meeting_topics_lineNo] DEFAULT 0,
    [title]      NVARCHAR(300) NOT NULL,
    [projectId]  NVARCHAR(36)  NULL,
    [discussion] NVARCHAR(MAX) NULL,
    [conclusion] NVARCHAR(MAX) NULL
  );

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'meeting_topics_meetingId_idx')
  CREATE INDEX [meeting_topics_meetingId_idx] ON [dbo].[meeting_topics] ([meetingId]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'meeting_topics_projectId_idx')
  CREATE INDEX [meeting_topics_projectId_idx] ON [dbo].[meeting_topics] ([projectId]);

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'meeting_topics_meetingId_fkey')
  ALTER TABLE [dbo].[meeting_topics] ADD CONSTRAINT [meeting_topics_meetingId_fkey]
    FOREIGN KEY ([meetingId]) REFERENCES [dbo].[meetings] ([id])
    ON DELETE CASCADE ON UPDATE NO ACTION;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'meeting_topics_projectId_fkey')
  ALTER TABLE [dbo].[meeting_topics] ADD CONSTRAINT [meeting_topics_projectId_fkey]
    FOREIGN KEY ([projectId]) REFERENCES [dbo].[projects] ([id])
    ON DELETE NO ACTION ON UPDATE NO ACTION;

IF COL_LENGTH('dbo.meeting_items', 'topicId') IS NULL
  ALTER TABLE [dbo].[meeting_items] ADD [topicId] NVARCHAR(36) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'meeting_items_topicId_idx')
  CREATE INDEX [meeting_items_topicId_idx] ON [dbo].[meeting_items] ([topicId]);

IF COL_LENGTH('dbo.meetings', 'projectId') IS NOT NULL
  EXEC(N'
    INSERT INTO [dbo].[meeting_topics] ([id], [meetingId], [lineNo], [title], [projectId])
    SELECT LOWER(CONVERT(NVARCHAR(36), NEWID())), m.[id], 1, m.[title], m.[projectId]
    FROM [dbo].[meetings] m
    WHERE NOT EXISTS (SELECT 1 FROM [dbo].[meeting_topics] t WHERE t.[meetingId] = m.[id]);
  ');

EXEC(N'
  UPDATE i SET [topicId] = t.[id]
  FROM [dbo].[meeting_items] i
  JOIN [dbo].[meeting_topics] t ON t.[meetingId] = i.[meetingId] AND t.[lineNo] = 1
  WHERE i.[topicId] IS NULL;
');

IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'meetings_projectId_fkey')
  ALTER TABLE [dbo].[meetings] DROP CONSTRAINT [meetings_projectId_fkey];

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'meetings_projectId_idx' AND object_id = OBJECT_ID('dbo.meetings'))
  DROP INDEX [meetings_projectId_idx] ON [dbo].[meetings];

IF COL_LENGTH('dbo.meetings', 'projectId') IS NOT NULL
  ALTER TABLE [dbo].[meetings] DROP COLUMN [projectId];
