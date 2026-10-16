import { CapabilityMetricDefinitions, SupplementaryCapabilityMetricDefinitions, type CapabilityMetricKey, type PlayerProfile, type Position, type ReportReferenceProfile, type TeamRosterContext } from "../domain/schemas.js";
import type { EvaluatedCandidate } from "./recruitment-evidence-evaluator.js";
import { toPer90 } from "./performance-metrics.js";
import { isReplacementTarget, replacementTargetNames } from "./replacement-target.js";
import { normalizeSearchText } from "../domain/text-matching.js";
import { sourcePlayerIdentityKey } from "../identity/source-player-key.js";

export interface ReferencePlayerProfile {
  playerId: string;
  sourceIdentityKey: string;
  name: string;
  source: string;
  provider: string;
  position: PlayerProfile["position"];
  competition: string;
  season: string;
  minutes: number;
  metrics: Record<string, number>;
}

/** Match exact aliases only; if one provider has multiple same-name identities, leave that source unresolved. */
export function createReferencePlayerProfiles(players: readonly PlayerProfile[], messages: readonly string[], referenceNames: readonly string[] = []): ReferencePlayerProfile[] {
  const names = [...replacementTargetNames(messages), ...referenceNames.map(normalizeSearchText)];
  const matches = players.filter(player => isReplacementTarget(player.name, names));
  const idsByProvider = new Map<string, Set<string>>();
  for (const player of matches) {
    const provider = player.sourceIdentity?.provider ?? player.source;
    const ids = idsByProvider.get(provider) ?? new Set<string>();
    ids.add(sourcePlayerIdentityKey(player));
    idsByProvider.set(provider, ids);
  }
  return matches.filter(player => (idsByProvider.get(player.sourceIdentity?.provider ?? player.source)?.size ?? 0) === 1).map(player => ({
    playerId: player.playerId, sourceIdentityKey: sourcePlayerIdentityKey(player), name: player.name, source: player.source,
    provider: player.sourceIdentity?.provider ?? player.source, position: player.position,
    competition: player.competition, season: player.season, minutes: player.minutes,
    metrics: Object.fromEntries([
      ...Object.entries(player.eventDataComplete === false ? {} : toPer90(player)),
      ...(player.supplementaryMetrics ?? []).map(metric => [metric.key, metric.value] as const),
    ].filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))),
  }));
}

function rosterPosition(value: string | null): Position | null {
  if (!value) return null;
  const normalized = value.normalize("NFKC").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (/^(?:gk|goal ?keeper|门将|守门员)$/.test(normalized)) return "GK";
  if (/^(?:centre back|center back|centre back|central defender|中后卫|中卫)$/.test(normalized)) return "CB";
  if (/^(?:left back|左后卫)$/.test(normalized)) return "LB";
  if (/^(?:right back|右后卫)$/.test(normalized)) return "RB";
  if (/^(?:full ?back|边后卫)$/.test(normalized)) return "FB";
  if (/^(?:defence|defense|defender|后卫|后防)$/.test(normalized)) return "DEF";
  if (/^(?:defensive midfield|defensive midfielder|后腰)$/.test(normalized)) return "DM";
  if (/^(?:central midfield|central midfielder|中前卫)$/.test(normalized)) return "CM";
  if (/^(?:attacking midfield|attacking midfielder|前腰)$/.test(normalized)) return "AM";
  if (/^(?:midfield|midfielder|中场)$/.test(normalized)) return "MID";
  if (/^(?:centre forward|center forward|striker|中锋|前锋)$/.test(normalized)) return "ST";
  if (/^(?:left winger|左边锋)$/.test(normalized)) return "LW";
  if (/^(?:right winger|右边锋)$/.test(normalized)) return "RW";
  if (/^(?:winger|边锋)$/.test(normalized)) return "WG";
  if (/^(?:offence|offense|forward|attacker|前锋|锋线)$/.test(normalized)) return "ATT";
  return null;
}

