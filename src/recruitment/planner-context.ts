import { type CapabilityEvidence, type CapabilityMetricKey, type RequestedCapabilityCoverage } from "../domain/capabilities.js";
import { AbilityMetricDefinitions } from "../domain/player-abilities.js";
import type { EvaluatedCandidate } from "./recruitment-evidence-evaluator.js";
import type { CandidateIdentityGroupReference } from "../players/identity/candidate-groups.js";

export interface ConversationHistoryEntry {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  /** Added to model-facing history views; never required in persisted checkpoints. */
  eventId?: string;
}

export interface ConclusionCandidateEvidence {
  candidateCount: number;
  metricDefinitions: Array<{ key: CapabilityMetricKey; label: string; unit: string }>;
  candidates: Array<Record<string, unknown> & { playerId: string }>;
}

export interface SelectedDocumentExcerpt {
  text: string;
  startOffset: number;
  endOffset: number;
  sourceCharacters: number;
  strategy: "complete" | "relevance_window" | "opening_fallback";
  completeSentences: boolean;
}

/**
 * Keep a contiguous passage from a retrieved document chunk. Prefer complete
 * sentences matching the result's capability gaps or entity context; the
 * opening is only a fallback when the chunk carries no usable relevance terms.
 */
export function selectRelevantDocumentExcerpt(
  document: { text: string; title?: string; entityNames?: readonly string[]; matchedCapabilityGaps?: readonly string[] },
  maxCharacters = 900,
): SelectedDocumentExcerpt {
  const { text } = document;
  const limit = Math.max(1, Math.floor(maxCharacters));
  if (text.length <= limit) {
    return { text, startOffset: 0, endOffset: text.length, sourceCharacters: text.length, strategy: "complete", completeSentences: isSentenceAligned(text, 0, text.length) };
  }

  const sentences = sentenceRanges(text);
  const gapTerms = relevanceTerms(document.matchedCapabilityGaps ?? []);
  const contextTerms = relevanceTerms([document.title ?? "", ...(document.entityNames ?? [])]);
  const ranked = sentences.map((sentence, index) => ({
    ...sentence,
    index,
    score: scoreSentence(sentence.text, gapTerms, 5) + scoreSentence(sentence.text, contextTerms, 1),
  }));
  const best = ranked.reduce<(typeof ranked)[number] | undefined>((current, sentence) => {
    if (!current || sentence.score > current.score) return sentence;
    if (sentence.score === current.score
      && hasCounterevidenceSignal(sentence.text)
      && !hasCounterevidenceSignal(current.text)) return sentence;
    return current;
  }, undefined);

  if (best && best.score > 0) {
    if (best.end - best.start > limit) {
      const matchingTerm = [...gapTerms, ...contextTerms].find(term => normalizeExcerptText(text.slice(best.start, best.end)).includes(term.value));
      const rawMatch = matchingTerm?.raw ? text.toLocaleLowerCase().indexOf(matchingTerm.raw.toLocaleLowerCase(), best.start) : -1;
      const center = rawMatch >= best.start && rawMatch < best.end ? rawMatch + matchingTerm!.raw.length / 2 : (best.start + best.end) / 2;
      const startOffset = Math.max(best.start, Math.min(best.end - limit, Math.floor(center - limit / 2)));
      const endOffset = Math.min(text.length, startOffset + limit);
      return { text: text.slice(startOffset, endOffset), startOffset, endOffset, sourceCharacters: text.length, strategy: "relevance_window", completeSentences: false };
    }

    let first = best.index;
    let last = best.index;
    while (true) {
      const left = ranked[first - 1];
      const right = ranked[last + 1];
      const leftFits = Boolean(left && ranked[last]!.end - left.start <= limit);
      const rightFits = Boolean(right && right.end - ranked[first]!.start <= limit);
      if (!leftFits && !rightFits) break;
      if (leftFits && rightFits) {
        if (right!.score > left!.score) last += 1;
        else first -= 1;
      } else if (leftFits) first -= 1;
      else last += 1;
    }
    const startOffset = ranked[first]!.start;
    const endOffset = ranked[last]!.end;
    return { text: text.slice(startOffset, endOffset), startOffset, endOffset, sourceCharacters: text.length, strategy: "relevance_window", completeSentences: isSentenceAligned(text, startOffset, endOffset) };
  }

  let endOffset = 0;
  for (const sentence of sentences) {
    if (sentence.end > limit) break;
    endOffset = sentence.end;
  }
  if (endOffset > 0) {
    return { text: text.slice(0, endOffset), startOffset: 0, endOffset, sourceCharacters: text.length, strategy: "opening_fallback", completeSentences: isSentenceAligned(text, 0, endOffset) };
  }
  return { text: text.slice(0, limit), startOffset: 0, endOffset: limit, sourceCharacters: text.length, strategy: "opening_fallback", completeSentences: false };
}

