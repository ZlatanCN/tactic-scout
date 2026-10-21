import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRecruitmentConversation, type RecruitmentAction, type RecruitmentTraceEvent } from "../../src/recruitment/conversation.js";
import { preflightConfiguredHistoricalArchive } from "../../src/sources/reep/historical-archive-enrichment.js";
import type { PlayerRepository } from "../../src/sources/registry.js";
import { type PlayerProfile } from "../../src/domain/players.js";
import { importReepRelease } from "../../src/players/identity/import-reep-release.js";

const archiveEnvironmentKeys = [
  "TACTISCOUT_WYSCOUT_HISTORICAL_REPORT_DISPLAY_ALLOWED",
  "TACTISCOUT_WYSCOUT_HISTORICAL_LOCAL_RETENTION_ALLOWED",
  "TACTISCOUT_REEP_IDENTITY_DB_PATH",
  "TACTISCOUT_WYSCOUT_ARCHIVE_DIR",
  "OPENAI_BASE_URL",
] as const;

function understatCandidate(): PlayerProfile {
  return {
    playerId: "understat:50001",
    externalPlayerId: "50001",
    name: "Current Source Candidate",
    team: "Current Club",
    age: 24,
    position: "ST",
    competition: "Current League",
    season: "2025/26",
    minutes: 1800,
    stats: {
      goals: 12,
      assists: 3,
      passesAttempted: 0,
      passesCompleted: 0,
      longPasses: 0,
      carries: 0,
      pressures: 0,
      tackles: 0,
      interceptions: 0,
      shotAssists: 8,
      keyPasses: 15,
    },
    availableStats: ["goals", "assists", "shotAssists", "keyPasses"],
    supplementaryMetrics: [{
      key: "understatNonPenaltyExpectedGoalsPer90",
      value: 0.42,
      unit: "xG/90分钟",
      normalization: "per90",
      definition: "合成测试指标，不用于外部结论。",
      sourceField: "synthetic npxG",
      sampleMinutes: 1800,
      sampleMatches: 20,
    }],
    sourceIdentity: {
      provider: "understat",
      playerId: "EPL:50001",
      providerIdentifiers: [{
        provider: "understat",
        namespace: "player",
        externalId: "50001",
        sourceField: "id",
      }],
      retrievedAt: "2026-10-10T00:00:00.000Z",
      isCurrentSeason: true,
    },
    source: "Synthetic Understat fixture",
  };
}

async function prepareArchive(root: string): Promise<{ archiveDirectory: string; identityIndexPath: string }> {
  const archiveDirectory = path.join(root, "wyscout");
  const identityIndexPath = path.join(root, "identity.sqlite");
  const bridgesPath = path.join(root, "bridges.csv.gz");
  const redirectsPath = path.join(root, "redirects.csv.gz");
  await mkdir(archiveDirectory, { recursive: true });
  await Promise.all([
    writeFile(bridgesPath, gzipSync(Buffer.from([
      "provider,namespace,external_id,reep_id,rung,upstream_status",
      "understat,player,50001,synthetic-reep-person,crosswalk,active",
      "wyscout,player,101,synthetic-reep-person,source_key,active",
    ].join("\n")))),
    writeFile(redirectsPath, gzipSync(Buffer.from("from_id,to_id,reason\n"))),
  ]);
  await importReepRelease({ bridgesPath, redirectsPath, releaseStamp: "20261005T180536Z", outputPath: identityIndexPath });
  await Promise.all([
    writeFile(path.join(archiveDirectory, "competitions.json"), JSON.stringify([
      { wyId: 1, name: "Synthetic Archive League", type: "club", format: "Domestic league" },
    ])),
    writeFile(path.join(archiveDirectory, "teams.json"), JSON.stringify([{ wyId: 10, name: "Archive Club" }])),
    writeFile(path.join(archiveDirectory, "players.json"), JSON.stringify([{
      wyId: 101,
      firstName: "Historical",
      lastName: "Display Alias",
      role: { name: "Forward" },
      birthDate: "1998-01-01",
      currentTeamId: 10,
    }])),
    writeFile(path.join(archiveDirectory, "matches_England.json"), JSON.stringify([{
      wyId: 1,
      competitionId: 1,
      dateutc: "2018-05-10 20:00:00",
      duration: "Regular",
      teamsData: {
        "10": {
          teamId: 10,
          hasFormation: 1,
          formation: { lineup: [{ playerId: 101 }], bench: [], substitutions: [] },
        },
      },
    }])),
    writeFile(path.join(archiveDirectory, "events_England.json"), JSON.stringify([{
      id: 1,
      matchId: 1,
      teamId: 10,
      playerId: 101,
      eventName: "Shot",
      subEventName: "Shot",
      matchPeriod: "1H",
      eventSec: 1,
      tags: [{ id: 101 }],
    }])),
  ]);
  return { archiveDirectory, identityIndexPath };
}

