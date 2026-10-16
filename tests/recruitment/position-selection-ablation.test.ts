import assert from "node:assert/strict";
import test from "node:test";
import { positionSelectionFixture } from "../fixtures/position-selection.js";
import { positionSelectionLabel } from "../../src/domain/position-selection.js";
import { type SelectablePosition } from "../../src/domain/position-contracts.js";

for (const scenario of [
  { positions: ["LB", "LWB"] as SelectablePosition[], expected: ["left-back", "wing-back"] },
  { positions: ["LB", "RW"] as SelectablePosition[], expected: ["left-back", "right-wing"] },
]) {
  test(`frozen whole-graph ablation preserves the complete ${scenario.positions.join("/")} selection through structured confirmation`, async (context) => {
    const results: Record<string, string[]> = {};
    const measurements: Record<string, unknown> = {};
    for (const arm of ["text_reinterpretation", "structured_confirmation"] as const) {
      const { app, queries, plannerCalls, events } = positionSelectionFixture();
      const started = performance.now();
      const url = `/api/v1/recruitment/cases/ablation-${arm}-${scenario.positions.join("-")}/turns`;
      try {
        const first = (await app.inject({ method: "POST", url, payload: { message: "为巴萨寻找提升防守的球员，年龄不超过25岁，至少900分钟，重点看抢断和拦截" } })).json();
        assert.equal(first.status, "needs_input");
        const payload = arm === "structured_confirmation"
          ? { positionAnswer: { questionId: first.question.input.questionId, positions: scenario.positions } }
          : { message: `找${positionSelectionLabel(scenario.positions)}，符合其中任一位置即可。` };
        const response = await app.inject({ method: "POST", url, payload });
        assert.equal(response.json().status, "completed", response.body);
        results[arm] = response.json().report.recommendations.map((item: { player: { playerId: string } }) => item.player.playerId).sort();
        measurements[arm] = { selectedPositions: scenario.positions, recommendedPlayers: results[arm], plannerCalls: plannerCalls(), toolCalls: events.filter((event) => event.phase === "tool").length, elapsedMs: Math.round(performance.now() - started) };
        for (const query of queries) { assert.equal(query.maxAge, 25); assert.equal(query.minimumMinutes, 900); }
      } finally { await app.close(); }
    }
    context.diagnostic(`position-confirmation-ablation ${JSON.stringify(measurements)}`);
    assert.deepEqual(results.structured_confirmation, scenario.expected.sort());
    assert.equal(results.text_reinterpretation!.length, 1, "the existing single-position text path preserves only one of this fixture's alternatives");
    assert.ok(results.text_reinterpretation!.every((id) => scenario.expected.includes(id)), "the baseline must not invent an unrelated candidate");
  });
}
