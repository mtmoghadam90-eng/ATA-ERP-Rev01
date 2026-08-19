-- Customer value ranking: two axes (realized / potential) and an A/B/C/D matrix.
--
-- Replaces the earlier single-axis طلایی/نقره‌ای/برنزی scoring, whose four
-- columns are dropped at the end of this file. That system answered one
-- question — "who has bought the most" — and this one answers two, separately,
-- because a customer with no history and real promise needs the opposite
-- treatment to one who is merely quiet.
--
-- Split across two tables on purpose:
--   * customers          — the manual judgements a person makes
--   * customer_value_metrics — everything computed, rewritten by a recalculation

/* ------------------ the manual half, on the customer row ------------------ */

IF COL_LENGTH('customers', 'potentialConsumption') IS NULL
    ALTER TABLE [dbo].[customers] ADD [potentialConsumption] SMALLINT NULL;
IF COL_LENGTH('customers', 'potentialCompanySize') IS NULL
    ALTER TABLE [dbo].[customers] ADD [potentialCompanySize] SMALLINT NULL;
IF COL_LENGTH('customers', 'potentialProjects') IS NULL
    ALTER TABLE [dbo].[customers] ADD [potentialProjects] SMALLINT NULL;
IF COL_LENGTH('customers', 'potentialPortfolioFit') IS NULL
    ALTER TABLE [dbo].[customers] ADD [potentialPortfolioFit] SMALLINT NULL;
IF COL_LENGTH('customers', 'potentialRepeatPurchase') IS NULL
    ALTER TABLE [dbo].[customers] ADD [potentialRepeatPurchase] SMALLINT NULL;
IF COL_LENGTH('customers', 'potentialValueScore') IS NULL
    ALTER TABLE [dbo].[customers] ADD [potentialValueScore] FLOAT NULL;
IF COL_LENGTH('customers', 'potentialAssessedAt') IS NULL
    ALTER TABLE [dbo].[customers] ADD [potentialAssessedAt] DATETIME2 NULL;
IF COL_LENGTH('customers', 'potentialAssessedBy') IS NULL
    ALTER TABLE [dbo].[customers] ADD [potentialAssessedBy] NVARCHAR(36) NULL;

IF COL_LENGTH('customers', 'paymentBehaviour') IS NULL
    ALTER TABLE [dbo].[customers] ADD [paymentBehaviour] NVARCHAR(40) NULL;
IF COL_LENGTH('customers', 'paymentReviewed') IS NULL
    ALTER TABLE [dbo].[customers] ADD [paymentReviewed] BIT NOT NULL CONSTRAINT [customers_paymentReviewed_df] DEFAULT 0;
IF COL_LENGTH('customers', 'costToServe') IS NULL
    ALTER TABLE [dbo].[customers] ADD [costToServe] NVARCHAR(40) NULL;
IF COL_LENGTH('customers', 'costToServeReviewed') IS NULL
    ALTER TABLE [dbo].[customers] ADD [costToServeReviewed] BIT NOT NULL CONSTRAINT [customers_costToServeReviewed_df] DEFAULT 0;

