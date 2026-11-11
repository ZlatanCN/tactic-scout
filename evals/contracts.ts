import { z } from "zod/v4";

import { TeamRosterCoverageSchema } from "../src/team-data/contracts.js";
import type { TeamRosterCoverage } from "../src/team-data/contracts.js";

const jsonValueSchema = z.json();

type JsonValue = z.output<typeof jsonValueSchema>;

const teamRosterCoverageSchema = z.custom<TeamRosterCoverage>(
  (value) => TeamRosterCoverageSchema.safeParse(value).success
);

const sourceProviderSchema = z.enum(["api_football", "fm", "understat"]);

const sourceRecordSchema = z.object({
  competition: z.string().nullable().optional(),
  provider: sourceProviderSchema,
  season: z.string().nullable().optional(),
  sourceId: z.string(),
});

const playerExpectationSchema = z
  .object({
    candidateId: z.string(),
    canonicalIdentityId: z.string().nullable(),
    mention: z.string(),
    sourceRecords: z.array(sourceRecordSchema),
  })
  .superRefine(({ candidateId, canonicalIdentityId }, context) => {
    if (
      canonicalIdentityId !== null &&
      candidateId !== `reep:${canonicalIdentityId}`
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A resolved player candidate ID must match its canonical Reep ID.",
        path: ["candidateId"],
      });
    }
  });

const toolActionExpectationSchema = z.object({
  businessOutcome: z.string(),
  name: z.string(),
  sourceRecords: z.array(sourceRecordSchema),
});

const actionValueExpectationSchema = z.object({
  name: z.string(),
  path: z.string().min(1),
  source: z.enum(["input", "result"]),
  turnId: z.string(),
  value: jsonValueSchema,
});

const evidenceExpectationSchema = z.object({
  competition: z.string().optional(),
  field: z.string(),
  provider: sourceProviderSchema,
  season: z.string().optional(),
  sourceId: z.string(),
  value: z.json(),
});

const declaredEvaluationDataFaultSchema = z.enum([
  "fm_snapshot_missing",
  "reep_bridge_malformed",
  "understat_snapshot_missing",
]);

const declaredTurnDataFaultSchema = z.object({
  missingSources: z.array(
    z.enum(["fm_snapshot_missing", "understat_snapshot_missing"])
  ),
  turnId: z.string(),
});

