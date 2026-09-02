-- Where a notification reaches a colleague when the application is shut.
--
-- One nullable column and nothing else: an account without a number simply
-- gets no text, which is what every account has until somebody fills it in.
-- No backfill, so no DML reading a column this batch adds.

IF COL_LENGTH('dbo.users', 'mobile') IS NULL
    ALTER TABLE [dbo].[users] ADD [mobile] NVARCHAR(20) NULL;
