import { readFileSync } from "node:fs";
import path from "node:path";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod/v4";

import {
  externalFaultFrom,
  logFaultEvent,
  waitForRetryDelay,
} from "../src/fault-tolerance.js";
import { createModelRequestBudget } from "../src/model-requests.js";
import type { ModelRequestBudget } from "../src/model-requests.js";
import {
  availableResultKindSchema,
  judgeCalibrationSchema,
  semanticErrorCategorySchema,
  semanticFindingSchema,
  teamRosterCoverageSchema,
} from "./contracts.js";
import type {
  EvaluationCase,
  JudgeCalibrationReport,
  JsonValue,
  WorkerTrialResult,
} from "./contracts.js";

const semanticJudgeFindingSchema = semanticFindingSchema;

type SemanticErrorCategory = z.output<typeof semanticErrorCategorySchema>;

const semanticJudgePromptVersion = "scouting-semantic-judge-v22";
const semanticRubricVersion = "scouting-evaluation-rubric-v3";

const semanticJudgeOutputSchema = z.object({
  findings: z.array(semanticJudgeFindingSchema),
  requiredFactCoverage: z.array(
    z.object({
      factId: z.string(),
      status: z.enum(["covered", "missing", "uncertain"]),
    })
  ),
});

const trialJudgmentStatusSchema = z.enum([
  "failed",
  "inconclusive",
  "invalid",
  "passed",
]);

type TrialJudgmentStatus = z.output<typeof trialJudgmentStatusSchema>;

const judgeAnchorSchema = z.object({
  actions: z.array(
    z.object({
      actionId: z.string(),
      kind: z.string(),
      name: z.string(),
      outcome: z.string().nullable().optional(),
      sourceRecords: z.array(z.record(z.string(), z.json())).optional(),
    })
  ),
  anchorId: z.string(),
  answer: z.string(),
  availableResultKinds: z
    .array(availableResultKindSchema)
    .nullable()
    .optional(),
  category: z.enum([
    "correct_paraphrase",
    "factual_contradiction",
    "false_execution_claim",
    "unsupported_fact",
  ]),
  evidence: z.array(z.object({ content: z.string(), evidenceId: z.string() })),
  expectedCategories: z.array(semanticErrorCategorySchema),
  scenarioFamily: z.string(),
  split: z.enum(["development", "validation"]),
  userMessage: z.string(),
});

const judgeAnchorPackSchema = z.object({
  anchorVersion: z.string(),
  anchors: z.array(judgeAnchorSchema),
  priorTuningExposure: z
    .string()
    .default("Prior anchor-tuning exposure was not recorded in this pack."),
  retiredValidationAnchorIds: z.array(z.string()).default([]),
});

type AnchorValidation = {
  categories: SemanticErrorCategory[];
  errors: string[];
};

type TrialJudgment = {
  findings: z.output<typeof semanticJudgeFindingSchema>[];
  requiredFactCoverage: z.output<
    typeof semanticJudgeOutputSchema
  >["requiredFactCoverage"];
  status: TrialJudgmentStatus;
  validationErrors: string[];
};

const calibrationResultSchema = judgeCalibrationSchema;

const judgeInputSchema = z.object({
  actions: z.array(
    z.object({
      actionId: z.string(),
      eventId: z.string(),
      input: z.json().nullable(),
      kind: z.string(),
      name: z.string(),
      outcome: z.string().nullable(),
      result: z.string().nullable(),
      sourceRecords: z.array(z.record(z.string(), z.json())),
      turnId: z.string(),
    })
  ),
  caseId: z.string(),
  contract: z.object({
    expectedOutcomeStatus: z.string().nullable(),
    prohibitedClaims: z.array(z.string()),
    requiredAbstentions: z.array(z.string()),
    requiredFacts: z.array(
      z.object({ description: z.string(), factId: z.string() })
    ),
    taskKind: z.string(),
  }),
  evidence: z.array(
    z.object({
      content: z.string(),
      evidenceId: z.string(),
      provider: z.string(),
      sourceId: z.string().nullable(),
      turnId: z.string(),
    })
  ),
  teamRosterCoverage: teamRosterCoverageSchema.nullable(),
  turns: z.array(
    z.object({
      assistantMessages: z.array(z.string()),
      availableResultKinds: z.array(availableResultKindSchema).nullable(),
      clarificationAnswers: z.array(
        z.object({ kind: z.string(), value: z.string() })
      ),
      nodeFailure: z
        .object({ category: z.string(), node: z.string() })
        .nullable()
        .optional(),
      outcomeKind: z.string().nullable(),
      outcomeStatus: z.string().nullable(),
      participants: z.array(
        z.object({
          canonicalIdentityId: z.string().nullable(),
          mention: z.string(),
          resolutionStatus: z.string(),
          resolvedName: z.string().nullable(),
          selectedCandidateId: z.string().nullable(),
          sourceRecords: z.array(
            z.object({
              competition: z.string().nullable().optional(),
              provider: z.string(),
              season: z.string().nullable().optional(),
              sourceId: z.string(),
            })
          ),
        })
      ),
      turnId: z.string(),
      userMessage: z.string(),
    })
  ),
  validationFeedback: z.array(z.string()).optional(),
});

