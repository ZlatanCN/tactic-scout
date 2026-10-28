import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { evaluationReportSchema } from "./contracts.js";
import type { EvaluationReport } from "./contracts.js";

const writeJsonAtomically = (
  filePath: string,
  value: EvaluationReport
): void => {
  const temporaryPath = `${filePath}.tmp`;

  writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(temporaryPath, filePath);
};

const escapeMarkdownCell = (value: string): string =>
  value.replaceAll("|", "\\|").replaceAll("\n", " ");

const usageLabel = (value: number | null): string =>
  value === null ? "unavailable" : String(value);

const retiredAnchorLabel = (
  calibration: EvaluationReport["judgeCalibration"]
): string => {
  if (calibration === null) {
    return "unavailable";
  }

  return calibration.retiredValidationAnchorIds.length === 0
    ? "none"
    : calibration.retiredValidationAnchorIds.join(", ");
};

const noneRecorded = "- None recorded";

const understatDateLabel = (
  sourceMetadata: EvaluationReport["trials"][number]["evidenceSourceMetadata"]
): string => {
  if (sourceMetadata === null) {
    return "unavailable";
  }

  const snapshots = sourceMetadata.understat.map(
    ({ capturedAt, resourceId, seasonStartYear }) =>
      `${resourceId}/${seasonStartYear} captured ${capturedAt}`
  );

  return snapshots.length > 0 ? snapshots.join(", ") : "unavailable";
};

const apiFootballCaptureLine = (
  sourceMetadata: EvaluationReport["trials"][number]["evidenceSourceMetadata"]
): string[] => {
  const capture = sourceMetadata?.apiFootball;

  if (capture === null || capture === undefined) {
    return [];
  }

  return [
    `- API-Football source capture: ${capture.sourceRequests ?? "request count unavailable"} requests · teams ${capture.requestedTeams.join(", ") || "unavailable"}`,
  ];
};

const trialDetails = (report: EvaluationReport): string[] =>
  report.trials.flatMap((trial) => {
    const sourceRefs = trial.observation.deliveredEvidence.map(
      ({ evidenceId, provider, sourceId, turnId }) =>
        `- ${escapeMarkdownCell(evidenceId)} · ${provider}:${sourceId ?? "n/a"} · ${turnId}`
    );

    const actionEvents = trial.observation.actionEvents.map((event) => {
      const sources = event.sourceRecords
        .map(({ provider, sourceId }) => `${provider}:${sourceId}`)
        .join(", ");

      return `- ${event.kind} ${event.name} · ${event.outcome ?? "no business outcome"} · ${sources || "no source IDs"} · ${event.turnId}`;
    });

    const identityLookups = trial.observation.identityLookupEvents.map(
      (event) =>
        `- ${event.kind} ${escapeMarkdownCell(event.lookupName)} · ${event.outcome ?? event.error ?? "pending"} · candidates ${event.candidates.map(({ candidateId }) => candidateId).join(", ") || "none"} · ${event.turnId}`
    );

    const responses = trial.observation.turns.flatMap((turn) =>
      turn.assistantMessages.map(
        (message) => `- ${turn.turnId}: ${escapeMarkdownCell(message)}`
      )
    );

    const checks = trial.checks.map(
      (check) =>
        `| ${escapeMarkdownCell(check.id)} | ${escapeMarkdownCell(check.expected)} | ${escapeMarkdownCell(check.actual)} | ${check.status} |`
    );

    const semanticFindings = trial.semanticFindings.map(
      ({ actionIds, category, evidenceIds, explanation, quote, turnId }) =>
        `- ${category} · ${turnId} · “${escapeMarkdownCell(quote)}” · evidence ${evidenceIds.join(", ") || "none"} · actions ${actionIds.join(", ") || "none"} · ${escapeMarkdownCell(explanation)}`
    );

    const semanticCoverage = trial.semanticRequiredFactCoverage.map(
      ({ factId, status }) => `- ${factId}: ${status}`
    );

    const sourceMetadata = trial.evidenceSourceMetadata;

    return [
      `### ${escapeMarkdownCell(trial.caseId)} · Trial ${trial.runIndex}`,
      "",
      `- Workflow: ${trial.workflow}`,
      `- Case category: ${trial.category}`,
      `- Split/origin: ${trial.split} / ${trial.origin}`,
      `- Scenario family: ${escapeMarkdownCell(trial.scenarioFamily)}`,
      `- Prior tuning exposure: ${escapeMarkdownCell(trial.priorTuningExposure)}`,
      `- Status: ${trial.status} · code checks: ${trial.codeStatus} · semantic: ${trial.semanticStatus}`,
      `- Evidence bundle SHA-256: ${trial.evidenceBundleHash.length > 0 ? trial.evidenceBundleHash : "unavailable"}`,
      `- Source dates: FM ${sourceMetadata?.fm.inGameDate ?? "unavailable"}; Understat ${understatDateLabel(sourceMetadata)}; API-Football ${sourceMetadata?.apiFootball?.capturedAt ?? "unavailable"}`,
      ...apiFootballCaptureLine(sourceMetadata),
      `- Gateway requests: ${trial.modelRequests}; network failures: ${trial.networkFailures}`,
      ...(trial.observation.error === undefined
        ? []
        : [`- Error: ${escapeMarkdownCell(trial.observation.error)}`]),
      "",
      "#### Expected vs observed checks",
      "",
      "| Check | Expected | Observed | Result |",
      "| --- | --- | --- | --- |",
      ...(checks.length > 0
        ? checks
        : ["| none | not run | not run | not run |"]),
      "",
      "#### Visible assistant responses",
      "",
      ...(responses.length > 0 ? responses : [noneRecorded]),
      "",
      "#### Identity lookup events",
      "",
      ...(identityLookups.length > 0 ? identityLookups : [noneRecorded]),
      "",
      "#### Execution events",
      "",
      ...(actionEvents.length > 0 ? actionEvents : [noneRecorded]),
      "",
      "#### Evidence delivered to the model",
      "",
      ...(sourceRefs.length > 0 ? sourceRefs : [noneRecorded]),
      "",
      "#### Automated semantic review",
      "",
      ...(semanticFindings.length > 0 ? semanticFindings : [noneRecorded]),
      ...(trial.semanticValidationErrors.length > 0
        ? trial.semanticValidationErrors.map(
            (error) => `- Validation: ${escapeMarkdownCell(error)}`
          )
        : []),
      ...(semanticCoverage.length > 0 ? ["", ...semanticCoverage] : []),
      "",
    ];
  });

