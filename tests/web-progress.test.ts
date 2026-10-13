import assert from "node:assert/strict";
import test from "node:test";
import { allProgressSteps, visibleProgressSteps } from "../web/src/progress.js";
import type { RecruitmentProgressEvent } from "../src/domain/schemas.js";

function event(input: Pick<RecruitmentProgressEvent, "sequence" | "occurrence" | "stage" | "status">): RecruitmentProgressEvent {
  return {
    ...input,
    message: `${input.stage} ${input.status}`,
    occurredAt: new Date(input.sequence * 1000).toISOString(),
  };
}

test("all saved progress steps merge lifecycle events and preserve execution order", () => {
  const events = [
    event({ sequence: 1, occurrence: 1, stage: "planning", status: "started" }),
    event({ sequence: 2, occurrence: 1, stage: "candidate_search", status: "started" }),
    event({ sequence: 3, occurrence: 1, stage: "planning", status: "completed" }),
    event({ sequence: 4, occurrence: 1, stage: "candidate_search", status: "completed" }),
    event({ sequence: 5, occurrence: 2, stage: "candidate_search", status: "started" }),
  ];

  assert.deepEqual(allProgressSteps(events).map(({ stage, occurrence, status }) => ({ stage, occurrence, status })), [
    { stage: "planning", occurrence: 1, status: "completed" },
    { stage: "candidate_search", occurrence: 1, status: "completed" },
    { stage: "candidate_search", occurrence: 2, status: "started" },
  ]);
});

test("live progress keeps the six most recent merged steps while saved history remains complete", () => {
  const events: RecruitmentProgressEvent[] = [];
  for (let occurrence = 1; occurrence <= 8; occurrence += 1) {
    events.push(event({ sequence: occurrence, occurrence, stage: "planning", status: "started" }));
    events.push(event({ sequence: occurrence + 8, occurrence, stage: "planning", status: "completed" }));
  }

  assert.equal(allProgressSteps(events).length, 8);
  assert.equal(visibleProgressSteps(events).length, 6);
  assert.deepEqual(visibleProgressSteps(events).map(({ occurrence }) => occurrence), [3, 4, 5, 6, 7, 8]);
});
