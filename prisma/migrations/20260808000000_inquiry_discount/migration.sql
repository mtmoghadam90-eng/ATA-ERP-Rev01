-- A discount on a supplier's offer, as a percentage of the quoted total.
--
-- A percentage rather than a fixed amount: an inquiry's lines each carry their
-- own currency, so a single amount could not say which currency it was in. It
-- also matches how a proforma's discount is entered — the user gives a
-- percentage and the money is derived from it — so the two forms behave alike.
--
-- Hand-written rather than generated: `prisma migrate diff` also wants to
-- re-create the DEFAULT constraints that introspection does not report, which
-- would bury this one real change.

IF COL_LENGTH('dbo.supplier_inquiries', 'discountPercent') IS NULL
    ALTER TABLE [dbo].[supplier_inquiries]
        ADD [discountPercent] DECIMAL(5, 2) NOT NULL CONSTRAINT [DF_supplier_inquiries_discountPercent] DEFAULT 0;
