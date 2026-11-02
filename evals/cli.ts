import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod/v4";

import { previewEvaluation, validateBenchmarkDataset } from "./benchmark.js";
import { compareEvaluationReportFiles } from "./report.js";
import { runEvaluation } from "./runner.js";
import type { RunEvaluationOptions } from "./runner.js";

const runCli = async (): Promise<void> => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      baseline: { type: "string" },
      candidate: { type: "string" },
      case: { multiple: true, type: "string" },
      "case-directory": { type: "string" },
      "evidence-directory": { type: "string" },
      "freeze-id": { type: "string" },
      judge: { type: "boolean" },
      "max-model-requests": { type: "string" },
      mode: { type: "string" },
      output: { type: "string" },
      workspace: { type: "string" },
    },
    strict: true,
  });

  const [command] = positionals;

  if (command === "compare") {
    const baseline = z.string().min(1).parse(values.baseline);
    const candidate = z.string().min(1).parse(values.candidate);
    const comparison = compareEvaluationReportFiles(baseline, candidate);

    if (values.output === undefined) {
      process.stdout.write(comparison);
    } else {
      writeFileSync(values.output, comparison);
    }

    return;
  }

  if (command === "validate") {
    const inventory = validateBenchmarkDataset({
      caseDirectory: values["case-directory"],
      evidenceDirectory: values["evidence-directory"],
    });

    process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);

    if (inventory.status !== "ready") {
      process.exitCode = 1;
    }

    return;
  }

  const mode = z.enum(["development", "held_out", "smoke"]).parse(values.mode);

  const caseIds = values.case ?? [];

  if (command === "preview") {
    process.stdout.write(
      `${JSON.stringify(
        previewEvaluation({
          caseDirectory: values["case-directory"],
          caseIds,
          evidenceDirectory: values["evidence-directory"],
          freezeId: values["freeze-id"],
          includeSemanticJudge: values.judge,
          mode,
        }),
        null,
        2
      )}\n`
    );

    return;
  }

  if (command !== "run") {
    throw new Error("Use the preview or run command.");
  }

  const maximumRequests = z
    .string()
    .regex(/^\d+$/u)
    .transform(Number)
    .refine(Number.isSafeInteger)
    .refine((value) => value > 0)
    .parse(values["max-model-requests"]);

  const options: RunEvaluationOptions = {
    caseDirectory: values["case-directory"],
    caseIds,
    evidenceDirectory: values["evidence-directory"],
    freezeId: values["freeze-id"],
    includeSemanticJudge: values.judge,
    maxModelRequests: maximumRequests,
    mode,
    outputDirectory: values.output ?? ".data/evals/runs",
    workspaceDirectory: values.workspace ?? ".data/evals/work",
  };

  const report = await runEvaluation(options);

  process.stdout.write(
    `${JSON.stringify(
      {
        caseCount: report.caseCount,
        deniedRequests: report.deniedRequests,
        judgeCalibration: report.judgeCalibration?.status ?? "not run",
        judgeEnabled: report.judgeEnabled,
        modelRequests: report.modelRequests,
        preflightErrors: report.preflightErrors,
        reportMarkdown: path.join(
          options.outputDirectory,
          report.runId,
          "report.md"
        ),
        runId: report.runId,
        status: report.status,
      },
      null,
      2
    )}\n`
  );

  if (report.status !== "completed") {
    process.exitCode = 1;
  }
};

const runCliWithErrors = async (): Promise<void> => {
  try {
    await runCli();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected evaluation failure.";

    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
};

void runCliWithErrors();
