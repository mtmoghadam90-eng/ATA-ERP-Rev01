-- A project that automation must leave alone.
--
-- The workflow rules are written once for the whole company, and a job now and
-- then needs to sit outside them: a customer who asked for no notifications on
-- this contract, an internal project, a job whose contact is being handled by
-- hand. Without this the only ways out were disabling the rule for everybody or
-- setting the customer's own opt-out, which stops their messages on every other
-- project too.
--
-- Guarded, so it is safe on a database built after this column existed.
IF COL_LENGTH('dbo.projects', 'suppressAutoMessages') IS NULL
  ALTER TABLE [dbo].[projects] ADD [suppressAutoMessages] BIT NOT NULL CONSTRAINT [DF_projects_suppressAutoMessages] DEFAULT 0;
