import { Command, type LangGraphRunnableConfig, type Runtime } from "@langchain/langgraph";
import { enrichPlayerEloSignals } from "../../sources/playerelo/enrichment.js";
import { createEmptyExternalSignalCoverage, type ExternalSignalCoverage } from "../../domain/external-evidence.js";
import { throwIfTurnCancelled } from "../turn-cancellation.js";
import { evaluatedPlayersForConstraint } from "./candidate-context.js";
import { emitProgress } from "./progress.js";
import { type State } from "./state.js";
import { type RecruitmentRuntimeContext, requireRecruitmentRuntimeContext } from "./runtime-context.js";

export function createExternalSignalNode() {
  return async (state: State, runtime: Runtime<RecruitmentRuntimeContext>): Promise<Partial<State>> => {
    const context = requireRecruitmentRuntimeContext(runtime.context);
    const config = runtime as LangGraphRunnableConfig;
    const playerEloSetup = context.playerEloSetup;
    const disabledPlayerEloCoverage = createEmptyExternalSignalCoverage(
      playerEloSetup?.status === "disabled" ? "disabled" : "not_run",
      playerEloSetup?.status === "disabled" ? playerEloSetup.reason : null,
    );
    if (!playerEloSetup || !playerEloSetup.client || state.action?.action !== "finish") {
      return { externalSignalCoverage: disabledPlayerEloCoverage };
    }
    const eligibleEvaluatedPlayers = evaluatedPlayersForConstraint(state);
    const players = state.action.recommendations.flatMap(({ playerId }) => {
      const candidate = eligibleEvaluatedPlayers[playerId];
      return candidate ? [candidate.player] : [];
    });
    if (!players.length) return { externalSignalCoverage: disabledPlayerEloCoverage };

    emitProgress(config, {
      stage: "external_signal",
      message: `正在核对 ${players.length} 名推荐球员的独立外部表现信号`,
      completedSteps: state.decisionSteps,
    });
    const result = await enrichPlayerEloSignals(playerEloSetup.client, players, { signal: config.signal });
    throwIfTurnCancelled(config.signal);
    const successfulLookups = result.checkedCandidates - result.failedCandidates;
    emitProgress(config, {
      stage: "external_signal",
      status: result.failedCandidates ? "notice" : "completed",
      message: `外部表现信号核对完成，匹配到 ${result.matchedCandidates} 名候选${result.failedCandidates ? `，另有 ${result.failedCandidates} 次查询未成功` : ""}`,
      completedSteps: state.decisionSteps,
    });
    return {
      externalSignals: result.signalsByPlayerId,
      externalSignalCoverage: {
        status: result.failedCandidates === 0 ? "complete" : successfulLookups > 0 ? "partial" : "failed",
        disabledReason: null,
        identityUnavailableCandidates: result.identityUnavailableCandidates,
        directIdentityCandidates: result.directIdentityCandidates,
        crosswalkIdentityCandidates: result.crosswalkIdentityCandidates,
        checkedCandidates: result.checkedCandidates,
        matchedCandidates: result.matchedCandidates,
        failedCandidates: result.failedCandidates,
      } satisfies ExternalSignalCoverage,
    };
  };
}

export function createHistoricalArchiveNode() {
  return async (state: State, runtime: Runtime<RecruitmentRuntimeContext>): Promise<Partial<State>> => {
    const context = requireRecruitmentRuntimeContext(runtime.context);
    const config = runtime as LangGraphRunnableConfig;
    const repository = context.repository;
    const historicalArchiveSetup = context.historicalArchiveSetup;
    if (repository.mode === "wyscout") {
      return {
        historicalArchiveCoverage: {
          ...(historicalArchiveSetup?.coverage ?? {
            status: "not_run" as const,
            disabledReason: null,
            checkedCandidates: 0,
            mappedCandidates: 0,
            matchedCandidates: 0,
            failedCandidates: 0,
          }),
          status: "disabled" as const,
          disabledReason: "primary_source_is_archive" as const,
        },
      };
    }
    if (!historicalArchiveSetup || historicalArchiveSetup.status !== "ready" || state.action?.action !== "finish") {
      return { historicalArchiveCoverage: historicalArchiveSetup?.coverage ?? {
        status: "not_run",
        disabledReason: null,
        checkedCandidates: 0,
        mappedCandidates: 0,
        matchedCandidates: 0,
        failedCandidates: 0,
      } };
    }
    const eligibleEvaluatedPlayers = evaluatedPlayersForConstraint(state);
    const players = Object.values(eligibleEvaluatedPlayers).map(({ player }) => player);
    if (!players.length) return { historicalArchiveCoverage: historicalArchiveSetup.coverage };

    emitProgress(config, {
      stage: "historical_archive",
      message: `正在用 Reep 精确身份映射核对 ${players.length} 名候选的 Wyscout 历史样本`,
      completedSteps: state.decisionSteps,
    });
    const result = await historicalArchiveSetup.enrich(players);
    throwIfTurnCancelled(config.signal);
    const historicalSampleCount = Object.values(result.samplesByPlayerId).reduce((count, samples) => count + samples.length, 0);
    emitProgress(config, {
      stage: "historical_archive",
      status: result.coverage.status === "complete" ? "completed" : "notice",
      message: `跨来源历史样本核对完成，找到 ${historicalSampleCount} 条可追溯记录`,
      completedSteps: state.decisionSteps,
    });
    return {
      historicalArchiveSamplesByPlayerId: result.samplesByPlayerId,
      historicalArchiveCoverage: result.coverage,
    };
  };
}

export function externalSignalFailureHandler(state: State) {
  const candidateCount = state.action?.action === "finish" ? state.action.recommendations.length : 0;
  return new Command({
    update: {
      externalSignalCoverage: {
        ...state.externalSignalCoverage,
        status: "failed" as const,
        disabledReason: null,
        checkedCandidates: Math.max(state.externalSignalCoverage.checkedCandidates, candidateCount),
        failedCandidates: Math.max(state.externalSignalCoverage.failedCandidates, candidateCount),
      },
    },
    goto: "deliver_recommendation",
  });
}

export function historicalArchiveFailureHandler(state: State) {
  const candidateCount = Object.keys(state.evaluatedPlayers).length;
  return new Command({
    update: {
      historicalArchiveCoverage: {
        ...state.historicalArchiveCoverage,
        status: "failed" as const,
        checkedCandidates: Math.max(state.historicalArchiveCoverage.checkedCandidates, candidateCount),
        failedCandidates: Math.max(state.historicalArchiveCoverage.failedCandidates, candidateCount),
      },
    },
    goto: "deliver_recommendation",
  });
}