const evaluationCaseSchema = z.object({
  ageAsOfDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u)
    .default("2026-11-04"),
  caseId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u),
  category: z.enum(["boundary", "multi_turn", "ordinary"]),
  contract: z.object({
    expectedActionValues: z.array(actionValueExpectationSchema).default([]),
    expectedActiveLookupSourceRecords: z.array(sourceRecordSchema).default([]),
    expectedActiveResultValues: z
      .array(
        z.object({
          kind: z.enum([
            "lookup",
            "player_comparison",
            "player_recommendation",
            "team_recommendation",
          ]),
          path: z.string().min(1),
          value: jsonValueSchema,
        })
      )
      .default([]),
    expectedIdentityLookups: z
      .array(
        z.object({
          lookupName: z.string(),
          status: z.string(),
          turnId: z.string(),
        })
      )
      .default([]),
    expectedIdentityStatuses: z
      .array(z.object({ mention: z.string(), status: z.string() }))
      .default([]),
    expectedTeamRosterCoverage: teamRosterCoverageSchema
      .nullable()
      .default(null),
    expectedTurnConstraints: z
      .array(
        z.object({
          constraints: z.array(
            z.object({ name: z.string(), value: z.string() })
          ),
          turnId: z.string(),
        })
      )
      .default([]),
    expectedTurnIdentityStatuses: z
      .array(
        z.object({
          acceptableStatuses: z.array(z.string()).optional(),
          mention: z.string(),
          selectedCandidateId: z.string().optional(),
          status: z.string(),
          turnId: z.string(),
        })
      )
      .default([]),
    expectedTurnParameters: z
      .array(
        z.object({
          path: z.string().min(1),
          turnId: z.string(),
          value: jsonValueSchema,
        })
      )
      .default([]),
    expectedTurnToolActions: z
      .array(
        z.object({
          businessOutcome: z.string(),
          name: z.string(),
          sourceRecords: z.array(sourceRecordSchema),
          turnId: z.string(),
        })
      )
      .default([]),
    outcomeStatus: z.string().nullable(),
    prohibitedClaims: z.array(z.string()),
    requiredAbstentions: z.array(z.string()).default([]),
    requiredEvidence: z.array(evidenceExpectationSchema),
    resolvedPlayers: z.array(playerExpectationSchema),
    sourceScope: z.array(sourceRecordSchema).default([]),
    taskKind: z.enum([
      "player_lookup",
      "player_comparison",
      "player_recommendation",
      "team_recommendation",
    ]),
    toolActions: z.array(toolActionExpectationSchema),
  }),
  declaredDataFaults: z.array(declaredEvaluationDataFaultSchema).default([]),
  declaredTurnFaults: z.array(declaredTurnDataFaultSchema).default([]),
  evidenceBundleId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u),
  evidenceBundleSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  origin: z.enum(["real", "synthetic", "mixed"]),
  priorTuningExposure: z.string(),
  scenarioFamily: z.string(),
  split: z.enum(["development", "held_out"]),
  turns: z
    .array(
      z.object({
        clarificationAlternatives: z
          .array(
            z.array(
              z.object({
                expectedKind: z.string(),
                resumeValue: z.string(),
              })
            )
          )
          .default([]),
        clarificationAnswers: z
          .array(
            z.object({
              expectedKind: z.string(),
              resumeValue: z.string(),
            })
          )
          .default([]),
        turnId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u),
        userMessage: z.string().min(1),
      })
    )
    .min(1),
  workflow: z.enum([
    "player_lookup",
    "player_comparison",
    "player_recommendation",
    "team_recommendation",
  ]),
});

const fmProfileDefinitionSchema = z.object({
  aliases: z.array(z.string()).default([]),
  birthDate: z.string().nullable(),
  name: z.string(),
  payload: z.record(z.string(), z.json()),
  recordId: z.string(),
  uniqueId: z.string().nullable(),
});

const evaluationEvidenceBundleSchema = z.object({
  apiFootball: z
    .object({
      capturedAt: z.iso.datetime().nullable().default(null),
      requestedTeams: z.array(z.string()).default([]),
      sourceRequests: z.number().int().nonnegative().nullable().default(null),
      squadResponses: z
        .array(
          z.object({
            payload: jsonValueSchema,
            teamId: z.number().int().positive(),
          })
        )
        .default([]),
      teamSearchResponses: z
        .array(z.object({ payload: jsonValueSchema, query: z.string().min(1) }))
        .default([]),
    })
    .default({
      capturedAt: null,
      requestedTeams: [],
      sourceRequests: null,
      squadResponses: [],
      teamSearchResponses: [],
    }),
  bundleId: z.string(),
  fm: z.object({
    manifest: z.object({
      databaseVersion: z.string(),
      gameBuild: z.string(),
      inGameDate: z.string(),
      sha256: z.string(),
    }),
    players: z.array(fmProfileDefinitionSchema),
    positions: z
      .array(
        z.object({
          position: z.string(),
          rating: z.number().int(),
          recordId: z.string(),
        })
      )
      .default([]),
  }),
  identity: z.object({
    bridges: z.array(
      z.object({
        canonicalReepId: z.string().nullable(),
        externalId: z.string(),
        provider: z.enum(["fm", "understat", "api_football"]),
        redirectStatus: z.string(),
      })
    ),
    releaseStamp: z.string(),
  }),
  origin: z.enum(["real", "synthetic", "mixed"]),
  understat: z.object({
    snapshots: z.array(
      z.object({
        capturedAt: z.iso.datetime(),
        kind: z.enum(["league", "team"]),
        parserVersion: z.string(),
        players: z.array(z.json()),
        resourceId: z.string(),
        schemaVersion: z.number().int(),
        seasonStartYear: z.number().int(),
      })
    ),
  }),
});

