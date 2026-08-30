-- Which calendar a holiday belongs to, and where its source put it.
--
-- Solar holidays are fixed dates and are right. Lunar ones are not computed
-- here or anywhere reachable: Iran announces the start of each hijri month by
-- sighting, so every astronomical table — the calendar source used here, and
-- aladhan.com behind it — can be a day out, and usually a day early. That is
-- one offset for the whole year, so it is corrected as one gesture rather than
-- fifteen edits.
--
-- `sourceDateJalali` keeps what the source said, so the correction is a
-- re-derivation from that rather than a cumulative nudge: shifting to +1 and
-- back to 0 restores exactly the imported dates.
--
-- No `GO`: it is sqlcmd's batch separator and Prisma hands each statement to
-- the driver on its own.

IF COL_LENGTH('dbo.holidays', 'calendarKind') IS NULL
    ALTER TABLE [dbo].[holidays] ADD [calendarKind] NVARCHAR(10) NOT NULL CONSTRAINT [holidays_calendarKind_df] DEFAULT 'SOLAR';

IF COL_LENGTH('dbo.holidays', 'sourceDateJalali') IS NULL
    ALTER TABLE [dbo].[holidays] ADD [sourceDateJalali] NVARCHAR(10) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'holidays_yearJalali_calendarKind_idx')
    CREATE NONCLUSTERED INDEX [holidays_yearJalali_calendarKind_idx] ON [dbo].[holidays]([yearJalali], [calendarKind]);

-- Backfill, so a database that already imported a year does not have to import
-- it again before the correction can be used.
--
-- The ten fixed solar dates are exactly the days the source tags `jalali` — a
-- year of real data was checked against them — so anything else an import wrote
-- is lunar. A hand-entered day is deliberately left SOLAR: it is an answer
-- about that date and must never be dragged by a lunar correction.
IF COL_LENGTH('dbo.holidays', 'calendarKind') IS NOT NULL
    UPDATE [dbo].[holidays]
       SET [calendarKind] = 'HIJRI'
     WHERE [source] = 'IMPORT'
       AND [calendarKind] = 'SOLAR'
       AND SUBSTRING([dateJalali], 6, 5) NOT IN
           ('01/01', '01/02', '01/03', '01/04', '01/12', '01/13',
            '03/14', '03/15', '11/22', '12/29');

-- Nothing has moved these yet, so where they are is where the source put them.
IF COL_LENGTH('dbo.holidays', 'sourceDateJalali') IS NOT NULL
    UPDATE [dbo].[holidays]
       SET [sourceDateJalali] = [dateJalali]
     WHERE [sourceDateJalali] IS NULL;