const formatRate = (positive: number, denominator: number): string =>
  denominator === 0
    ? "N/A"
    : `${((positive / denominator) * 100).toFixed(2)}% (${positive}/${denominator})`;

const semanticMetricSummary = (
  report: EvaluationReport,
  category:
    | "factual_contradiction"
    | "false_execution_claim"
    | "unsupported_fact"
): string => {
  const validSemanticTrials =
    report.judgeCalibration?.status === "passed"
      ? report.trials.filter(({ semanticStatus }) =>
          ["passed", "failed"].includes(semanticStatus)
        )
      : [];

  const positiveTrials = validSemanticTrials.filter((trial) =>
    trial.semanticFindings.some((finding) => finding.category === category)
  ).length;

  return formatRate(positiveTrials, validSemanticTrials.length);
};

const aggregateSummary = (report: EvaluationReport): string[] => {
  const planned = report.caseCount * (report.mode === "smoke" ? 1 : 3);

  const attempted = report.trials.filter(
    ({ modelRequests }) => modelRequests > 0
  ).length;

  const unfinished = report.trials.filter(({ status }) =>
    ["budget_exhausted", "not_run"].includes(status)
  ).length;

  const errors = report.trials.filter(({ status }) =>
    ["preflight_error", "runtime_error"].includes(status)
  ).length;

  const adjudicated = report.trials.filter(({ semanticStatus }) =>
    ["passed", "failed"].includes(semanticStatus)
  ).length;

  const inconclusive = report.trials.filter(({ semanticStatus }) =>
    ["inconclusive", "invalid"].includes(semanticStatus)
  ).length;

  const missingRequiredFacts = report.trials.reduce(
    (count, trial) =>
      count +
      trial.semanticRequiredFactCoverage.filter(
        ({ status }) => status === "missing"
      ).length,
    0
  );

  const casesById = new Map<string, EvaluationReport["trials"]>();

  for (const trial of report.trials) {
    const trials = casesById.get(trial.caseId) ?? [];
    trials.push(trial);
    casesById.set(trial.caseId, trials);
  }

  const stableCases = [...casesById.values()].filter(
    (trials) =>
      trials.length === 3 && trials.every(({ status }) => status === "passed")
  ).length;

  const workflows = [...new Set(report.trials.map(({ workflow }) => workflow))]
    .toSorted()
    .map((workflow) => {
      const trials = report.trials.filter(
        (trial) => trial.workflow === workflow
      );

      const codePassed = trials.filter(
        ({ codeStatus }) => codeStatus === "passed"
      ).length;

      const semanticPassed = trials.filter(
        ({ semanticStatus }) => semanticStatus === "passed"
      ).length;

      return `| ${workflow} | ${trials.length} | ${codePassed} | ${semanticPassed} |`;
    });

  return [
    "## Aggregate coverage and quality",
    "",
    `- Planned / attempted / completed: ${planned} / ${attempted} / ${Math.max(0, report.trials.length - unfinished - errors)}`,
    `- Adjudicated / inconclusive / errored / unfinished: ${adjudicated} / ${inconclusive} / ${errors} / ${unfinished}`,
    `- Required-fact omissions reported by the judge: ${missingRequiredFacts}`,
    `- Cases passing all three trials: ${stableCases}`,
    `- Factual contradictions: ${semanticMetricSummary(report, "factual_contradiction")}`,
    `- Unsupported factual additions: ${semanticMetricSummary(report, "unsupported_fact")}`,
    `- False execution claims: ${semanticMetricSummary(report, "false_execution_claim")}`,
    "",
    "| Workflow | Trials | Code contract passed | Semantic passed |",
    "| --- | ---: | ---: | ---: |",
    ...(workflows.length > 0 ? workflows : ["| none | 0 | 0 | 0 |"]),
    "",
  ];
};

