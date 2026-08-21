-- The messaging module: providers, templates and an outbox.
--
-- The automation half is deliberately absent from this migration. The workflow
-- engine already has twenty-one event triggers, a time-based trigger and a
-- firing log that enforces once-per-record; sending a message is a third kind
-- of *action* on that engine, not a second engine. Nothing here duplicates it.

IF OBJECT_ID('dbo.message_providers', 'U') IS NULL
CREATE TABLE [dbo].[message_providers] (
    -- The channel is the identity: exactly one configuration per channel, and
    -- no way to end up with two competing rows for the same one.
    [channel]       NVARCHAR(20)   NOT NULL,
    [active]        BIT            NOT NULL CONSTRAINT [DF_message_providers_active] DEFAULT 0,
    -- Credentials. Never returned to a client; the route answers with a masked
    -- summary, the same rule `passwordHash` follows.
    [config]        NVARCHAR(MAX)  NULL,
    [lastTestAt]    DATETIME2      NULL,
    [lastTestOk]    BIT            NULL,
    [lastTestError] NVARCHAR(MAX)  NULL,
    [updatedAt]     DATETIME2      NOT NULL,
    CONSTRAINT [PK_message_providers] PRIMARY KEY CLUSTERED ([channel])
);

IF OBJECT_ID('dbo.message_templates', 'U') IS NULL
CREATE TABLE [dbo].[message_templates] (
    [id]        NVARCHAR(36)   NOT NULL,
    [name]      NVARCHAR(200)  NOT NULL,
    [channel]   NVARCHAR(20)   NOT NULL,
    [subject]   NVARCHAR(400)  NULL,
    [body]      NVARCHAR(MAX)  NOT NULL,
    [active]    BIT            NOT NULL CONSTRAINT [DF_message_templates_active] DEFAULT 1,
    [createdAt] DATETIME2      NOT NULL CONSTRAINT [DF_message_templates_createdAt] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2      NOT NULL,
    CONSTRAINT [PK_message_templates] PRIMARY KEY CLUSTERED ([id])
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'message_templates_channel_idx')
    CREATE NONCLUSTERED INDEX [message_templates_channel_idx]
        ON [dbo].[message_templates]([channel]);

IF OBJECT_ID('dbo.messages', 'U') IS NULL
CREATE TABLE [dbo].[messages] (
    [id]                NVARCHAR(36)   NOT NULL,
    [channel]           NVARCHAR(20)   NOT NULL,
    [recipient]         NVARCHAR(400)  NOT NULL,
    [recipientName]     NVARCHAR(200)  NULL,
    [subject]           NVARCHAR(400)  NULL,
    [body]              NVARCHAR(MAX)  NOT NULL,
    [status]            NVARCHAR(20)   NOT NULL,
    -- A message scheduled for later, or held out of quiet hours, simply has
    -- this in the future. No separate "held" state to fall out of step.
    [scheduledAt]       DATETIME2      NOT NULL,
    [scheduledAtJalali] NVARCHAR(10)   NULL,
    [sentAt]            DATETIME2      NULL,
    [sentAtJalali]      NVARCHAR(10)   NULL,
    [attempts]          INT            NOT NULL CONSTRAINT [DF_messages_attempts] DEFAULT 0,
    [lastError]         NVARCHAR(MAX)  NULL,
    [providerMessageId] NVARCHAR(200)  NULL,
    [dryRun]            BIT            NOT NULL CONSTRAINT [DF_messages_dryRun] DEFAULT 0,
    [customerId]        NVARCHAR(36)   NULL,
    [projectId]         NVARCHAR(36)   NULL,
    [templateId]        NVARCHAR(36)   NULL,
    [workflowRuleId]    NVARCHAR(60)   NULL,
    [workflowRuleName]  NVARCHAR(200)  NULL,
    [entityType]        NVARCHAR(40)   NULL,
    [entityId]          NVARCHAR(36)   NULL,
    [createdByUserId]   NVARCHAR(36)   NULL,
    [createdByName]     NVARCHAR(200)  NULL,
    [createdAt]         DATETIME2      NOT NULL CONSTRAINT [DF_messages_createdAt] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PK_messages] PRIMARY KEY CLUSTERED ([id])
);

-- The queue's own read: everything due, oldest first.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'messages_status_scheduledAt_idx')
    CREATE NONCLUSTERED INDEX [messages_status_scheduledAt_idx]
        ON [dbo].[messages]([status], [scheduledAt]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'messages_customerId_idx')
    CREATE NONCLUSTERED INDEX [messages_customerId_idx] ON [dbo].[messages]([customerId]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'messages_projectId_idx')
    CREATE NONCLUSTERED INDEX [messages_projectId_idx] ON [dbo].[messages]([projectId]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'messages_createdAt_idx')
    CREATE NONCLUSTERED INDEX [messages_createdAt_idx] ON [dbo].[messages]([createdAt]);

-- NoAction on every one of these: a message is a record of something that was
-- sent. Deleting the customer it went to must not delete the evidence, and must
-- not fail either.
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'messages_customerId_fkey')
    ALTER TABLE [dbo].[messages] ADD CONSTRAINT [messages_customerId_fkey]
        FOREIGN KEY ([customerId]) REFERENCES [dbo].[customers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'messages_projectId_fkey')
    ALTER TABLE [dbo].[messages] ADD CONSTRAINT [messages_projectId_fkey]
        FOREIGN KEY ([projectId]) REFERENCES [dbo].[projects]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'messages_templateId_fkey')
    ALTER TABLE [dbo].[messages] ADD CONSTRAINT [messages_templateId_fkey]
        FOREIGN KEY ([templateId]) REFERENCES [dbo].[message_templates]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Opt-out, and the one contact detail no other module had a column for.
IF COL_LENGTH('customers', 'doNotContact') IS NULL
    ALTER TABLE [dbo].[customers] ADD [doNotContact] BIT NOT NULL
        CONSTRAINT [DF_customers_doNotContact] DEFAULT 0;
IF COL_LENGTH('customers', 'baleChatId') IS NULL
    ALTER TABLE [dbo].[customers] ADD [baleChatId] NVARCHAR(60) NULL;

-- Who to write to about a job, and how.
IF COL_LENGTH('projects', 'messagingContactId') IS NULL
    ALTER TABLE [dbo].[projects] ADD [messagingContactId] NVARCHAR(36) NULL;
IF COL_LENGTH('projects', 'messagingChannel') IS NULL
    ALTER TABLE [dbo].[projects] ADD [messagingChannel] NVARCHAR(20) NULL;