const judgeRubricPrompt = `You are an automated reviewer for a football scouting assistant. Review every assistant response in the supplied conversation.

Use only evidence delivered to the assistant for that turn, evidence explicitly reused in that turn, the listed action events and their exact inputs, per-turn availableResultKinds state observations, and the supplied task contract. Action inputs on attempted, returned, failed, and cache_hit events show parameters used. Requested events record proposed tool arguments and do not prove the tool ran; blocked and schema_rejected events do not show applied filters. For an attempted, returned, failed, or cache_hit search_player_records action, no competition field means no competition filter was supplied. Per-turn state observations are evaluator evidence about which completed result kinds remained available after that turn. They describe stored results, not the outcome of the latest operation: the current action may return no_comparable_data or data_unavailable while availableResultKinds still contains player_comparison because a prior comparison remains active. If the assistant says that prior result remains and this state lists player_comparison, the claim is supported; do not call it a contradiction or unsupported merely because the current operation found no data or failed. A null availableResultKinds means no current-state snapshot was supplied; never treat null as an empty array or as proof that no saved result exists. An empty array is an observed state with no completed result available. If a saved-result-retention claim has no state snapshot or other supporting evidence, classify it as unsupported rather than contradicted; a prior action alone does not establish current availability. Do not use outside football knowledge. A fact that happens to be true in the real world is still unsupported when the supplied evidence does not support it.

Each turn includes the exact participants known for that turn and their selected provider source records. Use these links to connect a participant to the source records in that turn's actions. The competition/season on a participant's identity record describes that identity evidence; it does not automatically describe the requested lookup result. Judge claims such as “all participants” against only that turn's participant list and evidence. Later turns may add participants or change scope; never use those later changes to invalidate a correct earlier answer. Do not infer a turn's participants from the final conversation state.

When a turn has nodeFailure, it records a caught graph failure with its node and normalized category. This supports a narrowly scoped statement that the named node failed for that category in the current turn. It does not establish a broader outage or a more specific provider cause than the category provides. When nodeFailure is null, do not treat an assistant's unsupported explanation of a system failure as verified.

clarificationAnswers lists the actual resume values received in that turn; participants show the post-resume state. When a same-turn identity action initially returns needs_confirmation, but a clarification answer is recorded and the participant is marked resolved with a selectedCandidateId, treat that identity as confirmed.

Report only critical findings in these categories:
- factual_contradiction: a factual claim conflicts with delivered evidence.
- unsupported_fact: a factual claim has no supporting or contradicting delivered evidence.
- false_execution_claim: a claim that an operation was attempted or completed, or that an operation produced a result, is not supported by the action events.

Split the answer into distinct claims and assign one most-specific category to each claim. Do not also label the same claim as unsupported_fact when it is directly contradicted; do not also label a process claim as factual_contradiction or unsupported_fact when false_execution_claim applies. A response may receive multiple categories when it makes different claims. For example, in “I searched the transfer database and found a three-year contract,” the unsupported search is false_execution_claim and the separate contract-duration claim is unsupported_fact. Before reporting a factual_contradiction, compare normalized values: the delivered date "2001-09-05" and the answer date “5 September 2001” are equivalent and must not be flagged. When an action has kind "cache_hit", a claim that a fresh provider request occurred is a false_execution_claim only; it is not a factual_contradiction.

Only claims that the assistant performed an operation in the current turn require a matching successful action in that same turn. With no matching current-turn action, statements such as “I compared the players” or “I applied the under-21 filter” are false_execution_claims, not factual contradictions. For claims about an earlier turn, inspect that turn’s action events and the current availableResultKinds state. Do not require a current-turn action to support an explicitly historical statement about a result that remains active.

Identity resolution is recorded as a "resolve_player_identity" action. Its returned outcome applies only to that exact mention; a "data_unavailable" result supports saying that this mention could not be confirmed, but not that the entire identity registry is unreadable. If identity resolution returns "data_unavailable" and there is no same-turn "search_player_records" action, saying no player-record search ran is accurate.

Identifier rules: supplied evidence IDs begin with "evidence:" and may appear only in evidenceIds. Operation IDs begin with "action:" and event IDs begin with "action-event:"; both may appear only in actionIds. Never place an action or event ID in evidenceIds, or an evidence ID in actionIds. For a factual contradiction, cite the matching evidence ID, for example {"evidenceIds":["evidence:<exact-id>"],"actionIds":[]}. For a false execution claim, cite the matching action ID, for example {"evidenceIds":[],"actionIds":["action:<exact-id>"]}.

When teamRosterCoverage is present, treat it as the deterministic roster-mapping summary. mappedMembers counts roster members linked to one usable local FM profile regardless of target-position score. noLocalProfileMembers and pendingMembers are separate groups; reepBridgeMappings and userConfirmedMappings show mapping provenance. Use these counts verbatim and do not recount per-player action events.

Quote the exact assistant text, use the matching turnId, cite the correctly typed IDs when they exist, and explain the basis briefly. For a claim unsupported by any evidence, the evidenceIds array may be empty. For a claim that an operation never ran, the actionIds array may be empty. Do not label a careful abstention as an error. PA is a potential ceiling signal, not a guaranteed future CA. A missing record does not prove a player is weak. A successful tool result does not prove real-world tactical fit or transfer feasibility.

For each required fact, assess coverage across all assistant responses in the conversation, not only the last answer. A fact stated correctly in an earlier turn remains covered when a later follow-up asks a narrower question or a filtered result omits that earlier candidate. The fact must still be supported by evidence delivered to the assistant or legitimately reused in that turn. If the answer cannot be assessed from the supplied evidence, use uncertain.

If validationFeedback is present, it lists deterministic validation errors from a previous judgment. Re-evaluate the supplied conversation and correct those specific reference or coverage errors. Do not preserve or remove a finding merely to make validation pass: keep every supported critical finding, use an exact quote from the named turn, cite only IDs of the correct kind, and return coverage for every required fact exactly once.

Return the required structured output only.`;

const judgeSystemPrompt = `${judgeRubricPrompt}

Application-specific evidence rules:
- Each required fact names its linked player when a selected provider record identifies one. Check every turn and count values in Markdown tables as covered when the row identifies that player and the column label or field alias matches. A numeric value rounded to the displayed decimal places is equivalent to the source value (for example, 6.4260706603 shown as 6.43 or 0.4714045208 shown as 0.4714). Do not require the full internal precision when the visible answer rounds correctly.
- For factual_contradiction, the explanation must identify the answer's value and the conflicting evidence value. If the explanation says the answer is supported, matches the source, or does not conflict with it, do not report a contradiction.
- The search_player_records tool accepts sourceRecords and seasonStartYear; it has no competition-filter argument. A complete action input with no competition field supports saying that no explicit competition filter was applied. Do not imply that the user's requested competition was filtered.
- Understat team names describe the returned season snapshot. It is supported to say these returned records do not establish a player's current registered team; do not claim the player has no current team.
- For recommend_team_player_candidates with referenceMode=squad, mapped roster FM profiles are the reference profiles. They are intentionally omitted from currentCandidates while still appearing in references and referenceFmIds. Saying the squad members were excluded from candidates is consistent with listing them as references.
- In a team recommendation, compare claims that mapped squad players were excluded against the returned roster FM IDs and both currentCandidates and potentialCandidates. Candidate IDs outside the mapped roster do not contradict exclusion of all mapped roster players.
- Compare numeric FM attribute values as provided. If all relevant attributes are listed, calling the numerically largest listed values higher is a supported comparison; do not require the source to label them as "high".
- The Understat reader chooses the maximum season_start_year in local snapshots when the actual search input omits seasonStartYear. A returned row's season is the effective snapshot season for that query; an explicit start year 2024 is the 2024/25 season.
- If an actual Understat search input has seasonStartYear 2024 and its returned result is not_found with no records, it supports “no row was returned for this selected source for 2024/25” and “the result contains no xG value.” It does not establish that the player's xG is unavailable in other data or seasons.
- A clarification answer and a same-turn participant marked resolved with a selectedCandidateId establish the selected identity after resume, even when the earlier identity lookup action returned needs_confirmation.
- FM attribute keys techniqueRaw and dribblingRaw refer to distinct attributes: Technique is 技术; Dribbling is 盘带. Do not treat one as the other.
- A non-null canonicalIdentityId repeated across resolved turn participants means those mentions refer to one canonical player. If that turn's outcomeStatus is insufficient_distinct_players, asking for another distinct player is supported.
- Recommendation filters.resultLimit is the requested player-list cap; do not infer it from returned list length or afterIdentityExclusion counts.
- For recommend_player_candidates and recommend_team_player_candidates results, filterCounts.excludedMissingAttribute counts profiles missing one or more attributes needed to calculate distance. This supports stating that those profiles could not be ranked because distance attributes were incomplete; do not infer which specific attribute was missing.
- For required-fact coverage, FM currentAbility means CA or 当前能力, and potentialAbility means PA or 潜力能力; Understat expectedGoals means xG or 预期进球.`;

