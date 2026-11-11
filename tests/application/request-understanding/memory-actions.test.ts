import { RunnableLambda } from "@langchain/core/runnables";
import { describe, expect, it, vi } from "vitest";

import {
  createRequestUnderstandingExtractor,
  normalizeExtractedPlayers,
} from "../../../src/request-extraction.js";
import { createInitialConversationContext } from "../../../src/state.js";
import { testModelContextConfiguration } from "../../fixtures/model-context.js";
import { requestUnderstandingTest } from "../../fixtures/request-understanding.js";

describe("player memory action extraction", () => {
  it.each([
    ["up to three players", 3],
    ["最多 3 名球员", 3],
  ])(
    "deterministically extracts the requested recommendation limit from %s",
    async (limitPhrase, expectedLimit) => {
      const model = requestUnderstandingTest.fakeModel();
      vi.spyOn(model, "getNumTokens").mockImplementation(async (text) => {
        await Promise.resolve();

        return Math.ceil(text.length / 4);
      });
      const structuredOutput = vi.spyOn(model, "withStructuredOutput");

      structuredOutput.mockReturnValue(
        RunnableLambda.from(() => ({
          constraints: [],
          kind: "player_recommendation",
          players: [
            {
              lookupName: null,
              mention: "Erling Haaland",
              recommendationRole: "reference",
              referenceScope: "explicit",
            },
          ],
          recommendation: { position: "stc" },
          teams: [],
        }))
      );

      const extractor = createRequestUnderstandingExtractor(
        model,
        testModelContextConfiguration
      );

      const result = await extractor(
        `Based on Erling Haaland's STC profile, recommend ${limitPhrase}.`,
        createInitialConversationContext()
      );

      expect(result.recommendation?.resultLimit).toBe(expectedLimit);
    }
  );

  it("does not accept model-inferred memory type or IDs absent from the forget command", async () => {
    const model = requestUnderstandingTest.fakeModel();
    vi.spyOn(model, "getNumTokens").mockImplementation(async (text) => {
      await Promise.resolve();

      return Math.ceil(text.length / 4);
    });

    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => ({
        constraints: [],
        kind: "other",
        playerMemoryManagement: {
          action: "forget",
          apiFootballPlayerId: 11,
          fmId: "fm-kane",
          targetKind: "roster_identity",
          targetMention: "Harry Kane",
        },
        players: [],
        teams: [],
      }))
    );

    const extractor = createRequestUnderstandingExtractor(
      model,
      testModelContextConfiguration
    );

    const result = await extractor(
      "Forget Harry Kane",
      createInitialConversationContext()
    );

    expect(result.playerMemoryManagement).toStrictEqual({
      action: "forget",
      apiFootballPlayerId: null,
      fmId: null,
      targetKind: null,
      targetMention: "Harry Kane",
    });
  });

  it("extracts both sides of an explicit remembered-alias correction", async () => {
    const model = requestUnderstandingTest.fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => ({
        constraints: [],
        kind: "other",
        playerMemoryManagement: {
          action: "correct",
          replacementMention: "Erling Haaland",
          targetMention: "凯恩",
        },
        players: [],
        teams: [],
      }))
    );

    const extractor = createRequestUnderstandingExtractor(
      model,
      testModelContextConfiguration
    );

    const result = await extractor(
      "Correct the remembered alias 凯恩 to Erling Haaland",
      createInitialConversationContext()
    );

    expect(result.playerMemoryManagement).toStrictEqual({
      action: "correct",
      apiFootballPlayerId: null,
      fmId: null,
      replacementMention: "Erling Haaland",
      targetKind: "player_identity",
      targetMention: "凯恩",
    });
  });

  it("recognizes clear-all as its own explicit player-memory action", async () => {
    const model = requestUnderstandingTest.fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => ({
        constraints: [],
        kind: "other",
        playerMemoryManagement: { action: "clear" },
        players: [],
        teams: [],
      }))
    );

    const extractor = createRequestUnderstandingExtractor(
      model,
      testModelContextConfiguration
    );

    const result = await extractor(
      "Clear all player memories",
      createInitialConversationContext()
    );

    expect(result.playerMemoryManagement).toStrictEqual({
      action: "clear",
      apiFootballPlayerId: null,
      fmId: null,
      replacementMention: null,
      targetKind: null,
      targetMention: null,
    });
  });

  it.each([
    "Do not clear all player memories",
    "I don't want to clear all player memories",
    "不要清空全部球员身份记忆",
    "我不想清空全部球员记忆",
  ])("rejects a negated clear-all command in %s", async (message) => {
    const model = requestUnderstandingTest.fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => ({
        constraints: [],
        kind: "other",
        playerMemoryManagement: { action: "clear" },
        players: [],
        teams: [],
      }))
    );

    const extractor = createRequestUnderstandingExtractor(
      model,
      testModelContextConfiguration
    );

    const result = await extractor(message, createInitialConversationContext());

    expect(result.playerMemoryManagement).toBeUndefined();
  });

  it.each(["Janik Haberer's", "Janik Haberer’s"])(
    "removes the possessive suffix from the explicit player name %s",
    (mention) => {
      const message = `Look up ${mention} FM profile.`;

      expect(
        normalizeExtractedPlayers(message, [
          { lookupName: null, mention, referenceScope: "explicit" },
        ])
      ).toStrictEqual([
        {
          lookupName: null,
          mention: "Janik Haberer",
          recommendationRole: "reference",
          referenceScope: "explicit",
          referenceTargetMention: null,
        },
      ]);
    }
  );
});
