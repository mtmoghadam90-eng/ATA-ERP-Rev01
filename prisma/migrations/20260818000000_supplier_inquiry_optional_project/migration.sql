-- Supplier inquiries without a project.
--
-- A warehouse/general-stock price inquiry has no job to attach to, but
-- projectId was NOT NULL, so the only way to record one was to invent a
-- project for it. Purchase orders already allow this (projectId is nullable
-- there); inquiries now match. The FK's ON DELETE CASCADE is unaffected: it
-- only fires for a row whose projectId is actually set.
IF COLUMNPROPERTY(OBJECT_ID('supplier_inquiries'), 'projectId', 'AllowsNull') = 0
BEGIN
    ALTER TABLE [dbo].[supplier_inquiries] ALTER COLUMN [projectId] NVARCHAR(36) NULL;
END
