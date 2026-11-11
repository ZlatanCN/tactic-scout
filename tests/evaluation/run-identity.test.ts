import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  captureRunIdentity,
  freezeFingerprintForEvaluation,
} from "../../evals/run-identity.js";

const temporaryDirectories: string[] = [];

const createSourceTree = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), "tactiscout-run-identity-"));

  temporaryDirectories.push(root);
  mkdirSync(path.join(root, "src", "nodes"), { recursive: true });
  mkdirSync(path.join(root, "evals", "scoring"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n');
  writeFileSync(path.join(root, "tsconfig.json"), '{"compilerOptions":{}}\n');
  writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(
    path.join(root, "src", "nodes", "assistant.ts"),
    "export const prompt = 1;\n"
  );
  writeFileSync(
    path.join(root, "src", "request-extraction.ts"),
    "export const extractor = 1;\n"
  );
  writeFileSync(
    path.join(root, "src", "nodes", "route.ts"),
    "export const route = 1;\n"
  );
  writeFileSync(
    path.join(root, "evals", "scoring", "rules.ts"),
    "export const rule = 1;\n"
  );

  return root;
};

const identityAndFingerprint = (root: string) => {
  const identity = captureRunIdentity(root);

  const fingerprint = freezeFingerprintForEvaluation(
    identity,
    [
      {
        caseDefinition: {
          caseId: "held-out-case-v1",
          evidenceBundleSha256: "b".repeat(64),
          split: "held_out",
        },
        caseHash: "a".repeat(64),
      },
    ],
    {
      agentModel: "test-model",
      gatewayBaseUrl: "https://gateway.example.test/v1",
      judgeEnabled: false,
      judgeModel: null,
    }
  );

  return { fingerprint, sourceTreeSha256: identity.sourceTreeSha256 };
};

describe("evaluation run identity", () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("invalidates the freeze when nested graph or scoring code changes", () => {
    const root = createSourceTree();
    const initial = identityAndFingerprint(root);

    writeFileSync(
      path.join(root, "tsconfig.json"),
      '{"compilerOptions":{"strict":true}}\n'
    );

    const afterTypeScriptConfigChange = identityAndFingerprint(root);

    writeFileSync(
      path.join(root, "package.json"),
      '{"type":"module","exports":"./src/index.js"}\n'
    );

    const afterPackageConfigChange = identityAndFingerprint(root);

    writeFileSync(
      path.join(root, "src", "nodes", "route.ts"),
      "export const route = 2;\n"
    );

    const afterGraphChange = identityAndFingerprint(root);

    writeFileSync(
      path.join(root, "evals", "scoring", "rules.ts"),
      "export const rule = 2;\n"
    );

    const afterScoringChange = identityAndFingerprint(root);

    mkdirSync(path.join(root, "evals", ".data"), { recursive: true });
    writeFileSync(path.join(root, "evals", ".data", "private.ts"), "secret\n");

    const afterPrivateDataChange = identityAndFingerprint(root);

    expect({
      graphChangeInvalidated:
        afterGraphChange.fingerprint !== afterPackageConfigChange.fingerprint,
      packageConfigInvalidated:
        afterPackageConfigChange.fingerprint !==
        afterTypeScriptConfigChange.fingerprint,
      privateDataExcluded:
        afterPrivateDataChange.sourceTreeSha256 ===
          afterScoringChange.sourceTreeSha256 &&
        afterPrivateDataChange.fingerprint === afterScoringChange.fingerprint,
      scoringChangeInvalidated:
        afterScoringChange.fingerprint !== afterGraphChange.fingerprint,
      typeScriptConfigInvalidated:
        afterTypeScriptConfigChange.fingerprint !== initial.fingerprint,
    }).toStrictEqual({
      graphChangeInvalidated: true,
      packageConfigInvalidated: true,
      privateDataExcluded: true,
      scoringChangeInvalidated: true,
      typeScriptConfigInvalidated: true,
    });
  });
});
