import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

describe("evaluation CLI case-directory option", () => {
  it("previews a case from the selected directory", () => {
    const caseId = "case-directory-preview-smoke";

    const caseDirectory = mkdtempSync(
      path.join(os.tmpdir(), "tactiscout-eval-cli-case-directory-")
    );

    const templatePath = path.join(
      process.cwd(),
      "evals/cases/lookup-smoke-v1.json"
    );

    const casePath = path.join(caseDirectory, `${caseId}.json`);

    const caseContents = readFileSync(templatePath, "utf-8").replaceAll(
      "lookup-smoke-v1",
      caseId
    );

    writeFileSync(casePath, caseContents);

    try {
      const output = execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "evals/cli.ts",
          "preview",
          "--mode",
          "smoke",
          "--case",
          caseId,
          "--case-directory",
          caseDirectory,
          "--evidence-directory",
          path.join(process.cwd(), "evals/evidence"),
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            DOTENV_CONFIG_PATH: "/dev/null",
            OPENAI_API_KEY: "eval-preview-key",
            OPENAI_BASE_URL: "http://127.0.0.1:1/v1",
            OPENAI_MODEL: "eval-preview-model",
          },
        }
      );

      const preview = z
        .object({
          caseCount: z.number().int(),
          cases: z.array(
            z.object({
              caseId: z.string(),
              evidenceStatus: z.string(),
            })
          ),
          mode: z.string(),
        })
        .parse(JSON.parse(output.toString("utf-8")));

      expect(preview).toMatchObject({
        caseCount: 1,
        cases: [{ caseId, evidenceStatus: "ready" }],
        mode: "smoke",
      });
    } finally {
      rmSync(caseDirectory, { force: true, recursive: true });
    }
  }, 15_000);
});