const markdownReport = (report: EvaluationReport): string => {
  const lines = [
    "# Scouting evaluation run",
    "",
    `- Mode: ${report.mode}`,
    `- Run ID: ${report.runId}`,
    `- Cases: ${report.caseCount}`,
    `- Benchmark version: ${report.runIdentity.benchmarkVersion}`,
    `- Git revision: ${report.runIdentity.gitRevision ?? "unavailable"}`,
    `- Working tree dirty: ${report.runIdentity.workingTreeDirty === null ? "unavailable" : String(report.runIdentity.workingTreeDirty)}`,
    `- Source tree SHA-256: ${report.runIdentity.sourceTreeSha256}`,
    `- Agent prompt source SHA-256: ${report.runIdentity.agentPromptSha256}`,
    `- Dependency lock SHA-256: ${report.runIdentity.dependencyLockSha256 ?? "unavailable"}`,
    `- Estimated model requests: ${report.estimatedModelRequests}`,
    `- Model requests: ${report.modelRequests} / ${report.maxModelRequests}`,
    `- Semantic judge: ${report.judgeEnabled ? "enabled" : "disabled"}`,
    ...(report.judgeCalibration === null
      ? []
      : [
          `- Judge calibration: ${report.judgeCalibration.status} · validation ${report.judgeCalibration.validation.passed}/${report.judgeCalibration.validation.total} · model ${report.judgeCalibration.judgeModel}${report.judgeCalibration.sameModelAsAgent ? " (same as agent)" : ""}`,
          `- Judge anchor prior tuning exposure: ${report.judgeCalibration.anchorPriorTuningExposure}`,
          `- Retired validation anchors: ${retiredAnchorLabel(report.judgeCalibration)}`,
        ]),
    `- Denied requests: ${report.deniedRequests}`,
    `- Network failures: ${report.networkFailures}`,
    `- Requests by role: agent ${report.requestCountsByRole.agent}, judge ${report.requestCountsByRole.judge}, calibration ${report.requestCountsByRole.calibration}`,
    `- Denied by role: agent ${report.deniedRequestsByRole.agent}, judge ${report.deniedRequestsByRole.judge}, calibration ${report.deniedRequestsByRole.calibration}`,
    `- Agent response models: ${report.tokenUsageByRole.agent.modelIds.join(", ") || "unavailable"}`,
    `- Agent tokens reported (prompt/completion/total): ${usageLabel(report.tokenUsageByRole.agent.promptTokensReported)} / ${usageLabel(report.tokenUsageByRole.agent.completionTokensReported)} / ${usageLabel(report.tokenUsageByRole.agent.totalTokensReported)}`,
    `- Agent responses with usage metadata: ${report.tokenUsageByRole.agent.responsesWithUsage}; without: ${report.tokenUsageByRole.agent.responsesWithoutUsage}`,
    `- Status: ${report.status}`,
    ...aggregateSummary(report),
    ...(report.preflightErrors.length > 0
      ? [
          "",
          "## Preflight errors",
          "",
          ...report.preflightErrors.map((error) => `- ${error}`),
        ]
      : []),
    "",
    "| Case | Trial | Workflow | Status | Code checks | Semantic | Requests |",
    "| --- | ---: | --- | --- | --- | --- | ---: |",
    ...report.trials.map(
      (trial) =>
        `| ${escapeMarkdownCell(trial.caseId)} | ${trial.runIndex} | ${
          trial.workflow
        } | ${trial.status} | ${trial.codeStatus} | ${trial.semanticStatus} | ${
          trial.modelRequests
        } |`
    ),
    "",
    "## Trial details",
    "",
    ...trialDetails(report),
  ];

  return `${lines.join("\n")}\n`;
};

