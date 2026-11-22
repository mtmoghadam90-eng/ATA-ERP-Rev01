-- Preserve full tag lists throughout the document chain. SQL Server cannot
-- use NVARCHAR(MAX) as an index key, so remove the two old tag indexes first.
BEGIN TRY

BEGIN TRAN;

-- DropIndex
DROP INDEX [project_items_tagNumber_idx] ON [dbo].[project_items];

-- DropIndex
DROP INDEX [proforma_items_tagNumber_idx] ON [dbo].[proforma_items];

-- AlterTable
ALTER TABLE [dbo].[project_items] ALTER COLUMN [tagNumber] NVARCHAR(max) NULL;

-- AlterTable
ALTER TABLE [dbo].[proforma_items] ALTER COLUMN [tagNumber] NVARCHAR(max) NULL;

-- AlterTable
ALTER TABLE [dbo].[purchase_order_items] ALTER COLUMN [tagNumber] NVARCHAR(max) NULL;

-- AlterTable
ALTER TABLE [dbo].[supplier_inquiry_items] ALTER COLUMN [tagNumber] NVARCHAR(max) NULL;

-- AlterTable
ALTER TABLE [dbo].[packing_items] ALTER COLUMN [tagNumber] NVARCHAR(max) NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