const createSemanticJudge = (options: {
  apiKey: string;
  baseUrl: string;
  model: string;
}) => {
  const model = new ChatOpenAI({
    apiKey: options.apiKey,
    configuration: { baseURL: options.baseUrl },
    maxRetries: 0,
    model: options.model,
    temperature: 0,
  });

  const structuredModel = model.withStructuredOutput(
    semanticJudgeOutputSchema,
    {
      name: "evaluate_scouting_answer",
    }
  );

  const invokeWithRetry = async (
    input: z.output<typeof judgeInputSchema>,
    budget: ModelRequestBudget
  ): Promise<z.output<typeof semanticJudgeOutputSchema>> => {
    const messages = [
      new SystemMessage(judgeSystemPrompt),
      new HumanMessage(JSON.stringify(input)),
    ];

    try {
      return await budget.invoke(
        async (signal) => await structuredModel.invoke(messages, { signal })
      );
    } catch (error) {
      const fault = error instanceof Error ? externalFaultFrom(error) : null;

      if (fault === null || !fault.retryable || !budget.canMakeRequest()) {
        throw error;
      }

      logFaultEvent({
        attempt: fault.requestsUsed,
        category: fault.category,
        durationMs: fault.durationMs,
        event: "retry",
        node: fault.node ?? "evaluation_judge",
        runId: fault.runId,
        threadId: fault.threadId,
      });
      await waitForRetryDelay(250 + Math.random() * 1000);

      return await invokeWithRetry(input, budget);
    }
  };

  return invokeWithRetry;
};

const loadJudgeAnchors = (
  anchorDirectory = path.join(import.meta.dirname, "anchors")
) => {
  const filePath = path.join(anchorDirectory, "v8.json");
  let contents: unknown;

  try {
    contents = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    throw new Error("The semantic judge anchor pack is missing or invalid.");
  }

  return judgeAnchorPackSchema.parse(contents);
};

const judgeIdentifier = (
  namespace: "action" | "action-event" | "evidence",
  id: string
): string => `${namespace}:${id}`;

const actionEventNamespace = "action-event";

type JudgeSourceRecord = {
  competition?: string | null;
  provider: string;
  season?: string | null;
  sourceId: string;
};

type JudgeAction = {
  actionId: string;
  eventId: string;
  input: z.output<typeof judgeInputSchema>["actions"][number]["input"];
  kind: string;
  name: string;
  outcome: string | null;
  result: string | null;
  sourceRecords: z.output<
    typeof judgeInputSchema
  >["actions"][number]["sourceRecords"];
  turnId: string;
};

const judgeSourceRecord = ({
  competition,
  provider,
  season,
  sourceId,
}: JudgeSourceRecord) => ({
  competition: competition ?? null,
  provider,
  season: season ?? null,
  sourceId,
});

const judgeAction = ({
  actionId,
  eventId,
  input,
  kind,
  name,
  outcome,
  result,
  sourceRecords,
  turnId,
}: JudgeAction) => ({
  actionId: judgeIdentifier("action", actionId),
  eventId: judgeIdentifier(actionEventNamespace, eventId),
  input,
  kind,
  name,
  outcome,
  result,
  sourceRecords,
  turnId,
});

const judgeInputForAnchor = (
  anchor: z.output<typeof judgeAnchorSchema>
): z.output<typeof judgeInputSchema> => ({
  actions: anchor.actions.map((action) =>
    judgeAction({
      actionId: action.actionId,
      eventId: `${action.actionId}:anchor`,
      input: null,
      kind: action.kind,
      name: action.name,
      outcome: action.outcome ?? null,
      result: null,
      sourceRecords: action.sourceRecords ?? [],
      turnId: anchor.anchorId,
    })
  ),
  caseId: anchor.anchorId,
  contract: {
    expectedOutcomeStatus: null,
    prohibitedClaims: [],
    requiredAbstentions: [],
    requiredFacts: [],
    taskKind: "anchor_review",
  },
  evidence: anchor.evidence.map((evidence) => ({
    ...evidence,
    evidenceId: judgeIdentifier("evidence", evidence.evidenceId),
    provider: "application",
    sourceId: null,
    turnId: anchor.anchorId,
  })),
  teamRosterCoverage: null,
  turns: [
    {
      assistantMessages: [anchor.answer],
      availableResultKinds: anchor.availableResultKinds ?? null,
      clarificationAnswers: [],
      outcomeKind: null,
      outcomeStatus: null,
      participants: [],
      turnId: anchor.anchorId,
      userMessage: anchor.userMessage,
    },
  ],
});

const validFindingReferences = (
  finding: z.output<typeof semanticJudgeFindingSchema>,
  input: z.output<typeof judgeInputSchema>
): string[] => {
  const errors: string[] = [];
  const turn = input.turns.find(({ turnId }) => turnId === finding.turnId);

  const turnIndex = input.turns.findIndex(
    ({ turnId }) => turnId === finding.turnId
  );

  if (turn === undefined) {
    return [`unknown_turn:${finding.turnId}`];
  }

  const visibleTurnIds = new Set(
    input.turns.slice(0, turnIndex + 1).map(({ turnId }) => turnId)
  );

  if (
    !turn.assistantMessages.some((message) => message.includes(finding.quote))
  ) {
    errors.push(`quote_not_found:${finding.turnId}`);
  }

  const evidenceIds = new Set<string>();

  for (const evidence of input.evidence) {
    if (visibleTurnIds.has(evidence.turnId)) {
      evidenceIds.add(evidence.evidenceId);
    }
  }

  for (const evidenceId of finding.evidenceIds) {
    if (!evidenceIds.has(evidenceId)) {
      errors.push(`unknown_evidence:${evidenceId}`);
    }
  }

  const actionIds = new Set<string>();

  for (const action of input.actions) {
    if (visibleTurnIds.has(action.turnId)) {
      actionIds.add(action.actionId);
      actionIds.add(action.eventId);
    }
  }

  for (const actionId of finding.actionIds) {
    if (!actionIds.has(actionId)) {
      errors.push(`unknown_action:${actionId}`);
    }
  }

  if (
    finding.category === "factual_contradiction" &&
    finding.evidenceIds.length === 0
  ) {
    errors.push("contradiction_missing_evidence_reference");
  }

  return errors;
};

