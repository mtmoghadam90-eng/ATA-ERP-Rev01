-- A record that moved on and then got stuck again is a second stall.
--
-- `workflow_firings` identified a firing by (ruleId, entityId, occurrence), and
-- for a rule counted from a fixed date that is exactly right: `sentDate` never
-- moves, so the reminder is owed once and a sweep that runs again tomorrow finds
-- nothing to do.
--
-- It is the wrong shape for the three dwell subjects, where the base date is a
-- clock that **restarts**. A project recorded as «باخته» fires the rule and
-- writes occurrence 1; the job is reopened, worked, and lost again two months
-- later; `statusChangedAt` now names the new day, `occurrenceDue` still answers
-- 1 because nothing repeats, and the insert hits the existing row — so the rule
-- never fires again for that project, for ever. Nothing failed: the message the
-- company meant to send simply never went, with nothing on any screen saying so.
-- The same holds for a purchase order rejected at customs and sent back into
-- transit, and for an after-sales job reopened.
--
-- `resolveFinishedTasks` already deletes a firing when it retires the task it
-- raised, which covered exactly one case — a rule with `closeWhenResolved` on,
-- that raised a task, whose record then left the band. A `send_message` rule has
-- no task to retire and was never covered at all.
--
-- `dueDay` is the honest fourth column, because it *is* «which stall this
-- answered»: it is derived from the base date, so it moves precisely when the
-- clock restarts and stays put when the date is fixed. A repeating rule is
-- unaffected — its occurrences already differ — and the earlier firing is kept
-- rather than deleted, which is what the column was being stored for.
--
-- No DML, so nothing in this batch reads a column the batch adds. The column
-- itself has existed since the table was created, so there is nothing to add:
-- this migration only replaces the key. Existing rows cannot violate the wider
-- index, since a superset of a unique key is still unique.
--
-- Guarded at each step, because a migration that fails half way leaves what ran
-- before it applied and the retry has to be safe. The index key list is exempt
-- from the compile-time binding that forced 20260916000000's filtered index into
-- an EXEC — a predicate is an expression and a key list is not.

-- The three-column key has to go before the four-column one can exist: they
-- would otherwise both stand, and the narrower one would keep refusing exactly
-- the second stall this migration exists to allow.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'workflow_firings_rule_entity_occurrence_uq' AND object_id = OBJECT_ID('dbo.workflow_firings'))
    DROP INDEX [workflow_firings_rule_entity_occurrence_uq] ON [dbo].[workflow_firings];

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'workflow_firings_rule_entity_occurrence_due_uq' AND object_id = OBJECT_ID('dbo.workflow_firings'))
    CREATE UNIQUE INDEX [workflow_firings_rule_entity_occurrence_due_uq] ON [dbo].[workflow_firings]([ruleId], [entityId], [occurrence], [dueDay]);
