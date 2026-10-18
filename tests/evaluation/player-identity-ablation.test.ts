import assert from "node:assert/strict";
import test from "node:test";
import { runPlayerIdentityAblation } from "../../src/evaluation/player-identity-ablation.js";

test("identity interventions use the same frozen cases and reveal recall, context and wrong-auto effects", async () => {
  const result = await runPlayerIdentityAblation();
  assert.equal(result.rows.length, 40);
  const row = (scenario: string, arm: string) => result.rows.find(row => row.scenario === scenario && row.arm === arm)!;
  assert.ok(result.rows.filter(row => row.arm === "full").every(row => !row.wrongAutomaticIdentity));
  assert.equal(row("chinese-name", "full").correctRecall, true);
  assert.equal(row("chinese-name", "full").confirmationRequired, true);
  assert.equal(row("chinese-name", "model-off").correctRecall, false);
  assert.equal(row("chinese-name", "local-off").expectedRecordAssociated, false);
  assert.equal(row("namesake-position", "full").correctFirstChoice, true);
  assert.equal(row("namesake-position", "context-off").correctFirstChoice, false);
  assert.equal(row("historical-namesake", "full").wrongAutomaticIdentity, false);
  assert.equal(row("historical-namesake", "context-off").wrongAutomaticIdentity, true);
  assert.equal(row("outside-catalog", "web-off").correctRecall, false);
  assert.equal(row("popular-wrong-web-lead", "full").wrongAutomaticIdentity, false);
  assert.ok(result.rows.every(row => row.totalTokens === null), "synthetic model leads do not fabricate real token usage");
});
