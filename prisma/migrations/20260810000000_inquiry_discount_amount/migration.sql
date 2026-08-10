-- The fixed-amount half of the offer discount.
--
-- This column belongs with `discountPercent` in 20260808000000_inquiry_discount,
-- and that is where it was written — by editing that migration after it had
-- already been applied. Prisma records a migration by name and never runs it
-- again, so the edit reached every repository and no database: `discountPercent`
-- existed, `discountAmount` did not, and the generated client selected both.
-- Every read and every write of the supplier-inquiry module answered P2022,
-- "The column `discountAmount` does not exist in the current database".
--
-- Hence a new migration. A migration that has shipped is history and cannot be
-- amended; the only way to change what a database contains is to add to it.
--
-- Guarded, so this is safe on a database built after the amendment — where the
-- 20260808 migration created both columns and there is nothing to do here.

IF COL_LENGTH('dbo.supplier_inquiries', 'discountAmount') IS NULL
    ALTER TABLE [dbo].[supplier_inquiries]
        ADD [discountAmount] DECIMAL(19, 4) NOT NULL CONSTRAINT [DF_supplier_inquiries_discountAmount] DEFAULT 0;

-- And the percentage, for the same reason in reverse: a database that somehow
-- missed the original migration entirely should end up correct too.
IF COL_LENGTH('dbo.supplier_inquiries', 'discountPercent') IS NULL
    ALTER TABLE [dbo].[supplier_inquiries]
        ADD [discountPercent] DECIMAL(5, 2) NOT NULL CONSTRAINT [DF_supplier_inquiries_discountPercent] DEFAULT 0;