/** Resolve a replacement's default position only from an exact reference name in observed player or roster data. */
export function resolveReplacementReferencePosition(input: {
  players: readonly PlayerProfile[];
  rosterContext: TeamRosterContext | null;
  userMessages: readonly string[];
  referenceNames?: readonly string[];
}): Position | null {
  const names = [...replacementTargetNames(input.userMessages), ...(input.referenceNames ?? []).map(normalizeSearchText)];
  if (!names.length) return null;

  const positions = [
    ...createReferencePlayerProfiles(input.players, input.userMessages, input.referenceNames).map(({ position }) => position),
    ...(input.rosterContext?.status === "available" ? (() => {
      const matches = input.rosterContext.players.filter(({ name }) => isReplacementTarget(name, names));
      return matches.length === 1 ? matches.map(({ position }) => rosterPosition(position)) : [];
    })() : []),
  ].filter((position): position is Position => position !== null);
  const distinctPositions = [...new Set(positions)];
  return distinctPositions.length === 1 ? distinctPositions[0]! : null;
}

const referenceMetricDefinitions = new Map([
  ...CapabilityMetricDefinitions,
  ...SupplementaryCapabilityMetricDefinitions,
].map(definition => [definition.key, definition] as const));

export function reportReferenceProfile(profile: ReferencePlayerProfile): ReportReferenceProfile {
  return {
    playerId: profile.playerId,
    name: profile.name,
    source: profile.source,
    competition: profile.competition,
    season: profile.season,
    minutes: profile.minutes,
    metrics: Object.entries(profile.metrics).flatMap(([key, value]) => {
      const definition = referenceMetricDefinitions.get(key as CapabilityMetricKey);
      return definition ? [{ key: definition.key, label: definition.label, value, unit: definition.unit,
        ...( "definition" in definition && definition.definition ? { definition: definition.definition } : {}),
      }] : [];
    }),
  };
}

function metricText(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

export function createReferenceComparisonNotes(
  candidate: EvaluatedCandidate,
  profiles: readonly ReferencePlayerProfile[],
  metricKeys: readonly string[],
): string[] {
  const provider = candidate.player.sourceIdentity?.provider ?? candidate.player.source;
  return profiles
    .filter(profile => profile.provider === provider
      && profile.position === candidate.player.position
      && profile.competition === candidate.player.competition
      && profile.season === candidate.player.season)
    .flatMap(profile => candidate.evidence
      .filter(evidence => metricKeys.includes(evidence.key)
        && evidence.sourceScope !== "season_position_aggregate"
        && typeof profile.metrics[evidence.key] === "number")
      .slice(0, 4)
      .map(evidence => {
        const referenceValue = profile.metrics[evidence.key]!;
        const candidateSample = evidence.minutes === null ? "样本分钟未知" : `${Math.round(evidence.minutes)} 分钟样本`;
        return `${evidence.label}：候选 ${metricText(evidence.value)} ${evidence.unit}（${candidateSample}），参考球员 ${profile.name} ${metricText(referenceValue)} ${evidence.unit}（${Math.round(profile.minutes)} 分钟记录）。同来源、位置、赛事和赛季的观测差异，不代表能力优劣。`;
      }));
}

/** Comparisons retain measurement context; no invented tactical score or cross-league rank. */
export function createCandidateComparison(candidates: readonly EvaluatedCandidate[], metricKeys: readonly string[]) {
  return candidates.map(candidate => ({
    playerId: candidate.player.playerId,
    minutes: candidate.player.minutes,
    comparisons: candidate.evidence.filter(item => metricKeys.includes(item.key)).map(item => {
      const peers = item.sourceScope === "season_position_aggregate" ? [] : candidates.filter(peer => peer.player.playerId !== candidate.player.playerId
        && peer.player.position === candidate.player.position
        && peer.player.competition === candidate.player.competition
        && peer.player.season === candidate.player.season
        && (peer.player.sourceIdentity?.provider ?? peer.player.source) === (candidate.player.sourceIdentity?.provider ?? candidate.player.source))
        .flatMap(peer => peer.evidence.filter(evidence => evidence.key === item.key && evidence.unit === item.unit));
      return { key: item.key, label: item.label, value: item.value, unit: item.unit,
        comparedCandidateCount: peers.length,
        ...(peers.length ? { observedMinimum: Math.min(item.value, ...peers.map(peer => peer.value)), observedMaximum: Math.max(item.value, ...peers.map(peer => peer.value)) } : {}),
        sampleWarning: "仅比较本轮同来源、位置、赛事和赛季的已评估样本；数值高低不等于战术适配。",
      };
    }),
  }));
}
