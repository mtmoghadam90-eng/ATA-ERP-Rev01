-- Adds the chosen SKU to a project line.
--
-- The requested-items grid lets the user pick a specific product variant, and
-- that choice drives stock matching later; without this column the selection was
-- silently dropped on save.
--
-- Hand-written rather than generated: `prisma migrate diff` also wanted to
-- re-create 18 DEFAULT constraints that introspection does not report, which
-- would have buried this one real change in noise.

IF COL_LENGTH('dbo.project_items', 'variantId') IS NULL
    ALTER TABLE [dbo].[project_items] ADD [variantId] NVARCHAR(36);