const evaluationWorkerRequestSchema = z.object({
  ageAsOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  apiFootball: evaluationEvidenceBundleSchema.shape.apiFootball,
  caseId: z.string(),
  caseOrigin: z.enum(["real", "synthetic", "mixed"]),
  databasePaths: z.object({
    fm: z.string(),
    identity: z.string(),
    understat: z.string(),
  }),
  declaredTurnFaults: z.array(declaredTurnDataFaultSchema),
  maxClarificationsPerTurn: z.number().int().positive(),
  resultPath: z.string(),
  runId: z.string(),
  threadId: z.string(),
  trialId: z.string(),
  turnIds: z.array(z.string()),
  turns: z
    .array(
      z.object({
        clarificationAlternatives: z.array(
          z.array(
            z.object({
              expectedKind: z.string(),
              resumeValue: z.string(),
            })
          )
        ),
        clarificationAnswers: z.array(
          z.object({
            expectedKind: z.string(),
            resumeValue: z.string(),
          })
        ),
        turnId: z.string(),
        userMessage: z.string().min(1),
      })
    )
    .min(1),
});

const observedSourceRecordSchema = z.object({
  competition: z.string().nullable().optional(),
  provider: sourceProviderSchema,
  season: z.string().nullable().optional(),
  sourceId: z.string(),
});

const observedPlayerSchema = z.object({
  candidates: z.array(
    z.object({
      candidateId: z.string(),
      canonicalIdentityId: z.string().nullable(),
      records: z.array(observedSourceRecordSchema),
    })
  ),
  lookupName: z.string().nullable(),
  mention: z.string(),
  resolutionStatus: z.string(),
  selectedCandidateId: z.string().nullable(),
  selectedName: z.string().nullable(),
});

const observedToolCallSchema = z.object({
  arguments: jsonValueSchema,
  id: z.string().nullable(),
  name: z.string(),
});

const evaluationActionEventSchema = z.object({
  actionId: z.string(),
  caseId: z.string(),
  durationMs: z.number().nonnegative().nullable(),
  eventId: z.string(),
  input: jsonValueSchema.nullable(),
  kind: z.enum([
    "attempted",
    "blocked",
    "cache_hit",
    "failed",
    "requested",
    "returned",
    "schema_rejected",
  ]),
  name: z.string(),
  outcome: z.string().nullable(),
  result: z.string().nullable(),
  runId: z.string(),
  sourceRecords: z.array(observedSourceRecordSchema),
  toolCallId: z.string().nullable(),
  trialId: z.string(),
  turnId: z.string(),
});

const identityLookupEventSchema = z.object({
  actionId: z.string().optional(),
  candidates: z.array(
    z.object({
      candidateId: z.string(),
      canonicalIdentityId: z.string().nullable(),
      records: z.array(observedSourceRecordSchema),
    })
  ),
  caseId: z.string(),
  durationMs: z.number().nonnegative().nullable(),
  error: z.string().nullable(),
  eventId: z.string(),
  kind: z.enum(["attempted", "failed", "returned"]),
  lookupName: z.string(),
  outcome: z.string().nullable(),
  runId: z.string(),
  selectedCandidateId: z.string().nullable(),
  trialId: z.string(),
  turnId: z.string(),
});

const deliveredEvidenceProjectionSchema = z.discriminatedUnion("kind", [
  z.object({
    batchCount: z.number().int().positive(),
    batchIndex: z.number().int().nonnegative(),
    kind: z.literal("lookup"),
    recordRefs: z.array(z.string()),
    resultDigest: z.string(),
  }),
  z.object({
    batchCount: z.number().int().positive(),
    batchIndex: z.number().int().nonnegative(),
    commonUnderstatScopeCount: z.number().int().nonnegative(),
    kind: z.literal("comparison"),
    participantCount: z.number().int().positive(),
    participantRefs: z.array(z.string()),
    recordRefs: z.array(z.string()),
    resultDigest: z.string(),
    understatScopes: z.array(
      z.object({
        competition: z.string(),
        coveredPlayerCount: z.number().int().nonnegative(),
        coversAllParticipants: z.boolean(),
        participantCount: z.number().int().positive(),
        season: z.string(),
      })
    ),
  }),
]);

