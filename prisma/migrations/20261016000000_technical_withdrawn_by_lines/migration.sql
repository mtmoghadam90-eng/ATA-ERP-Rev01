-- A technical proposal whose every line was marked «لغو شده» in the outcome
-- modal is a withdrawn proposal: the document now says so (`isCancelled`), as
-- `setItemOutcomes` does from here on (`technicalWithdrawnByLines`). Before
-- this, such a document stayed «در انتظار تأیید فنی» and in the follow-up queue,
-- whose «ثبت اقدام بعدی» then refused it as already decided.
-- Every column read here exists before this migration, so plain DML compiles.
UPDATE [proformas]
SET [isCancelled] = 1
WHERE [proformaType] = N'TECHNICAL'
  AND [isCancelled] = 0
  AND EXISTS (SELECT 1 FROM [proforma_items] i WHERE i.[proformaId] = [proformas].[id])
  AND NOT EXISTS (
    SELECT 1 FROM [proforma_items] i
    WHERE i.[proformaId] = [proformas].[id]
      AND (i.[status] IS NULL OR i.[status] <> N'لغو شده')
  );
