import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { FmAttributeKeys, FmRetainedFields } from "../../src/sources/fm/profile.js";
import { importFmProfiles } from "../../src/sources/fm/import.js";
import { FmProfileRepository } from "../../src/sources/fm/repository.js";
import { FusedPlayerRepository, type ProfileEvidenceMode } from "../../src/sources/fm/fused-repository.js";
import { importReepRelease } from "../../src/players/identity/import-reep-release.js";
import { ReepIdentityRegistry } from "../../src/players/identity/reep-registry.js";
import { searchPlayerPage } from "../../src/players/repository.js";
import { createRecruitmentEvidenceEvaluator } from "../../src/recruitment/recruitment-evidence-evaluator.js";
import { createRecruitmentConversation } from "../../src/recruitment/conversation.js";
import { createSinglePassInvestigationPlanner } from "../../src/evaluation/fixed-investigation-planner.js";
import { groupCandidatesByExactIdentity } from "../../src/players/identity/candidate-groups.js";
import { createFmFusionReviewPackets } from "../../src/evaluation/fm-fusion-review.js";
import { createShortlistQualityDataset } from "../../src/evaluation/shortlist-evaluation-dataset.js";
import { roleConstraintPlayer } from "../recruitment/fixtures/recruitment-conversation.js";

async function setup(mode: ProfileEvidenceMode = "combined", researchAvailable = false, offline = false) {
  const directory = await mkdtemp(path.join(tmpdir(), "fm-fusion-"));
  const csvPath = path.join(directory, "profiles.csv"), outputPath = path.join(directory, "profiles.sqlite");
  const fields = FmRetainedFields;
  const names = ["Harry Kane", "New Forward", "Same Name", "New Keeper"];
  const rows = names.map((name, index) => ({
    uid: String(index + 1), unique_id: String((index + 1) * 111), name, full_name: name, last_name: name.split(" ").at(-1)!, birth_date: "1998-01-01",
    positions_stc: index === 3 ? "1" : "20", positions_gk: index === 3 ? "20" : "1",
    ability_current: "150", ability_potential: "-8", personality_professionalism: "17", left_foot: "15", right_foot: "20",
    ...Object.fromEntries(FmAttributeKeys.flatMap((key) => [[`raw_attributes_${key}`, String(70 + index * 5)], [`attributes_${key}`, "15"]])),
  }));
  await writeFile(csvPath, [fields, ...rows.map((row) => fields.map((field) => (row as Record<string, string>)[field] ?? ""))].map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n"));
  await importFmProfiles({ csvPath, outputPath, gameBuild: "26.3.2", databaseVersion: "26.2.0", parserVersion: "0.5.10", inGameDate: "2025-11-23", maleOnlyConfirmed: true });
  const bridgesPath = path.join(directory, "bridges.gz"), redirectsPath = path.join(directory, "redirects.gz"), registryPath = path.join(directory, "registry.sqlite");
  await writeFile(bridgesPath, gzipSync("provider,namespace,external_id,reep_id,rung,upstream_status\nfm,player,111,rp1,name-dob,\nunderstat,player,647,rp1,footprint,\nfm,player,222,rp2,name-dob,\nunderstat,player,1001,rp2,footprint,\n"));
  await writeFile(redirectsPath, gzipSync("from_id,to_id,reason\n"));
  await importReepRelease({ bridgesPath, redirectsPath, releaseStamp: "20261005T180536Z", outputPath: registryPath });
  const players = names.slice(0, 3).map((name, index) => ({
    ...roleConstraintPlayer(`p${index}`, name, "ST"), age: null, team: index === 0 ? "Bayern Munich" : "Other Club",
    sourceIdentity: { provider: "understat", playerId: ["647", "1001", "999"][index]!, retrievedAt: "2026-10-16T00:00:00.000Z", isCurrentSeason: true },
  }));
  const registry = new ReepIdentityRegistry(registryPath);
  const comparisonPlayers = Array.from({ length: 6 }, (_, index) => ({ ...players[1]!, playerId: `peer-${index}`, stats: { ...players[1]!.stats, goals: index }, sourceIdentity: { ...players[1]!.sourceIdentity, playerId: `peer-${index}` } }));
  const repository = new FusedPlayerRepository({ mode: researchAvailable ? "understat" : "demo", sourceName: "Frozen performance", loadPlayers: async () => { if (offline) throw new Error("Remote catalog offline"); return players; },
    ...(researchAvailable ? { inspectCandidateGroup: async () => [] } : {}),
    getComparisonPlayers: async () => [...players, ...comparisonPlayers],
  }, new FmProfileRepository(outputPath), registry, mode, () => "2026-10-16");
  return { repository, registry, players, cleanup: async () => { repository.close(); await rm(directory, { recursive: true, force: true }); } };
}

const query = { playerName: null, position: "ST" as const, maxAge: null, minimumMinutes: 0, competition: null, season: null, offset: 0, limit: 20 };

test("the local name index can read an ability profile without fetching the remote performance catalog", async () => {
  const { repository, cleanup } = await setup("combined", false, true);
  try {
    const players = await repository.findLocalPlayersByNames(["Harry Kane"]);
    assert.equal(players.length, 1);
    assert.equal(players[0]?.name, "Harry Kane");
    assert.ok(players[0]?.abilityProfile);
    await assert.rejects(repository.findPlayersByNames(["Harry Kane"]), /Remote catalog offline/);
  } finally { await cleanup(); }
});

test("fused recall joins exact IDs, keeps same-name unlinked players separate and paginates the full union", async () => {
  const { repository, cleanup } = await setup();
  try {
    const page = await searchPlayerPage(repository, query);
    assert.equal(page.totalRecords, 4);
    assert.equal(page.players.filter((player) => player.name === "Same Name").length, 2);
    const linked = page.players.find((player) => player.name === "New Forward")!;
    assert.equal(linked.abilityProfile?.identityLink.method, "verified_bridge");
    assert.equal(linked.stats.goals, 8);
    assert.equal(linked.age, 28, "a verified FM birth date can supply age for a linked Understat record");
    assert.equal(linked.ageSource, "birth_date");
    assert.equal(linked.abilityProfile?.currentAbility, 150);
    assert.equal(linked.abilityProfile?.potentialAbility, null, "a potential range code is not an exact rating");
    assert.equal(linked.abilityProfile?.personality.professionalism, 17);
    assert.equal(linked.abilityProfile?.leftFoot, 15);
    const surname = await repository.findPlayersByNames(["Kane"]);
    assert.deepEqual(surname.map((player) => player.playerId), ["p0"], "verified aliases reuse the linked performance record");
    const sameName = page.players.filter((player) => player.name === "Same Name");
    assert.equal(sameName.filter((player) => player.abilityProfile).length, 1);
    const ids: string[] = [];
    for (let offset = 0; offset < page.totalRecords!; offset++) {
      const next = await searchPlayerPage(repository, { ...query, offset, limit: 1 });
      ids.push(next.players[0]!.playerId);
      assert.equal(next.nextOffset, offset + 1 < page.totalRecords! ? offset + 1 : null);
    }
    assert.equal(new Set(ids).size, 4);
    const batch = await createRecruitmentEvidenceEvaluator(repository).evaluate(page.players, page.players.map((player) => player.playerId));
    assert.ok(batch.evaluations[linked.playerId]!.evidence.some((evidence) => evidence.key === "goals"));
    assert.ok(batch.evaluations[linked.playerId]!.evidence.some((evidence) => evidence.key === "abilityFinishing" && evidence.minutes === null));
    const fit = batch.evaluations[linked.playerId]!.roleFits!.find((fit) => fit.role === "finisher")!;
    assert.notEqual(fit.abilityFit, null);
    assert.notEqual(fit.performanceFit, null);
    assert.notEqual(fit.combinedFit, null);
    const keeperPage = await searchPlayerPage(repository, { ...query, position: "GK" });
    assert.equal(keeperPage.players.length, 1);
    const keeper = keeperPage.players[0]!;
    const keeperBatch = await createRecruitmentEvidenceEvaluator(repository).evaluate([keeper], [keeper.playerId]);
    assert.ok(keeperBatch.evaluations[keeper.playerId]!.evidence.some((evidence) => evidence.key === "abilitySweeperKeeper"));
    assert.ok(keeperBatch.evaluations[keeper.playerId]!.evidence.every((evidence) => evidence.basis === "ability_profile"));
    assert.equal((await searchPlayerPage(repository, { ...query, minimumMinutes: 900 })).players.some((player) => player.sourceIdentity?.provider === "fm"), false);
  } finally { await cleanup(); }
});

test("target-club search excludes current squad records and FM-only profiles without a current club", async () => {
  const { repository, cleanup } = await setup();
  try {
    const page = await searchPlayerPage(repository, { ...query, position: null, targetTeam: "Bayern Munich" });
    assert.ok(page.players.every((player) => player.team !== "Bayern Munich"));
    assert.ok(page.players.every((player) => player.sourceIdentity?.provider !== "fm"),
      "standalone FM profiles have no current-club evidence for a target-specific recruitment request");
    assert.ok(page.appliedFilters.includes("targetTeam"));
  } finally { await cleanup(); }
});

for (const mode of ["performance_only", "ability_only"] as const) {
  test(`source ablation masks the unavailable evidence in ${mode}`, async () => {
    const { repository, cleanup } = await setup(mode);
    try {
      const page = await searchPlayerPage(repository, query);
      const batch = await createRecruitmentEvidenceEvaluator(repository).evaluate(page.players, page.players.map((player) => player.playerId));
      assert.ok(page.players.length > 0);
      for (const candidate of Object.values(batch.evaluations)) {
        if (mode === "performance_only") {
          assert.equal(candidate.player.abilityProfile, undefined);
          assert.equal(candidate.evidence.some((evidence) => evidence.basis === "ability_profile"), false);
        } else {
          assert.equal(candidate.player.sourceIdentity?.provider, "fm");
          assert.equal(candidate.evidence.some((evidence) => evidence.basis !== "ability_profile"), false);
        }
      }
    } finally { await cleanup(); }
  });
}

for (const researchAvailable of [false, true]) test(`complete LangGraph report evaluates fused evidence before concluding (research=${researchAvailable})`, async () => {
  const { repository, registry, cleanup } = await setup("combined", researchAvailable);
  const previousBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
  try {
    const conversation = createRecruitmentConversation({
      repository, candidateIdentityGrouper: (players) => groupCandidatesByExactIdentity(players, registry),
      referenceNameResolver: async (mention) => ({ status: "resolved", mention, resolutionMethod: "wikidata_exact", player: { entityId: "Q969725", sourceUrl: "https://www.wikidata.org/wiki/Q969725", preferredName: "Harry Kane", names: ["凯恩", "Harry Kane"], match: "exact_alias" } }),
      planner: createSinglePassInvestigationPlanner({ decide: async () => ({
        action: "finish", targetTeam: "拜仁", needSummary: "寻找能接应做球和终结的前锋", capabilityProfile: ["接应", "做球", "终结"],
        recommendations: [{ playerId: "p1", evidenceKeys: ["abilityLinkForward", "abilityFinishing", "goals"] }], limitationKeys: [],
      }) }),
      knowledgeBase: { search: async () => [] },
    });
    const response = await conversation.turn({ threadId: "fm-fused-replacement", message: "为拜仁寻找凯恩的替代者，重点看能接应、做球和终结的前锋" });
    assert.equal(response.status, "completed");
    assert.ok(response.report);
    assert.equal(response.report.recommendations.length, 1, JSON.stringify(response.report));
    assert.equal(response.report.recommendations[0]!.player.playerId, "p1");
    assert.ok(response.report.recommendations[0]!.focusEvidenceKeys.includes("abilityLinkForward"));
    assert.ok(response.report.recommendations[0]!.evidence.some((evidence) => evidence.key === "goals"));
    assert.ok(response.report.requestedCapabilityCoverage.some((area) => area.name === "射门终结" && area.candidatesWithEvidenceCount > 0 && area.observedMetricKeys.includes("abilityFinishing")));
    assert.ok(response.report.recommendations.every((recommendation) => recommendation.player.name !== "Harry Kane"));
  } finally {
    if (previousBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previousBaseUrl;
    await cleanup();
  }
});

test("ability-only goalkeeper report uses specialist evidence without inventing match minutes", async () => {
  const { repository, cleanup } = await setup("ability_only");
  try {
    const [keeper] = await repository.findPlayersByNames(["New Keeper"]);
    assert.ok(keeper);
    const conversation = createRecruitmentConversation({ repository, knowledgeBase: { search: async () => [] },
      planner: createSinglePassInvestigationPlanner({ decide: async () => ({ action: "finish", targetTeam: null, needSummary: "寻找出击出球门将", capabilityProfile: ["出击", "出球"],
        recommendations: [{ playerId: keeper.playerId, evidenceKeys: ["abilityGoalkeeping", "abilitySweeperKeeper"] }], limitationKeys: [] }) }),
    });
    const result = await conversation.turn({ threadId: "ability-keeper", message: "寻找门将 GK，重点看出击出球和门线扑救" });
    assert.equal(result.status, "completed");
    assert.equal(result.report?.recommendations.length, 1);
    const candidate = result.report!.recommendations[0]!;
    assert.equal(candidate.player.minutes, 0);
    assert.ok(candidate.evidence.every((evidence) => evidence.basis === "ability_profile" && evidence.minutes === null));
    assert.equal(candidate.tradeoffs.some((text) => text.includes("900")), false);
    const reviewInput = { queryId: "keeper-fixture", roleBrief: "门将出击出球", performanceSha256: "a".repeat(64), profileSha256: "b".repeat(64),
      asOf: "2026-10-16T00:00:00.000Z", blindingSecret: "test-secret-".repeat(4),
      runs: (["performance_only", "ability_only", "combined"] as const).map((arm) => ({ arm, round: 0, status: "completed", report: arm === "performance_only" ? { ...result.report, recommendations: [] } : result.report })),
    };
    const { reviewerPacket, answerKey } = createFmFusionReviewPackets(reviewInput);
    assert.equal(reviewerPacket.cards.length, 1);
    assert.equal(reviewerPacket.cards[0]!.performances[0]!.basis, "ability_profile");
    assert.equal(reviewerPacket.cards[0]!.performances[0]!.sampleSize.minutes, null);
    assert.equal(reviewerPacket.snapshot.license.url, null);
    const serialized = JSON.stringify(reviewerPacket);
    for (const secret of ["New Keeper", keeper.playerId, "performance_only", "ability_only", "combined"]) assert.equal(serialized.includes(secret), false);
    assert.equal(answerKey.cards[0]!.playerName, "New Keeper");
    assert.equal(answerKey.cards[0]!.systemRanks.length, 2);
    assert.equal(answerKey.systemRuns?.length, 3);
    assert.throws(() => createFmFusionReviewPackets({ ...reviewInput, runs: reviewInput.runs.slice(0, 2) }), /three/);
    assert.throws(() => createFmFusionReviewPackets({ ...reviewInput, runs: reviewInput.runs.map((run, index) => index ? run : { ...run, status: "failed" }) }), /completed/);
    const ratings = reviewerPacket.cards.map(({ cardId }) => ({ cardId, rating: 2 }));
    // Fixture grades verify compatibility only; these are not human evaluation results.
    const dataset = createShortlistQualityDataset({ packet: reviewerPacket, answerKey,
      submissions: ["fixture-reviewer-a", "fixture-reviewer-b"].map((reviewerId) => ({ schemaVersion: 1, benchmarkId: "human-shortlist-fit-v1", packetId: reviewerPacket.packetId, reviewerId, ratings })),
      adjudications: ratings.map(({ cardId, rating }) => ({ cardId, grade: rating })),
    });
    assert.ok(dataset);
    assert.deepEqual(dataset.queries[0]!.systemRankings.find((ranking) => ranking.systemId === "performance_only")?.candidateIds, [], "an empty arm remains in the evaluation rather than silently disappearing");

    const controller = new AbortController(); controller.abort();
    await assert.rejects(repository.searchCandidates(query, controller.signal), { name: "AbortError" });
  } finally { await cleanup(); }
});