const deliveredEvidenceSchema = z.object({
  content: z.string(),
  evidenceId: z.string(),
  messageIndex: z.number().int().nonnegative(),
  modelCallIndex: z.number().int().positive(),
  modelRunId: z.string(),
  projection: deliveredEvidenceProjectionSchema.optional(),
  provider: z.enum(["api_football", "application", "fm", "understat"]),
  sourceId: z.string().nullable(),
  trialId: z.string(),
  turnId: z.string(),
});

const renderedEvidenceSchema = z.object({
  content: z.string(),
  evidenceId: z.string(),
  messageIndex: z.number().int().nonnegative(),
  provider: z.enum(["api_football", "application", "fm", "understat"]),
  sourceId: z.string().nullable(),
  trialId: z.string(),
  turnId: z.string(),
});

const availableResultKindSchema = z.enum([
  "player_comparison",
  "player_lookup",
  "player_recommendation",
  "team_recommendation",
]);

const turnObservationSchema = z.object({
  assistantMessages: z.array(z.string()),
  availableResultKinds: z.array(availableResultKindSchema),
  clarificationAnswers: z.array(
    z.object({ kind: z.string(), value: z.string() })
  ),
  clarificationKinds: z.array(z.string()),
  deliveredEvidenceIds: z.array(z.string()),
  effectiveConditions: z
    .object({
      includePotential: z.boolean().nullable(),
      maxAge: z.number().int().nullable(),
      minimumCurrentAbility: z.number().int().nullable(),
      minimumPotentialAbility: z.number().int().nullable(),
      position: z.string().nullable(),
      referenceMode: z.enum(["named", "squad"]).nullable(),
      resultLimit: z.number().int().nullable(),
      teamId: z.number().int().positive().nullable(),
      teamName: z.string().nullable(),
    })
    .nullable(),
  effectiveConstraints: z.array(
    z.object({ name: z.string(), value: z.string() })
  ),
  nodeFailure: z
    .object({ category: z.string(), node: z.string() })
    .nullable()
    .optional(),
  outcomeKind: z.string().nullable(),
  outcomeStatus: z.string().nullable(),
  players: z.array(observedPlayerSchema),
  renderedEvidenceIds: z.array(z.string()).optional(),
  requestKind: z.string().nullable(),
  reuse: z
    .object({
      evidenceIds: z.array(z.string()),
      kind: z.literal("saved_lookup_result"),
    })
    .nullable(),
  turnId: z.string(),
  userMessage: z.string(),
});

const observedConversationMessageSchema = z.object({
  content: z.string(),
  invalidToolCalls: z.array(
    z.object({
      arguments: jsonValueSchema.nullable(),
      error: z.string().nullable(),
      id: z.string().nullable(),
      name: z.string(),
    })
  ),
  role: z.enum(["human", "assistant", "tool"]),
  toolCallId: z.string().nullable().optional(),
  toolCalls: z.array(observedToolCallSchema),
  toolName: z.string().nullable().optional(),
});

const workerTrialResultSchema = z.object({
  actionEvents: z.array(evaluationActionEventSchema),
  activeLookupResult: z.string().nullable(),
  activeResults: z.object({
    comparison: z.string().nullable(),
    lookup: z.string().nullable(),
    playerRecommendation: z.string().nullable(),
    teamRecommendation: z.string().nullable(),
  }),
  conversationContext: z.array(observedConversationMessageSchema),
  deliveredEvidence: z.array(deliveredEvidenceSchema),
  driverIssue: z.string().nullable(),
  error: z.string().optional(),
  failureCategory: z.string().nullable(),
  identityLookupEvents: z.array(identityLookupEventSchema),
  outcomeKind: z.string().nullable(),
  outcomeStatus: z.string().nullable(),
  players: z.array(observedPlayerSchema),
  renderedEvidence: z.array(renderedEvidenceSchema).optional(),
  requestKind: z.string().nullable(),
  teamRosterCoverage: teamRosterCoverageSchema.nullable(),
  toolMessages: z.array(
    z.object({
      content: z.string(),
      name: z.string().nullable(),
      status: z.string().nullable(),
      toolCallId: z.string(),
    })
  ),
  turns: z.array(turnObservationSchema),
});

