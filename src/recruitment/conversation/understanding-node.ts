import type { LangGraphRunnableConfig, Runtime } from "@langchain/langgraph";
import type { PlayerRepository } from "../../players/repository.js";
import type { PlayerNameResolver } from "../../players/identity/name-resolver.js";
import type { RecruitmentBriefInterpreter } from "../brief.js";
import { RecruitmentBriefOutputLimitError, RecruitmentBriefValidationError } from "../brief.js";
import { projectRecentRecruitmentDialogue, projectRecruitmentHistory, RecruitmentContextCapacityError, selectTransmittedHistoryEventIds } from "../context.js";
import { normalizeSearchText } from "../../domain/text-matching.js";
import { createReferencePlayerProfiles, resolveReplacementReferencePosition } from "../recruitment-comparison.js";
import { throwIfTurnCancelled } from "../turn-cancellation.js";
import { emitProgress } from "./progress.js";
import type { State } from "./state.js";
import { compareWithReference, referenceComparisonEvidence } from "../reference-similarity.js";
import type { RecruitmentTraceObserver } from "./contracts.js";
import { SelectablePositionSchema } from "../../domain/position-contracts.js";
import { z } from "zod/v4";
import { identityRecordKey } from "../../players/identity/player-identity-resolver.js";
import type { PlayerProfile } from "../../domain/players.js";
import { resolvedCandidateSearchIntent, sameCandidateSearchScope } from "./candidate-context.js";
import { type RecruitmentRuntimeContext, requireRecruitmentRuntimeContext } from "./runtime-context.js";
import { compileRecruitmentCriteria } from "../criterion-compiler.js";
import { ModelAttemptBudgetExceededError } from "../chat-model.js";

function safeFailureMetadata(error: unknown): { failureCode?: string; failureStatus?: number } {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const record = current as { code?: unknown; status?: unknown; cause?: unknown };
    if (typeof record.code === "string" && /^[A-Z0-9_-]{1,40}$/i.test(record.code)) {
      return { failureCode: record.code };
    }
    if (typeof record.status === "number" && Number.isInteger(record.status) && record.status >= 100 && record.status <= 599) {
      return { failureStatus: record.status };
    }
    current = record.cause;
  }
  return {};
}

