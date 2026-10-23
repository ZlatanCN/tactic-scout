import assert from "node:assert/strict";
import test from "node:test";
import {
  isModelGatewayAttemptBudgetExhausted,
  isModelGatewayAttemptLimitError,
  ModelGatewayAttemptLimitError,
  reserveModelGatewayAttempt,
  withModelGatewayAttemptBudget,
} from "../../src/recruitment/model-gateway-attempt-budget.js";

test("shared request budget blocks a provider attempt before dispatch", async () => {
  await withModelGatewayAttemptBudget(2, async () => {
    assert.equal(isModelGatewayAttemptBudgetExhausted(), false);
    reserveModelGatewayAttempt();
    reserveModelGatewayAttempt();
    assert.equal(isModelGatewayAttemptBudgetExhausted(), true);
    assert.throws(reserveModelGatewayAttempt, ModelGatewayAttemptLimitError);
  });
  assert.equal(isModelGatewayAttemptBudgetExhausted(), false);
  assert.doesNotThrow(reserveModelGatewayAttempt);
});

test("gateway limit errors remain detectable when wrapped by an adapter", () => {
  const error = new Error("Model adapter failed", { cause: new ModelGatewayAttemptLimitError(1) });
  assert.equal(isModelGatewayAttemptLimitError(error), true);
});

test("nested request scopes can tighten but cannot expand the active cap", async () => {
  await withModelGatewayAttemptBudget(3, async () => {
    reserveModelGatewayAttempt();
    await withModelGatewayAttemptBudget(1, async () => {
      assert.throws(reserveModelGatewayAttempt, ModelGatewayAttemptLimitError);
    });
    reserveModelGatewayAttempt();
    reserveModelGatewayAttempt();
    assert.throws(reserveModelGatewayAttempt, ModelGatewayAttemptLimitError);
  });
});
