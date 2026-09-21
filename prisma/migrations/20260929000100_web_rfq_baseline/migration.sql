-- The line below which a website price request is never imported.
--
-- A separate migration rather than an edit to 20260929000000: a migration that
-- has shipped is history, recorded by name and never run again, so amending one
-- reaches every repository and no database. Guarded so it is safe on a database
-- built after the column existed, and the batch reads nothing it adds.
--
-- NULL is the right value for every row already here: it means «no line drawn
-- yet», which is what the first poll answers. Backfilling a number would claim
-- a decision nobody made.

IF COL_LENGTH(N'[dbo].[web_rfq_config]', N'startAfterId') IS NULL
BEGIN
    ALTER TABLE [dbo].[web_rfq_config] ADD [startAfterId] INT NULL;
END