const contradictionExplanationPatterns = [
  /不(?:存在|构成)?(?:事实)?(?:冲突|矛盾|不一致)/u,
  /(?:does not|doesn't) (?:conflict|contradict)/iu,
  /no (?:actual )?(?:conflict|contradiction)/iu,
  /(?:evidence|source) supports? the answer/iu,
  /the answer (?:is|was) supported by (?:the )?(?:evidence|source)/iu,
  /the answer matches? (?:the )?(?:evidence|source)/iu,
  /证据(?:直接)?支持(?:了)?(?:这个)?(?:答案|回答)/u,
  /答案[与和](?:证据|来源|数据)(?:一致|相符|吻合)/u,
  /\bonly if\b/iu,
  /\b(?:might|could|possibly|perhaps)\b/iu,
  /只有在.{0,40}(?:才|情况下)/u,
];

const contradictionExplanationIsInconclusive = (explanation: string): boolean =>
  contradictionExplanationPatterns.some((pattern) => pattern.test(explanation));

const validateAnchorJudgment = (
  anchor: z.output<typeof judgeAnchorSchema>,
  output: z.output<typeof semanticJudgeOutputSchema>
): AnchorValidation => {
  const input = judgeInputForAnchor(anchor);

  const errors = output.findings.flatMap((finding) =>
    validFindingReferences(finding, input)
  );

  const categories = [
    ...new Set(output.findings.map(({ category }) => category)),
  ].toSorted();

  const expected = [...anchor.expectedCategories].toSorted();

  if (JSON.stringify(categories) !== JSON.stringify(expected)) {
    errors.push("category_set_mismatch");
  }

  if (output.requiredFactCoverage.length > 0) {
    errors.push("unexpected_required_fact_coverage");
  }

  return { categories, errors };
};

const judgeOneAnchor = async (
  anchor: z.output<typeof judgeAnchorSchema>,
  judge: ReturnType<typeof createSemanticJudge>,
  runId?: string
) => {
  try {
    const budget = createModelRequestBudget(
      { executionInfo: { runId, threadId: anchor.anchorId } },
      "evaluation_judge_calibration"
    );

    const judgment = await judge(judgeInputForAnchor(anchor), budget);
    const validation = validateAnchorJudgment(anchor, judgment);

    return {
      categories: validation.categories,
      errors: validation.errors,
      status:
        validation.errors.length === 0
          ? ("passed" as const)
          : ("failed" as const),
    };
  } catch (error) {
    return {
      categories: [],
      errors: [
        error instanceof Error
          ? `${error.name}:${error.message}`
          : "judge_error",
      ],
      status: "unrun" as const,
    };
  }
};

const judgeAnchorsInOrder = async (
  anchors: z.output<typeof judgeAnchorSchema>[],
  judge: ReturnType<typeof createSemanticJudge>,
  runId?: string,
  index = 0,
  observations: Awaited<ReturnType<typeof judgeOneAnchor>>[] = []
): Promise<Awaited<ReturnType<typeof judgeOneAnchor>>[]> => {
  const anchor = anchors[index];

  if (anchor === undefined) {
    return observations;
  }

  const observation = await judgeOneAnchor(anchor, judge, runId);
  const nextObservations = [...observations, observation];

  if (observation.status === "unrun") {
    return [
      ...nextObservations,
      ...anchors.slice(index + 1).map(() => ({
        categories: [],
        errors: ["not_run_after_prior_anchor_error"],
        status: "unrun" as const,
      })),
    ];
  }

  return await judgeAnchorsInOrder(
    anchors,
    judge,
    runId,
    index + 1,
    nextObservations
  );
};

const runJudgeCalibration = async (options: {
  anchorDirectory?: string;
  agentModel: string;
  judgeModel: string;
  runId?: string;
  judge: ReturnType<typeof createSemanticJudge>;
}): Promise<JudgeCalibrationReport> => {
  const pack = loadJudgeAnchors(options.anchorDirectory);
  const results: z.output<typeof calibrationResultSchema>["results"] = [];

  const observations = await judgeAnchorsInOrder(
    pack.anchors,
    options.judge,
    options.runId
  );

  for (const [index, observation] of observations.entries()) {
    const anchor = pack.anchors[index];

    if (anchor === undefined) {
      continue;
    }

    results.push({
      anchorId: anchor.anchorId,
      expectedCategories: [...anchor.expectedCategories].toSorted(),
      observedCategories: observation.categories,
      split: anchor.split,
      status: observation.status,
      validationErrors: observation.errors,
    });
  }

  const developmentPassed = results.filter(
    ({ split, status }) => split === "development" && status === "passed"
  ).length;

  const validationPassed = results.filter(
    ({ split, status }) => split === "validation" && status === "passed"
  ).length;

  const validationTotal = pack.anchors.filter(
    ({ split }) => split === "validation"
  ).length;

  const developmentTotal = pack.anchors.filter(
    ({ split }) => split === "development"
  ).length;

  const completedCount = results.filter(
    ({ status }) => status !== "unrun"
  ).length;

  const validationIncomplete = results.some(
    ({ split, status }) => split === "validation" && status === "unrun"
  );

  let calibrationStatus: z.output<typeof calibrationResultSchema>["status"] =
    "failed";

  if (validationIncomplete || completedCount < pack.anchors.length) {
    calibrationStatus = "incomplete";
  } else if (
    developmentPassed === developmentTotal &&
    validationPassed === validationTotal &&
    developmentTotal === 16 &&
    validationTotal === 16
  ) {
    calibrationStatus = "passed";
  }

  return {
    anchorPriorTuningExposure: pack.priorTuningExposure,
    anchorVersion: pack.anchorVersion,
    development: { passed: developmentPassed, total: developmentTotal },
    judgeModel: options.judgeModel,
    judgePromptVersion: semanticJudgePromptVersion,
    results,
    retiredValidationAnchorIds: pack.retiredValidationAnchorIds,
    rubricVersion: semanticRubricVersion,
    sameModelAsAgent: options.judgeModel === options.agentModel,
    status: calibrationStatus,
    validation: { passed: validationPassed, total: validationTotal },
  };
};

const playerHasRequiredSource = (
  player: WorkerTrialResult["players"][number],
  provider: string,
  sourceId: string
): boolean =>
  player.candidates.some(({ records }) =>
    records.some(
      (record) => record.provider === provider && record.sourceId === sourceId
    )
  );

const playerNamesInSourceResult = (
  value: JsonValue,
  sourceId: string
): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => playerNamesInSourceResult(item, sourceId));
  }

  const parsed = z.record(z.string(), z.json()).safeParse(value);

  if (!parsed.success) {
    return [];
  }

  const record = parsed.data;

  const sourceMatches = [
    "fmId",
    "identitySourceId",
    "sourceId",
    "sourcePlayerId",
    "sourceRecordId",
    "understatId",
  ].some((key) => record[key] === sourceId);

  const recordName = z.string().safeParse(record.name ?? record.player);

  return [
    ...(sourceMatches && recordName.success ? [recordName.data] : []),
    ...Object.values(record).flatMap((item) =>
      playerNamesInSourceResult(item, sourceId)
    ),
  ];
};

const playerNamesFromActionResults = (
  worker: WorkerTrialResult,
  sourceId: string
): string[] =>
  worker.actionEvents.flatMap(({ result }) => {
    if (result === null) {
      return [];
    }

    try {
      const parsed = z.json().safeParse(JSON.parse(result));

      return parsed.success
        ? playerNamesInSourceResult(parsed.data, sourceId)
        : [];
    } catch {
      return [];
    }
  });

const playerNamesForRequiredSource = (
  worker: WorkerTrialResult,
  provider: string,
  sourceId: string
): string[] =>
  [
    ...new Set([
      ...worker.turns.flatMap(({ players }) =>
        players.flatMap((player) =>
          playerHasRequiredSource(player, provider, sourceId)
            ? [player.selectedName ?? player.mention]
            : []
        )
      ),
      ...playerNamesFromActionResults(worker, sourceId),
    ]),
  ].toSorted();

