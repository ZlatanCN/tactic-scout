import { RunnableLambda } from "@langchain/core/runnables";
import { describe, expect, it, vi } from "vitest";

import {
  createRequestUnderstandingExtractor,
  normalizeExtractedPlayers,
} from "../../../src/request-extraction.js";
import { createInitialConversationContext } from "../../../src/state.js";
import { testModelContextConfiguration } from "../../fixtures/model-context.js";
import { requestUnderstandingTest } from "../../fixtures/request-understanding.js";

describe("player references and comparison mentions", () => {
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

  it("uses tool calling and recognizes a request to add a player to the active comparison", async () => {
    const model = requestUnderstandingTest.fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => ({
        comparisonAction: "replace",
        constraints: [],
        kind: "player_comparison",
        players: [
          {
            lookupName: "Erling Haaland",
            mention: "哈兰德",
            referenceScope: "explicit",
            referenceTargetMention: null,
          },
        ],
        teams: [],
      }))
    );

    const extractor = createRequestUnderstandingExtractor(
      model,
      testModelContextConfiguration
    );

    const result = await extractor(
      "把哈兰德也加入对比，三人对比",
      createInitialConversationContext()
    );

    expect(structuredOutput).toHaveBeenCalledWith(expect.anything(), {
      includeRaw: true,
      method: "functionCalling",
    });
    expect(result).toMatchObject({
      comparisonAction: "add",
      kind: "player_comparison",
      players: [{ lookupName: "Erling Haaland", mention: "哈兰德" }],
    });
  });

  it("treats a literal null placeholder as no lookup-name override", async () => {
    const model = requestUnderstandingTest.fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => ({
        constraints: [],
        kind: "player_lookup",
        players: [
          {
            lookupName: "null",
            mention: "Synthetic Failure Demo",
            referenceScope: "explicit",
          },
        ],
        teams: [],
      }))
    );

    const extractor = createRequestUnderstandingExtractor(
      model,
      testModelContextConfiguration
    );

    const result = await extractor(
      "Look up Synthetic Failure Demo's FM profile and performance data.",
      createInitialConversationContext()
    );

    expect(result.players).toMatchObject([
      { lookupName: null, mention: "Synthetic Failure Demo" },
    ]);
  });

  it("uses a singular pronoun as the only explicit player reference in its turn", () => {
    const message =
      "How many appearances did Fisnik Asllani make? Does his PA guarantee future CA?";

    const players = normalizeExtractedPlayers(message, [
      {
        lookupName: null,
        mention: "Fisnik Asllani",
        referenceScope: "explicit",
      },
      {
        lookupName: null,
        mention: "his",
        referenceScope: "prior_context",
      },
    ]);

    expect(players).toMatchObject([
      { mention: "Fisnik Asllani", referenceScope: "explicit" },
    ]);
  });

  it("does not treat a data source as a player mention", () => {
    const message = "What xA did Understat report?";

    expect(
      normalizeExtractedPlayers(message, [
        {
          lookupName: null,
          mention: "Understat",
          referenceScope: "explicit",
        },
      ])
    ).toStrictEqual([]);
  });

  it("treats an explicit non-pronoun ambiguous mention as a name to resolve", async () => {
    const model = requestUnderstandingTest.fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => ({
        comparisonAction: "replace",
        constraints: [],
        kind: "player_comparison",
        players: [
          {
            lookupName: null,
            mention: "Elias Demo",
            referenceScope: "explicit",
            referenceTargetMention: null,
          },
          {
            lookupName: null,
            mention: "Demo",
            referenceScope: "ambiguous",
            referenceTargetMention: null,
          },
        ],
        teams: [],
      }))
    );

    const extractor = createRequestUnderstandingExtractor(
      model,
      testModelContextConfiguration
    );

    const message = "Compare Elias Demo with the alias Demo.";
    const result = await extractor(message, createInitialConversationContext());

    const normalizedPlayers = normalizeExtractedPlayers(
      message,
      result.players
    );

    expect(
      normalizedPlayers.map(({ mention, referenceScope }) => ({
        mention,
        referenceScope,
      }))
    ).toStrictEqual([
      { mention: "Elias Demo", referenceScope: "explicit" },
      { mention: "Demo", referenceScope: "explicit" },
    ]);
  });

  it("does not resolve a collective possessive as a third comparison player", () => {
    const message =
      "Compare Diagnostic Alpha and Diagnostic Beta using their respective league records.";

    const players = normalizeExtractedPlayers(message, [
      {
        lookupName: null,
        mention: "Diagnostic Alpha",
        recommendationRole: "reference",
        referenceScope: "explicit",
        referenceTargetMention: null,
      },
      {
        lookupName: null,
        mention: "Diagnostic Beta",
        recommendationRole: "reference",
        referenceScope: "explicit",
        referenceTargetMention: null,
      },
      {
        lookupName: null,
        mention: "their",
        recommendationRole: "reference",
        referenceScope: "explicit",
        referenceTargetMention: null,
      },
    ]);

    expect(
      players.map(({ mention, referenceScope }) => ({
        mention,
        referenceScope,
      }))
    ).toStrictEqual([
      { mention: "Diagnostic Alpha", referenceScope: "explicit" },
      { mention: "Diagnostic Beta", referenceScope: "explicit" },
    ]);
  });
});
