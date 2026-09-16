-- Files on a document's note, and the account that wrote it.
--
-- «توافقات خاص و کامنت‌های این پیش‌فاکتور» is where a salesperson records what
-- was agreed on the phone, and the evidence of that agreement is almost always
-- a file — the customer's confirming email, a signed page, a corrected
-- datasheet. There was nowhere to put one, so it went onto the project's
-- documents tab under a name nobody could connect back to the note, or nowhere.
--
-- `attachments` is the same JSON list `project_activities` and the supplier
-- inquiry's offers already store (`[{name,size,url}]`, read and written only by
-- `src/utils/attachments.ts`). There are no legacy single-file columns to mirror
-- into here, because this record never had one.
--
-- `authorUserId` is the other half and is the reason this is one migration.
-- Authorship was matched by comparing `authorName` against the reader's own
-- `fullName`, and a name is not an identity: SQL Server's collation reads ی/ي
-- and ک/ك as different characters, two colleagues here genuinely share a name,
-- and somebody whose account is renamed loses the right to delete notes they
-- wrote. It is the fault `resolveAssignee` was written for, on a delete button.
--
-- Both are nullable and nothing is backfilled. A note already on disk has no
-- files, which is true, and no author id — so the name comparison stays as the
-- fallback for exactly those rows and nobody loses a button they had yesterday.
--
-- No DML, so nothing in this batch reads a column the batch adds.

IF COL_LENGTH('dbo.module_notes', 'attachments') IS NULL
    ALTER TABLE [dbo].[module_notes] ADD [attachments] NVARCHAR(MAX) NULL;

IF COL_LENGTH('dbo.module_notes', 'authorUserId') IS NULL
    ALTER TABLE [dbo].[module_notes] ADD [authorUserId] NVARCHAR(36) NULL;
