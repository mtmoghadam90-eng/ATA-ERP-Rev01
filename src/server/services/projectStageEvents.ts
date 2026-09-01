import { getDb } from "../db";
import type { AuthUser } from "../auth";
import { processWorkflowRules } from "./workflowService";

/**
 * Fires «تغییر مرحله پروژه» after the write that caused it has committed.
 *
 * `syncProjectStage` runs **inside** the writing transaction — that is the
 * whole point of it, so the stage can never be seen disagreeing with the
 * records it came from. But a workflow rule must not run in there: it creates
 * tasks, sends messages and reads rows this transaction has not released, and
 * anything it throws would roll back a save that was otherwise fine. Same rule
 * as every other after-commit side effect here.
 *
 * So the move is queued and drained a moment later, outside the transaction.
 * Three things make that safe:
 *
 *  * **The drain re-reads the project.** A transaction that rolls back after
 *    queueing would otherwise fire a trigger for a move that never happened;
 *    the stored stage will not match `to`, and the event is dropped. This is
 *    the important half — a delay alone would not give it.
 *  * **Coalescing per project.** A save that moves the stage twice is one
 *    event, keeping the first `from` and the last `to`, which is the move a
 *    person would describe.
 *  * **It can never fail a write.** Nothing awaits it and a failure is logged
 *    and forgotten, exactly as `scheduleCustomerValueRecalculation` does.
 */

/** Long enough for the transaction to commit, short enough to feel immediate. */
const SETTLE_MS = 3_000;

interface PendingMove {
  from: string | null;
  to: string;
  user?: AuthUser;
}

const pending = new Map<string, PendingMove>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function drain(): Promise<void> {
  const moves = [...pending.entries()];
  pending.clear();

  const db = getDb();
  for (const [projectId, move] of moves) {
    try {
      const project = await db.project.findUnique({
        where: { id: projectId },
        select: { id: true, code: true, name: true, status: true, stage: true, customerId: true },
      });
      /*
       * The move has to still be true. A rolled-back transaction leaves the
       * stored stage where it was, and firing on it would raise a task for
       * something that did not happen.
       */
      if (!project || project.stage !== move.to) continue;

      await processWorkflowRules(
        "project_stage_change",
        {
          projectId: project.id,
          projectCode: project.code,
          projectName: project.name,
          customerId: project.customerId,
          oldStage: move.from,
          newStage: move.to,
          stage: move.to,
          // The sales outcome alongside, so a rule can ask for «ترخیص گمرک on a
          // won project» without a second lookup.
          status: project.status,
        },
        move.user,
      );
    } catch (err) {
      // Detached from any request: never rethrow.
      console.error("project stage trigger failed:", err);
    }
  }
}

/**
 * Records that a project's stage moved. Safe to call inside a transaction, and
 * from anywhere, any number of times.
 */
export function scheduleProjectStageTrigger(
  projectId: string,
  from: string | null,
  to: string,
  user?: AuthUser,
): void {
  const existing = pending.get(projectId);
  // The first `from` and the last `to`: the move as a person would describe it.
  pending.set(projectId, { from: existing ? existing.from : from, to, user: user ?? existing?.user });

  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void drain();
  }, SETTLE_MS);
  // Never hold the process open for a queued trigger.
  if (typeof timer === "object" && timer && "unref" in timer) timer.unref();
}