const compatibleTrialKey = (
  trial: EvaluationReport["trials"][number]
): string =>
  [
    trial.caseId,
    trial.caseHash,
    trial.evidenceBundleHash,
    trial.split,
    trial.workflow,
    trial.runIndex,
  ].join("|");

const metricCounts = (
  trials: EvaluationReport["trials"],
  category: EvaluationReport["trials"][number]["semanticFindings"][number]["category"]
) => {
  const adjudicated = trials.filter(({ semanticStatus }) =>
    ["passed", "failed"].includes(semanticStatus)
  );

  const positive = adjudicated.filter((trial) =>
    trial.semanticFindings.some((finding) => finding.category === category)
  ).length;

  return { adjudicated: adjudicated.length, positive };
};

const comparisonConfigRow = (
  name: string,
  before: string,
  after: string
): string => `| ${name} | ${before} | ${after} |`;

const judgePromptLabel = (report: EvaluationReport): string => {
  const calibration = report.judgeCalibration;

  if (calibration === null) {
    return "unavailable";
  }

  return `${calibration.judgePromptVersion} / ${calibration.rubricVersion}`;
};

const dirtyLabel = (value: boolean | null): string =>
  value === null ? "unavailable" : String(value);

const comparisonCodeRows = (
  baseline: EvaluationReport,
  candidate: EvaluationReport
): string[] => [
  comparisonConfigRow(
    "Git revision",
    baseline.runIdentity.gitRevision ?? "unavailable",
    candidate.runIdentity.gitRevision ?? "unavailable"
  ),
  comparisonConfigRow(
    "Working tree dirty",
    dirtyLabel(baseline.runIdentity.workingTreeDirty),
    dirtyLabel(candidate.runIdentity.workingTreeDirty)
  ),
  comparisonConfigRow(
    "Agent prompt source SHA-256",
    baseline.runIdentity.agentPromptSha256,
    candidate.runIdentity.agentPromptSha256
  ),
  comparisonConfigRow(
    "Source tree SHA-256",
    baseline.runIdentity.sourceTreeSha256,
    candidate.runIdentity.sourceTreeSha256
  ),
  comparisonConfigRow(
    "Dependency lock SHA-256",
    baseline.runIdentity.dependencyLockSha256 ?? "unavailable",
    candidate.runIdentity.dependencyLockSha256 ?? "unavailable"
  ),
];

const comparisonModelRows = (
  baseline: EvaluationReport,
  candidate: EvaluationReport
): string[] => [
  comparisonConfigRow(
    "Gateway origin",
    baseline.gatewayOrigin ?? "unavailable",
    candidate.gatewayOrigin ?? "unavailable"
  ),
  comparisonConfigRow(
    "Agent model",
    baseline.agentModel ?? "unavailable",
    candidate.agentModel ?? "unavailable"
  ),
  comparisonConfigRow(
    "Agent response models",
    baseline.tokenUsageByRole.agent.modelIds.join(", ") || "unavailable",
    candidate.tokenUsageByRole.agent.modelIds.join(", ") || "unavailable"
  ),
];

