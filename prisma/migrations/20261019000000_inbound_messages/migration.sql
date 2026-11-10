-- Messages customers send to us: replies to the Bale bot, read by polling.
-- A new table, so nothing on disk changes.

IF OBJECT_ID(N'[dbo].[inbound_messages]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[inbound_messages] (
        [id] NVARCHAR(36) NOT NULL,
        [channel] NVARCHAR(20) NOT NULL,
        [updateId] BIGINT NOT NULL,
        [chatId] NVARCHAR(60) NOT NULL,
        [senderName] NVARCHAR(200) NULL,
        [senderUsername] NVARCHAR(100) NULL,
        [phone] NVARCHAR(30) NULL,
        [kind] NVARCHAR(20) NOT NULL,
        [text] NVARCHAR(MAX) NULL,
        [fileName] NVARCHAR(300) NULL,
        [customerId] NVARCHAR(36) NULL,
        [receivedAt] DATETIME2 NOT NULL,
        [readAt] DATETIME2 NULL,
        [readByName] NVARCHAR(200) NULL,
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [inbound_messages_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT [inbound_messages_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [inbound_messages_channel_updateId_key] UNIQUE NONCLUSTERED ([channel], [updateId])
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'inbound_messages_chatId_idx')
    CREATE NONCLUSTERED INDEX [inbound_messages_chatId_idx] ON [dbo].[inbound_messages]([chatId]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'inbound_messages_customerId_idx')
    CREATE NONCLUSTERED INDEX [inbound_messages_customerId_idx] ON [dbo].[inbound_messages]([customerId]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'inbound_messages_readAt_idx')
    CREATE NONCLUSTERED INDEX [inbound_messages_readAt_idx] ON [dbo].[inbound_messages]([readAt]);
