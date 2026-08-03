-- Per-user notification inbox and per-user read receipts.
--
-- Both replace collections that lived only in the document store, and both are
-- keyed by user id rather than by the display name the old store used:
--
--  * module_notifications was addressed by `responsibleName`, so two people
--    sharing a full name shared an inbox, and renaming someone orphaned every
--    notice already sent to them.
--
--  * read_receipts replaces `erp_read_items`, which was a single flat array for
--    the whole company — the first person to open a referral reply marked it
--    read for everybody.
--
-- Hand-written for the same reason as the previous migration: `migrate diff`
-- wants to re-create DEFAULT constraints that introspection does not report,
-- which would bury the real change.

IF OBJECT_ID('dbo.module_notifications', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[module_notifications] (
        [id]          NVARCHAR(36)   NOT NULL,
        [userId]      NVARCHAR(36)   NOT NULL,
        [module]      NVARCHAR(100)  NOT NULL,
        [title]       NVARCHAR(300)  NOT NULL,
        [description] NVARCHAR(MAX)  NOT NULL,
        [projectId]   NVARCHAR(36)   NULL,
        [isRead]      BIT            NOT NULL CONSTRAINT [module_notifications_isRead_df] DEFAULT 0,
        [createdAt]   DATETIME2      NOT NULL CONSTRAINT [module_notifications_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT [module_notifications_pkey] PRIMARY KEY CLUSTERED ([id])
    );

    ALTER TABLE [dbo].[module_notifications]
        ADD CONSTRAINT [module_notifications_userId_fkey]
        FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

    CREATE NONCLUSTERED INDEX [module_notifications_userId_isRead_idx]
        ON [dbo].[module_notifications]([userId], [isRead]);
    CREATE NONCLUSTERED INDEX [module_notifications_createdAt_idx]
        ON [dbo].[module_notifications]([createdAt]);
END

IF OBJECT_ID('dbo.read_receipts', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[read_receipts] (
        [id]        NVARCHAR(36) NOT NULL,
        [userId]    NVARCHAR(36) NOT NULL,
        [itemId]    NVARCHAR(36) NOT NULL,
        [createdAt] DATETIME2    NOT NULL CONSTRAINT [read_receipts_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT [read_receipts_pkey] PRIMARY KEY CLUSTERED ([id])
    );

    ALTER TABLE [dbo].[read_receipts]
        ADD CONSTRAINT [read_receipts_userId_fkey]
        FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

    -- One receipt per user per item: marking the same thing read twice is a
    -- no-op rather than a second row.
    CREATE UNIQUE INDEX [read_receipts_userId_itemId_key]
        ON [dbo].[read_receipts]([userId], [itemId]);
    CREATE NONCLUSTERED INDEX [read_receipts_userId_idx]
        ON [dbo].[read_receipts]([userId]);
END
