import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { describe, expect, it, vi } from "vitest";

import { createRequestUnderstandingExtractor } from "../src/request-extraction.js";
import { createInitialConversationContext } from "../src/state.js";

describe("request understanding extraction", () => {
  it("uses tool calling and recognizes a request to add a player to the active comparison", async () => {
    const model = fakeModel();
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
    const extractor = createRequestUnderstandingExtractor(model);

    const result = await extractor(
      "把哈兰德也加入对比，三人对比",
      createInitialConversationContext()
    );

    expect(structuredOutput).toHaveBeenCalledWith(expect.anything(), {
      method: "functionCalling",
    });
    expect(result).toMatchObject({
      comparisonAction: "add",
      kind: "player_comparison",
      players: [{ lookupName: "Erling Haaland", mention: "哈兰德" }],
    });
  });

  it("preserves explicit null while omitting recommendation fields the user did not mention", async () => {
    const model = fakeModel();
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

    const extractor = createRequestUnderstandingExtractor(model);

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

  it("keeps the user's team mention separate from the provider search name", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => ({
        constraints: [],
        kind: "team_recommendation",
        players: [],
        recommendation: { position: "stc" },
        teamSearchName: "Arsenal",
        teams: ["阿森纳"],
      }))
    );

    const extractor = createRequestUnderstandingExtractor(model);

    const result = await extractor(
      "为阿森纳找一个中锋",
      createInitialConversationContext()
    );

    expect(result).toMatchObject({
      kind: "team_recommendation",
      recommendation: { position: "stc" },
      teamSearchName: "Arsenal",
      teams: ["阿森纳"],
    });
  });
});