const comparisonJudgePolicyRows = (
  baseline: EvaluationReport,
  candidate: EvaluationReport
): string[] => [
  comparisonConfigRow(
    "Judge model",
    baseline.judgeCalibration?.judgeModel ?? "unavailable",
    candidate.judgeCalibration?.judgeModel ?? "unavailable"
  ),
  comparisonConfigRow(
    "Judge prompt / rubric",
    judgePromptLabel(baseline),
    judgePromptLabel(candidate)
  ),
  comparisonConfigRow(
    "Judge anchors",
    baseline.judgeCalibration?.anchorVersion ?? "unavailable",
    candidate.judgeCalibration?.anchorVersion ?? "unavailable"
  ),
  comparisonConfigRow(
    "Anchor prior tuning exposure",
    baseline.judgeCalibration?.anchorPriorTuningExposure ?? "unavailable",
    candidate.judgeCalibration?.anchorPriorTuningExposure ?? "unavailable"
  ),
  comparisonConfigRow(
    "Retired validation anchors",
    retiredAnchorLabel(baseline.judgeCalibration),
    retiredAnchorLabel(candidate.judgeCalibration)
  ),
];

const comparisonRunRows = (
  baseline: EvaluationReport,
  candidate: EvaluationReport
): string[] => [
  comparisonConfigRow(
    "Freeze ID",
    baseline.freezeId ?? "not applicable",
    candidate.freezeId ?? "not applicable"
  ),
  comparisonConfigRow("Run start", baseline.startedAt, candidate.startedAt),
  comparisonConfigRow(
    "Run end",
    baseline.finishedAt ?? "incomplete",
    candidate.finishedAt ?? "incomplete"
  ),
];

const comparisonConfigurationRows = (
  baseline: EvaluationReport,
  candidate: EvaluationReport
): string[] => [
  ...comparisonCodeRows(baseline, candidate),
  ...comparisonModelRows(baseline, candidate),
  ...comparisonJudgePolicyRows(baseline, candidate),
  ...comparisonRunRows(baseline, candidate),
];

