import assert from "node:assert/strict";
import test from "node:test";
import { createSinglePassInvestigationPlanner } from "../../src/evaluation/fixed-investigation-planner.js";
import type { RecruitmentPlanner, RecruitmentPlannerInput } from "../../src/recruitment/recruitment-planner.js";
import { messageForRecruitmentAction, parseRecruitmentPlannerOutput } from "../../src/recruitment/recruitment-tools.js";

function plannerInput(history: RecruitmentPlannerInput["history"]): RecruitmentPlannerInput {
  return {
    decisionSnapshot: { case: { targetTeam: null }, caps: { stage: "investigate" } },
    history,
    dataMode: "demo",
    dataSource: "fixture",
  } as unknown as RecruitmentPlannerInput;
}

test("fixed hybrid baseline searches the exact user question once, then goes to answer synthesis", async () => {
  let conclusionStage = "";
  const conclusionPlanner: RecruitmentPlanner = {
    async decide(input) {
      conclusionStage = input.decisionSnapshot.caps.stage;
      return messageForRecruitmentAction({ action: "ask_user", question: "Which role?", reason: "Need a role." }, "baseline-conclusion");
    },
  };
  const planner = createSinglePassInvestigationPlanner(conclusionPlanner);
  const userQuery = "According to the study about movement, what happened on 2099-12-31?";
  const initial = plannerInput([{ role: "user", content: userQuery }]);
  assert.equal(planner.requiresGatewayDispatch?.(initial), false);
  assert.equal(planner.isFinalSynthesis?.(initial), false);
  const retrievalAction = parseRecruitmentPlannerOutput(await planner.decide(initial));
  assert.equal(retrievalAction.action.action, "search_methodology");
  if (retrievalAction.action.action !== "search_methodology") throw new Error("Expected one methodology lookup.");
  assert.equal(retrievalAction.action.query, userQuery);
  assert.deepEqual(retrievalAction.action.additionalQueries, []);

  const afterRetrieval = plannerInput([
    { role: "user", content: userQuery },
    { role: "tool", toolName: "search_methodology", content: "one retrieval batch" },
  ]);
  assert.equal(planner.requiresGatewayDispatch?.(afterRetrieval), true);
  assert.equal(planner.isFinalSynthesis?.(afterRetrieval), true);
  const finalAction = parseRecruitmentPlannerOutput(await planner.decide(afterRetrieval));
  assert.equal(finalAction.action.action, "ask_user");
  assert.equal(conclusionStage, "conclude");
});
