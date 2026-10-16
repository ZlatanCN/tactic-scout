import assert from "node:assert/strict";
import test from "node:test";
import { runCounterbalancedPairs, runCounterbalancedTriples } from "../../src/evaluation/paired-runs.js";

test("paired experiments alternate execution order while retaining the matching repetition in each arm", async () => {
  const order: string[] = [];
  const arm = (name: string) => async (repetition: number) => {
    order.push(`${name}:${repetition}`);
    await Promise.resolve();
    return `${name}:${repetition}`;
  };
  const runs = await runCounterbalancedPairs(3, arm("baseline"), arm("control"));
  assert.deepEqual(order, ["baseline:1", "control:1", "control:2", "baseline:2", "baseline:3", "control:3"]);
  assert.deepEqual(runs, { baseline: ["baseline:1", "baseline:2", "baseline:3"], control: ["control:1", "control:2", "control:3"] });
});

test("a failed comparison arm aborts before starting any unmatched later run", async () => {
  const order: string[] = [];
  await assert.rejects(runCounterbalancedPairs(3,
    async (n) => { order.push(`baseline:${n}`); return n; },
    async (n) => { order.push(`control:${n}`); if (n === 2) throw new Error("control failed"); return n; },
  ), /control failed/);
  assert.deepEqual(order, ["baseline:1", "control:1", "control:2"]);
});

test("counterbalanced triples rotate every arm through first, middle, and last position", async () => {
  const order: string[][] = [];
  const makeArm = (id: string) => async (repetition: number) => {
    order[repetition - 1] ??= [];
    order[repetition - 1]!.push(id);
    return `${id}-${repetition}`;
  };

  const result = await runCounterbalancedTriples(3, [
    { id: "catalog", run: makeArm("catalog") },
    { id: "fixed", run: makeArm("fixed") },
    { id: "adaptive", run: makeArm("adaptive") },
  ]);

  assert.deepEqual(order, [
    ["catalog", "fixed", "adaptive"],
    ["fixed", "adaptive", "catalog"],
    ["adaptive", "catalog", "fixed"],
  ]);
  assert.deepEqual(result, {
    catalog: ["catalog-1", "catalog-2", "catalog-3"],
    fixed: ["fixed-1", "fixed-2", "fixed-3"],
    adaptive: ["adaptive-1", "adaptive-2", "adaptive-3"],
  });
});