interface TextRange { start: number; end: number; text: string }
interface RelevanceTerm { value: string; raw: string }

function sentenceRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  const boundary = /[.!?。！？]+|\n+/gu;
  let start = 0;
  for (const match of text.matchAll(boundary)) {
    const rawEnd = match.index! + match[0].length;
    const range = trimTextRange(text, start, rawEnd);
    if (range) ranges.push(range);
    start = rawEnd;
  }
  const tail = trimTextRange(text, start, text.length);
  if (tail) ranges.push(tail);
  return ranges;
}

function trimTextRange(text: string, start: number, end: number): TextRange | null {
  while (start < end && /\s/u.test(text[start]!)) start += 1;
  while (end > start && /\s/u.test(text[end - 1]!)) end -= 1;
  return start < end ? { start, end, text: text.slice(start, end) } : null;
}

function isSentenceAligned(text: string, start: number, end: number): boolean {
  const leftBoundary = start === 0 || /[.!?。！？\n]\s*$/u.test(text.slice(0, start));
  const rightBoundary = /[.!?。！？]\s*$/u.test(text.slice(0, end))
    || (end < text.length && /^\s*\n/u.test(text.slice(end)));
  return leftBoundary && rightBoundary;
}

function relevanceTerms(values: readonly string[]): RelevanceTerm[] {
  const terms = new Map<string, RelevanceTerm>();
  const add = (raw: string) => {
    const value = normalizeExcerptText(raw);
    if (value.length >= 2 && !terms.has(value)) terms.set(value, { value, raw });
  };
  for (const raw of values) {
    add(raw);
    for (const match of raw.matchAll(/[\p{Script=Latin}\p{N}]{3,}|[\p{Script=Han}]{2,}/gu)) {
      const token = match[0];
      if (/^[\p{Script=Han}]+$/u.test(token) && [...token].length > 2) {
        const characters = [...token];
        for (let index = 0; index < characters.length - 1; index++) add(characters.slice(index, index + 2).join(""));
      } else add(token);
    }
  }
  return [...terms.values()];
}

