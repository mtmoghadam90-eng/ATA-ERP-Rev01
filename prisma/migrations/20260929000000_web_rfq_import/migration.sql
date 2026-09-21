-- Price requests raised on the public website, imported as customers and projects.
--
-- Two tables and no DML. Every step is guarded so a migration that failed half
-- way is safe to run again, and nothing here reads a column this batch adds —
-- SQL Server compiles the whole batch before running any of it, so such a read
-- dies with «Invalid column name» however it is guarded.

IF OBJECT_ID(N'[dbo].[web_rfq_config]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[web_rfq_config] (
        [id] NVARCHAR(36) NOT NULL,
        [feedUrl] NVARCHAR(500),
        [token] NVARCHAR(200),
        [active] BIT NOT NULL CONSTRAINT [web_rfq_config_active_df] DEFAULT 0,
        [ownerUserId] NVARCHAR(36),
        [updatedAt] DATETIME2 NOT NULL CONSTRAINT [web_rfq_config_updatedAt_df] DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT [web_rfq_config_pkey] PRIMARY KEY CLUSTERED ([id])
    );
END

IF OBJECT_ID(N'[dbo].[web_rfq_imports]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[web_rfq_imports] (
        [id] NVARCHAR(36) NOT NULL,
        [rfqId] INT NOT NULL,
        [status] NVARCHAR(20) NOT NULL,
        [attempts] INT NOT NULL CONSTRAINT [web_rfq_imports_attempts_df] DEFAULT 0,
        [customerId] NVARCHAR(36),
        [projectId] NVARCHAR(36),
        [projectCode] NVARCHAR(60),
        [productName] NVARCHAR(400),
        [fullName] NVARCHAR(191),
        [payload] NVARCHAR(MAX) NOT NULL,
        [error] NVARCHAR(MAX),
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [web_rfq_imports_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        [importedAt] DATETIME2,
        CONSTRAINT [web_rfq_imports_pkey] PRIMARY KEY CLUSTERED ([id])
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'web_rfq_imports_rfqId_key' AND object_id = OBJECT_ID(N'[dbo].[web_rfq_imports]'))
BEGIN
    CREATE UNIQUE INDEX [web_rfq_imports_rfqId_key] ON [dbo].[web_rfq_imports]([rfqId]);
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'web_rfq_imports_status_idx' AND object_id = OBJECT_ID(N'[dbo].[web_rfq_imports]'))
BEGIN
    CREATE INDEX [web_rfq_imports_status_idx] ON [dbo].[web_rfq_imports]([status]);
END
