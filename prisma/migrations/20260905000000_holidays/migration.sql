-- Official holidays, as data rather than as a hardcoded set.
--
-- Every promised delivery date is counted in working days, and what counted as
-- one was a set in `dateUtils.ts`: the ten fixed solar days, plus hand-typed
-- lunar dates for 1405 and 1406 and nothing after. Beyond 1406 every lunar
-- holiday silently disappeared, and the two years that were there were a lunar
-- month late — the app had Ashura 1405 on 5 Mordad when it falls on 4 Tir.
--
-- `isHoliday` is a column rather than the row's mere existence because the
-- answer runs both ways: a company works some announced holidays, and Iran
-- occasionally turns a weekend into a working day. `source` keeps a
-- hand-entered day from being overwritten by an import — somebody typed it
-- because the source was wrong or silent.
--
-- No `GO`: it is sqlcmd's batch separator and Prisma hands each statement to
-- the driver on its own.

IF OBJECT_ID('dbo.holidays', 'U') IS NULL
    CREATE TABLE [dbo].[holidays] (
        [id]         NVARCHAR(36)  NOT NULL,
        [dateJalali] NVARCHAR(10)  NOT NULL,
        [date]       DATE          NOT NULL,
        [yearJalali] INT           NOT NULL,
        [title]      NVARCHAR(300) NOT NULL,
        [isHoliday]  BIT           NOT NULL CONSTRAINT [holidays_isHoliday_df] DEFAULT 1,
        [source]     NVARCHAR(20)  NOT NULL CONSTRAINT [holidays_source_df] DEFAULT 'MANUAL',
        [createdAt]  DATETIME2     NOT NULL CONSTRAINT [holidays_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        [updatedAt]  DATETIME2     NOT NULL,
        CONSTRAINT [holidays_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [holidays_dateJalali_key] UNIQUE NONCLUSTERED ([dateJalali])
    );

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'holidays_yearJalali_idx')
    CREATE NONCLUSTERED INDEX [holidays_yearJalali_idx] ON [dbo].[holidays]([yearJalali]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'holidays_date_idx')
    CREATE NONCLUSTERED INDEX [holidays_date_idx] ON [dbo].[holidays]([date]);