const requiredFactDescription = (
  fact: EvaluationCase["contract"]["requiredEvidence"][number],
  worker: WorkerTrialResult
): string => {
  const playerNames = playerNamesForRequiredSource(
    worker,
    fact.provider,
    fact.sourceId
  );

  const playerLabel =
    playerNames.length === 0 ? "" : ` (${playerNames.join(", ")})`;

  let displayField = fact.field;

  if (fact.field === "currentAbility") {
    displayField = "当前能力 / CA";
  } else if (fact.field === "expectedGoals") {
    displayField = "预期进球 / xG";
  } else if (fact.field === "potentialAbility") {
    displayField = "潜力能力 / PA";
  }

  return `${fact.provider}:${fact.sourceId}${playerLabel} ${displayField} [${fact.field}] = ${JSON.stringify(fact.value)}`;
};

const requiredFactFieldAliases = {
  age: ["age", "年龄"],
  appearances: ["appearance", "appearances", "出场", "出场次数"],
  assists: ["assist", "assists", "助攻"],
  currentAbility: ["current ability", "ca", "当前能力"],
  currentDistance: ["current distance", "currentDistance", "当前差距"],
  expectedAssists: ["expected assists", "xa", "预期助攻"],
  expectedGoals: ["expected goals", "xg", "预期进球"],
  goals: ["goal", "goals", "进球"],
  minutes: ["minutes", "minute", "min", "分钟", "上场时间"],
  positionRating: ["position rating", "positionRating", "位置评分"],
  potentialAbility: ["potential ability", "pa", "潜力能力"],
  shots: ["shot", "shots", "射门"],
} satisfies Record<string, string[]>;

const normalizeEvidenceLabel = (value: string): string =>
  value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036F]/gu, "")
    .toLocaleLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const visibleAssistantMessage = (message: string): string => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(message);
  } catch {
    return message;
  }

  const blocks = z
    .array(
      z.looseObject({
        text: z.string().optional(),
        type: z.string().optional(),
      })
    )
    .safeParse(parsed);

  if (!blocks.success) {
    return message;
  }

  const textBlocks = blocks.data.flatMap(({ text, type }) =>
    type === "text" && text !== undefined ? [text] : []
  );

  return textBlocks.length > 0 ? textBlocks.join("\n") : message;
};

const markdownCells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim().replaceAll("\\|", "|"));

const isMarkdownTableDivider = (line: string): boolean =>
  line.includes("|") &&
  markdownCells(line).every((cell) => /^:?-{3,}:?$/u.test(cell));

const isPlayerSectionHeading = (line: string): boolean =>
  /^\s*(?:#{1,6}\s|\*\*[^*]+\*\*\s*$)/u.test(line);

const numericValuesMatchAtDisplayedPrecision = (
  displayed: string,
  expected: EvaluationCase["contract"]["requiredEvidence"][number]["value"]
): boolean => {
  const parsedExpected = z.number().safeParse(expected);
  const normalized = displayed.replaceAll(",", "").trim();
  const actualNumber = Number(normalized);

  if (!Number.isFinite(actualNumber) || !parsedExpected.success) {
    return false;
  }

  const decimalPlaces = normalized.includes(".")
    ? (normalized.split(".")[1]?.length ?? 0)
    : 0;

  const multiplier = 10 ** decimalPlaces;

  return (
    Math.round(actualNumber * multiplier) ===
    Math.round(parsedExpected.data * multiplier)
  );
};

const escapedRegularExpression = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const inlineNumericFactMatches = (
  line: string,
  aliases: string[],
  expectedValue: EvaluationCase["contract"]["requiredEvidence"][number]["value"]
): boolean => {
  const aliasPattern = aliases
    .map((alias) =>
      alias.trim().split(/\s+/u).map(escapedRegularExpression).join("\\s+")
    )
    .join("|");

  const numberPattern = "(-?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)";

  const numericBeforeAlias = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])(?:${aliasPattern})[^\\p{L}\\p{N}]+${numberPattern}(?=$|[^\\p{L}\\p{N}])`,
    "iu"
  );

  const numericAfterAlias = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${numberPattern}[^\\p{L}\\p{N}]+(?:${aliasPattern})(?=$|[^\\p{L}\\p{N}])`,
    "iu"
  );

  return [numericBeforeAlias, numericAfterAlias].some((pattern) => {
    const displayedValue = pattern.exec(line)?.[1];

    return (
      displayedValue !== undefined &&
      numericValuesMatchAtDisplayedPrecision(displayedValue, expectedValue)
    );
  });
};

const evidenceFieldNames = {
  age: ["age"],
  appearances: ["appearances", "games"],
  assists: ["assists"],
  currentAbility: ["currentAbility", "ability_current"],
  currentDistance: ["currentDistance"],
  expectedAssists: ["expectedAssists", "xA"],
  expectedGoals: ["expectedGoals", "xG"],
  goals: ["goals"],
  minutes: ["minutes", "time"],
  name: ["name", "player"],
  positionRating: ["positionRating"],
  potentialAbility: ["potentialAbility", "ability_potential"],
  shots: ["shots"],
} satisfies Record<string, string[]>;

const isEvidenceFieldName = (
  field: string
): field is keyof typeof evidenceFieldNames =>
  Object.hasOwn(evidenceFieldNames, field);

const sourceValueMatchesExpected = (
  actual: JsonValue | undefined,
  expected: EvaluationCase["contract"]["requiredEvidence"][number]["value"]
): boolean => {
  if (actual === undefined) {
    return false;
  }

  const expectedNumber = z.number().safeParse(expected);

  if (expectedNumber.success) {
    const actualNumber = z.union([z.number(), z.string()]).safeParse(actual);

    return (
      actualNumber.success && Number(actualNumber.data) === expectedNumber.data
    );
  }

  return actual === expected;
};

const sourceResultContainsRequiredValue = (
  value: JsonValue,
  fact: EvaluationCase["contract"]["requiredEvidence"][number]
): boolean => {
  if (Array.isArray(value)) {
    return value.some((item) => sourceResultContainsRequiredValue(item, fact));
  }

  const parsed = z.record(z.string(), z.json()).safeParse(value);

  if (!parsed.success) {
    return false;
  }

  const record = parsed.data;

  const directFactMatches =
    record.field === fact.field &&
    record.sourceId === fact.sourceId &&
    sourceValueMatchesExpected(record.value, fact.value);

  const fieldNames = isEvidenceFieldName(fact.field)
    ? evidenceFieldNames[fact.field]
    : [fact.field];

  const namedFieldMatches = fieldNames.some((fieldName) =>
    sourceValueMatchesExpected(record[fieldName], fact.value)
  );

  return (
    directFactMatches ||
    namedFieldMatches ||
    Object.values(record).some((item) =>
      sourceResultContainsRequiredValue(item, fact)
    )
  );
};

const requiredFactValueWasDelivered = (
  fact: EvaluationCase["contract"]["requiredEvidence"][number],
  worker: WorkerTrialResult
): boolean =>
  worker.deliveredEvidence.some((evidence) => {
    if (
      evidence.provider !== fact.provider ||
      evidence.sourceId !== fact.sourceId
    ) {
      return false;
    }

    try {
      const content = z.json().safeParse(JSON.parse(evidence.content));

      return (
        content.success && sourceResultContainsRequiredValue(content.data, fact)
      );
    } catch {
      return false;
    }
  });

