-- Two optional things an account may say about the person behind it.
--
-- `gender` is what decides the honorific. The rule already exists
-- (`namePrefixFor` in src/utils/honorific.ts) and has always read a
-- **customer's** gender; the dashboard's welcome card had no such column to
-- read on the account, so it wrote «جناب آقای» to everybody, women included.
--
-- `avatarUrl` is a picture of the person, drawn beside their name in the
-- sidebar and beside every message they write in a project's feed.
--
-- Both are NULL for every account already on disk and nothing is backfilled:
-- NULL means «nobody has said», which for the honorific is the case the rule
-- answers with a blank rather than a guess, and for the picture is the initials
-- the screen draws instead. Guessing either would be worse than the gap.

IF COL_LENGTH('dbo.users', 'gender') IS NULL
    ALTER TABLE [dbo].[users] ADD [gender] NVARCHAR(10) NULL;

IF COL_LENGTH('dbo.users', 'avatarUrl') IS NULL
    ALTER TABLE [dbo].[users] ADD [avatarUrl] NVARCHAR(500) NULL;