const gatewayExchangeSchema = z.object({
  durationMs: z.number().nonnegative(),
  forwarded: z.boolean(),
  model: z.string().nullable(),
  requestBody: z.string(),
  requestPath: z.string(),
  responseBody: z.string().nullable(),
  responseStatus: z.number().int().nullable(),
  role: z.enum(["agent", "judge", "calibration"]),
  tokenUsage: z
    .object({
      completionTokens: z.number().int().nonnegative().nullable(),
      promptTokens: z.number().int().nonnegative().nullable(),
      totalTokens: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
});

const requestLatencySchema = z.object({
  averageMs: z.number().nonnegative().nullable(),
  p50Ms: z.number().nonnegative().nullable(),
  p95Ms: z.number().nonnegative().nullable(),
  requestsWithLatency: z.number().int().nonnegative(),
});

const emptyRequestLatency = {
  averageMs: null,
  p50Ms: null,
  p95Ms: null,
  requestsWithLatency: 0,
};

const evaluationCheckSchema = z.object({
  actual: z.string(),
  expected: z.string(),
  id: z.string(),
  status: z.enum(["failed", "passed"]),
});

const semanticErrorCategorySchema = z.enum([
  "factual_contradiction",
  "false_execution_claim",
  "unsupported_fact",
]);

type SemanticErrorCategory = z.output<typeof semanticErrorCategorySchema>;

const semanticFindingSchema = z.object({
  actionIds: z.array(z.string()),
  category: semanticErrorCategorySchema,
  evidenceIds: z.array(z.string()),
  explanation: z.string(),
  quote: z.string(),
  turnId: z.string(),
});

const requiredFactCoverageSchema = z.object({
  factId: z.string(),
  status: z.enum(["covered", "missing", "uncertain"]),
});

const judgeCalibrationSchema = z.object({
  anchorPriorTuningExposure: z
    .string()
    .default("Prior anchor-tuning exposure was not recorded in this report."),
  anchorVersion: z.string(),
  development: z.object({
    passed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  judgeModel: z.string(),
  judgePromptVersion: z.string(),
  results: z.array(
    z.object({
      anchorId: z.string(),
      expectedCategories: z.array(semanticErrorCategorySchema),
      observedCategories: z.array(semanticErrorCategorySchema),
      split: z.enum(["development", "validation"]),
      status: z.enum(["failed", "passed", "unrun"]),
      validationErrors: z.array(z.string()),
    })
  ),
  retiredValidationAnchorIds: z.array(z.string()).default([]),
  rubricVersion: z.string(),
  sameModelAsAgent: z.boolean(),
  status: z.enum(["failed", "incomplete", "passed"]),
  validation: z.object({
    passed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
});

const evaluationTrialReportSchema = z.object({
  caseHash: z.string(),
  caseId: z.string(),
  category: evaluationCaseSchema.shape.category,
  checks: z.array(evaluationCheckSchema),
  codeStatus: z.enum(["failed", "not_run", "passed"]),
  evidenceBundleHash: z.string(),
  evidenceSourceMetadata: z
    .object({
      apiFootball: z
        .object({
          capturedAt: z.iso.datetime().nullable(),
          requestedTeams: z.array(z.string()),
          sourceRequests: z.number().int().nonnegative().nullable(),
          teamIds: z.array(z.number().int().positive()),
        })
        .nullable(),
      fm: z.object({
        databaseVersion: z.string(),
        gameBuild: z.string(),
        inGameDate: z.string(),
        manifestSha256: z.string(),
      }),
      identityReleaseStamp: z.string(),
      understat: z.array(
        z.object({
          capturedAt: z.iso.datetime(),
          kind: z.enum(["league", "team"]),
          parserVersion: z.string(),
          resourceId: z.string(),
          schemaVersion: z.number().int(),
          seasonStartYear: z.number().int(),
        })
      ),
    })
    .nullable(),
  gatewayExchanges: z.array(gatewayExchangeSchema),
  modelRequests: z.number().int().nonnegative(),
  modelRequestsByRole: z.object({
    agent: z.number().int().nonnegative(),
    calibration: z.number().int().nonnegative(),
    judge: z.number().int().nonnegative(),
  }),
  networkFailures: z.number().int().nonnegative(),
  observation: workerTrialResultSchema,
  origin: evaluationCaseSchema.shape.origin,
  priorTuningExposure: z.string(),
  runIndex: z.number().int().positive(),
  scenarioFamily: z.string(),
  semanticFindings: z.array(semanticFindingSchema),
  semanticRequiredFactCoverage: z.array(requiredFactCoverageSchema),
  semanticStatus: z.enum([
    "failed",
    "inconclusive",
    "invalid",
    "not_assessed",
    "passed",
  ]),
  semanticValidationErrors: z.array(z.string()),
  sourceRecords: z.array(observedSourceRecordSchema),
  split: evaluationCaseSchema.shape.split,
  status: z.enum([
    "budget_exhausted",
    "failed",
    "inconclusive",
    "judge_invalid",
    "not_assessed",
    "not_run",
    "preflight_error",
    "passed",
    "runtime_error",
  ]),
  workflow: evaluationCaseSchema.shape.workflow,
});

const evaluationReportSchema = z.object({
  agentModel: z.string().nullable(),
  caseCount: z.number().int().nonnegative(),
  deniedRequests: z.number().int().nonnegative(),
  deniedRequestsByRole: z.object({
    agent: z.number().int().nonnegative(),
    calibration: z.number().int().nonnegative(),
    judge: z.number().int().nonnegative(),
  }),
  estimatedModelRequests: z.number().int().nonnegative(),
  finishedAt: z.iso.datetime().nullable(),
  freezeId: z.string().nullable(),
  gatewayOrigin: z.string().nullable(),
  judgeCalibration: judgeCalibrationSchema.nullable(),
  judgeEnabled: z.boolean(),
  latencyByRole: z
    .object({
      agent: requestLatencySchema,
      calibration: requestLatencySchema,
      judge: requestLatencySchema,
    })
    .default({
      agent: emptyRequestLatency,
      calibration: emptyRequestLatency,
      judge: emptyRequestLatency,
    }),
  maxModelRequests: z.number().int().positive(),
  mode: z.enum(["development", "held_out", "smoke"]),
  modelRequests: z.number().int().nonnegative(),
  networkFailures: z.number().int().nonnegative(),
  preflightErrors: z.array(z.string()),
  requestCountsByRole: z.object({
    agent: z.number().int().nonnegative(),
    calibration: z.number().int().nonnegative(),
    judge: z.number().int().nonnegative(),
  }),
  runId: z.string(),
  runIdentity: z.object({
    agentPromptSha256: z.string(),
    benchmarkVersion: z.string(),
    dependencyLockSha256: z.string().nullable(),
    gitRevision: z.string().nullable(),
    sourceTreeSha256: z.string(),
    workingTreeDirty: z.boolean().nullable(),
  }),
  startedAt: z.iso.datetime(),
  status: z.enum(["completed", "partial"]),
  tokenUsageByRole: z.object({
    agent: z.object({
      completionTokensReported: z.number().int().nonnegative().nullable(),
      deniedRequests: z.number().int().nonnegative(),
      dispatchedRequests: z.number().int().nonnegative(),
      modelIds: z.array(z.string()),
      promptTokensReported: z.number().int().nonnegative().nullable(),
      responsesWithCompletionTokens: z.number().int().nonnegative().default(0),
      responsesWithPromptTokens: z.number().int().nonnegative().default(0),
      responsesWithTotalTokens: z.number().int().nonnegative().default(0),
      responsesWithUsage: z.number().int().nonnegative(),
      responsesWithoutUsage: z.number().int().nonnegative(),
      totalTokensReported: z.number().int().nonnegative().nullable(),
    }),
    calibration: z.object({
      completionTokensReported: z.number().int().nonnegative().nullable(),
      deniedRequests: z.number().int().nonnegative(),
      dispatchedRequests: z.number().int().nonnegative(),
      modelIds: z.array(z.string()),
      promptTokensReported: z.number().int().nonnegative().nullable(),
      responsesWithCompletionTokens: z.number().int().nonnegative().default(0),
      responsesWithPromptTokens: z.number().int().nonnegative().default(0),
      responsesWithTotalTokens: z.number().int().nonnegative().default(0),
      responsesWithUsage: z.number().int().nonnegative(),
      responsesWithoutUsage: z.number().int().nonnegative(),
      totalTokensReported: z.number().int().nonnegative().nullable(),
    }),
    judge: z.object({
      completionTokensReported: z.number().int().nonnegative().nullable(),
      deniedRequests: z.number().int().nonnegative(),
      dispatchedRequests: z.number().int().nonnegative(),
      modelIds: z.array(z.string()),
      promptTokensReported: z.number().int().nonnegative().nullable(),
      responsesWithCompletionTokens: z.number().int().nonnegative().default(0),
      responsesWithPromptTokens: z.number().int().nonnegative().default(0),
      responsesWithTotalTokens: z.number().int().nonnegative().default(0),
      responsesWithUsage: z.number().int().nonnegative(),
      responsesWithoutUsage: z.number().int().nonnegative(),
      totalTokensReported: z.number().int().nonnegative().nullable(),
    }),
  }),
  trials: z.array(evaluationTrialReportSchema),
});

type EvaluationCase = z.output<typeof evaluationCaseSchema>;

type DeclaredEvaluationDataFault = z.output<
  typeof declaredEvaluationDataFaultSchema
>;

type EvaluationCheck = z.output<typeof evaluationCheckSchema>;

type EvaluationActionEvent = z.output<typeof evaluationActionEventSchema>;

type IdentityLookupEvent = z.output<typeof identityLookupEventSchema>;

type DeliveredEvidence = z.output<typeof deliveredEvidenceSchema>;

type DeliveredEvidenceProjection = z.output<
  typeof deliveredEvidenceProjectionSchema
>;

type RenderedEvidence = z.output<typeof renderedEvidenceSchema>;

type EvaluationEvidenceBundle = z.output<typeof evaluationEvidenceBundleSchema>;

type ObservedConversationMessage = z.output<
  typeof observedConversationMessageSchema
>;

type EvaluationGatewayExchange = z.output<typeof gatewayExchangeSchema>;

type EvaluationReport = z.output<typeof evaluationReportSchema>;

type EvaluationTrialReport = z.output<typeof evaluationTrialReportSchema>;

type JudgeCalibrationReport = z.output<typeof judgeCalibrationSchema>;

type EvaluationWorkerRequest = z.output<typeof evaluationWorkerRequestSchema>;

type WorkerTrialResult = z.output<typeof workerTrialResultSchema>;

type TurnObservation = z.output<typeof turnObservationSchema>;

export {
  availableResultKindSchema,
  evaluationCaseSchema,
  declaredEvaluationDataFaultSchema,
  evaluationActionEventSchema,
  evaluationEvidenceBundleSchema,
  deliveredEvidenceProjectionSchema,
  identityLookupEventSchema,
  gatewayExchangeSchema,
  evaluationReportSchema,
  evaluationWorkerRequestSchema,
  workerTrialResultSchema,
  teamRosterCoverageSchema,
  judgeCalibrationSchema,
  semanticErrorCategorySchema,
  semanticFindingSchema,
  requiredFactCoverageSchema,
};

export type {
  EvaluationCase,
  EvaluationCheck,
  EvaluationEvidenceBundle,
  EvaluationGatewayExchange,
  DeclaredEvaluationDataFault,
  DeliveredEvidence,
  DeliveredEvidenceProjection,
  EvaluationActionEvent,
  IdentityLookupEvent,
  JsonValue,
  ObservedConversationMessage,
  EvaluationReport,
  EvaluationTrialReport,
  JudgeCalibrationReport,
  RenderedEvidence,
  SemanticErrorCategory,
  EvaluationWorkerRequest,
  WorkerTrialResult,
  TurnObservation,
};