const compareEvaluationReports = (
  baseline: EvaluationReport,
  candidate: EvaluationReport
): string => {
  const candidateByKey = new Map(
    candidate.trials.map((trial) => [compatibleTrialKey(trial), trial])
  );

  const matched = baseline.trials.flatMap((trial) => {
    const paired = candidateByKey.get(compatibleTrialKey(trial));

    return paired === undefined ? [] : [{ baseline: trial, candidate: paired }];
  });

  const matchedBaselineKeys = new Set(
    matched.map(({ baseline: trial }) => compatibleTrialKey(trial))
  );

  const matchedCandidateKeys = new Set(
    matched.map(({ candidate: trial }) => compatibleTrialKey(trial))
  );

  const bothJudgesQualified =
    baseline.judgeCalibration?.status === "passed" &&
    candidate.judgeCalibration?.status === "passed";

  const categories = [
    "factual_contradiction",
    "unsupported_fact",
    "false_execution_claim",
  ] as const;

  const metricRows = categories.map((category) => {
    const baselineCounts = bothJudgesQualified
      ? metricCounts(
          matched.map(({ baseline: trial }) => trial),
          category
        )
      : { adjudicated: 0, positive: 0 };

    const candidateCounts = bothJudgesQualified
      ? metricCounts(
          matched.map(({ candidate: trial }) => trial),
          category
        )
      : { adjudicated: 0, positive: 0 };

    const baselineRate =
      baselineCounts.adjudicated === 0
        ? "N/A"
        : `${((baselineCounts.positive / baselineCounts.adjudicated) * 100).toFixed(2)}%`;

    const candidateRate =
      candidateCounts.adjudicated === 0
        ? "N/A"
        : `${((candidateCounts.positive / candidateCounts.adjudicated) * 100).toFixed(2)}%`;

    return `| ${category} | ${baselineRate} (${baselineCounts.positive}/${baselineCounts.adjudicated}) | ${candidateRate} (${candidateCounts.positive}/${candidateCounts.adjudicated}) |`;
  });

  const workflowRows = [
    ...new Set(matched.map(({ baseline: trial }) => trial.workflow)),
  ]
    .toSorted()
    .map((workflow) => {
      const pairs = matched.filter(
        ({ baseline: trial }) => trial.workflow === workflow
      );

      const baselinePassed = pairs.filter(
        ({ baseline: trial }) => trial.codeStatus === "passed"
      ).length;

      const candidatePassed = pairs.filter(
        ({ candidate: trial }) => trial.codeStatus === "passed"
      ).length;

      return `| ${workflow} | ${baselinePassed}/${pairs.length} | ${candidatePassed}/${pairs.length} |`;
    });

  const configurationRows = comparisonConfigurationRows(baseline, candidate);

  const baselineOnly = baseline.trials.filter(
    (trial) => !matchedBaselineKeys.has(compatibleTrialKey(trial))
  ).length;

  const candidateOnly = candidate.trials.filter(
    (trial) => !matchedCandidateKeys.has(compatibleTrialKey(trial))
  ).length;

  const meanLatencyForRole = (
    side: "baseline" | "candidate",
    role: EvaluationReport["trials"][number]["gatewayExchanges"][number]["role"]
  ): string => {
    const durations = matched.flatMap((pair) =>
      pair[side].gatewayExchanges.flatMap((exchange) =>
        exchange.forwarded && exchange.role === role
          ? [exchange.durationMs]
          : []
      )
    );

    return durations.length === 0
      ? "N/A"
      : `${(durations.reduce((total, duration) => total + duration, 0) / durations.length).toFixed(1)} ms`;
  };

  return [
    "# Scouting evaluation comparison",
    "",
    `- Baseline run: ${baseline.runId}`,
    `- Candidate run: ${candidate.runId}`,
    `- Compatible paired trials: ${matched.length}`,
    `- Baseline-only trials: ${baselineOnly}`,
    `- Candidate-only trials: ${candidateOnly}`,
    `- Judge calibration: ${baseline.judgeCalibration?.status ?? "not run"} / ${candidate.judgeCalibration?.status ?? "not run"}`,
    "",
    "## Configuration and provenance",
    "",
    "| Field | Baseline | Candidate |",
    "| --- | --- | --- |",
    ...configurationRows,
    "",
    "## Deterministic task checks on compatible trials",
    "",
    "| Workflow | Baseline code checks | Candidate code checks |",
    "| --- | ---: | ---: |",
    ...(workflowRows.length > 0 ? workflowRows : ["| none | 0/0 | 0/0 |"]),
    "",
    "## Semantic error rates",
    "",
    ...(bothJudgesQualified
      ? [
          "Rates use only compatible trials with valid semantic adjudication. Categories can overlap; compare them independently.",
          "",
          "| Category | Baseline positive/adjudicated | Candidate positive/adjudicated |",
          "| --- | ---: | ---: |",
          ...metricRows,
        ]
      : [
          "N/A: both runs need all reserved validation anchors to pass before semantic metrics can be compared.",
        ]),
    "",
    "## Request usage",
    "",
    `- Baseline: ${baseline.modelRequests}/${baseline.maxModelRequests} model requests; agent ${baseline.requestCountsByRole.agent}, calibration ${baseline.requestCountsByRole.calibration}, judge ${baseline.requestCountsByRole.judge}.`,
    `- Candidate: ${candidate.modelRequests}/${candidate.maxModelRequests} model requests; agent ${candidate.requestCountsByRole.agent}, calibration ${candidate.requestCountsByRole.calibration}, judge ${candidate.requestCountsByRole.judge}.`,
    `- Mean matched-trial latency: agent ${meanLatencyForRole("baseline", "agent")} → ${meanLatencyForRole("candidate", "agent")}; judge ${meanLatencyForRole("baseline", "judge")} → ${meanLatencyForRole("candidate", "judge")}.`,
    "",
  ].join("\n");
};

const compareEvaluationReportFiles = (
  baselinePath: string,
  candidatePath: string
): string => {
  const baseline = evaluationReportSchema.parse(
    JSON.parse(readFileSync(baselinePath, "utf-8"))
  );

  const candidate = evaluationReportSchema.parse(
    JSON.parse(readFileSync(candidatePath, "utf-8"))
  );

  return compareEvaluationReports(baseline, candidate);
};

const writeEvaluationReport = (
  outputDirectory: string,
  report: EvaluationReport
): void => {
  mkdirSync(outputDirectory, { recursive: true });
  writeJsonAtomically(path.join(outputDirectory, "report.json"), report);
  writeFileSync(
    path.join(outputDirectory, "report.md"),
    markdownReport(report),
    { mode: 0o600 }
  );
};

export {
  compareEvaluationReportFiles,
  compareEvaluationReports,
  writeEvaluationReport,
};
