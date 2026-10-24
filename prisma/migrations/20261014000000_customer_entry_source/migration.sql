-- How a customer came to be on the system: MANUAL, EXCEL or WEBSITE, stamped by
-- the server at creation (see src/utils/customerEntry.ts). Nullable and not
-- backfilled: NULL reads as MANUAL, which is what nearly every existing row is.

IF COL_LENGTH(N'[dbo].[customers]', N'entrySource') IS NULL
BEGIN
    ALTER TABLE [dbo].[customers] ADD [entrySource] NVARCHAR(20) NULL;
END
