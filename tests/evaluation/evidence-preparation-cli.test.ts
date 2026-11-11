import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

describe("local evidence preparation CLI", () => {
  it("reads case files from the selected case directory", () => {
    const caseId = "case-directory-real-evidence-test";

    const workspace = mkdtempSync(
      path.join(os.tmpdir(), "tactiscout-prepare-evidence-case-directory-")
    );

    const caseDirectory = path.join(workspace, "cases");
    const outputDirectory = path.join(workspace, "evidence");

    const templatePath = path.join(
      process.cwd(),
      "evals/cases/lookup-smoke-v1.json"
    );

    const caseContents = readFileSync(templatePath, "utf-8").replaceAll(
      "lookup-smoke-v1",
      caseId
    );

    mkdirSync(caseDirectory, { recursive: true });
    writeFileSync(path.join(caseDirectory, `${caseId}.json`), caseContents);

    try {
      let stderr = "";

      try {
        execFileSync(
          process.execPath,
          [
            "--import",
            "tsx",
            "evals/prepare-local-evidence.ts",
            "--case",
            caseId,
            "--case-directory",
            caseDirectory,
            "--output",
            outputDirectory,
          ],
          {
            cwd: process.cwd(),
            encoding: "utf-8",
          }
        );
      } catch (error) {
        const parsed = z.looseObject({ stderr: z.unknown() }).safeParse(error);

        stderr = parsed.success ? String(parsed.data.stderr) : "";
      }

      expect(stderr).toContain(`${caseId} is not marked as real evidence.`);
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  }, 15_000);
});
