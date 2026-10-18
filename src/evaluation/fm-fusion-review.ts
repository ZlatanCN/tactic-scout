import { createHash, createHmac } from "node:crypto";
import { BlindedReviewerPacketSchema, type BlindedReviewerPacket } from "../domain/shortlist-review.js";
import { RecruitmentReportSchema, type RecruitmentReport } from "../domain/reports.js";
import { shortlistFitRubric } from "../domain/shortlist-fit-rubric.js";
import { AbilityMetricDefinitions } from "../domain/player-abilities.js";
import { groupCandidatesByExactIdentity, type CandidateIdentityResolver } from "../players/identity/candidate-groups.js";
import type { BlindedReviewPacketExport } from "./blinded-review-packet.js";

type Recommendation = RecruitmentReport["recommendations"][number];
export interface FusionReviewRun {
  arm: "performance_only" | "ability_only" | "combined";
  round: number;
  status: string;
  report: unknown;
}

/** One shared anonymous evidence pool; arm identity and ranking remain in the separate key. */
export function createFmFusionReviewPackets(input: {
  queryId: string; roleBrief: string; runs: readonly FusionReviewRun[];
  performanceSha256: string; profileSha256: string; asOf: string;
  blindingSecret: string; identityResolver?: CandidateIdentityResolver;
}): BlindedReviewPacketExport {
  if (input.blindingSecret.length < 32) throw new Error("A blinding secret of at least 32 characters is required.");
  if (![input.performanceSha256, input.profileSha256].every((hash) => /^[a-f0-9]{64}$/.test(hash))) throw new Error("Invalid frozen snapshot hash.");
  const runs = input.runs.map((run) => {
    if (run.status !== "completed") throw new Error("Blind comparison requires completed runs in every arm; failed runs remain experiment failures.");
    return { ...run, report: RecruitmentReportSchema.parse(run.report) };
  });
  if (new Set(runs.map((run) => run.arm)).size !== 3) throw new Error("All three evidence arms are required.");
  const runIds = runs.map((run) => `${run.arm}:${run.round}`);
  if (new Set(runIds).size !== runIds.length) throw new Error("Duplicate arm and round.");
  const records = new Map<string, Recommendation>();
  // Use the same maximum available evidence for every reviewer, irrespective of which arm recommended it.
  for (const run of runs) for (const item of run.report.recommendations) {
    const previous = records.get(item.player.playerId);
    records.set(item.player.playerId, previous ? { ...item,
      evidence: [...new Map([...previous.evidence, ...item.evidence].map((evidence) => [evidence.key, evidence])).values()],
      player: item.player.abilityProfile ? item.player : previous.player,
    } : item);
  }
  if (!records.size) throw new Error("No recommendations available for blind review.");
  const groups = groupCandidatesByExactIdentity([...records.values()].map((item) => item.player), input.identityResolver);
  const identityById = new Map(groups.flatMap((group) => group.records.map((record) => [record.playerId, group.identityKey] as const)));
  const sha256 = createHash("sha256").update(`${input.performanceSha256}:${input.profileSha256}`).digest("hex");
  const packetId = `packet_${createHash("sha256").update(`${input.queryId}:${sha256}`).digest("hex").slice(0, 16)}`;
  const cards = groups.map((group) => {
    const cardId = `card_${createHmac("sha256", input.blindingSecret).update(`${input.queryId}:${group.identityKey}`).digest("hex").slice(0, 16)}`;
    const performances: BlindedReviewerPacket["cards"][number]["performances"] = [];
    const seenProfiles = new Set<string>();
    for (const player of group.records) {
      const item = records.get(player.playerId)!;
      for (const basis of ["match_statistics", "ability_profile"] as const) {
        const evidence = item.evidence.filter((metric) => (metric.basis ?? "match_statistics") === basis);
        if (!evidence.length) continue;
        if (basis === "ability_profile") {
          if (!player.abilityProfile) throw new Error("Ability evidence lacks its frozen profile.");
          const key = `${player.abilityProfile.snapshotId}:${player.abilityProfile.recordId}`;
          if (seenProfiles.has(key)) continue;
          seenProfiles.add(key);
        }
        performances.push({ basis, position: player.position === "UNKNOWN" ? null : player.position,
          ageAtSeasonEnd: null, // No season-end age is inferred from an age measured today.
          competition: basis === "ability_profile" ? "职责属性" : player.competition || "赛事未记录",
          season: basis === "ability_profile" ? "冻结能力画像" : player.season || "赛季未记录",
          sampleSize: basis === "ability_profile" ? { minutes: null, matches: null } : { minutes: player.minutes, matches: null },
          metrics: evidence.map((metric) => ({ key: metric.key, label: AbilityMetricDefinitions.find((definition) => definition.key === metric.key)?.label ?? metric.label, status: "observed", value: metric.value, unit: metric.unit,
            definition: basis === "ability_profile" ? "相关职责属性的组合评价，尺度为 0–100，不是比赛产出或成功概率。" : metric.definition ?? "冻结比赛记录中的观测指标。",
            sourceField: null, sampleSize: { minutes: metric.minutes, matches: null },
          })),
        });
      }
    }
    return { group, cardId, performances };
  }).sort((left, right) => left.cardId.localeCompare(right.cardId));
  const reviewerPacket = BlindedReviewerPacketSchema.parse({
    schemaVersion: 2, benchmarkId: "human-shortlist-fit-v1", packetId, roleBrief: input.roleBrief,
    snapshot: { source: "冻结球员证据", publisher: "本机评估", attribution: "用户提供的本地能力画像与冻结比赛记录；仅限本机评估。",
      license: { name: "再分发授权未记录", url: null }, datasetId: "fm-fusion-v1", sha256, asOf: input.asOf,
      derivationRuleset: "Shared evidence union; exact-ID grouping; source weights masked; no identity or system rank in reviewer cards.",
      scope: "三种证据策略所推荐候选的并集；只评估冻结职责，未知不记零。" },
    cards: cards.map(({ cardId, performances }) => ({ cardId, performances })),
    reviewerInstructions: ["仅根据匿名资料评估冻结职责，不推断球员身份、现役球队、合同或可签约性。", "职责属性与比赛产出分别阅读；没有比赛样本不表示出场为零。",
      "同一人只评一次；不同来源记录按精确身份关联，不能把缺字段当能力为零。", ...shortlistFitRubric.map((item) => `${item.label}：${item.detail}。${item.anchor}`)],
  });
  return { reviewerPacket, answerKey: { schemaVersion: 2, packetId, queryId: input.queryId, snapshotSha256: sha256,
    systemRuns: runs.map((run) => ({ systemId: run.arm, runId: `round-${run.round}` })),
    cards: cards.map(({ group, cardId }) => ({ cardId, sourcePlayerIds: group.records.map((player) => player.playerId), externalPlayerId: group.identityKey,
      playerName: group.records[0]!.name, teamStints: [],
      systemRanks: runs.flatMap((run) => {
        const uniqueIdentities = [...new Set(run.report.recommendations.map((item) => identityById.get(item.player.playerId)!))];
        const rank = uniqueIdentities.indexOf(group.identityKey);
        return rank < 0 ? [] : [{ systemId: run.arm, runId: `round-${run.round}`, rank: rank + 1 }];
      }),
    })),
  } };
}
