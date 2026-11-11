import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import {
  positionFeatureMap,
  positionFeatureMapSha256,
} from "../../../src/player-data/position-features.js";
import { recommendPlayerCandidates } from "../../../src/tools/recommend-player-candidates.js";
import type { RecommendPlayerCandidatesInput } from "../../../src/tools/recommend-player-candidates.js";
import { playerRecommendationDataTest } from "../../fixtures/player-recommendation-data.js";

describe("recommendation identity exclusions and feature registry", () => {
  afterEach(() => {
    playerRecommendationDataTest.cleanup();
  });

  it("excludes alternate FM profiles linked to reference and excluded identities", async () => {
    playerRecommendationDataTest.createFmDatabase([
      { fmId: "reference-selected", rating: 20 },
      { fmId: "reference-alternate", rating: 20 },
      { fmId: "exclude-selected", rating: 20 },
      { fmId: "exclude-alternate", rating: 20 },
      { fmId: "outside-candidate", rating: 20 },
    ]);
    playerRecommendationDataTest.createIdentityDatabase([
      { canonicalReepId: "identity-reference", fmId: "reference-selected" },
      { canonicalReepId: "identity-reference", fmId: "reference-alternate" },
      { canonicalReepId: "identity-excluded", fmId: "exclude-selected" },
      { canonicalReepId: "identity-excluded", fmId: "exclude-alternate" },
      { canonicalReepId: "identity-outside", fmId: "outside-candidate" },
    ]);
    vi.stubEnv("OPENAI_BASE_URL", "http://127.0.0.1:1234");

    const input: RecommendPlayerCandidatesInput = {
      excludeGroups: [
        {
          fmIds: ["exclude-selected"],
          identityKey: "identity-excluded",
          name: "Excluded Player",
        },
      ],
      includePotential: false,
      maxAge: null,
      minimumCurrentAbility: null,
      minimumPotentialAbility: null,
      position: "stc",
      referenceGroups: [
        {
          fmIds: ["reference-selected"],
          identityKey: "identity-reference",
          name: "Reference Player",
        },
      ],
      resultLimit: 5,
    };

    const result = z
      .object({
        currentCandidates: z.array(z.object({ fmId: z.string() })),
        referenceFmIds: z.array(z.string()),
        status: z.string(),
      })
      .parse(JSON.parse(await recommendPlayerCandidates(input)));

    expect(result).toStrictEqual({
      currentCandidates: [{ fmId: "outside-candidate" }],
      referenceFmIds: ["reference-selected"],
      status: "ready",
    });
  });

  it("merges FM IDs across repeated groups for the same identity", async () => {
    playerRecommendationDataTest.createFmDatabase([
      { fmId: "selected-fm-id", rating: 20 },
    ]);
    vi.stubEnv("OPENAI_BASE_URL", "http://127.0.0.1:1234");

    const input: RecommendPlayerCandidatesInput = {
      excludeGroups: [],
      includePotential: false,
      maxAge: null,
      minimumCurrentAbility: null,
      minimumPotentialAbility: null,
      position: null,
      referenceGroups: [
        { fmIds: [], identityKey: "same-person", name: "Selected Player" },
        {
          fmIds: ["selected-fm-id"],
          identityKey: "same-person",
          name: "Selected Player",
        },
      ],
      resultLimit: 5,
    };

    const resultJson = await recommendPlayerCandidates(input);
    const parsedResult: unknown = JSON.parse(resultJson);

    const result = z
      .object({
        referenceFmIds: z.array(z.string()).optional(),
        status: z.string(),
      })
      .parse(parsedResult);

    expect(result).toMatchObject({
      referenceFmIds: ["selected-fm-id"],
      status: "no_candidates",
    });
  });

  it("keeps the TypeScript feature map synchronized with the frozen experiment registry", () => {
    const featureMapPath = path.resolve(
      import.meta.dirname,
      "../../../.scratch/player-recommendation/position-feature-map.json"
    );

    const bytes = readFileSync(featureMapPath);
    const parsed: unknown = JSON.parse(bytes.toString("utf-8"));

    const featureRegistry = z
      .object({
        positions: z.record(
          z.string(),
          z.object({
            groups: z.record(z.string(), z.array(z.string())),
          })
        ),
      })
      .parse(parsed);

    const runtimeMap = Object.fromEntries(
      Object.entries(featureRegistry.positions).map(
        ([position, definition]) => [
          position,
          {
            features: Object.values(definition.groups).flat(),
            groups: definition.groups,
          },
        ]
      )
    );

    const digest = createHash("sha256").update(bytes).digest("hex");

    expect(positionFeatureMap).toStrictEqual(runtimeMap);
    expect(digest).toBe(positionFeatureMapSha256);
  });
});