function stableTrace(events: RecruitmentTraceEvent[]) {
  return events.flatMap((event) => {
    if (event.phase === "decision") return [{ phase: event.phase, action: event.action, decisionSource: event.decisionSource }];
    if (event.phase === "tool") return [{
      phase: event.phase,
      toolName: event.toolName,
      filters: Object.fromEntries(Object.entries(event.filters).filter(([key]) => key !== "traceId")),
      resultCount: event.resultCount,
    }];
    return [];
  });
}

function reportWithoutHistoricalSidecar<T extends NonNullable<Awaited<ReturnType<ReturnType<typeof createRecruitmentConversation>["turn"]>>["report"]>>(report: T) {
  const normalized = structuredClone(report);
  normalized.historicalArchiveCoverage = {
    status: "not_run",
    disabledReason: null,
    checkedCandidates: 0,
    mappedCandidates: 0,
    matchedCandidates: 0,
    failedCandidates: 0,
  };
  normalized.historicalArchiveCandidates = [];
  normalized.recommendations = normalized.recommendations.map((recommendation) => ({
    ...recommendation,
    historicalArchiveSamples: [],
  }));
  return normalized;
}

test("the full LangGraph report adds exact linked archive context without changing assessment or recommendations", async () => {
  const previousEnvironment = new Map(archiveEnvironmentKeys.map((key) => [key, process.env[key]]));
  const root = await mkdtemp(path.join(os.tmpdir(), "tactiscout-history-ablation-"));
  try {
    const { archiveDirectory, identityIndexPath } = await prepareArchive(root);
    process.env.TACTISCOUT_WYSCOUT_HISTORICAL_REPORT_DISPLAY_ALLOWED = "true";
    process.env.TACTISCOUT_WYSCOUT_HISTORICAL_LOCAL_RETENTION_ALLOWED = "true";
    process.env.TACTISCOUT_REEP_IDENTITY_DB_PATH = identityIndexPath;
    process.env.TACTISCOUT_WYSCOUT_ARCHIVE_DIR = archiveDirectory;
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
    const preflight = await preflightConfiguredHistoricalArchive();
    assert.equal(preflight.status, "ready");
    if (preflight.status !== "ready") throw new Error("synthetic historical archive fixture must pass preflight");
    assert.equal(preflight.releaseStamp, "20261005T180536Z");
    assert.equal(preflight.archivePlayerRecords, 1);

    const candidate = understatCandidate();
    const repository: PlayerRepository = {
      mode: "understat",
      sourceName: "Synthetic Understat",
      async loadPlayers() { return [candidate]; },
    };

    async function run(archiveEnabled: boolean) {
      if (!archiveEnabled) process.env.TACTISCOUT_WYSCOUT_HISTORICAL_REPORT_DISPLAY_ALLOWED = "false";
      const plannerActions: RecruitmentAction[] = [
        { action: "search_methodology", query: "中锋射门机会质量" },
        { action: "search_candidates", position: "ST", minimumMinutes: 0, limit: 5 },
        { action: "evaluate_candidates", playerIds: [candidate.playerId] },
        { action: "search_player_reports", query: "Current Source Candidate 球员报告", playerNames: [candidate.name] },
        {
          action: "finish",
          targetTeam: "Bayern",
          needSummary: "评估当前赛季中锋的进球与机会质量。",
          capabilityProfile: ["进球与射门机会质量"],
          recommendations: [{ playerId: candidate.playerId, evidenceKeys: ["goals", "understatNonPenaltyExpectedGoalsPer90"] }],
          limitationKeys: [],
        },
      ];
      const plannerInputs: Array<Parameters<import("../../src/recruitment/conversation.js").RecruitmentPlanner["decide"]>[0]> = [];
      const events: RecruitmentTraceEvent[] = [];
      const conversation = createRecruitmentConversation({
        repository,
        planner: {
          async decide(input) {
            plannerInputs.push(input);
            const next = plannerActions.shift();
            assert.ok(next, "scripted planner should have enough actions to complete the full graph");
            return next;
          },
        },
        knowledgeBase: { async search() { return []; } },
        observer(event) { events.push(event); },
      });
      const response = await conversation.turn({
        threadId: archiveEnabled ? "history-ablation-enabled" : "history-ablation-disabled",
        message: "为拜仁评估这名前锋的进球与射门机会质量。",
      });
      assert.equal(response.status, "completed");
      assert.ok(response.report);
      assert.equal(plannerActions.length, 0);
      assert.ok(plannerInputs.every((input) => !JSON.stringify(input.history).includes("Historical Display Alias")), "archive-only names must never enter Planner context");
      return { report: response.report, events };
    }

    const enabled = await run(true);
    process.env.TACTISCOUT_WYSCOUT_HISTORICAL_REPORT_DISPLAY_ALLOWED = "true";
    const disabled = await run(false);

    assert.equal(enabled.report.historicalArchiveCoverage.status, "complete");
    assert.equal(enabled.report.historicalArchiveCoverage.matchedCandidates, 1);
    assert.equal(disabled.report.historicalArchiveCoverage.status, "disabled");
    assert.equal(disabled.report.historicalArchiveCandidates.length, 0);
    assert.equal(enabled.report.historicalArchiveCandidates.length, 0, "recommended candidate archive samples belong on the recommendation appendix");
    const enabledRecommendation = enabled.report.recommendations[0];
    const disabledRecommendation = disabled.report.recommendations[0];
    assert.ok(enabledRecommendation);
    assert.ok(disabledRecommendation);
    assert.equal(enabledRecommendation.player.name, "Current Source Candidate");
    assert.deepEqual(enabled.report.recommendations.map(({ player, focusEvidenceKeys }) => ({ playerId: player.playerId, focusEvidenceKeys })),
      disabled.report.recommendations.map(({ player, focusEvidenceKeys }) => ({ playerId: player.playerId, focusEvidenceKeys })));
    assert.deepEqual(enabledRecommendation.evidence, disabledRecommendation.evidence);
    assert.deepEqual(enabled.report.evidenceCoverage, disabled.report.evidenceCoverage);
    assert.deepEqual(enabled.report.requestedCapabilityCoverage, disabled.report.requestedCapabilityCoverage);
    assert.deepEqual(reportWithoutHistoricalSidecar(enabled.report), reportWithoutHistoricalSidecar(disabled.report));
    assert.deepEqual(stableTrace(enabled.events), stableTrace(disabled.events));
    assert.equal(enabledRecommendation.historicalArchiveSamples.length, 1);
    const sample = enabledRecommendation.historicalArchiveSamples[0]!;
    assert.equal(sample.playerName, "Historical Display Alias");
    assert.equal(sample.providerPlayerId, "101");
    assert.equal(sample.identityLink.sourceProvider, "understat");
    assert.equal(sample.identityLink.sourcePlayerId, "EPL:50001");
    assert.equal(sample.identityLink.reepReleaseStamp, "20261005T180536Z");
  } finally {
    for (const key of archiveEnvironmentKeys) {
      const value = previousEnvironment.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
