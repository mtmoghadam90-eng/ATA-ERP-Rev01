-- A discount on a supplier's offer: a percentage, and a fixed amount off what
-- the percentage leaves.
--
-- The amount is in the offer's own currency, which is well defined because a
-- supplier prices a whole inquiry in one currency; for a Rial-only offer it is
-- Rial. Both totals are reduced by the same proportion so they cannot drift
-- apart when the exchange rate moves.
--
-- Hand-written rather than generated: `prisma migrate diff` also wants to
-- re-create the DEFAULT constraints that introspection does not report, which
-- would bury these two real changes.

IF COL_LENGTH('dbo.supplier_inquiries', 'discountPercent') IS NULL
    ALTER TABLE [dbo].[supplier_inquiries]
        ADD [discountPercent] DECIMAL(5, 2) NOT NULL CONSTRAINT [DF_supplier_inquiries_discountPercent] DEFAULT 0;

IF COL_LENGTH('dbo.supplier_inquiries', 'discountAmount') IS NULL
    ALTER TABLE [dbo].[supplier_inquiries]
        ADD [discountAmount] DECIMAL(19, 4) NOT NULL CONSTRAINT [DF_supplier_inquiries_discountAmount] DEFAULT 0;
