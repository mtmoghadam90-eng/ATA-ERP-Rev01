-- More than one file on an activity.
--
-- An activity carried exactly one attachment, in three columns. A single
-- meeting produces a catalogue, a photograph of a nameplate and a scanned
-- letter, and the form let you attach one of them — so the rest went in as
-- three separate activities, or not at all.
--
-- A JSON column rather than a child table: activities are append-only and are
-- read on a hot path, and this follows `projects.manualDocuments`, which is the
-- same shape of problem already solved here. The three original columns stay
-- and keep carrying the first file, so the Power BI export and anything else
-- reading them is unaffected.
--
-- Guarded, so it is safe on a database built after this column existed.
IF COL_LENGTH('dbo.project_activities', 'attachments') IS NULL
  ALTER TABLE [dbo].[project_activities] ADD [attachments] NVARCHAR(MAX) NULL;
