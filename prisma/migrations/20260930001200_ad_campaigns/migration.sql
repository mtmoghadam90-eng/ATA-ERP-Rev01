-- «اثربخشی تبلیغات»: advertising campaigns and what came of them.
--
-- Only the typed figures are stored; every rate is derived. The outcome counts
-- are nullable because NULL is «not measured yet», which is not zero leads.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ad_campaigns')
  CREATE TABLE [dbo].[ad_campaigns] (
    [id]              NVARCHAR(36)   NOT NULL CONSTRAINT [PK_ad_campaigns] PRIMARY KEY,
    [code]            NVARCHAR(40)   NOT NULL,
    [runDate]         DATE           NULL,
    [runDateJalali]   NVARCHAR(10)   NULL,
    [channel]         NVARCHAR(100)  NOT NULL,
    [topic]           NVARCHAR(400)  NOT NULL,
    [audience]        NVARCHAR(200)  NULL,
    [audienceSize]    INT            NOT NULL CONSTRAINT [DF_ad_campaigns_audienceSize] DEFAULT 0,
    [directCost]      DECIMAL(19, 2) NOT NULL CONSTRAINT [DF_ad_campaigns_directCost] DEFAULT 0,
    [responses]       INT            NULL,
    [leads]           INT            NULL,
    [sales]           INT            NULL,
    [revenue]         DECIMAL(19, 2) NULL,
    [quality]         INT            NULL,
    [notes]           NVARCHAR(MAX)  NULL,
    [createdByUserId] NVARCHAR(36)   NULL,
    [createdByName]   NVARCHAR(200)  NULL,
    [createdAt]       DATETIME2      NOT NULL CONSTRAINT [DF_ad_campaigns_createdAt] DEFAULT SYSDATETIME(),
    [updatedAt]       DATETIME2      NOT NULL CONSTRAINT [DF_ad_campaigns_updatedAt] DEFAULT SYSDATETIME()
  );

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ad_campaigns_code_key')
  CREATE UNIQUE INDEX [ad_campaigns_code_key] ON [dbo].[ad_campaigns] ([code]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ad_campaigns_runDate_idx')
  CREATE INDEX [ad_campaigns_runDate_idx] ON [dbo].[ad_campaigns] ([runDate]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ad_campaigns_channel_idx')
  CREATE INDEX [ad_campaigns_channel_idx] ON [dbo].[ad_campaigns] ([channel]);
