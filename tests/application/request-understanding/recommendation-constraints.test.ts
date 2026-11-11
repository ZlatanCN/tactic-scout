import { setTimeout as delay } from "node:timers/promises";

import { HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { createRequestUnderstandingExtractor } from "../../../src/request-extraction.js";
import { createInitialConversationContext } from "../../../src/state.js";
import { testModelContextConfiguration } from "../../fixtures/model-context.js";
import { requestUnderstandingTest } from "../../fixtures/request-understanding.js";

describe("recommendation constraint extraction", () => {
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

  it("preserves explicit null while omitting recommendation fields the user did not mention", async () => {
    const model = requestUnderstandingTest.fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => ({
        constraints: [],
        kind: "player_recommendation",
        players: [],
        recommendation: { maxAge: null },
        teams: [],
      }))
    );

    const extractor = createRequestUnderstandingExtractor(
      model,
      testModelContextConfiguration
    );

    const result = await extractor(
      "Remove the age limit from the last recommendation.",
      createInitialConversationContext()
    );

    expect({
      action: result.recommendationAction,
      recommendation: result.recommendation,
    }).toStrictEqual({
      action: "replace",
      recommendation: { maxAge: null },
    });
  });

  it("maps a generic maximum-age constraint into the recommendation filter", async () => {
    const graph = requestUnderstandingTest.createAgent({
      checkpointer: new MemorySaver(),
      model: requestUnderstandingTest.fakeModel(),
      requestUnderstandingExtractor: async () => {
        await delay(0);

        return {
          constraints: [{ name: "maximum_age", value: "21" }],
          kind: "player_recommendation",
          players: [],
          recommendation: { position: "stc" },
          teams: [],
        };
      },
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Find striker candidates under 21.")] },
      { configurable: { thread_id: "recommendation-maximum-age-alias" } }
    );

    if (result.request.kind !== "player_recommendation") {
      throw new Error("Expected a player recommendation request.");
    }

    expect(result.request.recommendation.maxAge).toBe(21);
  });

  it("preserves a relative comparison season when structured extraction omits it", async () => {
    const model = requestUnderstandingTest.fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => ({
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
            mention: "Synthetic Midfielder",
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
      "Compare Elias Demo and Synthetic Midfielder from last season.",
      createInitialConversationContext()
    );

    expect(result.constraints).toContainEqual({
      name: "season",
      value: "last season",
    });
  });

  it("maps an explicit supported position code even when structured extraction omits it", async () => {
    const model = requestUnderstandingTest.fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let systemPrompt = "";

    structuredOutput.mockReturnValue(
      RunnableLambda.from((messages: BaseMessage[]) => {
        const [firstMessage] = messages;
        systemPrompt = z.string().parse(firstMessage?.content);

        return {
          constraints: [],
          kind: "team_recommendation",
          players: [],
          teamSearchName: "Synthetic Town",
          teams: ["Synthetic Town"],
        };
      })
    );

    const extractor = createRequestUnderstandingExtractor(
      model,
      testModelContextConfiguration
    );

    const result = await extractor(
      "为 Synthetic Town 推荐 stc 球员。",
      createInitialConversationContext()
    );

    expect({
      position: result.recommendation?.position ?? null,
      promptRule: systemPrompt.includes(
        "team_recommendation 中，用户直接写出的受支持位置代码（如 stc、dc、dm）必须填入 recommendation.position"
      ),
    }).toStrictEqual({ position: "stc", promptRule: true });
  });
});
