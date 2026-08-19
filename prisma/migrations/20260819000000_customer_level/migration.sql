-- Customer levels, from what each customer has bought.
--
-- Three totals plus the level they earn, stored on the row rather than
-- recomputed by every reader: the customers grid filters, sorts, pages and
-- exports on the level, and none of those work against a figure that only
-- exists after the page has been fetched. Same treatment, for the same reason,
-- as a project's derived status.
--
-- The totals default to 0 and the level starts NULL. Nothing is back-filled
-- here: the level depends on thresholds that live in settings, which this
-- migration cannot read. `POST /api/customers/recompute-levels` fills them in,
-- and it is also what has to be run after the thresholds are edited.
IF COL_LENGTH('customers', 'purchaseCount') IS NULL
BEGIN
    ALTER TABLE [dbo].[customers] ADD [purchaseCount] INT NOT NULL CONSTRAINT [customers_purchaseCount_df] DEFAULT 0;
END

IF COL_LENGTH('customers', 'purchaseAmountRial') IS NULL
BEGIN
    ALTER TABLE [dbo].[customers] ADD [purchaseAmountRial] DECIMAL(19,2) NOT NULL CONSTRAINT [customers_purchaseAmountRial_df] DEFAULT 0;
END

IF COL_LENGTH('customers', 'purchaseItemCount') IS NULL
BEGIN
    ALTER TABLE [dbo].[customers] ADD [purchaseItemCount] DECIMAL(18,3) NOT NULL CONSTRAINT [customers_purchaseItemCount_df] DEFAULT 0;
END

IF COL_LENGTH('customers', 'customerLevel') IS NULL
BEGIN
    ALTER TABLE [dbo].[customers] ADD [customerLevel] NVARCHAR(20) NULL;
END

-- The column the grid filters on.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'customers_customerLevel_idx' AND object_id = OBJECT_ID('customers'))
BEGIN
    CREATE NONCLUSTERED INDEX [customers_customerLevel_idx] ON [dbo].[customers]([customerLevel]);
END
