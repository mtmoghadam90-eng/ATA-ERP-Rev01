-- A second plugin raises price requests on the site, so a request is a source
-- and a number rather than a number.
--
-- Both plugins number their own requests from one, so `rfqId` alone cannot
-- identify one: keyed on it, the form's request #9 would be refused as
-- «already imported» on the strength of the advisor's — and refused silently,
-- which is exactly the failure the unique index exists to prevent.
--
-- `DEFAULT 'ADVISOR'` because every row already here is the advisor's, which is
-- what it is; no backfill is needed and none is written, so nothing in this
-- batch reads a column the batch adds. The **DROP precedes the CREATE**: left
-- the other way round, the narrower key goes on refusing precisely the second
-- plugin's requests.

IF COL_LENGTH(N'[dbo].[web_rfq_imports]', N'source') IS NULL
BEGIN
    ALTER TABLE [dbo].[web_rfq_imports] ADD [source] NVARCHAR(20) NOT NULL CONSTRAINT [web_rfq_imports_source_df] DEFAULT 'ADVISOR';
END

IF COL_LENGTH(N'[dbo].[web_rfq_imports]', N'reference') IS NULL
BEGIN
    ALTER TABLE [dbo].[web_rfq_imports] ADD [reference] NVARCHAR(60) NULL;
END

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'web_rfq_imports_rfqId_key' AND object_id = OBJECT_ID(N'[dbo].[web_rfq_imports]'))
BEGIN
    DROP INDEX [web_rfq_imports_rfqId_key] ON [dbo].[web_rfq_imports];
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'web_rfq_imports_source_rfqId_key' AND object_id = OBJECT_ID(N'[dbo].[web_rfq_imports]'))
BEGIN
    CREATE UNIQUE INDEX [web_rfq_imports_source_rfqId_key] ON [dbo].[web_rfq_imports]([source], [rfqId]);
END

-- The configuration row's id is the source, and the one already stored is the
-- advisor's. Renaming it rather than adding a column: there is exactly one
-- configuration per plugin, so the key already says which. Guarded so a rerun
-- and a database built after this are both no-ops, and it touches only columns
-- that already exist — a batch is compiled before any of it runs.
IF EXISTS (SELECT 1 FROM [dbo].[web_rfq_config] WHERE [id] = N'default')
   AND NOT EXISTS (SELECT 1 FROM [dbo].[web_rfq_config] WHERE [id] = N'ADVISOR')
BEGIN
    UPDATE [dbo].[web_rfq_config] SET [id] = N'ADVISOR' WHERE [id] = N'default';
END
