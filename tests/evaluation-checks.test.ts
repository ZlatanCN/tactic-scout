import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkCaseContract, emptyWorkerResult } from "../evals/checks.js";
import { evaluationCaseSchema } from "../evals/contracts.js";

describe("evaluation identity lookup checks", () => {
  it("keeps distinct Chinese player names distinct while normalizing accents", () => {
    const caseDefinition = evaluationCaseSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(process.cwd(), "evals/cases/lookup-smoke-v1.json"),
          "utf-8"
        )
      )
    );

    const [turn] = caseDefinition.turns;

    if (turn === undefined) {
      throw new Error("The lookup fixture must declare a turn.");
    }

    const caseWithChineseLookup = {
      ...caseDefinition,
      contract: {
        ...caseDefinition.contract,
        expectedIdentityLookups: [
          {
            lookupName: "孙兴慜",
            status: "resolved",
            turnId: turn.turnId,
          },
        ],
      },
    };

    const worker = {
      ...emptyWorkerResult("test-fixture"),
      identityLookupEvents: [
        {
          candidates: [],
          caseId: caseDefinition.caseId,
          durationMs: 0,
          error: null,
          eventId: "test-identity-lookup",
          kind: "returned" as const,
          lookupName: "武磊",
          outcome: "resolved",
          runId: "test-run",
          selectedCandidateId: "source:fm:wu-lei",
          trialId: "test-trial",
          turnId: turn.turnId,
        },
      ],
    };

    const check = checkCaseContract(caseWithChineseLookup, worker).find(
      ({ id }) => id === "identity-lookup-observations"
    );

    expect(check?.status).toBe("failed");
  });
});
