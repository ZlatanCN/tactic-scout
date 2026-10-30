import { readFileSync } from "node:fs";
import path from "node:path";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod/v4";

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
  WorkerTrialResult,
} from "./contracts.js";

const semanticJudgeFindingSchema = semanticFindingSchema;

type SemanticErrorCategory = z.output<typeof semanticErrorCategorySchema>;

const semanticJudgePromptVersion = "scouting-semantic-judge-v13";
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
  availableResultKinds: z.array(availableResultKindSchema).default([]),
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
      availableResultKinds: z.array(availableResultKindSchema),
      participants: z.array(
        z.object({
          mention: z.string(),
          resolvedName: z.string().nullable(),
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
});

const judgeSystemPrompt = `You are an automated reviewer for a football scouting assistant. Review every assistant response in the supplied conversation.

Use only evidence delivered to the assistant for that turn, evidence explicitly reused in that turn, the listed action events and their exact inputs, per-turn availableResultKinds state observations, and the supplied task contract. Action inputs on attempted, returned, failed, and cache_hit events show parameters used. Requested events record proposed tool arguments and do not prove the tool ran; blocked and schema_rejected events do not show applied filters. For an attempted, returned, failed, or cache_hit search_player_records action, no competition field means no competition filter was supplied. Per-turn state observations are evaluator evidence about which completed result kinds remained available after that turn. They describe stored results, not the outcome of the latest operation: the current action may return no_comparable_data or data_unavailable while availableResultKinds still contains player_comparison because a prior comparison remains active. If the assistant says that prior result remains and this state lists player_comparison, the claim is supported; do not call it a contradiction or unsupported merely because the current operation found no data or failed. Do not infer current state from a prior tool action alone. Do not use outside football knowledge. A fact that happens to be true in the real world is still unsupported when the supplied evidence does not support it.

Each turn includes the exact participants known for that turn and their selected provider source records. Use these links to connect a participant to the source records in that turn's actions. The competition/season on a participant's identity record describes that identity evidence; it does not automatically describe the requested lookup result. Judge claims such as “all participants” against only that turn's participant list and evidence. Later turns may add participants or change scope; never use those later changes to invalidate a correct earlier answer. Do not infer a turn's participants from the final conversation state.

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

For each required fact, mark whether it is covered in the visible assistant responses. If the answer cannot be assessed from the supplied evidence, use uncertain. Return the required structured output only.`;

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

  return async (input: z.output<typeof judgeInputSchema>) =>
    await structuredModel.invoke([
      new SystemMessage(judgeSystemPrompt),
      new HumanMessage(JSON.stringify(input)),
    ]);
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
      availableResultKinds: anchor.availableResultKinds,
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

  if (turn === undefined) {
    return [`unknown_turn:${finding.turnId}`];
  }

  if (
    !turn.assistantMessages.some((message) => message.includes(finding.quote))
  ) {
    errors.push(`quote_not_found:${finding.turnId}`);
  }

  const evidenceIds = new Set<string>();

  for (const evidence of input.evidence) {
    if (evidence.turnId === finding.turnId) {
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
    if (action.turnId === finding.turnId) {
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
  judge: ReturnType<typeof createSemanticJudge>
) => {
  try {
    const judgment = await judge(judgeInputForAnchor(anchor));
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
  index = 0,
  observations: Awaited<ReturnType<typeof judgeOneAnchor>>[] = []
): Promise<Awaited<ReturnType<typeof judgeOneAnchor>>[]> => {
  const anchor = anchors[index];

  if (anchor === undefined) {
    return observations;
  }

  const observation = await judgeOneAnchor(anchor, judge);
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

  return await judgeAnchorsInOrder(anchors, judge, index + 1, nextObservations);
};

const runJudgeCalibration = async (options: {
  anchorDirectory?: string;
  agentModel: string;
  judgeModel: string;
  judge: ReturnType<typeof createSemanticJudge>;
}): Promise<JudgeCalibrationReport> => {
  const pack = loadJudgeAnchors(options.anchorDirectory);
  const results: z.output<typeof calibrationResultSchema>["results"] = [];

  const observations = await judgeAnchorsInOrder(pack.anchors, options.judge);

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
  } else if (validationPassed === validationTotal && validationTotal === 16) {
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

const judgeInputForTrial = (
  caseDefinition: EvaluationCase,
  worker: WorkerTrialResult
): z.output<typeof judgeInputSchema> => {
  const requiredFacts = caseDefinition.contract.requiredEvidence.map(
    (fact, index) => ({
      description: `${fact.provider}:${fact.sourceId} ${fact.field} = ${JSON.stringify(fact.value)}`,
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
      assistantMessages: turn.assistantMessages,
      availableResultKinds: turn.availableResultKinds,
      participants: turn.players.map((player) => {
        const selectedCandidate = player.candidates.find(
          ({ candidateId }) => candidateId === player.selectedCandidateId
        );

        return {
          mention: player.mention,
          resolvedName: player.selectedName,
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

  const validationErrors = output.findings.flatMap((finding) =>
    validFindingReferences(finding, input)
  );

  const expectedFactIds = new Set(
    input.contract.requiredFacts.map(({ factId }) => factId)
  );

  const coverageIds = output.requiredFactCoverage.map(({ factId }) => factId);

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
      findings: output.findings,
      requiredFactCoverage: output.requiredFactCoverage,
      status: "invalid",
      validationErrors,
    };
  }

  if (output.findings.length > 0) {
    return {
      findings: output.findings,
      requiredFactCoverage: output.requiredFactCoverage,
      status: "failed",
      validationErrors: [],
    };
  }

  if (hasMissingRequiredEvidence) {
    return {
      findings: output.findings,
      requiredFactCoverage: output.requiredFactCoverage,
      status: "inconclusive",
      validationErrors: ["required_evidence_not_delivered"],
    };
  }

  if (output.requiredFactCoverage.some(({ status }) => status === "missing")) {
    return {
      findings: output.findings,
      requiredFactCoverage: output.requiredFactCoverage,
      status: "failed",
      validationErrors: [],
    };
  }

  if (
    output.requiredFactCoverage.some(({ status }) => status === "uncertain")
  ) {
    return {
      findings: output.findings,
      requiredFactCoverage: output.requiredFactCoverage,
      status: "inconclusive",
      validationErrors: [],
    };
  }

  if (conversationIncomplete) {
    return {
      findings: output.findings,
      requiredFactCoverage: output.requiredFactCoverage,
      status: "inconclusive",
      validationErrors: ["conversation_incomplete"],
    };
  }

  return {
    findings: output.findings,
    requiredFactCoverage: output.requiredFactCoverage,
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
