-- What record each automatic timeline entry describes.
--
-- Deleting a proforma, a packing list or an inquiry can offer to remove the
-- entries the system wrote about it. Doing that safely needs an exact link:
-- the previous version matched on the *wording* of the entry when no link was
-- stored, which could just as easily delete a sibling document's entry that
-- happened to mention the same product.
--
-- Not a foreign key: it points at six different tables, and an entry must be
-- able to outlive its record — keeping the history is the default, and the
-- entry that says "this document was deleted" refers to something gone.
--
-- Entries written before this migration have no link and are never matched;
-- the option is simply not offered for them.

IF COL_LENGTH('dbo.project_activities', 'sourceType') IS NULL
    ALTER TABLE [dbo].[project_activities] ADD [sourceType] NVARCHAR(30) NULL;

IF COL_LENGTH('dbo.project_activities', 'sourceId') IS NULL
    ALTER TABLE [dbo].[project_activities] ADD [sourceId] NVARCHAR(36) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'project_activities_sourceId_idx')
    CREATE INDEX [project_activities_sourceId_idx] ON [dbo].[project_activities]([sourceId]);
