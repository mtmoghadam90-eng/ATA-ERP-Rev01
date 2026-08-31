-- The people who follow one category on one project.
--
-- Subscribing to a conversation, in the sense a messaging app means it: every
-- message posted in this category raises a notice for these people, without
-- anybody having to be named in it. Being named stays what it always was — a
-- referral, with an action required and an inbox of its own — and this is the
-- weaker, quieter thing beside it.
--
-- Per project **and** per category on purpose. The people involved in «خرید» on
-- one job are not the people involved in «خرید» on the next, so this cannot
-- live on `settings.activityCategories`; the `responsibleUserId` there is a
-- different question («who owns this kind of work in the company») and is
-- untouched.
--
-- JSON rather than a join table: it is a short list read whole with its row and
-- never queried across rows, the same shape `attachments` and `milestoneRules`
-- already use here. A NULL means nobody has set one, which is not the same as
-- an empty list and is why the column is nullable.
--
-- No `GO`, and nothing reads the new column in this file — see
-- 20260906000000_holiday_calendar_kind for why that matters.

IF COL_LENGTH('dbo.project_category_groups', 'memberUserIds') IS NULL
    ALTER TABLE [dbo].[project_category_groups] ADD [memberUserIds] NVARCHAR(MAX) NULL;
