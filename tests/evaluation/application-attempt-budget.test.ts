import assert from "node:assert/strict";
import test from "node:test";
import { createApplicationAttemptBudget } from "../../src/evaluation/application-attempt-budget.js";

test("planner reservations share the remaining request budget with completed setup and retrieval calls", () => {
  let completedAttempts = 1;
  const budget = createApplicationAttemptBudget(() => completedAttempts);
  budget.reset(4);

  assert.equal(budget.reserve(), true);
  assert.equal(budget.hasCapacity(), true);
  assert.equal(budget.reserve(), true);
  assert.equal(budget.reserve(), true);
  assert.equal(budget.reserve(), false);

  completedAttempts += 3;
  budget.completePlannerDispatch();
  assert.equal(budget.hasCapacity(), false);
  assert.equal(budget.reserve(), false);
});

test("reset starts a new application request without carrying reservations forward", () => {
  let completedAttempts = 0;
  const budget = createApplicationAttemptBudget(() => completedAttempts);
  budget.reset(2);
  assert.equal(budget.reserve(), true);
  assert.equal(budget.reserve(), true);
  assert.equal(budget.reserve(), false);

  completedAttempts = 0;
  budget.reset(1);
  assert.equal(budget.hasCapacity(), true);
  assert.equal(budget.reserve(), true);
});
