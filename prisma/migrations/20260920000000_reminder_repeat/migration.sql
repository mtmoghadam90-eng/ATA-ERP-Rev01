-- A reminder that comes back.
--
-- A reminder was one moment: `reminderEnabled` plus a Shamsi date and a time,
-- matched by the browser's poll against **exactly** the current minute. Two
-- things follow, and the second is why repeating was not merely missing but
-- impossible.
--
-- It fires only inside its own minute. A reminder set for 09:00 on a machine
-- whose browser opens at 09:05 is never seen — not late, never. For a one-off
-- that is a bad afternoon; for «هر دوشنبه ساعت ۹» it would be missed every week
-- for ever, and the honest report would be «تکرار کار نمی‌کند».
--
-- `reminderAnchor` is the series — its own date and time, `YYYY/MM/DD HH:MM` —
-- and it is deliberately separate from `reminderDate`/`reminderTime`, which now
-- hold *this* occurrence. That is what lets a snooze move today without dragging
-- the whole series behind it, the same shape as `sourceDateJalali` on a holiday
-- (20260906) keeping what the source said beside the date in force.
--
-- `reminderAckedFor` names the occurrence somebody has already answered, in the
-- same spelling, so closing a reminder is durable across a refresh and so the
-- next occurrence is owed again on its own day with nothing to reset.
--
-- **No backfill, and no default.** NULL in `reminderRepeat` means «does not
-- repeat», which is what every reminder already on disk is, so nothing changes
-- behaviour on the day this ships. There is no DML here at all, so nothing reads
-- a column this batch adds (20260906 stopped a deployment that way).
--
-- Guarded so a retry after a partial failure is safe. DDL only, no GO.

IF COL_LENGTH('dbo.tasks', 'reminderRepeat') IS NULL
  ALTER TABLE [dbo].[tasks] ADD [reminderRepeat] NVARCHAR(20) NULL;

IF COL_LENGTH('dbo.tasks', 'reminderAnchor') IS NULL
  ALTER TABLE [dbo].[tasks] ADD [reminderAnchor] NVARCHAR(20) NULL;

IF COL_LENGTH('dbo.tasks', 'reminderRepeatUntilJalali') IS NULL
  ALTER TABLE [dbo].[tasks] ADD [reminderRepeatUntilJalali] NVARCHAR(10) NULL;

IF COL_LENGTH('dbo.tasks', 'reminderAckedFor') IS NULL
  ALTER TABLE [dbo].[tasks] ADD [reminderAckedFor] NVARCHAR(20) NULL;

-- The poll asks twice a minute for the reminders owed now: the one-off ones
-- dated today, and every repeating one still running. Both narrow on
-- `reminderEnabled` first, which is false for almost every task.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'tasks_reminderEnabled_reminderRepeat_idx' AND object_id = OBJECT_ID('dbo.tasks'))
CREATE INDEX [tasks_reminderEnabled_reminderRepeat_idx] ON [dbo].[tasks]([reminderEnabled], [reminderRepeat]);
