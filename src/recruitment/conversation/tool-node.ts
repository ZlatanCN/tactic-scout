import type { TeamRosterEnrichmentProvider } from "../../sources/thesportsdb/roster.js";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Command, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ToolMessage } from "@langchain/core/messages";
import { tool, type ToolRuntime } from "@langchain/core/tools";
import { type PlayerRepository } from "../../players/repository.js";
import { type RecruitmentProgressEventStatus } from "../../domain/conversation.js";
import { type PlayerProfile } from "../../domain/players.js";
import { normalizeSearchText } from "../../domain/text-matching.js";
import { type CandidateIdentityGroup } from "../../players/identity/candidate-groups.js";
import { type KnowledgeRepository } from "../../knowledge/index.js";
import { requestedCapabilityEvidenceAreasForInput } from "../../domain/recruitment-capabilities.js";
import { summarizeRequestedCapabilityCoverage } from "../conclusion-policy.js";
import { RecruitmentActionSchema, type ToolActionName } from "../recruitment-actions.js";
import { type RecruitmentEvidenceEvaluator } from "../recruitment-evidence-evaluator.js";
import { type RecruitmentToolExecutionRequest, executeRecruitmentToolAction } from "../recruitment-tool-executor.js";
import { RecruitmentTurnCancelledError, throwIfTurnCancelled } from "../turn-cancellation.js";
import { constrainSearchActionToIntent, discoveredPlayersForConstraint, evaluatedPlayersForConstraint, resolvedCandidateSearchIntent, userMessages } from "./candidate-context.js";
import { type RecruitmentTraceObserver } from "./contracts.js";
import { type ProgressUpdate, emitCandidatePreviews, emitProgress } from "./progress.js";
import { type State } from "./state.js";
import { projectToolResult } from "./tool-results.js";
import type { PlayerNameResolver } from "../../players/identity/name-resolver.js";
import { replacementTargetMention } from "../replacement-target.js";
import { recruitmentDataToolNames, recruitmentToolDescription, recruitmentToolInputSchema } from "../recruitment-tools.js";
import { type RecruitmentRuntimeContext, requireRecruitmentRuntimeContext } from "./runtime-context.js";
import { TransientRecruitmentReadError } from "./node-policies.js";

function providerErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[a-z0-9_-]{1,40}$/i.test(code) ? code : undefined;
}

