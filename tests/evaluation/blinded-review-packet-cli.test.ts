import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("review export CLI writes separate files and refuses to overwrite either output", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-blind-review-"));
  try {
    const candidateId = "wyscout:303:team:10:competition:8:season:2017/18";
    const snapshotJson = JSON.stringify({
      schemaVersion: 1,
      datasetId: "tactiscout-wyscout-cli-test",
      builtAt: "2026-10-09T00:00:00.000Z",
      attribution: "Wyscout Open Data, CC BY 4.0",
      license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
      upstreamSource: {
        name: "Soccer match event dataset",
        publisher: "Wyscout",
        paperUrl: "https://doi.org/10.1038/s41597-019-0247-7",
        acquiredAt: "2019-10-01",
        scope: "2017/18 league season",
      },
      derivation: { ruleset: "tactiscout-wyscout-events-v2" },
      records: [{
        playerId: candidateId,
        externalPlayerId: "303",
        name: "CLI Hidden Player",
        team: "CLI Hidden Team",
        teamId: "10",
        competition: "League A",
        competitionId: "8",
        season: "2017/18",
        ageAtSeasonEnd: 24,
        position: "MID",
        minutes: 720,
        appearanceMatches: 8,
        metrics: [{
          key: "goals",
          value: 3,
          unit: "count",
          type: "event_aggregate",
          definition: "Goals in the frozen season.",
          sourceField: "shot events; tag 101",
          sampleMinutes: 720,
          sampleMatches: 8,
        }],
      }],
    });
    const snapshotPath = path.join(directory, "snapshot.json");
    const requestPath = path.join(directory, "request.json");
    const packetPath = path.join(directory, "reviewer-packet.json");
    const answerKeyPath = path.join(directory, "answer-key.json");
    const snapshotSha256 = createHash("sha256").update(snapshotJson).digest("hex");
    const request = {
      queryId: "cli-query-1",
      roleBrief: "评估一名中场的进球贡献。",
      snapshotSha256,
      candidateIds: [candidateId],
      metricKeys: ["goals"],
      systemRankings: [{ systemId: "system-hidden", runId: "run-1", candidateIds: [candidateId] }],
    };
    await writeFile(snapshotPath, snapshotJson, "utf8");
    await writeFile(requestPath, JSON.stringify(request), "utf8");

    const runCli = () => spawnSync(process.execPath, [
      "--import", "tsx", "src/evaluation/blinded-review-packet-cli.ts",
      "--snapshot", snapshotPath,
      "--request", requestPath,
      "--reviewer-packet", packetPath,
      "--answer-key", answerKeyPath,
    ], { cwd: process.cwd(), encoding: "utf8", timeout: 15_000 });

    const firstRun = runCli();
    assert.equal(firstRun.status, 0, firstRun.stderr);
    const reviewerPacketText = await readFile(packetPath, "utf8");
    const answerKeyText = await readFile(answerKeyPath, "utf8");
    assert.equal((await stat(packetPath)).mode & 0o777, 0o600);
    assert.equal((await stat(answerKeyPath)).mode & 0o777, 0o600);
    const reviewerPacket = JSON.parse(reviewerPacketText) as { cards: unknown[]; reviewerInstructions: string[] };
    const answerKey = JSON.parse(answerKeyText) as { cards: Array<{ sourcePlayerIds: string[] }> };
    assert.equal(reviewerPacket.cards.length, 1);
    assert.ok(reviewerPacket.reviewerInstructions.some((instruction) => instruction.includes("评分锚点：unknown = 未知")));
    assert.deepEqual(answerKey.cards[0]?.sourcePlayerIds, [candidateId]);
    assert.doesNotMatch(reviewerPacketText, /CLI Hidden Player|CLI Hidden Team|system-hidden|wyscout:303/);

    const secondRun = runCli();
    assert.equal(secondRun.status, 2);
    assert.match(secondRun.stderr, /已存在|覆盖/);
    assert.equal(await readFile(packetPath, "utf8"), reviewerPacketText);
    assert.equal(await readFile(answerKeyPath, "utf8"), answerKeyText);

    await unlink(packetPath);
    const keyConflictRun = runCli();
    assert.equal(keyConflictRun.status, 2);
    await assert.rejects(readFile(packetPath), { code: "ENOENT" });
    assert.equal(await readFile(answerKeyPath, "utf8"), answerKeyText);

    const evaluationPath = path.join(directory, "harness-output.json");
    const reviewContextPath = path.join(directory, "review-context.json");
    const harnessPacketPath = path.join(directory, "harness-reviewer-packet.json");
    const harnessKeyPath = path.join(directory, "harness-answer-key.json");
    const evaluation = {
      datasetVersion: 2,
      model: "qwen3.5:9b",
      repository: { mode: "wyscout", source: "Wyscout Open Data · historical 2017/18" },
      allPassed: true,
      scenarios: [{
        id: "barcelona-midfielder",
        runs: [{
          threadId: "local-eval-run-1",
          allPassed: true,
          checks: { recommendationsWereEvaluated: true, evaluatedOnlyAfterCandidateDiscovery: true },
          report: { evaluatedCandidateCount: 1, recommendations: [{ playerId: candidateId }] },
          trace: [{
            phase: "tool",
            toolName: "evaluate_candidates",
            ok: true,
            filters: { evaluatedPlayerIds: [candidateId] },
          }],
        }],
      }],
    };
    const reviewContext = {
      queryId: "cli-harness-query",
      roleBrief: "评估一名中场的进球贡献。",
      metricKeys: ["goals"],
      scenarioId: "barcelona-midfielder",
      runNumber: 1,
    };
    await writeFile(evaluationPath, JSON.stringify(evaluation), "utf8");
    await writeFile(reviewContextPath, JSON.stringify(reviewContext), "utf8");
    const harnessRun = spawnSync(process.execPath, [
      "--import", "tsx", "src/evaluation/blinded-review-packet-cli.ts",
      "--snapshot", snapshotPath,
      "--evaluation", evaluationPath,
      "--review-context", reviewContextPath,
      "--reviewer-packet", harnessPacketPath,
      "--answer-key", harnessKeyPath,
    ], { cwd: process.cwd(), encoding: "utf8", timeout: 15_000 });
    assert.equal(harnessRun.status, 0, harnessRun.stderr);
    const cliSummary = JSON.parse(harnessRun.stdout.slice(harnessRun.stdout.indexOf("{"))) as { cardCount: number; sourceRecordCount: number };
    assert.equal(cliSummary.cardCount, 1);
    assert.equal(cliSummary.sourceRecordCount, 1);
    const harnessPacketText = await readFile(harnessPacketPath, "utf8");
    const harnessKeyText = await readFile(harnessKeyPath, "utf8");
    assert.doesNotMatch(harnessPacketText, /CLI Hidden Player|CLI Hidden Team|tactiscout:wyscout|local-eval-run-1/);
    const harnessKey = JSON.parse(harnessKeyText) as { cards: Array<{ playerName: string; sourcePlayerIds: string[]; systemRanks: Array<{ rank: number }> }> };
    assert.equal(harnessKey.cards[0]?.playerName, "CLI Hidden Player");
    assert.deepEqual(harnessKey.cards[0]?.sourcePlayerIds, [candidateId]);
    assert.equal(harnessKey.cards[0]?.systemRanks[0]?.rank, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("review export CLI accepts pnpm's argument separator", () => {
  const result = spawnSync("pnpm", ["export:shortlist-review", "--", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 15_000,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reviewer-packet/);
  assert.match(result.stdout, /--evaluation/);
});