-- Existing customers start on the neutral middle option, left explicitly
-- un-reviewed so the UI can say the value is a placeholder rather than a
-- judgement. Run through EXEC because the columns do not exist yet when this
-- file is compiled — Prisma sends it as one batch, with no GO.
EXEC(N'
    UPDATE [dbo].[customers]
    SET [paymentBehaviour] = N''معمولی''
    WHERE [paymentBehaviour] IS NULL;

    UPDATE [dbo].[customers]
    SET [costToServe] = N''متوسط''
    WHERE [costToServe] IS NULL;
');

/* --------------------- the computed half, its own table ------------------- */

IF OBJECT_ID('dbo.customer_value_metrics', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[customer_value_metrics] (
        [customerId] NVARCHAR(36) NOT NULL,

        [salesRevenueRial]   DECIMAL(19,2) NOT NULL CONSTRAINT [cvm_salesRevenueRial_df] DEFAULT 0,
        [grossProfitRial]    DECIMAL(19,2) NOT NULL CONSTRAINT [cvm_grossProfitRial_df] DEFAULT 0,
        [grossMarginPercent] FLOAT NULL,
        [costCoveragePercent] FLOAT NOT NULL CONSTRAINT [cvm_costCoveragePercent_df] DEFAULT 0,

        [purchaseFrequency] INT NOT NULL CONSTRAINT [cvm_purchaseFrequency_df] DEFAULT 0,

        [lastPurchaseDate]       DATE NULL,
        [lastPurchaseDateJalali] NVARCHAR(10) NULL,
        [daysSinceLastPurchase]  INT NULL,

        [grossProfitScore] FLOAT NOT NULL CONSTRAINT [cvm_grossProfitScore_df] DEFAULT 0,
        [frequencyScore]   FLOAT NOT NULL CONSTRAINT [cvm_frequencyScore_df] DEFAULT 0,
        [recencyScore]     FLOAT NOT NULL CONSTRAINT [cvm_recencyScore_df] DEFAULT 0,
        [paymentScore]     FLOAT NOT NULL CONSTRAINT [cvm_paymentScore_df] DEFAULT 0,
        [costToServeScore] FLOAT NOT NULL CONSTRAINT [cvm_costToServeScore_df] DEFAULT 0,

        [realizedValueScore]  FLOAT NOT NULL CONSTRAINT [cvm_realizedValueScore_df] DEFAULT 0,
        [potentialValueScore] FLOAT NULL,
        [customerValueIndex]  FLOAT NULL,
        [customerValueRank]   NVARCHAR(10) NOT NULL CONSTRAINT [cvm_customerValueRank_df] DEFAULT N'PENDING',

        [calculatedAt] DATETIME2 NOT NULL CONSTRAINT [cvm_calculatedAt_df] DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT [customer_value_metrics_pkey] PRIMARY KEY CLUSTERED ([customerId])
    );

    CREATE NONCLUSTERED INDEX [cvm_rank_idx] ON [dbo].[customer_value_metrics]([customerValueRank]);
    CREATE NONCLUSTERED INDEX [cvm_cvi_idx] ON [dbo].[customer_value_metrics]([customerValueIndex]);
    CREATE NONCLUSTERED INDEX [cvm_realized_idx] ON [dbo].[customer_value_metrics]([realizedValueScore]);
    CREATE NONCLUSTERED INDEX [cvm_potential_idx] ON [dbo].[customer_value_metrics]([potentialValueScore]);
    CREATE NONCLUSTERED INDEX [cvm_grossProfit_idx] ON [dbo].[customer_value_metrics]([grossProfitRial]);
    CREATE NONCLUSTERED INDEX [cvm_lastPurchase_idx] ON [dbo].[customer_value_metrics]([lastPurchaseDate]);

    ALTER TABLE [dbo].[customer_value_metrics]
        ADD CONSTRAINT [customer_value_metrics_customerId_fkey]
        FOREIGN KEY ([customerId]) REFERENCES [dbo].[customers]([id])
        ON DELETE CASCADE ON UPDATE CASCADE;
END

/* -------------------------- potential assessment log ---------------------- */

IF OBJECT_ID('dbo.customer_potential_history', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[customer_potential_history] (
        [id]         NVARCHAR(36) NOT NULL,
        [customerId] NVARCHAR(36) NOT NULL,

        [previousScore] FLOAT NULL,
        [newScore]      FLOAT NULL,
        [previousParams] NVARCHAR(MAX) NULL,
        [newParams]      NVARCHAR(MAX) NULL,

        [changedBy]     NVARCHAR(36) NULL,
        [changedByName] NVARCHAR(200) NULL,
        [changedAt]     DATETIME2 NOT NULL CONSTRAINT [cph_changedAt_df] DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT [customer_potential_history_pkey] PRIMARY KEY CLUSTERED ([id])
    );

    CREATE NONCLUSTERED INDEX [cph_customer_idx]
        ON [dbo].[customer_potential_history]([customerId], [changedAt]);

    ALTER TABLE [dbo].[customer_potential_history]
        ADD CONSTRAINT [customer_potential_history_customerId_fkey]
        FOREIGN KEY ([customerId]) REFERENCES [dbo].[customers]([id])
        ON DELETE CASCADE ON UPDATE CASCADE;
END

/* ------------------- retire the previous scoring columns ------------------ */
-- The single-axis level this replaces. Its index and default constraints have
-- to go first; SQL Server will not drop a column either is still attached to.

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'customers_customerLevel_idx' AND object_id = OBJECT_ID('customers'))
    DROP INDEX [customers_customerLevel_idx] ON [dbo].[customers];

DECLARE @sql NVARCHAR(MAX) = N'';
SELECT @sql = @sql + N'ALTER TABLE [dbo].[customers] DROP CONSTRAINT [' + dc.name + N'];'
FROM sys.default_constraints dc
JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
WHERE dc.parent_object_id = OBJECT_ID('dbo.customers')
  AND c.name IN ('purchaseCount', 'purchaseAmountRial', 'purchaseItemCount', 'customerLevel');
IF LEN(@sql) > 0 EXEC sp_executesql @sql;

IF COL_LENGTH('customers', 'purchaseCount') IS NOT NULL
    ALTER TABLE [dbo].[customers] DROP COLUMN [purchaseCount];
IF COL_LENGTH('customers', 'purchaseAmountRial') IS NOT NULL
    ALTER TABLE [dbo].[customers] DROP COLUMN [purchaseAmountRial];
IF COL_LENGTH('customers', 'purchaseItemCount') IS NOT NULL
    ALTER TABLE [dbo].[customers] DROP COLUMN [purchaseItemCount];
IF COL_LENGTH('customers', 'customerLevel') IS NOT NULL
    ALTER TABLE [dbo].[customers] DROP COLUMN [customerLevel];
