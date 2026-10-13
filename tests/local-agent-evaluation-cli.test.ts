import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function runCli(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, ["--import", "tsx", "src/evals/local-model-agent.ts", ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 15_000,
  });
}

test("the local evaluation CLI documents named and repeated scenarios", () => {
  const result = runCli(["--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--scenario <id\|all>/);
  assert.match(result.stdout, /--runs <1-10>/);
  assert.match(result.stdout, /bayern-kane-replacement/);
  assert.match(result.stdout, /barcelona-attacking-one-on-one-forward/);
  assert.match(result.stdout, /--compare-ask-policy/);
  assert.match(result.stdout, /--compare-methodology-rag/);
  assert.match(result.stdout, /--compare-investigation-planning/);
  assert.match(result.stdout, /--compare-historical-archive/);
  assert.match(result.stdout, /--compare-evidence-evaluator/);
  assert.match(result.stdout, /--summary-output <path>/);
});

test("the local evaluation CLI refuses an existing summary path before contacting data or the model", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-cli-summary-"));
  const outputPath = path.join(directory, "existing.json");
  const originalContents = "keep this file";
  await writeFile(outputPath, originalContents, "utf8");
  try {
    const result = runCli(["--scenario", "understat-five-league-xg-creation", "--summary-output", outputPath], {
      ...process.env,
      TACTISCOUT_DATA_MODE: "understat",
      OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
    });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /输出文件已存在，拒绝覆盖/);
    assert.doesNotMatch(result.stderr, /ECONNREFUSED|fetch failed/i);
    assert.equal(await readFile(outputPath, "utf8"), originalContents);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the local evaluation CLI rejects summary output for ablations before contacting data or the model", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tactiscout-cli-summary-ablation-"));
  const outputPath = path.join(directory, "summary.json");
  try {
    const result = runCli([
      "--scenario", "bayern-kane-replacement",
      "--compare-ask-policy",
      "--summary-output", outputPath,
    ], {
      ...process.env,
      TACTISCOUT_DATA_MODE: "curated",
      OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
    });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /--summary-output 目前只支持普通 Harness 运行/);
    assert.doesNotMatch(result.stderr, /ECONNREFUSED|fetch failed/i);
    await assert.rejects(access(outputPath), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the local evaluation CLI rejects unsupported run counts before contacting the model", () => {
  const result = runCli(["--scenario", "all", "--runs", "11"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--runs 必须是 1 到 10 之间的整数/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|fetch failed/i);
});

test("the local evaluation CLI rejects unknown scenarios before contacting the model", () => {
  const result = runCli(["--scenario", "imaginary-scenario"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /未知场景/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|fetch failed/i);
});

test("the local evaluation CLI rejects unsupported player positions before contacting the model", () => {
  const result = runCli(["--message", "找一名好球员", "--expected-position", "striker"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--expected-position 必须是以下值之一/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|fetch failed/i);
});

test("the local evaluation CLI requires one registered scenario for ask-policy comparison", () => {
  const result = runCli(["--scenario", "all", "--compare-ask-policy"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--compare-ask-policy 必须与单个 --scenario <id> 一起使用/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|fetch failed/i);
});

test("the local evaluation CLI rejects custom input and conflicting experiments for ask-policy comparison", () => {
  const curatedEnv = { ...process.env, TACTISCOUT_DATA_MODE: "curated" };
  const custom = runCli(["--scenario", "bayern-kane-replacement", "--compare-ask-policy", "--message", "custom"], curatedEnv);
  assert.equal(custom.status, 2);
  assert.match(custom.stderr, /--scenario 不能与 --message 或 --expected-position 一起使用/);
  assert.doesNotMatch(custom.stderr, /ECONNREFUSED|fetch failed/i);

  const conflicting = runCli(["--scenario", "bayern-kane-replacement", "--compare-ask-policy", "--compare-interaction"], curatedEnv);
  assert.equal(conflicting.status, 2);
  assert.match(conflicting.stderr, /一次只能使用一个/);
  assert.doesNotMatch(conflicting.stderr, /ECONNREFUSED|fetch failed/i);
});

test("the local evaluation CLI requires curated data for ask-policy comparison", () => {
  const result = runCli(["--scenario", "bayern-kane-replacement", "--compare-ask-policy"], {
    ...process.env,
    TACTISCOUT_DATA_MODE: "demo",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /需要 TACTISCOUT_DATA_MODE=curated/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|fetch failed/i);
});

test("the local evaluation CLI requires one registered scenario for methodology RAG comparison", () => {
  const result = runCli(["--scenario", "all", "--compare-methodology-rag"], {
    ...process.env,
    TACTISCOUT_DATA_MODE: "curated",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /必须与单个 --scenario bayern-kane-replacement/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|fetch failed/i);
});

test("the local evaluation CLI restricts methodology RAG comparison to its source-hit scenario", () => {
  const result = runCli(["--scenario", "barcelona-attacking-one-on-one-forward", "--compare-methodology-rag"], {
    ...process.env,
    TACTISCOUT_DATA_MODE: "curated",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /只支持已验证方法来源命中的拜仁凯恩接班人场景/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|fetch failed/i);
});

test("the local evaluation CLI requires curated data and rejects competing arms for methodology RAG comparison", () => {
  const unpinned = runCli(["--scenario", "bayern-kane-replacement", "--compare-methodology-rag"], {
    ...process.env,
    TACTISCOUT_DATA_MODE: "demo",
  });
  assert.equal(unpinned.status, 2);
  assert.match(unpinned.stderr, /需要 TACTISCOUT_DATA_MODE=curated/);
  assert.doesNotMatch(unpinned.stderr, /ECONNREFUSED|fetch failed/i);

  const conflicting = runCli(["--scenario", "bayern-kane-replacement", "--compare-methodology-rag", "--compare-ask-policy"], {
    ...process.env,
    TACTISCOUT_DATA_MODE: "curated",
  });
  assert.equal(conflicting.status, 2);
  assert.match(conflicting.stderr, /一次只能使用一个/);
  assert.doesNotMatch(conflicting.stderr, /ECONNREFUSED|fetch failed/i);
});

test("the local evaluation CLI requires one registered scenario for investigation-planning comparison", () => {
  const result = runCli(["--scenario", "all", "--compare-investigation-planning"], {
    ...process.env,
    TACTISCOUT_DATA_MODE: "curated",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--compare-investigation-planning 必须与单个 --scenario <id> 一起使用/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|fetch failed/i);
});

test("the evidence-evaluator comparison requires an explicit registered scenario before contacting the model", () => {
  const result = runCli(["--compare-evidence-evaluator"], {
    ...process.env,
    TACTISCOUT_DATA_MODE: "demo",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--compare-evidence-evaluator 必须与 --scenario <id|all> 一起使用/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|fetch failed/i);
});

test("the evidence-evaluator comparison rejects custom input and fewer than three pairs", () => {
  const env = { ...process.env, TACTISCOUT_DATA_MODE: "curated" };
  const custom = runCli(["--scenario", "bayern-kane-replacement", "--compare-evidence-evaluator", "--message", "custom"], env);
  assert.equal(custom.status, 2);
  assert.match(custom.stderr, /--scenario 不能与 --message 或 --expected-position 一起使用/);
  assert.doesNotMatch(custom.stderr, /ECONNREFUSED|fetch failed/i);

  const tooFew = runCli(["--scenario", "all", "--compare-evidence-evaluator", "--runs", "2"], {
    ...process.env,
    TACTISCOUT_DATA_MODE: "demo",
  });
  assert.equal(tooFew.status, 2);
  assert.match(tooFew.stderr, /至少需要 --runs 3/);
  assert.doesNotMatch(tooFew.stderr, /ECONNREFUSED|fetch failed/i);
});

test("the evidence-evaluator comparison requires curated data and rejects another ablation", () => {
  const unpinned = runCli(["--scenario", "barcelona-attacking-one-on-one-forward", "--compare-evidence-evaluator", "--runs", "3"], {
    ...process.env,
    TACTISCOUT_DATA_MODE: "demo",
  });
  assert.equal(unpinned.status, 2);
  assert.match(unpinned.stderr, /需要 TACTISCOUT_DATA_MODE=curated/);
  assert.doesNotMatch(unpinned.stderr, /ECONNREFUSED|fetch failed/i);

  const conflicting = runCli(["--scenario", "barcelona-attacking-one-on-one-forward", "--compare-evidence-evaluator", "--compare-ask-policy", "--runs", "3"], {
    ...process.env,
    TACTISCOUT_DATA_MODE: "demo",
  });
  assert.equal(conflicting.status, 2);
  assert.match(conflicting.stderr, /一次只能使用一个/);
  assert.doesNotMatch(conflicting.stderr, /ECONNREFUSED|fetch failed/i);
});

test("help and argument validation remain available when curated model processing is disabled", () => {
  const env = {
    ...process.env,
    TACTISCOUT_DATA_MODE: "curated",
    TACTISCOUT_WYSCOUT_AI_PROCESSING_ALLOWED: "false",
  };
  const help = runCli(["--help"], env);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--compare-evidence-evaluator/);
  assert.equal(help.stderr, "");

  const invalid = runCli(["--compare-evidence-evaluator"], env);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /--compare-evidence-evaluator 必须与 --scenario <id\|all> 一起使用/);
  assert.doesNotMatch(invalid.stderr, /CuratedDatasetRepository|at new |Node\.js v/i);
});

test("a curated evaluation with model processing disabled reports the permission gate without a stack trace", () => {
  const result = runCli([
    "--scenario", "barcelona-attacking-one-on-one-forward",
    "--compare-evidence-evaluator",
    "--runs", "3",
  ], {
    ...process.env,
    TACTISCOUT_DATA_MODE: "curated",
    TACTISCOUT_WYSCOUT_AI_PROCESSING_ALLOWED: "false",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /TACTISCOUT_WYSCOUT_AI_PROCESSING_ALLOWED=true/);
  assert.doesNotMatch(result.stderr, /CuratedDatasetRepository|at new |Node\.js v|ECONNREFUSED|fetch failed/i);
});

test("the local evaluation CLI rejects custom inputs and competing arms for investigation-planning comparison", () => {
  const custom = runCli(["--scenario", "bayern-kane-replacement", "--compare-investigation-planning", "--message", "custom"], {
    ...process.env,
    TACTISCOUT_DATA_MODE: "curated",
  });
  assert.equal(custom.status, 2);
  assert.match(custom.stderr, /--scenario 不能与 --message 或 --expected-position 一起使用/);
  assert.doesNotMatch(custom.stderr, /ECONNREFUSED|fetch failed/i);

  const conflicting = runCli(["--scenario", "bayern-kane-replacement", "--compare-investigation-planning", "--compare-ask-policy"], {
    ...process.env,
    TACTISCOUT_DATA_MODE: "curated",
  });
  assert.equal(conflicting.status, 2);
  assert.match(conflicting.stderr, /一次只能使用一个/);
  assert.doesNotMatch(conflicting.stderr, /ECONNREFUSED|fetch failed/i);
});

test("the local evaluation CLI requires one registered Understat or mosaic scenario for historical archive comparison", () => {
  const result = runCli(["--scenario", "all", "--compare-historical-archive"], {
    ...process.env,
    TACTISCOUT_DATA_MODE: "understat",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /必须与单个已登记场景一起使用/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|fetch failed/i);
});

test("the local evaluation CLI rejects custom inputs and competing experiments for historical archive comparison", () => {
  const custom = runCli(["--scenario", "understat-five-league-xg-creation", "--compare-historical-archive", "--message", "custom"], {
    ...process.env,
    TACTISCOUT_DATA_MODE: "understat",
  });
  assert.equal(custom.status, 2);
  assert.match(custom.stderr, /--scenario 不能与 --message 或 --expected-position 一起使用/);
  assert.doesNotMatch(custom.stderr, /ECONNREFUSED|fetch failed/i);

  const conflicting = runCli(["--scenario", "understat-five-league-xg-creation", "--compare-historical-archive", "--compare-ask-policy"], {
    ...process.env,
    TACTISCOUT_DATA_MODE: "understat",
  });
  assert.equal(conflicting.status, 2);
  assert.match(conflicting.stderr, /一次只能使用一个/);
  assert.doesNotMatch(conflicting.stderr, /ECONNREFUSED|fetch failed/i);
});

test("historical archive comparison requires paired archive opt-ins and three counterbalanced repetitions before model calls", () => {
  const result = runCli(["--scenario", "understat-five-league-xg-creation", "--compare-historical-archive", "--runs", "3"], {
    ...process.env,
    TACTISCOUT_DATA_MODE: "understat",
    TACTISCOUT_WYSCOUT_HISTORICAL_REPORT_DISPLAY_ALLOWED: "false",
    TACTISCOUT_WYSCOUT_HISTORICAL_LOCAL_RETENTION_ALLOWED: "false",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /需要预先启用历史报告展示和本地保留两个选项/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|fetch failed/i);

  const tooFewPairs = runCli(["--scenario", "understat-five-league-xg-creation", "--compare-historical-archive", "--runs", "2"], {
    ...process.env,
    TACTISCOUT_DATA_MODE: "understat",
    TACTISCOUT_WYSCOUT_HISTORICAL_REPORT_DISPLAY_ALLOWED: "true",
    TACTISCOUT_WYSCOUT_HISTORICAL_LOCAL_RETENTION_ALLOWED: "true",
  });
  assert.equal(tooFewPairs.status, 2);
  assert.match(tooFewPairs.stderr, /至少需要 --runs 3/);
  assert.doesNotMatch(tooFewPairs.stderr, /ECONNREFUSED|fetch failed/i);

  const unusableArchive = runCli(["--scenario", "understat-five-league-xg-creation", "--compare-historical-archive", "--runs", "3"], {
    ...process.env,
    TACTISCOUT_DATA_MODE: "understat",
    TACTISCOUT_WYSCOUT_HISTORICAL_REPORT_DISPLAY_ALLOWED: "true",
    TACTISCOUT_WYSCOUT_HISTORICAL_LOCAL_RETENTION_ALLOWED: "true",
    TACTISCOUT_REEP_IDENTITY_DB_PATH: `/tmp/tactiscout-missing-reep-${process.pid}.sqlite`,
    TACTISCOUT_WYSCOUT_ARCHIVE_DIR: `/tmp/tactiscout-missing-wyscout-${process.pid}`,
  });
  assert.equal(unusableArchive.status, 2);
  assert.match(unusableArchive.stderr, /无法读取有效的 Reep 身份索引与本机 Wyscout 档案/);
  assert.match(unusableArchive.stderr, /未联系模型/);
  assert.doesNotMatch(unusableArchive.stderr, /ECONNREFUSED|fetch failed/i);
});

test("the local evaluation CLI requires curated data for investigation-planning comparison", () => {
  const result = runCli(["--scenario", "bayern-kane-replacement", "--compare-investigation-planning"], {
    ...process.env,
    TACTISCOUT_DATA_MODE: "demo",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /需要 TACTISCOUT_DATA_MODE=curated/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|fetch failed/i);
});
