-- Whether a ledger row also moved the sellable level, recorded on the row.
--
-- `stockLevel` means *free to sell*, not *physically present*: a foreign
-- order's receipt and a packing list's issue write the ledger and leave the
-- level alone, because those units were sold before they were bought. Until
-- now that was only an argument passed to applyStockDelta and then forgotten.
--
-- It has to be stored, because a system administrator can now correct or
-- delete a single ledger row, and a correction must put back exactly what the
-- row took. Without the flag, editing a purchase-order receipt would move a
-- level that receipt never touched, and the level would drift by the whole
-- quantity every time someone fixed a typo.
--
-- Backfill: every existing row from those two sources is ledger-only; every
-- other row moved the level, which is the column default.

IF COL_LENGTH('dbo.inventory_transactions', 'affectsAvailable') IS NULL
BEGIN
    ALTER TABLE [dbo].[inventory_transactions]
        ADD [affectsAvailable] BIT NOT NULL CONSTRAINT [DF_inventory_transactions_affectsAvailable] DEFAULT 1;

    EXEC(N'
        UPDATE [dbo].[inventory_transactions]
        SET [affectsAvailable] = 0
        WHERE [referenceType] IN (''PURCHASE_ORDER'', ''DELIVERY'')
    ');
END
