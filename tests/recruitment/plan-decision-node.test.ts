import assert from "node:assert/strict";
import test from "node:test";
import { runWithinEvidenceDeadline } from "../../src/recruitment/conversation/plan-decision-node.js";

test("the RAG Planner call is aborted when its shared investigation deadline expires", async () => {
  let signalAborted = false;
  await assert.rejects(runWithinEvidenceDeadline({
    remainingMs: 5,
    operation(signal) {
      signal.addEventListener("abort", () => { signalAborted = true; }, { once: true });
      return new Promise<never>(() => undefined);
    },
  }), (error: unknown) => error instanceof Error && error.name === "EvidenceInvestigationBudgetExceededError");
  assert.equal(signalAborted, true);
});