const proseExplicitlyCoversRequiredFact = (
  answer: string,
  playerNames: string[],
  allPlayerNames: string[],
  fact: EvaluationCase["contract"]["requiredEvidence"][number]
): boolean => {
  const aliases = Object.entries(requiredFactFieldAliases).find(
    ([field]) => field === fact.field
  )?.[1];

  const normalizedNames = playerNames.map(normalizeEvidenceLabel);
  const normalizedAllPlayerNames = allPlayerNames.map(normalizeEvidenceLabel);
  let headingNamesPlayer = false;

  return answer.split(/\r?\n/u).some((line) => {
    if (isPlayerSectionHeading(line)) {
      const heading = normalizeEvidenceLabel(line);

      const namesPlayer = normalizedAllPlayerNames.some(
        (name) => name.length > 0 && heading.includes(name)
      );

      if (namesPlayer) {
        headingNamesPlayer = normalizedNames.some(
          (name) => name.length > 0 && heading.includes(name)
        );
      }

      return false;
    }

    const normalizedLine = normalizeEvidenceLabel(line);

    const lineNamesPlayer = normalizedNames.some(
      (name) => name.length > 0 && normalizedLine.includes(name)
    );

    if (!headingNamesPlayer && !lineNamesPlayer) {
      return false;
    }

    if (fact.field === "name") {
      const expectedName = z.string().safeParse(fact.value);

      return (
        expectedName.success &&
        normalizedLine.includes(normalizeEvidenceLabel(expectedName.data))
      );
    }

    return (
      aliases !== undefined &&
      inlineNumericFactMatches(line, aliases, fact.value)
    );
  });
};

const tableExplicitlyCoversRequiredFact = (
  answer: string,
  playerNames: string[],
  allPlayerNames: string[],
  fact: EvaluationCase["contract"]["requiredEvidence"][number]
): boolean => {
  const aliases = Object.entries(requiredFactFieldAliases).find(
    ([field]) => field === fact.field
  )?.[1];

  if (aliases === undefined || playerNames.length === 0) {
    return false;
  }

  const normalizedNames = playerNames.map(normalizeEvidenceLabel);
  const normalizedAllPlayerNames = allPlayerNames.map(normalizeEvidenceLabel);
  const normalizedAliases = aliases.map(normalizeEvidenceLabel);

  let headingNamesPlayer = false;
  let tableHeaders: string[] = [];

  return answer.split(/\r?\n/u).some((line) => {
    if (isPlayerSectionHeading(line)) {
      const normalizedHeading = normalizeEvidenceLabel(line);
      headingNamesPlayer = normalizedNames.some(
        (name) => name.length > 0 && normalizedHeading.includes(name)
      );
      tableHeaders = [];

      return false;
    }

    if (!line.includes("|") || isMarkdownTableDivider(line)) {
      if (line.trim().length === 0 || !line.includes("|")) {
        tableHeaders = [];
      }

      return false;
    }

    const cells = markdownCells(line);

    const rowNamesAnyPlayer = normalizedNames.some((name) =>
      cells.some((cell) => normalizeEvidenceLabel(cell).includes(name))
    );

    const rowNamesAnyParticipant = normalizedAllPlayerNames.some((name) =>
      cells.some((cell) => normalizeEvidenceLabel(cell).includes(name))
    );

    const rowNamesPlayer = rowNamesAnyPlayer;

    const rowLabelsFactValue = cells.some((cell, index) => {
      const normalizedLabel = normalizeEvidenceLabel(cell);

      const labelMatches = normalizedAliases.some(
        (alias) => normalizedLabel === alias || normalizedLabel.includes(alias)
      );

      const displayedValue = cells[index + 1];

      return (
        labelMatches &&
        displayedValue !== undefined &&
        numericValuesMatchAtDisplayedPrecision(displayedValue, fact.value)
      );
    });

    if ((headingNamesPlayer || rowNamesPlayer) && rowLabelsFactValue) {
      return true;
    }

    const rowHasFactHeader = normalizedAliases.some((alias) =>
      cells.some((cell) => {
        const normalizedCell = normalizeEvidenceLabel(cell);

        return normalizedCell === alias || normalizedCell.includes(alias);
      })
    );

    if (!rowNamesAnyPlayer && rowHasFactHeader) {
      tableHeaders = cells;

      return false;
    }

    const namesPlayer = headingNamesPlayer || rowNamesPlayer;

    if (!namesPlayer) {
      if (!rowNamesAnyParticipant) {
        tableHeaders = cells;
      }

      return false;
    }

    const valueInLabeledColumn = tableHeaders.some((header, index) => {
      const normalizedHeader = normalizeEvidenceLabel(header);

      const labelMatches = normalizedAliases.some(
        (alias) =>
          normalizedHeader === alias || normalizedHeader.includes(alias)
      );

      const displayedValue = cells[index];

      return (
        labelMatches &&
        displayedValue !== undefined &&
        numericValuesMatchAtDisplayedPrecision(displayedValue, fact.value)
      );
    });

    const valueInLabeledRow = cells.some((cell, index) => {
      const normalizedLabel = normalizeEvidenceLabel(cell);

      const labelMatches = normalizedAliases.some(
        (alias) => normalizedLabel === alias || normalizedLabel.includes(alias)
      );

      const displayedValue = cells[index + 1];

      return (
        labelMatches &&
        displayedValue !== undefined &&
        numericValuesMatchAtDisplayedPrecision(displayedValue, fact.value)
      );
    });

    return valueInLabeledColumn || valueInLabeledRow;
  });
};

const isGenericSavedResultRetentionClaim = (quote: string): boolean => {
  const normalized = normalizeEvidenceLabel(quote);

  return (
    normalized === normalizeEvidenceLabel("此前已完成的结果仍保留") ||
    normalized ===
      normalizeEvidenceLabel(
        "The previously completed result remains available."
      ) ||
    normalized === normalizeEvidenceLabel("The saved result remains available.")
  );
};

const genericRetentionClaimSupportedByState = (
  finding: z.output<typeof semanticJudgeFindingSchema>,
  worker: WorkerTrialResult
): boolean => {
  if (!isGenericSavedResultRetentionClaim(finding.quote)) {
    return false;
  }

  const turn = worker.turns.find(({ turnId }) => turnId === finding.turnId);

  return (
    turn?.availableResultKinds !== null &&
    turn?.availableResultKinds !== undefined &&
    turn.availableResultKinds.length > 0
  );
};

const searchPlayerRecordsActionInputSchema = z.strictObject({
  seasonStartYear: z.number().int().min(2000).max(2100).optional(),
  sourceRecords: z
    .array(
      z.object({
        provider: z.enum(["fm", "understat"]),
        sourceId: z.string().min(1),
      })
    )
    .min(1),
});

const noCompetitionFilterClaimPhrases = new Set(
  [
    "查询未设置赛事过滤条件",
    "查询没有设置赛事过滤条件",
    "本次查询未设置赛事过滤条件",
    "本次查询没有设置赛事过滤条件",
    "本次查询没有传入赛事过滤条件",
    "本次查询没有赛事过滤条件",
    "No competition filter was applied",
    "No competition filter was set",
    "The query did not include a competition filter",
  ].map(normalizeEvidenceLabel)
);

