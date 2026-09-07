-- Segments and campaigns: sending one message to a group of customers.
--
-- A segment stores the customers grid's own query parameters, not a list of
-- customer ids. Storing the ids would be a photograph taken the day it was
-- saved: somebody who qualifies tomorrow would not be in it and somebody who
-- has since asked not to be contacted still would, while the list looked
-- exactly as it did on the day. So there is no join table here, and there
-- deliberately is not one.
--
-- A campaign carries `segmentName` denormalised for the same reason a category
-- group carries `categoryName`: the campaign's history has to survive the
-- segment being renamed or removed.
--
-- Guarded throughout so a retry after a half-applied migration is safe, and DDL
-- only — there is no DML here, so nothing needs deferring through EXEC.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'customer_segments')
CREATE TABLE [dbo].[customer_segments] (
  [id]              NVARCHAR(36)  NOT NULL,
  [name]            NVARCHAR(200) NOT NULL,
  [description]     NVARCHAR(MAX) NULL,
  -- The customers list's query parameters, as JSON. Resolved against the
  -- database on every use, through the same code path the grid goes through.
  [query]           NVARCHAR(MAX) NOT NULL,
  [createdByUserId] NVARCHAR(36)  NULL,
  [createdByName]   NVARCHAR(200) NULL,
  [createdAt]       DATETIME2     NOT NULL CONSTRAINT [DF_customer_segments_createdAt] DEFAULT CURRENT_TIMESTAMP,
  [updatedAt]       DATETIME2     NOT NULL CONSTRAINT [DF_customer_segments_updatedAt] DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT [PK_customer_segments] PRIMARY KEY CLUSTERED ([id])
);

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'campaigns')
CREATE TABLE [dbo].[campaigns] (
  [id]              NVARCHAR(36)  NOT NULL,
  [name]            NVARCHAR(200) NOT NULL,
  [segmentId]       NVARCHAR(36)  NULL,
  -- Kept beside the id so a sent campaign still says who it went to after the
  -- segment is renamed or deleted.
  [segmentName]     NVARCHAR(200) NULL,
  [channel]         NVARCHAR(20)  NOT NULL,
  [templateId]      NVARCHAR(36)  NULL,
  [subject]         NVARCHAR(400) NULL,
  [body]            NVARCHAR(MAX) NOT NULL,
  -- DRAFT | SENDING | SENT | CANCELLED
  [status]          NVARCHAR(20)  NOT NULL CONSTRAINT [DF_campaigns_status] DEFAULT 'DRAFT',
  [scheduledAt]     DATETIME2     NULL,
  [scheduledAtJalali] NVARCHAR(10) NULL,
  -- How many customers the segment resolved to at the moment it was sent. The
  -- messages are the record of what was actually queued; this is the figure
  -- they are read against, and it cannot be recovered later because the segment
  -- is a live query.
  [matchedCount]    INT           NULL,
  [sentAt]          DATETIME2     NULL,
  [createdByUserId] NVARCHAR(36)  NULL,
  [createdByName]   NVARCHAR(200) NULL,
  [createdAt]       DATETIME2     NOT NULL CONSTRAINT [DF_campaigns_createdAt] DEFAULT CURRENT_TIMESTAMP,
  [updatedAt]       DATETIME2     NOT NULL CONSTRAINT [DF_campaigns_updatedAt] DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT [PK_campaigns] PRIMARY KEY CLUSTERED ([id])
);

IF COL_LENGTH('dbo.messages', 'campaignId') IS NULL
  ALTER TABLE [dbo].[messages] ADD [campaignId] NVARCHAR(36) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'campaigns_status_idx' AND object_id = OBJECT_ID('dbo.campaigns'))
CREATE INDEX [campaigns_status_idx] ON [dbo].[campaigns]([status]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'campaigns_segmentId_idx' AND object_id = OBJECT_ID('dbo.campaigns'))
CREATE INDEX [campaigns_segmentId_idx] ON [dbo].[campaigns]([segmentId]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'messages_campaignId_idx' AND object_id = OBJECT_ID('dbo.messages'))
CREATE INDEX [messages_campaignId_idx] ON [dbo].[messages]([campaignId]);

-- One customer, one message per campaign.
--
-- This index is what enforces it, exactly as `workflow_firings`'s (ruleId,
-- entityId) enforces once-per-record: a double-pressed send, or a re-run after
-- a send that died half way through, must not text the same person twice. It is
-- filtered because both columns are nullable and a campaign message with no
-- customer (there is no such path today) must not collide with another.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'messages_campaign_customer_uq' AND object_id = OBJECT_ID('dbo.messages'))
CREATE UNIQUE INDEX [messages_campaign_customer_uq] ON [dbo].[messages]([campaignId], [customerId])
  WHERE [campaignId] IS NOT NULL AND [customerId] IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'campaigns_segmentId_fkey')
  ALTER TABLE [dbo].[campaigns] ADD CONSTRAINT [campaigns_segmentId_fkey]
    FOREIGN KEY ([segmentId]) REFERENCES [dbo].[customer_segments]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'messages_campaignId_fkey')
  ALTER TABLE [dbo].[messages] ADD CONSTRAINT [messages_campaignId_fkey]
    FOREIGN KEY ([campaignId]) REFERENCES [dbo].[campaigns]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
