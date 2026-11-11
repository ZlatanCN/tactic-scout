import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { previewEvaluation } from "../../../evals/benchmark.js";
import {
  evaluationCaseSchema,
  evaluationEvidenceBundleSchema,
} from "../../../evals/contracts.js";
import { evaluationRunnerTest } from "../../fixtures/evaluation-runner-entry.js";

describe("evaluation evidence preflight contracts", () => {
  afterEach(async () => {
    await evaluationRunnerTest.cleanup();
  });

  it("rejects a required Understat record when its declared competition is absent from the bundle", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "tactiscout-understat-scope-preview-")
    );

    evaluationRunnerTest.temporaryDirectories.push(directory);

    const caseDirectory = path.join(directory, "cases");
    const evidenceDirectory = path.join(directory, "evidence");
    mkdirSync(caseDirectory, { recursive: true });
    mkdirSync(evidenceDirectory, { recursive: true });

    const caseDefinition = evaluationCaseSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(process.cwd(), "evals/cases/lookup-smoke-v1.json"),
          "utf-8"
        )
      )
    );

    const evidenceBundle = evaluationEvidenceBundleSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(
            process.cwd(),
            "evals/evidence/lookup-smoke-evidence-v1.json"
          ),
          "utf-8"
        )
      )
    );

    caseDefinition.contract.sourceScope =
      caseDefinition.contract.sourceScope.map((source) =>
        source.provider === "understat"
          ? { ...source, competition: "La_liga" }
          : source
      );
    const evidenceText = `${JSON.stringify(evidenceBundle, null, 2)}\n`;
    caseDefinition.evidenceBundleSha256 = createHash("sha256")
      .update(evidenceText)
      .digest("hex");

    writeFileSync(
      path.join(caseDirectory, "lookup-smoke-v1.json"),
      `${JSON.stringify(caseDefinition, null, 2)}\n`
    );
    writeFileSync(
      path.join(evidenceDirectory, "lookup-smoke-evidence-v1.json"),
      evidenceText
    );

    const preview = previewEvaluation({
      caseDirectory,
      caseIds: ["lookup-smoke-v1"],
      evidenceDirectory,
      mode: "smoke",
    });

    expect(
      preview.cases.map(({ evidenceStatus }) => evidenceStatus)
    ).toStrictEqual(["missing_or_invalid"]);
  });

  it("rejects an Understat golden value that differs from the fixed evidence", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "tactiscout-understat-value-preview-")
    );

    evaluationRunnerTest.temporaryDirectories.push(directory);

    const caseDirectory = path.join(directory, "cases");
    const evidenceDirectory = path.join(directory, "evidence");
    mkdirSync(caseDirectory, { recursive: true });
    mkdirSync(evidenceDirectory, { recursive: true });

    const caseDefinition = evaluationCaseSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(process.cwd(), "evals/cases/lookup-smoke-v1.json"),
          "utf-8"
        )
      )
    );

    const evidenceBundle = evaluationEvidenceBundleSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(
            process.cwd(),
            "evals/evidence/lookup-smoke-evidence-v1.json"
          ),
          "utf-8"
        )
      )
    );

    caseDefinition.contract.requiredEvidence =
      caseDefinition.contract.requiredEvidence.map((expectation) =>
        expectation.provider === "understat" &&
        expectation.field === "expectedGoals"
          ? { ...expectation, value: 5.3 }
          : expectation
      );

    const evidenceText = `${JSON.stringify(evidenceBundle, null, 2)}\n`;
    caseDefinition.evidenceBundleSha256 = createHash("sha256")
      .update(evidenceText)
      .digest("hex");

    writeFileSync(
      path.join(caseDirectory, "lookup-smoke-v1.json"),
      `${JSON.stringify(caseDefinition, null, 2)}\n`
    );
    writeFileSync(
      path.join(evidenceDirectory, "lookup-smoke-evidence-v1.json"),
      evidenceText
    );

    const preview = previewEvaluation({
      caseDirectory,
      caseIds: ["lookup-smoke-v1"],
      evidenceDirectory,
      mode: "smoke",
    });

    expect(
      preview.cases.map(({ evidenceStatus }) => evidenceStatus)
    ).toStrictEqual(["missing_or_invalid"]);
  });

  it("does not coerce a blank Understat number to zero", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "tactiscout-understat-blank-value-preview-")
    );

    evaluationRunnerTest.temporaryDirectories.push(directory);

    const caseDirectory = path.join(directory, "cases");
    const evidenceDirectory = path.join(directory, "evidence");
    mkdirSync(caseDirectory, { recursive: true });
    mkdirSync(evidenceDirectory, { recursive: true });

    const caseDefinition = evaluationCaseSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(process.cwd(), "evals/cases/lookup-smoke-v1.json"),
          "utf-8"
        )
      )
    );

    const evidenceBundle = evaluationEvidenceBundleSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(
            process.cwd(),
            "evals/evidence/lookup-smoke-evidence-v1.json"
          ),
          "utf-8"
        )
      )
    );

    const snapshot = evidenceBundle.understat.snapshots.find(
      ({ resourceId, seasonStartYear }) =>
        resourceId === "EPL" && seasonStartYear === 2024
    );

    if (snapshot === undefined) {
      throw new Error("The smoke fixture must include its EPL snapshot.");
    }

    const playerIndex = snapshot.players.findIndex((player) => {
      const parsed = z.record(z.string(), z.json()).safeParse(player);

      return parsed.success && parsed.data.id === "us-demo-01";
    });

    if (playerIndex === -1) {
      throw new Error("The smoke fixture must include its Understat player.");
    }

    const player = z
      .record(z.string(), z.json())
      .parse(snapshot.players[playerIndex]);

    snapshot.players[playerIndex] = { ...player, xG: "" };
    caseDefinition.contract.requiredEvidence =
      caseDefinition.contract.requiredEvidence.map((expectation) =>
        expectation.provider === "understat" &&
        expectation.field === "expectedGoals"
          ? { ...expectation, value: 0 }
          : expectation
      );

    const evidenceText = `${JSON.stringify(evidenceBundle, null, 2)}\n`;
    caseDefinition.evidenceBundleSha256 = createHash("sha256")
      .update(evidenceText)
      .digest("hex");
    writeFileSync(
      path.join(caseDirectory, "lookup-smoke-v1.json"),
      `${JSON.stringify(caseDefinition, null, 2)}\n`
    );
    writeFileSync(
      path.join(evidenceDirectory, "lookup-smoke-evidence-v1.json"),
      evidenceText
    );

    const preview = previewEvaluation({
      caseDirectory,
      caseIds: ["lookup-smoke-v1"],
      evidenceDirectory,
      mode: "smoke",
    });

    expect(
      preview.cases.map(({ evidenceStatus }) => evidenceStatus)
    ).toStrictEqual(["missing_or_invalid"]);
  });

  it("rejects API-Football source scopes that include provider prefixes", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "tactiscout-api-football-scope-preview-")
    );

    evaluationRunnerTest.temporaryDirectories.push(directory);

    const caseDirectory = path.join(directory, "cases");
    const evidenceDirectory = path.join(directory, "evidence");
    mkdirSync(caseDirectory, { recursive: true });
    mkdirSync(evidenceDirectory, { recursive: true });

    const caseDefinition = evaluationCaseSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(process.cwd(), "evals/cases/team-rec-synthetic-v1.json"),
          "utf-8"
        )
      )
    );

    const evidenceBundle = evaluationEvidenceBundleSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(
            process.cwd(),
            "evals/evidence/team-recommendation-synthetic-evidence-v1.json"
          ),
          "utf-8"
        )
      )
    );

    caseDefinition.contract.sourceScope =
      caseDefinition.contract.sourceScope.map((source) =>
        source.provider === "api_football"
          ? { ...source, sourceId: `team:${source.sourceId}` }
          : source
      );

    const evidenceText = `${JSON.stringify(evidenceBundle, null, 2)}\n`;
    caseDefinition.evidenceBundleSha256 = createHash("sha256")
      .update(evidenceText)
      .digest("hex");

    writeFileSync(
      path.join(caseDirectory, "team-rec-synthetic-v1.json"),
      `${JSON.stringify(caseDefinition, null, 2)}\n`
    );
    writeFileSync(
      path.join(
        evidenceDirectory,
        "team-recommendation-synthetic-evidence-v1.json"
      ),
      evidenceText
    );

    const preview = previewEvaluation({
      caseDirectory,
      caseIds: ["team-rec-synthetic-v1"],
      evidenceDirectory,
      mode: "smoke",
    });

    expect(
      preview.cases.map(({ evidenceStatus }) => evidenceStatus)
    ).toStrictEqual(["missing_or_invalid"]);
  });
});
