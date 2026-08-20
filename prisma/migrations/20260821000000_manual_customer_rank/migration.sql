-- A rank set by hand, and whether it survives a recalculation.
--
-- Two different intentions a person can have when overriding a rank, and the
-- system cannot guess which: "this account is strategic whatever this year's
-- numbers say" (locked — no recalculation may move it) versus "the figures are
-- wrong today, fix it and let the evaluation take back over" (unlocked — the
-- next recalculation clears it). So the choice is asked for and stored.
--
-- `computedRank` keeps what the formula said even while a manual rank is in
-- effect, so an override never hides what it overrode.

IF COL_LENGTH('customers', 'manualRank') IS NULL
    ALTER TABLE [dbo].[customers] ADD [manualRank] NVARCHAR(10) NULL;
IF COL_LENGTH('customers', 'manualRankLocked') IS NULL
    ALTER TABLE [dbo].[customers] ADD [manualRankLocked] BIT NOT NULL CONSTRAINT [customers_manualRankLocked_df] DEFAULT 0;
IF COL_LENGTH('customers', 'manualRankNote') IS NULL
    ALTER TABLE [dbo].[customers] ADD [manualRankNote] NVARCHAR(400) NULL;
IF COL_LENGTH('customers', 'manualRankSetAt') IS NULL
    ALTER TABLE [dbo].[customers] ADD [manualRankSetAt] DATETIME2 NULL;
IF COL_LENGTH('customers', 'manualRankSetBy') IS NULL
    ALTER TABLE [dbo].[customers] ADD [manualRankSetBy] NVARCHAR(36) NULL;

IF COL_LENGTH('customer_value_metrics', 'computedRank') IS NULL
    ALTER TABLE [dbo].[customer_value_metrics] ADD [computedRank] NVARCHAR(10) NOT NULL CONSTRAINT [cvm_computedRank_df] DEFAULT N'PENDING';
IF COL_LENGTH('customer_value_metrics', 'rankIsManual') IS NULL
    ALTER TABLE [dbo].[customer_value_metrics] ADD [rankIsManual] BIT NOT NULL CONSTRAINT [cvm_rankIsManual_df] DEFAULT 0;

-- Existing rows were all computed, so the two ranks start out agreeing.
EXEC(N'
    UPDATE [dbo].[customer_value_metrics]
    SET [computedRank] = [customerValueRank]
    WHERE [computedRank] = N''PENDING'' AND [customerValueRank] <> N''PENDING'';
');
