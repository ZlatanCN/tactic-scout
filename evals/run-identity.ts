import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { z } from "zod/v4";

type RunIdentity = {
  agentPromptSha256: string;
  benchmarkVersion: string;
  dependencyLockSha256: string | null;
  gitRevision: string | null;
  sourceTreeSha256: string;
  workingTreeDirty: boolean | null;
};

type FreezeCase = {
  caseDefinition: {
    caseId: string;
    evidenceBundleSha256: string;
    split: "development" | "held_out";
  };
  caseHash: string;
};

type FreezeConfiguration = {
  agentModel: string | null;
  gatewayBaseUrl: string | null;
  judgeEnabled: boolean;
  judgeModel: string | null;
};

const nonEmptyValue = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? "";

  return trimmed.length > 0 ? trimmed : null;
};

const recursiveSourceFiles = (
  root: string,
  relativeDirectory: string
): string[] =>
  readdirSync(path.join(root, relativeDirectory), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);

    if (entry.isDirectory()) {
      if (["anchors", "cases", "evidence"].includes(entry.name)) {
        return recursiveSourceFiles(root, relativePath);
      }

      return [];
    }

    return entry.isFile() && /\.(?:json|ts)$/u.test(entry.name)
      ? [relativePath]
      : [];
  });

const sha256 = (content: string | Buffer): string =>
  createHash("sha256").update(content).digest("hex");

const gitValue = (root: string, args: string[]): string | null => {
  try {
    return execFileSync("/usr/bin/git", args, {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

const captureRunIdentity = (root = process.cwd()): RunIdentity => {
  const sourceFiles = [
    "package.json",
    "tsconfig.json",
    ...recursiveSourceFiles(root, "src"),
    ...recursiveSourceFiles(root, "evals"),
  ].toSorted();

  const sourceHash = createHash("sha256");

  for (const file of sourceFiles) {
    sourceHash
      .update(file)
      .update("\0")
      .update(readFileSync(path.join(root, file)));
  }

  const promptFiles = ["src/nodes/assistant.ts", "src/request-extraction.ts"];

  const promptHash = createHash("sha256");

  for (const file of promptFiles) {
    promptHash
      .update(file)
      .update("\0")
      .update(readFileSync(path.join(root, file)));
  }

  const lockFile = path.join(root, "pnpm-lock.yaml");
  const gitRevision = gitValue(root, ["rev-parse", "HEAD"]);
  const workingTree = gitValue(root, ["status", "--porcelain"]);

  return {
    agentPromptSha256: promptHash.digest("hex"),
    benchmarkVersion: "scouting-evaluation-v1",
    dependencyLockSha256: existsSync(lockFile)
      ? sha256(readFileSync(lockFile))
      : null,
    gitRevision:
      gitRevision !== null &&
      z
        .string()
        .regex(/^[a-f0-9]{40,64}$/u)
        .safeParse(gitRevision).success
        ? gitRevision
        : null,
    sourceTreeSha256: sourceHash.digest("hex"),
    workingTreeDirty: workingTree === null ? null : workingTree.length > 0,
  };
};

const captureFreezeConfiguration = (
  judgeEnabled: boolean
): FreezeConfiguration => {
  const agentModel = nonEmptyValue(process.env.OPENAI_MODEL);
  const configuredUrl = nonEmptyValue(process.env.OPENAI_BASE_URL);

  const baseUrl = configuredUrl ?? "https://api.openai.com/v1";

  let gatewayBaseUrl: string | null = null;

  try {
    const parsedUrl = new URL(baseUrl);

    if (
      (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") &&
      parsedUrl.username.length === 0 &&
      parsedUrl.password.length === 0
    ) {
      const pathname = parsedUrl.pathname.endsWith("/")
        ? parsedUrl.pathname.slice(0, -1)
        : parsedUrl.pathname;

      gatewayBaseUrl = `${parsedUrl.origin}${pathname}`;
    }
  } catch {
    gatewayBaseUrl = null;
  }

  const configuredJudgeModel = nonEmptyValue(
    process.env.TACTISCOUT_EVAL_JUDGE_MODEL
  );

  return {
    agentModel,
    gatewayBaseUrl,
    judgeEnabled,
    judgeModel: judgeEnabled ? (configuredJudgeModel ?? agentModel) : null,
  };
};

const freezeFingerprintForEvaluation = (
  identity: RunIdentity,
  cases: FreezeCase[],
  configuration: FreezeConfiguration
): string | null => {
  const missingRunIdentity =
    identity.dependencyLockSha256 === null ||
    configuration.agentModel === null ||
    configuration.gatewayBaseUrl === null;

  const missingJudgeIdentity =
    configuration.judgeEnabled && configuration.judgeModel === null;

  if (missingRunIdentity || missingJudgeIdentity) {
    return null;
  }

  const caseIdentity = cases
    .map(({ caseDefinition, caseHash }) => ({
      caseHash,
      caseId: caseDefinition.caseId,
      evidenceBundleSha256: caseDefinition.evidenceBundleSha256,
      split: caseDefinition.split,
    }))
    .toSorted((left, right) => left.caseId.localeCompare(right.caseId));

  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        agentModel: configuration.agentModel,
        agentPromptSha256: identity.agentPromptSha256,
        benchmarkVersion: identity.benchmarkVersion,
        cases: caseIdentity,
        dependencyLockSha256: identity.dependencyLockSha256,
        gatewayBaseUrl: configuration.gatewayBaseUrl,
        judgeEnabled: configuration.judgeEnabled,
        judgeModel: configuration.judgeModel,
        sourceTreeSha256: identity.sourceTreeSha256,
      })
    )
    .digest("hex");

  return `scouting-eval-v1-${fingerprint}`;
};

export {
  captureFreezeConfiguration,
  captureRunIdentity,
  freezeFingerprintForEvaluation,
};

export type { RunIdentity };
