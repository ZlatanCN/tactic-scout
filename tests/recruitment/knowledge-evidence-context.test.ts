import assert from "node:assert/strict";
import test from "node:test";
import { knowledgeEvidenceAccessContext } from "../../src/recruitment/conversation/knowledge-evidence-context.js";

const config = { configurable: { thread_id: "rag-context-case-001" } } as never;

test("RAG round IDs are stable on resume while the investigation owner remains shared", () => {
  const initial = knowledgeEvidenceAccessContext(config, {
    history: [{ role: "user", content: "find a role-fit candidate" }],
    ragResearchQueryCount: 0,
  }, "recruitment");
  const followup = knowledgeEvidenceAccessContext(config, {
    history: [{ role: "user", content: "find a role-fit candidate" }],
    ragResearchQueryCount: 1,
  }, "recruitment");
  const resumedFollowup = knowledgeEvidenceAccessContext(config, {
    history: [{ role: "user", content: "find a role-fit candidate" }],
    ragResearchQueryCount: 1,
  }, "recruitment");
  assert.equal(initial.rankingRound, 1);
  assert.equal(followup.rankingRound, 2);
  assert.equal(followup.investigationId, initial.investigationId);
  assert.notEqual(followup.turnId, initial.turnId);
  assert.equal(resumedFollowup.turnId, followup.turnId);
});

test("final source-reference checks have their own bounded operation budget", () => {
  const investigation = knowledgeEvidenceAccessContext(config, {
    history: [{ role: "user", content: "find a role-fit candidate" }],
    ragResearchQueryCount: 2,
  }, "reporting");
  const finalCheck = knowledgeEvidenceAccessContext(config, {
    history: [{ role: "user", content: "find a role-fit candidate" }],
    ragResearchQueryCount: 2,
  }, "reporting", { phase: "final_check" });
  assert.equal(investigation.investigationId !== undefined, true);
  assert.equal(finalCheck.investigationId, undefined);
  assert.notEqual(finalCheck.turnId, investigation.investigationId);
});