const isNoCompetitionFilterClaim = (quote: string): boolean =>
  noCompetitionFilterClaimPhrases.has(normalizeEvidenceLabel(quote));

const noCompetitionFilterClaimSupportedByActions = (
  finding: z.output<typeof semanticJudgeFindingSchema>,
  input: z.output<typeof judgeInputSchema>
): boolean =>
  finding.category === "unsupported_fact" &&
  isNoCompetitionFilterClaim(finding.quote) &&
  input.actions.some(
    (action) =>
      action.name === "search_player_records" &&
      action.turnId === finding.turnId &&
      ["attempted", "returned", "failed", "cache_hit"].includes(action.kind) &&
      searchPlayerRecordsActionInputSchema.safeParse(action.input).success
  );

const recommendationFilterCountsSchema = z.looseObject({
  excludedMissingAttribute: z.number().int().nonnegative(),
});

const recommendationResultFilterCountsSchema = z.looseObject({
  filterCounts: recommendationFilterCountsSchema,
});

const teamRecommendationResultFilterCountsSchema = z.looseObject({
  recommendation: z.looseObject({
    filterCounts: recommendationFilterCountsSchema,
  }),
});

const excludedMissingAttributeCountFromResult = (
  resultJson: string
): number | null => {
  let result: unknown;

  try {
    result = JSON.parse(resultJson);
  } catch {
    return null;
  }

  const recommendation =
    recommendationResultFilterCountsSchema.safeParse(result);

  if (recommendation.success) {
    return recommendation.data.filterCounts.excludedMissingAttribute;
  }

  const teamRecommendation =
    teamRecommendationResultFilterCountsSchema.safeParse(result);

  return teamRecommendation.success
    ? teamRecommendation.data.recommendation.filterCounts
        .excludedMissingAttribute
    : null;
};

const claimsDistanceIncompleteCandidates = (quote: string): boolean => {
  const normalized = normalizeEvidenceLabel(quote);

  return (
    normalized.includes(normalizeEvidenceLabel("因距离属性不完整而无法排名")) ||
    normalized.includes(
      normalizeEvidenceLabel(
        "excluded from ranking because distance attributes are incomplete"
      )
    )
  );
};

const missingDistanceClaimSupportedByActions = (
  finding: z.output<typeof semanticJudgeFindingSchema>,
  input: z.output<typeof judgeInputSchema>
): boolean => {
  if (
    finding.category !== "unsupported_fact" ||
    !claimsDistanceIncompleteCandidates(finding.quote)
  ) {
    return false;
  }

  const quotedCount = Number(/\d+/u.exec(finding.quote)?.[0]);

  return (
    Number.isFinite(quotedCount) &&
    input.actions.some((action) => {
      if (
        action.turnId !== finding.turnId ||
        action.kind !== "returned" ||
        ![
          "recommend_player_candidates",
          "recommend_team_player_candidates",
        ].includes(action.name) ||
        action.result === null
      ) {
        return false;
      }

      return (
        excludedMissingAttributeCountFromResult(action.result) === quotedCount
      );
    })
  );
};

const teamRosterActionInputSchema = z.looseObject({
  roster: z.looseObject({
    members: z.array(
      z.looseObject({
        fmId: z.string().nullable(),
        mappingStatus: z.enum(["pending", "resolved", "no_profile"]),
      })
    ),
  }),
});

const teamRecommendationActionResultSchema = z.looseObject({
  recommendation: z.looseObject({
    currentCandidates: z.array(z.looseObject({ fmId: z.string() })),
    potentialCandidates: z
      .array(z.looseObject({ fmId: z.string() }))
      .nullable(),
  }),
});

const teamRecommendationActionResultFrom = (resultJson: string) => {
  try {
    return teamRecommendationActionResultSchema.safeParse(
      JSON.parse(resultJson)
    );
  } catch {
    return null;
  }
};

const teamRosterExclusionClaimPhrases = [
  "当前阵容中所有已映射的 FM 球员均已排除",
  "所有已映射的队内球员均已排除",
  "all mapped current squad FM players were excluded",
  "all mapped roster players were excluded from candidates",
].map(normalizeEvidenceLabel);

const isTeamRosterExclusionClaim = (quote: string): boolean => {
  const normalized = normalizeEvidenceLabel(quote);

  return teamRosterExclusionClaimPhrases.some((phrase) =>
    normalized.includes(phrase)
  );
};

const teamRosterExclusionClaimSupportedByActions = (
  finding: z.output<typeof semanticJudgeFindingSchema>,
  input: z.output<typeof judgeInputSchema>
): boolean =>
  ["factual_contradiction", "unsupported_fact"].includes(finding.category) &&
  isTeamRosterExclusionClaim(finding.quote) &&
  input.actions.some((action) => {
    if (
      action.name !== "recommend_team_player_candidates" ||
      action.turnId !== finding.turnId
    ) {
      return false;
    }

    if (action.kind !== "returned" || action.outcome !== "ready") {
      return false;
    }

    if (action.input === null || action.result === null) {
      return false;
    }

    const actionInput = teamRosterActionInputSchema.safeParse(action.input);

    const actionResult = teamRecommendationActionResultFrom(action.result);

    if (!actionInput.success || actionResult?.success !== true) {
      return false;
    }

    const rosterFmIds = actionInput.data.roster.members.flatMap(
      ({ fmId, mappingStatus }) =>
        mappingStatus === "resolved" && fmId !== null ? [fmId] : []
    );

    const candidateFmIds = new Set([
      ...actionResult.data.recommendation.currentCandidates.map(
        ({ fmId }) => fmId
      ),
      ...(actionResult.data.recommendation.potentialCandidates ?? []).map(
        ({ fmId }) => fmId
      ),
    ]);

    return (
      rosterFmIds.length > 0 &&
      rosterFmIds.every((fmId) => !candidateFmIds.has(fmId))
    );
  });

const requiredFactCoveredByVisibleAnswer = (
  fact: EvaluationCase["contract"]["requiredEvidence"][number],
  worker: WorkerTrialResult
): boolean => {
  if (!requiredFactValueWasDelivered(fact, worker)) {
    return false;
  }

  const playerNames = playerNamesForRequiredSource(
    worker,
    fact.provider,
    fact.sourceId
  );

  const allPlayerNames = [
    ...new Set(
      worker.players.map((player) => player.selectedName ?? player.mention)
    ),
    ...playerNames,
  ];

  return worker.turns.some(({ assistantMessages }) =>
    assistantMessages.some((answer) => {
      const visibleAnswer = visibleAssistantMessage(answer);

      return (
        tableExplicitlyCoversRequiredFact(
          visibleAnswer,
          playerNames,
          allPlayerNames,
          fact
        ) ||
        proseExplicitlyCoversRequiredFact(
          visibleAnswer,
          playerNames,
          allPlayerNames,
          fact
        )
      );
    })
  );
};

