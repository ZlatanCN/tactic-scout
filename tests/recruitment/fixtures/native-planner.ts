import { AIMessage } from "@langchain/core/messages";
import { emptyToolUseCounts } from "../../../src/recruitment/recruitment-actions.js";
import type { DecisionSnapshot } from "../../../src/recruitment/conversation/planning-snapshot.js";
import type { RecruitmentPlannerInput } from "../../../src/recruitment/recruitment-planner.js";

export function plannerSnapshot(options: {
  stage?: DecisionSnapshot["caps"]["stage"];
  targetTeam?: string | null;
  confirmedPosition?: DecisionSnapshot["case"]["confirmedPosition"];
  availableActions?: DecisionSnapshot["caps"]["availableActions"];
  constraints?: DecisionSnapshot["constraints"];
  expansionConstraints?: DecisionSnapshot["search"]["expansionConstraints"];
  history?: DecisionSnapshot["history"];
} = {}): DecisionSnapshot {
  const stage = options.stage ?? "investigate";
  const availableActions = options.availableActions ?? (stage === "conclude"
    ? ["ask_user", "finish"]
    : stage === "expand" || stage === "expand_recovery"
      ? ["search_candidates", "finish"]
      : stage === "reorient"
        ? ["search_candidates", "ask_user", "finish"]
        : ["search_candidates", "search_methodology", "evaluate_candidates", "search_player_reports", "ask_user", "finish"]);
  const constraints = options.constraints ?? (stage === "investigate" ? null : {
    targetTeam: options.targetTeam ?? null,
    evaluatedCandidates: [],
    reportObservations: [],
    requestedCapabilityCoverage: [],
  });
  return {
    version: 1,
    userPreferences: [],
    case: {
      latestUserRequest: "为球队寻找合适的候选球员",
      targetTeam: options.targetTeam ?? null,
      brief: null,
      abilityProfilesEnabled: false,
      confirmedPosition: options.confirmedPosition ?? null,
      confirmedPositions: [],
      positionBroadeningApproved: false,
      pendingQuestion: null,
    },
    history: options.history ?? [],
    caps: { stage, availableActions },
    candidates: { eligiblePlayerIds: [], evaluatedPlayerIds: [], identityGroups: [] },
    search: {
      nextOffset: options.expansionConstraints?.nextOffset ?? null,
      request: null,
      expansionConstraints: options.expansionConstraints ?? null,
    },
    budget: emptyToolUseCounts(),
    constraints,
  };
}

export function plannerInput(options: {
  stage?: DecisionSnapshot["caps"]["stage"];
  targetTeam?: string | null;
  confirmedPosition?: DecisionSnapshot["case"]["confirmedPosition"];
  availableActions?: DecisionSnapshot["caps"]["availableActions"];
  constraints?: DecisionSnapshot["constraints"];
  expansionConstraints?: DecisionSnapshot["search"]["expansionConstraints"];
  history?: DecisionSnapshot["history"];
  caseProgress?: unknown;
  dataMode?: RecruitmentPlannerInput["dataMode"];
  dataSource?: string;
} = {}): RecruitmentPlannerInput {
  const decisionSnapshot = plannerSnapshot(options);
  return {
    decisionSnapshot,
    history: options.history ?? [],
    dataMode: options.dataMode ?? "demo",
    dataSource: options.dataSource ?? "Fixture",
    ...(options.caseProgress === undefined ? {} : { caseProgress: options.caseProgress }),
  };
}

export function toolCallMessage(name: string, args: Record<string, unknown>, id = "fixture-tool-call"): AIMessage {
  return new AIMessage({ content: "", tool_calls: [{ name, args, id, type: "tool_call" }] });
}

export function nativeCompletion(name: string, args: Record<string, unknown> = {}) {
  return Response.json({
    id: "fixture",
    object: "chat.completion",
    created: 1,
    model: "fixture",
    choices: [{
      index: 0,
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "fixture-tool-call", type: "function", function: { name, arguments: JSON.stringify(args) } }],
      },
    }],
    usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 },
  });
}

export const finishArguments = {
  needSummary: "根据当前已核验的比赛数据整理后续考察线索。",
  capabilityProfile: [],
  recommendations: [],
  limitationKeys: ["other"],
  reportObservations: [],
};