function safeToolFailure(error: unknown): { code: string | null; message: string } {
  const rawMessage = error instanceof Error ? error.message : "数据工具调用失败。";
  const message = rawMessage
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [已隐藏]")
    .replace(/\b(authorization|api[_-]?(?:token|key)|access[_-]?token|token)\s*[:=]\s*["']?[^\s,&"']+/gi, "$1=[已隐藏]")
    .slice(0, 400);
  return { code: providerErrorCode(error) ?? null, message: message || "数据工具调用失败。" };
}

const retryableReadActions = new Set<ToolActionName>([
  "search_candidates",
  "search_methodology",
  "search_player_reports",
  "inspect_team",
  "inspect_player",
  "inspect_candidate_group",
  "inspect_match",
]);

function mismatchedActionFields(invoked: unknown, authorized: unknown, name: ToolActionName): string[] {
  if (!invoked || typeof invoked !== "object" || !authorized || typeof authorized !== "object") return ["action"];
  const invokedRecord = invoked as Record<string, unknown>;
  const authorizedRecord = authorized as Record<string, unknown>;
  const fields = new Set([...Object.keys(invokedRecord), ...Object.keys(authorizedRecord)]);
  const serverOwnedFields = name === "search_player_reports"
    ? new Set(["playerNames", "targetTeam"])
    : new Set(["targetTeam"]);
  return [...fields]
    .filter(field => !serverOwnedFields.has(field))
    .filter(field => !isDeepStrictEqual(invokedRecord[field], authorizedRecord[field]))
    .sort();
}

export function createToolNode(input: {
  methodologyReuseEnabled: boolean;
}) {
  const tools = recruitmentDataToolNames().map((name) => tool(
    async (args, runtime: ToolRuntime) => {
      const state = runtime.state as State;
      const context = requireRecruitmentRuntimeContext(runtime.context as RecruitmentRuntimeContext | undefined);
      const invokedAction = RecruitmentActionSchema.parse({ action: name, ...args });
      const authorizedAction = state.action;
      const actionMismatches = mismatchedActionFields(invokedAction, authorizedAction, name);
      if (runtime.toolCall?.name !== name || state.action?.action !== name || actionMismatches.length > 0) {
        const mismatchSummary = [
          ...(runtime.toolCall?.name !== name ? ["tool_name"] : []),
          ...(state.action?.action !== name ? ["action"] : []),
          ...actionMismatches,
        ].filter((field, index, fields) => fields.indexOf(field) === index).sort();
        throw new Error(`工具调用与经过策略校验的案件动作不一致：${mismatchSummary.join(", ")}`);
      }
      const update = await executeRecruitmentStateAction(
        { ...state, action: authorizedAction },
        runtime.config as LangGraphRunnableConfig,
        context,
        input.methodologyReuseEnabled,
      );
      return new Command({
        update: {
          ...update,
          messages: [new ToolMessage({
            name,
            content: "工具结果已写入案件状态，可依据结构化调查记录规划下一步。",
            tool_call_id: runtime.toolCallId,
          })],
        },
      });
    },
    { name, description: recruitmentToolDescription(name), schema: recruitmentToolInputSchema(name) },
  ));
  return new ToolNode(tools, { handleToolErrors: false });
}

async function executeRecruitmentStateAction(
  state: State,
  config: LangGraphRunnableConfig,
  context: RecruitmentRuntimeContext,
  methodologyReuseEnabled: boolean,
): Promise<Partial<State>> {
    const {
      repository,
      knowledgeBase,
      evidenceEvaluator,
      observer,
      candidateIdentityGrouper: groupCandidateRecords,
      teamRosterEnrichment,
      referenceNameResolver,
    } = context;
    throwIfTurnCancelled(config.signal);
    const action = state.action;
    if (!action || action.action === "ask_user" || action.action === "finish") {
      return { history: [{ role: "tool" as const, toolName: "agent", content: "无效的工具动作。" }] };
    }
    const toolStartedAt = performance.now();
    const progressByTool: Record<ToolActionName, Pick<ProgressUpdate, "stage" | "message">> = {
      search_methodology: { stage: "methodology", message: "正在检索球员角色和评估方法" },
      inspect_team: { stage: "team_sample", message: "正在检查目标球队在数据集中的历史样本" },
      inspect_player: { stage: "player_detail", message: "正在读取候选球员的位置记录和近期表现" },
      inspect_candidate_group: { stage: "player_detail", message: "正在并行比较候选组的位置、表现和进攻参与数据" },
      inspect_match: { stage: "match_detail", message: "正在读取比赛名单与射门记录" },
      search_candidates: { stage: "candidate_search", message: "正在按当前需求搜索候选球员" },
      evaluate_candidates: {
        stage: "player_evaluation",
        message: evidenceEvaluator.availability === "experimentally_withheld"
          ? "实验对照组有意屏蔽候选球员的表现评估证据"
          : "正在计算候选球员的可观察比赛表现",
      },
      search_player_reports: { stage: "report_search", message: "正在检索候选球员的报告资料" },
    };
    emitProgress(config, { ...progressByTool[action.action], completedSteps: state.decisionSteps });
    const completeToolProgress = (message: string, status: RecruitmentProgressEventStatus = "completed") => emitProgress(config, {
      stage: progressByTool[action.action].stage,
      status,
      message,
      completedSteps: state.decisionSteps,
    });
    // Candidate previews let the UI surface search results while the report is still being written.
    const emitCandidatePreview = (candidates: readonly { playerId: string; name: string; team: string; position: string; age: number | null; minutes: number; source: string; competition: string; season: string }[]) => emitCandidatePreviews(
      config,
      candidates.slice(0, 20).map((candidate) => ({
        playerId: candidate.playerId,
        name: candidate.name,
        team: candidate.team,
        position: candidate.position,
        age: candidate.age,
        minutes: candidate.minutes,
        source: candidate.source,
        competition: candidate.competition,
        season: candidate.season,
      })),
      state.decisionSteps,
    );
    const eligibleEvaluatedPlayers = Object.values(evaluatedPlayersForConstraint(state));
    const alreadySearchedReportNames = new Set(state.searchedReportPlayerNames.map(normalizeSearchText));
    const reportNames = action.action === "search_player_reports"
      ? eligibleEvaluatedPlayers
        .map(({ player }) => player.name)
        .filter((name) => !alreadySearchedReportNames.has(normalizeSearchText(name)))
      : [];
    let filters: Record<string, string | number | boolean | null | string[] | string[][]> = {};
    const toolUses = { ...state.toolUses, [action.action]: state.toolUses[action.action] + 1 };
    // Only fixed methodology evidence is reusable. Candidate/roster reads and evaluator
    // cohorts may change; their existing cursor and eligibility policies remain authoritative.
    const methodologyKey = action.action === "search_methodology"
      ? createHash("sha256").update(JSON.stringify([action.query, action.limit])).digest("hex")
      : null;
    const previousResultCount = methodologyKey === null ? undefined : state.successfulMethodologyQueries[methodologyKey];
    if (methodologyReuseEnabled && previousResultCount !== undefined) {
      observer?.({ phase: "tool_reuse", toolName: "search_methodology", resultCount: previousResultCount, reason: "successful_same_turn_query" });
      completeToolProgress(`本轮相同方法查询已完成，沿用已有的 ${previousResultCount} 条资料`);
      return {
        toolUses,
        history: [{ role: "tool", toolName: "search_methodology", content: JSON.stringify({ reused: true, resultCount: previousResultCount, note: "相同查询和数量在本轮已经成功执行，证据仍保留在状态与前面的工具结果中。零命中也是已完成查询；请更改调查方向或依据现有证据继续。" }) }],
      };
    }
    const currentEvaluations = Object.values(evaluatedPlayersForConstraint(state));
    const currentUserMessages = userMessages(state.history);
    const currentCoverage = summarizeRequestedCapabilityCoverage({
      brief: state.brief,
      userMessages: currentUserMessages,
      evaluatedPlayers: currentEvaluations,
      includeAbilityProfiles: state.abilityProfilesEnabled,
      candidateIdentityGroups: state.candidateIdentityGroups,
    });
    const reportCapabilityGaps = action.action === "search_player_reports"
      ? currentCoverage
        .filter((area) => area.status !== "observed")
        .map(({ name }) => name)
      : [];
    const reportPlayerContexts = action.action === "search_player_reports"
      ? currentEvaluations
        .map(({ player }) => player)
        .filter((player) => reportNames.includes(player.name))
        .slice(0, 10)
        .map(({ name: playerName, team, competition, season }) => ({ playerName, team, competition, season }))
        .filter(({ team, competition, season }) => [team, competition, season].every(value => typeof value === "string" && value.trim().length > 0))
      : [];
    const similarityReference = state.brief?.task === "similarity"
      ? state.referenceProfiles.find(profile => profile.abilitySnapshotId && profile.abilityRolePriorities) : undefined;
    const searchIntent = resolvedCandidateSearchIntent(state);
    const toolRequest: RecruitmentToolExecutionRequest = action.action === "search_player_reports"
      ? {
        ...action,
        playerNames: reportNames,
        requestedPlayerCount: reportNames.length,
        ...(reportCapabilityGaps.length && reportPlayerContexts.length ? {
          capabilityGaps: reportCapabilityGaps,
          playerContexts: reportPlayerContexts,
        } : {}),
      }
      : action.action === "evaluate_candidates"
        ? {
          ...action,
          eligiblePlayers: discoveredPlayersForConstraint(state),
          ...(Object.keys(state.understatPlayerResearch).length
            ? { understatResearch: state.understatPlayerResearch }
            : {}),
        }
        : action.action === "search_candidates"
      ? { ...constrainSearchActionToIntent(action, searchIntent),
        ...(similarityReference ? { referenceRoles: { snapshotId: similarityReference.abilitySnapshotId!, values: similarityReference.abilityRolePriorities! } } : {}),
        discoveryMetricGroups: requestedCapabilityEvidenceAreasForInput({ brief: state.brief, userMessages: userMessages(state.history) }, undefined, state.abilityProfilesEnabled).filter(area => area.metricKeys.length > 0).map(area => [...area.metricKeys]) }
          : action.action === "inspect_team"
            ? {
              ...action,
              ...(replacementTargetMention(currentUserMessages) ? {
                referenceMention: [replacementTargetMention(currentUserMessages), state.referenceResolutionQuery]
                  .filter((value): value is string => Boolean(value?.trim())).join(" "),
              } : {}),
              ...(state.referenceNameResolution?.status === "resolved"
                ? { referenceResolutionOverride: state.referenceNameResolution.player }
                : {}),
            }
            : action;
    try {
      const execution = await executeRecruitmentToolAction(toolRequest, {
        repository,
        knowledgeBase,
        evaluator: evidenceEvaluator,
        ...(teamRosterEnrichment ? { teamRosterEnrichment } : {}),
        ...(referenceNameResolver ? { referenceNameResolver } : {}),
        signal: config.signal,
      });
      throwIfTurnCancelled(config.signal);
      const projected = projectToolResult(state, execution, { repository, evidenceAvailability: evidenceEvaluator.availability, groupCandidateRecords });
      filters = projected.filters;
      observer?.({ phase: "tool", toolName: execution.action, elapsedMs: Math.round(performance.now() - toolStartedAt), ok: true, filters: projected.filters, resultCount: projected.resultCount, ...(projected.matchingRecordCount === undefined ? {} : { matchingRecordCount: projected.matchingRecordCount }) });
      completeToolProgress(projected.message);
      if (execution.action === "search_candidates" && projected.update.history?.at(-1)?.role === "tool") {
        const historyPayload = projected.update.history.at(-1)?.content;
        if (typeof historyPayload === "string") {
          try {
            const parsed = JSON.parse(historyPayload) as { candidates?: Array<{
              playerId: string; name: string; team: string; position: string; age: number | null; minutes: number; source: string; competition: string; season: string;
            }> };
            if (Array.isArray(parsed.candidates)) emitCandidatePreview(parsed.candidates);
          } catch {
            // History payload is an internal contract; a preview is optional and must never break the turn.
          }
        }
      }
      return {
        ...projected.update,
        ...(methodologyKey === null ? {} : { successfulMethodologyQueries: { ...state.successfulMethodologyQueries, [methodologyKey]: projected.resultCount } }),
      };
    } catch (error) {
      throwIfTurnCancelled(config.signal);
      if (error instanceof RecruitmentTurnCancelledError) throw error;
      const retryCode = providerErrorCode(error);
      if (retryableReadActions.has(action.action) && (retryCode === "network" || retryCode === "timeout")) {
        throw new TransientRecruitmentReadError();
      }
      const failure = safeToolFailure(error);
      observer?.({
        phase: "tool",
        toolName: action.action,
        elapsedMs: Math.round(performance.now() - toolStartedAt),
        ok: false,
        ...(failure.code ? { errorCode: failure.code } : {}),
        filters,
        resultCount: 0,
      });
      completeToolProgress("这项查询没有成功，Agent 正在判断是否有其他调查路径", "notice");
      const { message, code } = failure;
      return {
        toolUses,
        hasInvestigated: true,
        ...(action.action === "inspect_team" ? { inspectedReferenceMention: normalizeSearchText(replacementTargetMention(currentUserMessages) ?? "") } : {}),
        ...(action.action === "search_methodology" ? { hasSearchedMethodology: true, methodologySearchFailed: true } : {}),
        ...(action.action === "search_player_reports" ? { hasSearchedPlayerReports: true, playerReportSearchFailed: true } : {}),
        ...(action.action === "search_player_reports" ? { searchedReportPlayerNames: reportNames } : {}),
        ...(["fbref", "fpl", "premier_league", "asa", "understat", "mosaic"].includes(repository.mode) && (code === "blocked" || code === "rate_limit")
          ? { sourceAccessFailure: { code, message } }
          : {}),
        ...(action.action === "search_candidates" ? { candidateSearchFailure: failure } : {}),
        history: [{
          role: "tool" as const, toolName: action.action, content: JSON.stringify({
            error: message,
            ...(code ? { errorCode: code } : {}),
          })
        }],
      };
    }
}