function normalizeExcerptText(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function scoreSentence(sentence: string, terms: readonly RelevanceTerm[], weight: number): number {
  const normalized = normalizeExcerptText(sentence);
  return terms.reduce((score, term) => normalized.includes(term.value) ? score + weight + Math.min(8, term.value.length) / 8 : score, 0);
}

function hasCounterevidenceSignal(sentence: string): boolean {
  return /\b(?:although|but|despite|failed|fails|failure|however|struggles?|unable|weakness|yet)\b|不过|但是|然而|未能|难以|不足|失败|失误|暴露/iu.test(sentence);
}

/** Keep exact, resolved source records for one player inside the same comparison batch. */
export function partitionConclusionCandidatesByIdentity<T extends { playerId: string }>(
  candidates: readonly T[],
  identityGroups: readonly CandidateIdentityGroupReference[] = [],
  maxBatches = 5,
): T[][] {
  const identityKeyFor = (playerId: string) => identityGroups
    .find(group => group.status === "resolved" && group.recordPlayerIds.includes(playerId))?.identityKey
    ?? `record:${playerId}`;
  const grouped = new Map<string, T[]>();
  for (const candidate of candidates) {
    const key = identityKeyFor(candidate.playerId);
    const group = grouped.get(key) ?? [];
    group.push(candidate);
    grouped.set(key, group);
  }
  const identityGroupsInOrder = [...grouped.values()];
  if (!identityGroupsInOrder.length) return [];
  const batchCount = Math.min(maxBatches, identityGroupsInOrder.length, Math.max(2, Math.ceil(candidates.length / 12)));
  const batches = Array.from({ length: batchCount }, () => [] as T[]);
  const batchSizes = Array.from({ length: batchCount }, () => 0);
  const largestGroupsFirst = identityGroupsInOrder
    .map((group, order) => ({ group, order }))
    .sort((left, right) => right.group.length - left.group.length || left.order - right.order);
  for (const { group } of largestGroupsFirst) {
    const targetBatch = batchSizes.indexOf(Math.min(...batchSizes));
    batches[targetBatch]!.push(...group);
    batchSizes[targetBatch] = batchSizes[targetBatch]! + group.length;
  }
  return batches.filter(batch => batch.length > 0);
}

/** Keep only already-observed tool evidence that belongs to one conclusion batch. */
export function projectConclusionHistoryForBatch(
  history: readonly ConversationHistoryEntry[],
  input: { candidateIds: ReadonlySet<string>; candidateNames: ReadonlySet<string>; documentIds: ReadonlySet<string> },
): ConversationHistoryEntry[] {
  return history.flatMap(entry => {
    if (entry.role !== "tool") return [{ ...entry }];
    if (entry.toolName === "evaluate_candidates" || entry.toolName === "search_candidates") {
      try {
        const result = JSON.parse(entry.content) as Record<string, unknown>;
        const field = entry.toolName === "evaluate_candidates" ? "evaluations" : "candidates";
        const rows = Array.isArray(result[field]) ? result[field] as Array<Record<string, unknown>> : [];
        return [{ ...entry, content: JSON.stringify({
          ...result,
          [field]: rows.filter(row => typeof row.playerId === "string" && input.candidateIds.has(row.playerId)),
        }) }];
      } catch {
        return [{ ...entry, content: "候选评估记录按本批候选范围筛选；只使用本批精简指标目录。" }];
      }
    }
    if (entry.toolName === "search_player_reports") {
      try {
        const result = JSON.parse(entry.content) as Record<string, unknown> & { results?: Array<Record<string, unknown>>; searchedPlayerNames?: string[] };
        return [{ ...entry, content: JSON.stringify({
          ...result,
          ...(result.searchedPlayerNames ? { searchedPlayerNames: result.searchedPlayerNames.filter(name => input.candidateNames.has(name)) } : {}),
          results: (result.results ?? []).filter(document => typeof document.id === "string" && input.documentIds.has(document.id)),
        }) }];
      } catch {
        return [{ ...entry, content: "球员报告按本批候选范围筛选；无可读取报告正文。" }];
      }
    }
    return [{ ...entry }];
  });
}

/** Keep only the latest page observation needed to decide whether expansion can continue. */
export function projectPlannerCaseProgress(
  decisionMode: string | undefined,
  caseProgress: unknown,
): unknown {
  if (decisionMode !== "expand" && decisionMode !== "expand_recovery") return caseProgress;
  if (!caseProgress || typeof caseProgress !== "object" || Array.isArray(caseProgress)) return caseProgress;

  const progress = caseProgress as Record<string, unknown>;
  const pages = Array.isArray(progress.currentTurnCandidatePages) ? progress.currentTurnCandidatePages : [];
  const latestPage = pages.at(-1);
  return {
    ...(typeof progress.discoveredCandidateCount === "number" ? { discoveredCandidateCount: progress.discoveredCandidateCount } : {}),
    ...(latestPage && typeof latestPage === "object" && !Array.isArray(latestPage) ? { currentTurnCandidatePages: [latestPage] } : {}),
  };
}

/** Keep expand decisions tied to the full assessed pool without repeating unrelated metrics. */
export function buildExpansionCandidateEvidence(
  candidates: readonly {
    playerId: string;
    evidenceKeys: readonly CapabilityMetricKey[];
    footballManager?: { currentAbility: number | null; potentialAbility: number | null; snapshotDate: string };
  }[],
  requestedMetricKeys: readonly CapabilityMetricKey[],
) {
  const requested = new Set(requestedMetricKeys);
  const projected = candidates.flatMap(candidate => {
    const evidenceKeys = requested.size
      ? candidate.evidenceKeys.filter(key => requested.has(key))
      : [...candidate.evidenceKeys];
    return evidenceKeys.length || !requested.size ? [{
      playerId: candidate.playerId,
      evidenceKeys,
      ...(candidate.footballManager ? { footballManager: candidate.footballManager } : {}),
    }] : [];
  });
  return {
    evaluatedCandidateCount: candidates.length,
    requestedMetricKeys: [...requested],
    candidatesWithRequestedEvidenceCount: requested.size ? projected.length : null,
    candidates: projected,
  };
}

/**
 * A conclusion-stage view of the authoritative evaluator state. It keeps every
 * eligible candidate, but only the metrics the current brief asks the Planner
 * to compare. Detailed evidence remains in State.
 */
export function buildConclusionCandidateEvidence(
  candidates: readonly EvaluatedCandidate[],
  requestedMetricKeys: readonly CapabilityMetricKey[],
): ConclusionCandidateEvidence {
  const requested = new Set(requestedMetricKeys);
  const metricDefinitionByKey = new Map<CapabilityMetricKey, { key: CapabilityMetricKey; label: string; unit: string }>();
  for (const candidate of candidates) {
    for (const metric of candidate.evidence) {
      if (!requested.has(metric.key) || metricDefinitionByKey.has(metric.key)) continue;
      metricDefinitionByKey.set(metric.key, { key: metric.key, label: metric.label, unit: metric.unit });
    }
  }
  const requestedRoles = new Set<string>(AbilityMetricDefinitions
    .filter(definition => requested.has(definition.key))
    .map(definition => definition.role));
  return {
    candidateCount: candidates.length,
    metricDefinitions: [...metricDefinitionByKey.values()],
    candidates: candidates.map(({ player, evidence, referenceSimilarity, roleFits }) => {
      const requestedRoleFits = roleFits?.filter(roleFit => requestedRoles.has(roleFit.role));
      return {
        playerId: player.playerId,
        name: player.name,
        position: player.position,
        ...(player.age === undefined ? {} : { age: player.age }),
        competition: player.competition,
        season: player.season,
        minutes: player.minutes,
        source: player.source,
        ...(player.abilityProfile && (player.abilityProfile.currentAbility !== null || player.abilityProfile.potentialAbility !== null)
          ? { footballManager: {
            currentAbility: player.abilityProfile.currentAbility,
            potentialAbility: player.abilityProfile.potentialAbility,
            snapshotDate: player.abilityProfile.inGameDate,
          } }
          : {}),
        ...(referenceSimilarity ? { referenceSimilarity } : {}),
        metrics: evidence.filter(metric => requested.has(metric.key)).map(metric => conclusionMetric(metric, player)),
        ...(requestedRoleFits?.length ? { roleFits: requestedRoleFits } : {}),
      };
    }),
  };
}

function conclusionMetric(metric: CapabilityEvidence, player: EvaluatedCandidate["player"]) {
  return {
    key: metric.key,
    value: metric.value,
    ...(metric.basis ? { basis: metric.basis } : {}),
    peerPercentile: metric.peerPercentile,
    peerGroupSize: metric.peerGroupSize,
    ...(metric.peerPercentileUnavailableReason ? { peerPercentileUnavailableReason: metric.peerPercentileUnavailableReason } : {}),
    ...(metric.minutes === player.minutes ? {} : { sampleMinutes: metric.minutes }),
    ...(metric.sampleMatches === undefined ? {} : { sampleMatches: metric.sampleMatches }),
    ...(metric.sampleAttempts === undefined ? {} : { sampleAttempts: metric.sampleAttempts }),
    ...(metric.sampleAttemptsLabel === undefined ? {} : { sampleAttemptsLabel: metric.sampleAttemptsLabel }),
    ...(metric.competition === player.competition ? {} : { competition: metric.competition }),
    ...(metric.season === player.season ? {} : { season: metric.season }),
    ...(metric.source === player.source ? {} : { source: metric.source }),
  };
}

/** Embed structured tool results directly instead of escaping JSON inside JSON. */
export function structuredPlannerHistory(history: readonly ConversationHistoryEntry[]) {
  return history.map((entry) => {
    if (entry.role === "user") return entry;
    try {
      const content: unknown = JSON.parse(entry.content);
      if (content !== null && typeof content === "object") return { ...entry, content };
    } catch {
      // Policy notices and incomplete payloads remain verbatim.
    }
    return entry;
  });
}

/**
 * Expansion constraints already carry the current evidence coverage, eligible
 * player IDs, filters, and exact next page offset. Other tool results do not
 * guide this decision. A blocked-question recovery can opt into the latest
 * policy feedback so the Planner understands why its previous question was
 * rejected, without restoring bulky candidate or metric payloads.
 */
export function compactExpansionHistory(
  history: ConversationHistoryEntry[],
  options: { includeLatestPolicyFeedback?: boolean } = {},
): ConversationHistoryEntry[] {
  const latestPolicyFeedbackIndex = options.includeLatestPolicyFeedback
    ? history.reduce((latest, entry, index) => entry.role === "tool" && entry.toolName === "investigation_policy" ? index : latest, -1)
    : -1;
  return history.filter((entry, index) => {
    if (entry.role === "user") return true;
    if (entry.role === "tool") return index === latestPolicyFeedbackIndex;
    if (entry.role !== "assistant") return false;
    try {
      const action = JSON.parse(entry.content) as { action?: unknown };
      return action.action === "ask_user";
    } catch {
      return false;
    }
  });
}

export function compactConclusionHistory(
  history: ConversationHistoryEntry[],
  requestedCapabilityCoverage?: readonly Pick<RequestedCapabilityCoverage, "requestedMetricKeys">[],
  options: { preserveAllMethodology?: boolean } = {},
): ConversationHistoryEntry[] {
  const hasRequestedCapabilities = (requestedCapabilityCoverage?.length ?? 0) > 0;
  const requestedMetricKeys = new Set(requestedCapabilityCoverage?.flatMap(({ requestedMetricKeys: keys }) => keys) ?? []);
  const evaluatedPlayerIds = new Set<string>();
  let hasAbilityEvidence = false;
  for (const entry of history) {
    if (entry.role !== "tool" || entry.toolName !== "evaluate_candidates") continue;
    try {
      const result = JSON.parse(entry.content) as { evaluations?: Array<{ playerId?: unknown; metrics?: Array<{ basis?: unknown }> }> };
      for (const evaluation of result.evaluations ?? []) {
        if (typeof evaluation.playerId === "string") evaluatedPlayerIds.add(evaluation.playerId);
        if (evaluation.metrics?.some((metric) => metric.basis === "ability_profile")) hasAbilityEvidence = true;
      }
    } catch {
      // Ignore malformed internal tool summaries; they do not affect candidate eligibility.
    }
  }

  const latestToolEntryIndex = (toolName: string) => {
    let latest = -1;
    history.forEach((entry, index) => {
      if (entry.role === "tool" && entry.toolName === toolName) latest = index;
    });
    return latest;
  };
  const conclusionHistory = history.flatMap((entry, index) => {
    if (entry.role === "user") return [entry];
    if (entry.role === "assistant") {
      try {
        const action = JSON.parse(entry.content) as { action?: unknown };
        return action.action === "ask_user" ? [entry] : [];
      } catch {
        return [];
      }
    }
    if (entry.toolName === "search_candidates") {
      try {
        const result = JSON.parse(entry.content) as {
          candidates?: Array<Record<string, unknown>>;
          [key: string]: unknown;
        };
        const candidates = (result.candidates ?? []).flatMap((candidate) => {
          if (typeof candidate.playerId !== "string" || !evaluatedPlayerIds.has(candidate.playerId)) return [];
          return [Object.fromEntries(
            ["playerId", "name", "position", "age", "competition", "season", "minutes"]
              .flatMap((key) => candidate[key] === undefined ? [] : [[key, candidate[key]]]),
          )];
        });
        return [{
          ...entry,
          content: JSON.stringify({
            ...result,
            candidates: hasAbilityEvidence ? [] : candidates,
            discoveredCandidateCount: result.candidates?.length ?? 0,
            note: hasAbilityEvidence ? "候选姓名与指标统一见 evaluate_candidates；此处只保留分页事实。" : "仅列出本页中已评估的候选人；其余候选尚未评估，不可推荐。",
          }),
        }];
      } catch {
        return [{ ...entry, content: "候选搜索页已读取；该页结果无法解析，不能据此增加候选推荐。" }];
      }
    }
    if (entry.toolName === "search_methodology" && !options.preserveAllMethodology
      && index !== latestToolEntryIndex("search_methodology")) return [];
    if (entry.toolName === "inspect_team" && index !== latestToolEntryIndex("inspect_team")) return [];
    if (entry.toolName === "investigation_policy" && index !== latestToolEntryIndex("investigation_policy")) return [];
    if (entry.toolName === "evaluate_candidates") {
      try {
        const result = JSON.parse(entry.content) as {
          evaluations?: Array<Record<string, unknown> & { metrics?: Array<Record<string, unknown>> }>;
          missingPlayerIds?: string[];
          note?: string;
        };
        return [{
          ...entry,
          content: JSON.stringify({
            ...result,
            evaluations: (result.evaluations ?? []).map((evaluation) => {
              const { metrics = [], roleFits, ...player } = evaluation;
              const requestedRoles = new Set(AbilityMetricDefinitions.filter((definition) => requestedMetricKeys.has(definition.key)).map((definition) => definition.role));
              const abilityOnly = metrics.length > 0 && metrics.every((metric) => metric.basis === "ability_profile");
              return {
                ...(abilityOnly ? Object.fromEntries(["playerId", "name", "position", "age", "footballManager", "referenceSimilarity"].filter(key => player[key] !== undefined).map((key) => [key, player[key]])) : player),
                ...(Array.isArray(roleFits) ? { roleFits: roleFits.filter((role) => role.performanceFit !== null && (!hasRequestedCapabilities || requestedRoles.has(role.role))) } : {}),
                metrics: metrics
                  .filter((metric) => !hasRequestedCapabilities || requestedMetricKeys.has(metric.key as CapabilityMetricKey))
                  .map((metric) => metric.basis === "ability_profile"
                    ? Object.fromEntries(["key", "value", "unit", "basis"].map((key) => [key, metric[key]]))
                    : Object.fromEntries(Object.entries(metric).filter(([key, value]) => (
                    !["competition", "season", "minutes"].includes(key)
                    && !(key === "source" && value === player.source)
                  )))),
              };
            }),
            note: `${result.note ?? ""} 同一球员的赛事、赛季和样本分钟在球员字段中统一提供。${hasAbilityEvidence ? " basis=ability_profile 为 /100 职责属性评价，无比赛分钟或百分位；不能改写为实战表现。" : ""}`,
          }),
        }];
      } catch {
        return [{ ...entry, content: "候选比赛表现评估已完成；请依据本轮已验证的能力指标和样本信息完成结论。" }];
      }
    }
    if (["search_methodology", "search_player_reports"].includes(entry.toolName ?? "")) {
      try {
        const result = JSON.parse(entry.content) as { results?: Array<Record<string, unknown>> };
        return [{
          ...entry,
          content: JSON.stringify({
            ...result,
            results: (result.results ?? []).map((document) => {
              const excerpt = selectRelevantDocumentExcerpt({
                text: typeof document.text === "string" ? document.text : "",
                title: typeof document.title === "string" ? document.title : undefined,
                entityNames: Array.isArray(document.entityNames) ? document.entityNames.filter((value): value is string => typeof value === "string") : undefined,
                matchedCapabilityGaps: Array.isArray(document.matchedCapabilityGaps) ? document.matchedCapabilityGaps.filter((value): value is string => typeof value === "string") : undefined,
              });
              return {
                ...document,
                text: excerpt.text,
                textExcerpt: {
                  strategy: excerpt.strategy,
                  startOffset: excerpt.startOffset,
                  endOffset: excerpt.endOffset,
                  sourceCharacters: excerpt.sourceCharacters,
                  completeSentences: excerpt.completeSentences,
                  note: "检索片段不代表全文；其余内容未读取。",
                },
              };
            }),
          }),
        }];
      } catch {
        return [{ ...entry, content: "资料检索完成；请依据已验证的来源元数据和评估证据完成结论。" }];
      }
    }
    return [entry];
  });
  return conclusionHistory;
}
