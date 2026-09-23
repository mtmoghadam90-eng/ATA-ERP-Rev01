-- A referral reply carries a list of files, like a project activity.
--
-- JSON [{name,size,url}]; the three original attachment* columns keep holding
-- the first entry. Nullable and backfilled with nothing: a row written before
-- this has its one file (if any) in those columns, which parseAttachments reads.
IF COL_LENGTH('referral_messages', 'attachments') IS NULL
  ALTER TABLE [referral_messages] ADD [attachments] NVARCHAR(MAX) NULL;