export function createUnderstandingNode(input: {
  referenceComparisonEnabled?: boolean;
}) {
  return async (state: State, runtime: Runtime<RecruitmentRuntimeContext>): Promise<Partial<State>> => {
    const context = requireRecruitmentRuntimeContext(runtime.context);
    const config = runtime as LangGraphRunnableConfig;
    if (!context.briefInterpreter) return {};
    const messages = state.history.filter(entry => entry.role === "user").map(entry => entry.content);
    const latest = messages.at(-1) ?? state.userMessage;
    const caseId = typeof config.configurable?.thread_id === "string" ? config.configurable.thread_id : "";
    const protectedQuotes = [
      state.brief?.targetTeam?.quote,
      state.brief?.referencePlayer?.quote,
      ...(state.brief?.referenceClues?.map(clue => clue.quote) ?? []),
      ...(state.brief?.criteria.map(criterion => criterion.quote) ?? []),
    ].filter((quote): quote is string => Boolean(quote));
    const historyProjection = projectRecruitmentHistory(state.history, {
      caseId,
      recentUserTurns: 3,
      protectedQuotes,
    });
    const recentDialogue = projectRecentRecruitmentDialogue(historyProjection.entries, 3);
    const clarificationQuestionEventId = state.briefQuestionContext
      ? historyProjection.entries.flatMap(entry => {
          if (entry.role !== "assistant" || !entry.eventId) return [];
          try {
            const action = JSON.parse(entry.content) as { action?: unknown; question?: unknown };
            return action.action === "ask_user" && action.question === state.briefQuestionContext ? [entry.eventId] : [];
          } catch { return []; }
        }).at(-1)
      : undefined;
    const latestUserEventId = historyProjection.entries
      .filter(entry => entry.role === "user" && entry.content === latest)
      .at(-1)?.eventId;
    const includedHistoryEventIds = selectTransmittedHistoryEventIds({
      retainedEventIds: historyProjection.manifest.includedEventIds,
      projectedDialogueEventIds: recentDialogue.flatMap(entry => entry.eventId ? [entry.eventId] : []),
      protectedQuoteEventIds: historyProjection.manifest.protectedQuoteReferences.map(reference => reference.eventId),
      ...(latestUserEventId ? { currentMessageEventId: latestUserEventId } : {}),
      ...(clarificationQuestionEventId ? { clarificationQuestionEventId } : {}),
    });
    const includedHistoryEventIdSet = new Set(includedHistoryEventIds);
    const omittedHistoryEventIds = [
      ...historyProjection.manifest.omittedEventIds,
      ...historyProjection.manifest.includedEventIds.filter(eventId => !includedHistoryEventIdSet.has(eventId)),
    ];
    const structuredAnswer = state.briefAnswerKind !== null;
    let brief = state.brief;
    const reuseValidatedBrief = !structuredAnswer && state.reportFollowupContext !== null;
    if (reuseValidatedBrief) {
      emitProgress(config, {
        stage: "understanding",
        status: "started",
        message: "正在沿用已确认的找人条件，整理本轮报告问题",
        completedSteps: 0,
      });
      emitProgress(config, {
        stage: "understanding",
        status: "completed",
        message: "已沿用确认过的找人条件，继续整理这次报告问题",
        completedSteps: 0,
      });
    }
    if (state.briefInterpretedThrough !== messages.length && !structuredAnswer && !reuseValidatedBrief) {
      emitProgress(config, { stage: "understanding", message: "正在理解你的找人需求", completedSteps: 0 });
      const startedAt = performance.now();
      try {
        brief = await context.briefInterpreter.interpret({ message: latest, previous: brief,
          recentMessages: messages.slice(0, -1).slice(-3),
          recentDialogue,
          validationMessages: messages, visibleCandidates: state.briefCandidates,
          contextRevision: JSON.stringify([config.configurable?.thread_id ?? null, messages.length, brief]),
          protectedQuoteReferences: historyProjection.manifest.protectedQuoteReferences,
          includedHistoryEventIds,
          omittedHistoryEventIds,
          ...(latestUserEventId ? { currentMessageEventId: latestUserEventId } : {}),
          ...(clarificationQuestionEventId ? { clarificationQuestionEventId } : {}),
          ...(state.briefQuestionContext ? { clarificationQuestion: state.briefQuestionContext } : {}), signal: config.signal,
          onUsage: usage => context.observer?.({ phase: "brief_usage", outcome: usage.outcome ?? "response", elapsedMs: performance.now() - startedAt, ...usage }),
          onModelRetry: ({ attempt, maxRetries, reason }) => {
            const cause = reason === "rate_limit" ? "模型服务正在限流" : reason === "request_timeout" ? "模型服务响应超时" : reason === "server_error" ? "模型服务暂时异常" : "模型连接中断";
            emitProgress(config, { stage: "understanding", status: "notice", message: `${cause}，系统自动重试（${attempt}/${maxRetries}）`, completedSteps: 0 });
          },
          onContextCompaction: status => emitProgress(config, {
            stage: "context_compaction",
            status,
            message: status === "started" ? "正在整理较早的对话内容，保留本轮需求与已确认条件" : "对话整理完成，继续本轮调查",
            completedSteps: 0,
          }) });
        emitProgress(config, { stage: "understanding", status: "completed", message: brief.task === "similarity" ? "已理解：以参考球员的特点寻找相似人选" : brief.task === "replacement" ? "已理解：寻找能承担参考职责的替代者" : "已理解：按位置与能力特点寻找人选", completedSteps: 0 });
      } catch (error) {
        throwIfTurnCancelled(config.signal);
        const issuePaths = error instanceof z.ZodError
          ? [...new Set(error.issues.map(issue => issue.path.length ? issue.path.join(".") : "root"))].slice(0, 5)
          : [];
        const issueSummary = issuePaths.length ? `（字段：${issuePaths.join("、")}）` : "";
        context.observer?.({ phase: "brief_failure", failureKind: error instanceof Error ? error.name : "unknown",
          ...safeFailureMetadata(error),
          ...(error instanceof RecruitmentBriefOutputLimitError ? { outputLimitTokens: error.maxOutputTokens } : {}),
          ...(error instanceof RecruitmentBriefValidationError ? { validationCode: error.validationCode } : {}),
          ...(issuePaths.length ? { issuePaths } : {}),
        });
        const failureMessage = error instanceof RecruitmentBriefOutputLimitError
          ? `模型在 ${error.maxOutputTokens} 个输出 token 的预算内未能完成需求解析，调查尚未开始。原始输入已保留，可以重试。`
          : error instanceof ModelAttemptBudgetExceededError ? "需求理解达到本轮模型请求上限，自动重试已停止；调查尚未开始。原始输入已保留，可以稍后重试。"
          : error instanceof RecruitmentContextCapacityError ? error.message
            : `这次没能完成需求理解${issueSummary}，调查尚未开始。原始输入已保留，可以直接重试。`;
        emitProgress(config, { stage: "understanding", status: "failed", message: `需求理解未完成${issueSummary}，原始输入已保留，可以重试`, completedSteps: 0 });
        return { briefFailure: failureMessage,
          briefFailureKind: error instanceof Error ? error.name : "unknown", briefInterpretedThrough: messages.length };
      }
    }
    throwIfTurnCancelled(config.signal);
    if (!brief) return { briefInterpretedThrough: messages.length };
    if (state.briefAnswerKind === "identity_reject") {
      brief = { ...brief, referenceRecheck: { quote: latest, reject: true }, selectedCandidateId: null };
    }
    if (state.briefAnswerKind === "positions") {
      const positionCriterion = state.confirmedPositions.length ? [{
        field: "position" as const,
        operator: "in" as const,
        value: [...state.confirmedPositions],
        unit: null,
        attributeKey: null,
        strength: "required" as const,
        basis: "explicit" as const,
        quote: latest,
      }] : [];
      brief = { ...brief,
        criteria: [...brief.criteria.filter(item => item.field !== "position"), ...positionCriterion],
        unresolved: brief.unresolved.filter(item => item.topic !== "position"),
      };
    }
    const mention = brief.referencePlayer?.value;
    const recheck = brief.referenceRecheck;
    if (recheck) brief = { ...brief, referenceRecheck: undefined, selectedCandidateId: null };
    const changed = (!recheck && brief.selectedCandidateId !== state.brief?.selectedCandidateId) || normalizeSearchText(mention ?? "") !== normalizeSearchText(state.brief?.referencePlayer?.value ?? "");
    const identityCluesChanged = JSON.stringify(brief.referenceClues ?? []) !== JSON.stringify(state.brief?.referenceClues ?? []);
    const priorResolution = state.referenceNameResolution;
    const priorCandidates = priorResolution?.status === "resolved" ? [priorResolution.player]
      : priorResolution?.status === "ambiguous" || priorResolution?.status === "needs_confirmation" ? priorResolution.candidates : state.referenceCandidatesBeforeAnswer ?? [];
    const rejected = !changed && recheck?.reject ? priorCandidates : [];
    const excludedIds = changed ? [] : [...new Set([...(state.rejectedReferenceIds ?? []), ...rejected.map(candidate => candidate.entityId)])];
    const excludedRecordIds = changed ? [] : [...new Set([...(state.rejectedReferenceRecordIds ?? []), ...rejected.flatMap(candidate => candidate.recordIds ?? [])])];
    const scopeChanged = changed || !sameCandidateSearchScope(
      resolvedCandidateSearchIntent(state),
      resolvedCandidateSearchIntent({ ...state, brief }),
    );
    const compiledCriteria = compileRecruitmentCriteria(brief, { abilityProfilesEnabled: context.repository.supportsAbilityProfiles ?? false });
    const update: Partial<State> = {
      brief, briefFailure: null, briefFailureKind: null, briefAnswerKind: null, briefInterpretedThrough: messages.length,
      rejectedReferenceIds: excludedIds, rejectedReferenceRecordIds: excludedRecordIds,
      referenceCandidatesBeforeAnswer: [],
      targetTeam: brief.targetTeam?.value ?? null,
      confirmedPosition: compiledCriteria.positions[0] ?? null,
      confirmedPositions: compiledCriteria.positions.flatMap(position => { const parsed = SelectablePositionSchema.safeParse(position); return parsed.success ? [parsed.data] : []; }),
      ...(scopeChanged ? { candidateSearchScopeChanged: true, confirmedPositionSearchObservationIndex: null } : {}),
      ...(changed || identityCluesChanged || recheck ? { referenceNameResolution: null, referenceProfiles: [], replacementReferencePosition: null,
        inspectedReferenceMention: null, referenceResolutionQuery: null,
        candidateSearchScopeChanged: true, confirmedPositionSearchObservationIndex: null } : {}),
    };
    if (!mention) return update;
    const identityContext = { scopeId: String(config.configurable?.thread_id ?? ""), clues: brief.referenceClues ?? [], forceRecheck: Boolean(recheck),
      excludedIds, excludedRecordIds,
      ...(recheck || state.referenceResolutionQuery ? { queryHint: recheck?.quote ?? state.referenceResolutionQuery! } : {}) };
    if (state.briefAnswerKind === "identity" && state.referenceNameResolution?.status === "resolved") {
      context.referenceNameResolver?.rememberConfirmation?.(mention, state.referenceNameResolution.player, identityContext);
    }
    if (!changed && !identityCluesChanged && !recheck && state.referenceNameResolution?.status === "resolved" && state.inspectedReferenceMention === normalizeSearchText(mention) && !state.referenceResolutionQuery) {
      return { ...update, brief: { ...brief, unresolved: brief.unresolved.filter(item => item.topic !== "identity" && !(item.topic === "position" && state.replacementReferencePosition)) } };
    }
    emitProgress(config, { stage: "reference_identity", message: `正在确认“${mention}”并读取参考画像`, completedSteps: 0 });
    const selectedPlayer = brief.selectedCandidateId && !recheck ? state.evaluatedPlayers[brief.selectedCandidateId]?.player ?? state.discoveredPlayers[brief.selectedCandidateId] : undefined;
    const resolution = selectedPlayer ? null : !changed && !identityCluesChanged && !recheck && state.referenceNameResolution?.status === "resolved" ? state.referenceNameResolution
      : context.referenceNameResolver ? await context.referenceNameResolver(mention, config.signal, identityContext) : null;
    throwIfTurnCancelled(config.signal);
    const names = selectedPlayer ? [selectedPlayer.name, ...(selectedPlayer.abilityProfile?.aliases ?? [])] : resolution?.status === "resolved" ? resolution.player.names : resolution ? [] : [mention];
    let players: PlayerProfile[] = selectedPlayer ? [selectedPlayer] : names.length && context.repository.findLocalPlayersByNames
      ? await context.repository.findLocalPlayersByNames(names, config.signal) : [];
    if (!selectedPlayer && names.length && context.repository.findPlayersByNames) {
      try { players = await context.repository.findPlayersByNames(names, config.signal); }
      catch { throwIfTurnCancelled(config.signal); /* Offline profiles remain usable during optional remote enrichment failure. */ }
    }
    if (!selectedPlayer && resolution?.status === "resolved" && resolution.player.recordIds !== undefined) {
      players = players.filter(player => resolution.player.recordIds!.includes(identityRecordKey(player)));
    }
    throwIfTurnCancelled(config.signal);
    const profiles = referenceComparisonEvidence(createReferencePlayerProfiles(players, [], names).map(profile =>
      resolution?.status === "resolved" ? { ...profile, name: resolution.player.preferredName } : profile), input.referenceComparisonEnabled !== false);
    const position = resolveReplacementReferencePosition({ players, rosterContext: null, userMessages: [], referenceNames: names });
    // Entity lookup owns identity questions, including its verified option picker.
    // A model's request to perform that lookup is not a question for the user.
    brief = { ...brief, unresolved: brief.unresolved.filter(item => item.topic !== "identity" && !(item.topic === "position" && position)) };
    emitProgress(config, { stage: "reference_identity", status: "completed", message: profiles.length
      ? `已读取${profiles[0]!.name}的参考资料，接下来寻找可比较的球员`
      : resolution?.status === "resolved" ? "已确认球员身份，当前资料中没有可用画像" : "参考球员身份需要进一步确认", completedSteps: 0 });
    return { ...update, brief, referenceComparisonEnabled: input.referenceComparisonEnabled !== false, referenceNameResolution: resolution, referenceResolutionQuery: null,
      referenceProfiles: profiles, replacementReferencePosition: position,
      evaluatedPlayers: Object.fromEntries(Object.entries(state.evaluatedPlayers).map(([id, candidate]) => [id,
        { ...candidate, referenceSimilarity: brief.task === "similarity" ? compareWithReference(candidate, profiles) : undefined }])),
      inspectedReferenceMention: normalizeSearchText(mention),
      history: [{ role: "tool", toolName: "reference_profile", content: JSON.stringify({
        task: brief.task, mention, referenceNameResolution: resolution, referenceProfiles: profiles,
        referencePosition: position, note: "参考资料用于比较与排除本人；目标球队可空，不得编造当前球队或缺失表现。",
      }) }],
    };
  };
}