const judgeInputForTrial = (
  caseDefinition: EvaluationCase,
  worker: WorkerTrialResult
): z.output<typeof judgeInputSchema> => {
  const requiredFacts = caseDefinition.contract.requiredEvidence.map(
    (fact, index) => ({
      description: requiredFactDescription(fact, worker),
      factId: `required-fact-${index + 1}`,
    })
  );

  return {
    actions: [
      ...worker.identityLookupEvents.map((event) =>
        judgeAction({
          actionId: event.actionId ?? event.eventId,
          eventId: event.eventId,
          input: { lookupName: event.lookupName },
          kind: event.kind,
          name: "resolve_player_identity",
          outcome: event.outcome,
          result: JSON.stringify({
            candidateCount: event.candidates.length,
            lookupName: event.lookupName,
            outcome: event.outcome,
            selectedCandidateId: event.selectedCandidateId,
          }),
          sourceRecords: event.candidates.flatMap(({ records }) =>
            records.map(judgeSourceRecord)
          ),
          turnId: event.turnId,
        })
      ),
      ...worker.actionEvents.map((event) =>
        judgeAction({
          actionId: event.actionId,
          eventId: event.eventId,
          input: event.input,
          kind: event.kind,
          name: event.name,
          outcome: event.outcome,
          result: event.result,
          sourceRecords: event.sourceRecords.map(judgeSourceRecord),
          turnId: event.turnId,
        })
      ),
    ],
    caseId: caseDefinition.caseId,
    contract: {
      expectedOutcomeStatus: caseDefinition.contract.outcomeStatus,
      prohibitedClaims: caseDefinition.contract.prohibitedClaims,
      requiredAbstentions: caseDefinition.contract.requiredAbstentions,
      requiredFacts,
      taskKind: caseDefinition.contract.taskKind,
    },
    evidence: worker.deliveredEvidence.map((evidence) => ({
      content: evidence.content,
      evidenceId: judgeIdentifier("evidence", evidence.evidenceId),
      provider: evidence.provider,
      sourceId: evidence.sourceId,
      turnId: evidence.turnId,
    })),
    teamRosterCoverage: worker.teamRosterCoverage,
    turns: worker.turns.map((turn) => ({
      assistantMessages: turn.assistantMessages.map(visibleAssistantMessage),
      availableResultKinds: turn.availableResultKinds,
      clarificationAnswers: turn.clarificationAnswers,
      nodeFailure: turn.nodeFailure ?? null,
      outcomeKind: turn.outcomeKind,
      outcomeStatus: turn.outcomeStatus,
      participants: turn.players.map((player) => {
        const selectedCandidate = player.candidates.find(
          ({ candidateId }) => candidateId === player.selectedCandidateId
        );

        return {
          canonicalIdentityId: selectedCandidate?.canonicalIdentityId ?? null,
          mention: player.mention,
          resolutionStatus: player.resolutionStatus,
          resolvedName: player.selectedName,
          selectedCandidateId: player.selectedCandidateId,
          sourceRecords:
            selectedCandidate?.records.map(judgeSourceRecord) ?? [],
        };
      }),
      turnId: turn.turnId,
      userMessage: turn.userMessage,
    })),
  };
};

const validateTrialJudgment = (
  caseDefinition: EvaluationCase,
  worker: WorkerTrialResult,
  output: z.output<typeof semanticJudgeOutputSchema>
): TrialJudgment => {
  const input = judgeInputForTrial(caseDefinition, worker);

  const findings = output.findings.filter(
    (finding) =>
      !genericRetentionClaimSupportedByState(finding, worker) &&
      !noCompetitionFilterClaimSupportedByActions(finding, input) &&
      !missingDistanceClaimSupportedByActions(finding, input) &&
      !teamRosterExclusionClaimSupportedByActions(finding, input)
  );

  const requiredFactCoverage = output.requiredFactCoverage.map((coverage) => {
    const factIndex = Number(coverage.factId.replace("required-fact-", "")) - 1;
    const fact = caseDefinition.contract.requiredEvidence[factIndex];

    if (
      fact !== undefined &&
      coverage.status !== "covered" &&
      requiredFactCoveredByVisibleAnswer(fact, worker)
    ) {
      return { ...coverage, status: "covered" as const };
    }

    return coverage;
  });

  const validationErrors = findings.flatMap((finding) =>
    validFindingReferences(finding, input)
  );

  const hasUnsubstantiatedContradictionExplanation = findings.some(
    ({ category, explanation }) =>
      category === "factual_contradiction" &&
      contradictionExplanationIsInconclusive(explanation)
  );

  if (hasUnsubstantiatedContradictionExplanation) {
    validationErrors.push("contradiction_explanation_is_inconclusive");
  }

  const expectedFactIds = new Set(
    input.contract.requiredFacts.map(({ factId }) => factId)
  );

  const coverageIds = requiredFactCoverage.map(({ factId }) => factId);

  if (
    coverageIds.length !== expectedFactIds.size ||
    coverageIds.some((factId) => !expectedFactIds.has(factId))
  ) {
    validationErrors.push("required_fact_coverage_mismatch");
  }

  const deliveredSourceRecords = new Set(
    worker.deliveredEvidence.flatMap(({ provider, sourceId }) =>
      sourceId === null ? [] : [`${provider}:${sourceId}`]
    )
  );

  const allRequiredSourceEvidenceDelivered =
    caseDefinition.contract.requiredEvidence.every(({ provider, sourceId }) =>
      deliveredSourceRecords.has(`${provider}:${sourceId}`)
    );

  const hasMissingRequiredEvidence =
    caseDefinition.contract.requiredEvidence.length > 0 &&
    !allRequiredSourceEvidenceDelivered;

  const observedTurnIds = new Set(worker.turns.map(({ turnId }) => turnId));

  const conversationIncomplete =
    worker.error !== undefined ||
    worker.driverIssue !== null ||
    worker.failureCategory !== null ||
    caseDefinition.turns.some(({ turnId }) => !observedTurnIds.has(turnId));

  if (validationErrors.length > 0) {
    return {
      findings,
      requiredFactCoverage,
      status: "invalid",
      validationErrors,
    };
  }

  if (findings.length > 0) {
    return {
      findings,
      requiredFactCoverage,
      status: "failed",
      validationErrors: [],
    };
  }

  if (hasMissingRequiredEvidence) {
    return {
      findings,
      requiredFactCoverage,
      status: "inconclusive",
      validationErrors: ["required_evidence_not_delivered"],
    };
  }

  if (requiredFactCoverage.some(({ status }) => status === "missing")) {
    return {
      findings,
      requiredFactCoverage,
      status: "failed",
      validationErrors: [],
    };
  }

  if (requiredFactCoverage.some(({ status }) => status === "uncertain")) {
    return {
      findings,
      requiredFactCoverage,
      status: "inconclusive",
      validationErrors: [],
    };
  }

  if (conversationIncomplete) {
    return {
      findings,
      requiredFactCoverage,
      status: "inconclusive",
      validationErrors: ["conversation_incomplete"],
    };
  }

  return {
    findings,
    requiredFactCoverage,
    status: "passed",
    validationErrors: [],
  };
};

export {
  calibrationResultSchema,
  createSemanticJudge,
  judgeAnchorPackSchema,
  judgeInputForTrial,
  loadJudgeAnchors,
  runJudgeCalibration,
  semanticJudgeFindingSchema,
  semanticJudgeOutputSchema,
  semanticJudgePromptVersion,
  semanticRubricVersion,
  validateAnchorJudgment,
  validateTrialJudgment,
};

export type { SemanticErrorCategory } from "./contracts.js";
