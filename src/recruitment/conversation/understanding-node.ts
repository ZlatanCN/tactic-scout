import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { PlayerRepository } from "../../players/repository.js";
import type { PlayerNameResolver } from "../../players/identity/name-resolver.js";
import type { RecruitmentBriefInterpreter } from "../brief.js";
import { RecruitmentBriefValidationError } from "../brief.js";
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

export function createUnderstandingNode(input: {
  interpreter?: RecruitmentBriefInterpreter;
  repository: PlayerRepository;
  resolver?: PlayerNameResolver;
  observer?: RecruitmentTraceObserver;
  referenceComparisonEnabled?: boolean;
}) {
  return async (state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> => {
    if (!input.interpreter) return {};
    const messages = state.history.filter(entry => entry.role === "user").map(entry => entry.content);
    const latest = messages.at(-1) ?? state.userMessage;
    const structuredAnswer = state.briefAnswerKind !== null;
    let brief = state.brief;
    if (state.briefInterpretedThrough !== messages.length && !structuredAnswer) {
      emitProgress(config, { stage: "understanding", message: "正在理解你的找人需求", completedSteps: 0 });
      const startedAt = performance.now();
      try {
        brief = await input.interpreter.interpret({ message: latest, previous: brief, recentMessages: messages.slice(0, -1), visibleCandidates: state.briefCandidates,
          ...(state.briefQuestionContext ? { clarificationQuestion: state.briefQuestionContext } : {}), signal: config.signal,
          onUsage: usage => input.observer?.({ phase: "brief_usage", outcome: "response", elapsedMs: performance.now() - startedAt, ...usage }) });
        emitProgress(config, { stage: "understanding", status: "completed", message: brief.task === "similarity" ? "已理解：以参考球员的特点寻找相似人选" : brief.task === "replacement" ? "已理解：寻找能承担参考职责的替代者" : "已理解：按位置与能力特点寻找人选", completedSteps: 0 });
      } catch (error) {
        throwIfTurnCancelled(config.signal);
        input.observer?.({ phase: "brief_failure", failureKind: error instanceof Error ? error.name : "unknown",
          ...(error instanceof z.ZodError ? { issuePaths: error.issues.map(issue => issue.path.join(".")) } : {}),
          ...(error instanceof RecruitmentBriefValidationError ? { validationFailure: error.message } : {}) });
        return { briefFailure: "这次没能完成需求理解，调查尚未开始。原始输入已保留，可以直接重试。",
          briefFailureKind: error instanceof Error ? error.name : "unknown", briefInterpretedThrough: messages.length };
      }
    }
    throwIfTurnCancelled(config.signal);
    if (!brief) return { briefInterpretedThrough: messages.length };
    if (state.briefAnswerKind === "identity_reject") {
      brief = { ...brief, referenceRecheck: { quote: latest, reject: true }, selectedCandidateId: null };
    }
    if (state.briefAnswerKind === "positions") brief = { ...brief, positions: [...state.confirmedPositions], unresolved: brief.unresolved.filter(item => item.topic !== "position") };
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
    const scopeChanged = changed || JSON.stringify(brief) !== JSON.stringify(state.brief);
    const update: Partial<State> = {
      brief, briefFailure: null, briefFailureKind: null, briefAnswerKind: null, briefInterpretedThrough: messages.length,
      rejectedReferenceIds: excludedIds, rejectedReferenceRecordIds: excludedRecordIds,
      referenceCandidatesBeforeAnswer: [],
      targetTeam: brief.targetTeam?.value ?? null,
      confirmedPosition: brief.positions[0] ?? null,
      confirmedPositions: brief.positions.flatMap(position => { const parsed = SelectablePositionSchema.safeParse(position); return parsed.success ? [parsed.data] : []; }),
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
      input.resolver?.rememberConfirmation?.(mention, state.referenceNameResolution.player, identityContext);
    }
    if (!changed && !identityCluesChanged && !recheck && state.referenceNameResolution?.status === "resolved" && state.inspectedReferenceMention === normalizeSearchText(mention) && !state.referenceResolutionQuery) {
      return { ...update, brief: { ...brief, unresolved: brief.unresolved.filter(item => item.topic !== "identity" && !(item.topic === "position" && state.replacementReferencePosition)) } };
    }
    emitProgress(config, { stage: "reference_identity", message: `正在确认“${mention}”并读取参考画像`, completedSteps: 0 });
    const selectedPlayer = brief.selectedCandidateId && !recheck ? state.evaluatedPlayers[brief.selectedCandidateId]?.player ?? state.discoveredPlayers[brief.selectedCandidateId] : undefined;
    const resolution = selectedPlayer ? null : !changed && !identityCluesChanged && !recheck && state.referenceNameResolution?.status === "resolved" ? state.referenceNameResolution
      : input.resolver ? await input.resolver(mention, config.signal, identityContext) : null;
    throwIfTurnCancelled(config.signal);
    const names = selectedPlayer ? [selectedPlayer.name, ...(selectedPlayer.abilityProfile?.aliases ?? [])] : resolution?.status === "resolved" ? resolution.player.names : resolution ? [] : [mention];
    let players: PlayerProfile[] = selectedPlayer ? [selectedPlayer] : names.length && input.repository.findLocalPlayersByNames
      ? await input.repository.findLocalPlayersByNames(names, config.signal) : [];
    if (!selectedPlayer && names.length && input.repository.findPlayersByNames) {
      try { players = await input.repository.findPlayersByNames(names, config.signal); }
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
