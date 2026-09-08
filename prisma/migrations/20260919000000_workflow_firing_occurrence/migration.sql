-- Which firing of a repeating rule this row is.
--
-- `workflow_firings` has enforced «once per record, for ever» through a unique
-- index on (ruleId, entityId) since scheduled rules were written, and that is
-- the right shape for «۳ روز پس از ارسال، پیگیری کن»: one reminder, and a sweep
-- that runs again tomorrow finds nothing to do.
--
-- It is the wrong shape for the case this whole line of work started from. The
-- supplier has not answered for a week; somebody is reminded once; nobody acts;
-- and nothing ever asks again. Repeating needs a third column in that key, and
-- there is no way to add one to an index without replacing it.
--
-- `occurrence` is 1-based and **derived from the dates**, never counted from the
-- rows in this table — so a firing the sweep never reached (the server was off,
-- the rule was inactive) leaves no gap that would shift every later number, and
-- asking twice gives the same answer. An ordinary rule always writes 1 and is
-- exactly as it was.
--
-- DEFAULT 1 is what makes this safe on a live database: every row already here
-- was that rule's only firing for its record, which is what 1 means. No DML,
-- so nothing in this batch reads a column the batch adds.
--
-- Guarded at each step, because a migration that fails half way leaves what ran
-- before it applied and the retry has to be safe. The index key list is exempt
-- from the compile-time binding that forced 20260916000000's filtered index into
-- an EXEC — a predicate is an expression and a key list is not — which is why
-- these are written plainly, as every other index in this tree is.

IF COL_LENGTH('dbo.workflow_firings', 'occurrence') IS NULL
    ALTER TABLE [dbo].[workflow_firings]
        ADD [occurrence] INT NOT NULL CONSTRAINT [workflow_firings_occurrence_df] DEFAULT 1;

-- The old two-column key has to go before the three-column one can exist: they
-- would otherwise both stand, and the narrower one would keep refusing exactly
-- the second firing this migration exists to allow.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'workflow_firings_rule_entity_uq' AND object_id = OBJECT_ID('dbo.workflow_firings'))
    DROP INDEX [workflow_firings_rule_entity_uq] ON [dbo].[workflow_firings];

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'workflow_firings_rule_entity_occurrence_uq' AND object_id = OBJECT_ID('dbo.workflow_firings'))
    CREATE UNIQUE INDEX [workflow_firings_rule_entity_occurrence_uq] ON [dbo].[workflow_firings]([ruleId], [entityId], [occurrence]);
