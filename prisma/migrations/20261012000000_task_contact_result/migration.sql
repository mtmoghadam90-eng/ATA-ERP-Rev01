-- What a call to a customer came to: a value from
-- settings.dropdownItems.contactResults, chosen as the task is ticked off.
-- Nullable and backfilled with nothing: NULL means no result was chosen, which
-- is every task completed before this existed.
IF COL_LENGTH('dbo.tasks', 'contactResult') IS NULL
  ALTER TABLE [dbo].[tasks] ADD [contactResult] NVARCHAR(200) NULL;
