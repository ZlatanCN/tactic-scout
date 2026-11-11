import type { BaseMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { createRequestUnderstandingExtractor } from "../../../src/request-extraction.js";
import { createInitialConversationContext } from "../../../src/state.js";
import type { ConversationContext } from "../../../src/state.js";
import { testModelContextConfiguration } from "../../fixtures/model-context.js";
import { requestUnderstandingTest } from "../../fixtures/request-understanding.js";

describe("team request extraction and refinement", () => {
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

  it("keeps the user's team mention separate from the provider search name", async () => {
    const model = requestUnderstandingTest.fakeModel();
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

    const extractor = createRequestUnderstandingExtractor(
      model,
      testModelContextConfiguration
    );

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

  it("preserves an explicitly written supported position code for team recommendations", async () => {
    const model = requestUnderstandingTest.fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => ({
        constraints: [],
        kind: "team_recommendation",
        players: [],
        teamSearchName: "Synthetic Town",
        teams: ["Synthetic Town"],
      }))
    );

    const extractor = createRequestUnderstandingExtractor(
      model,
      testModelContextConfiguration
    );

    const result = await extractor(
      "为 Synthetic Town 推荐 stc 球员。",
      createInitialConversationContext()
    );

    expect(result.recommendation?.position).toBe("stc");
  });

  it("requires repeated explicit team names to stay in the team list during refinement", async () => {
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
          recommendation: { minimumCurrentAbility: 150, position: "stc" },
          teamSearchName: "Real Madrid",
          teams: ["Real Madrid"],
        };
      })
    );

    const extractor = createRequestUnderstandingExtractor(
      model,
      testModelContextConfiguration
    );

    const message = "为 Real Madrid 继续推荐 stc 球员，CA 下限 150。";
    const result = await extractor(message, createInitialConversationContext());

    expect({
      keepsExplicitSameTeamDuringRefinement: systemPrompt.includes(
        "即使该球队与上次相同、用户同时细化筛选条件，也必须照抄到 teams"
      ),
      teams: result.teams,
    }).toStrictEqual({
      keepsExplicitSameTeamDuringRefinement: true,
      teams: ["Real Madrid"],
    });
  });

  it("deterministically extracts an explicit CA refinement from a saved team recommendation", async () => {
    const model = requestUnderstandingTest.fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");

    const invoke = vi.fn<() => never>(() => {
      throw new Error(
        "The structured model should not run for this refinement."
      );
    });

    structuredOutput.mockReturnValue(RunnableLambda.from(invoke));

    const context: ConversationContext = {
      ...createInitialConversationContext(),
      activeTeamRecommendation: {
        includePotential: false,
        maxAge: null,
        minimumCurrentAbility: null,
        minimumPotentialAbility: null,
        position: "stc",
        referenceMode: "squad",
        referencePlayers: [],
        resultJson: JSON.stringify({ status: "ready" }),
        resultLimit: 5,
        roster: {
          members: [],
          retrievedAt: "2026-11-02T00:00:00.000Z",
          team: { country: "Spain", id: 541, name: "Real Madrid" },
        },
        status: "ready",
        team: { country: "Spain", id: 541, name: "Real Madrid" },
      },
    };

    const extractor = createRequestUnderstandingExtractor(
      model,
      testModelContextConfiguration
    );

    const result = await extractor("把球队推荐的 CA 下限设为 130。", context);

    expect({
      extractorModelCalls: invoke.mock.calls.length,
      kind: result.kind,
      recommendation: result.recommendation,
      teams: result.teams,
    }).toStrictEqual({
      extractorModelCalls: 0,
      kind: "team_recommendation",
      recommendation: { minimumCurrentAbility: 130 },
      teams: [],
    });
  });

  it("recovers an explicit team recommendation when structured extraction says other", async () => {
    const model = requestUnderstandingTest.fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => ({
        constraints: [],
        kind: "other",
        players: [],
        teams: [],
      }))
    );

    const extractor = createRequestUnderstandingExtractor(
      model,
      testModelContextConfiguration
    );

    const result = await extractor(
      "为 Real Madrid 推荐 stc 球员。",
      createInitialConversationContext()
    );

    expect(result).toMatchObject({
      kind: "team_recommendation",
      recommendation: { position: "stc" },
      teams: ["Real Madrid"],
    });
  });

  it.each([
    "根据 Erling Haaland 推荐 stc 球员。",
    "以 Erling Haaland 的能力画像推荐 stc 球员。",
  ])(
    "keeps a player-based recommendation out of the team workflow when no team was named: %s",
    async (message) => {
      const model = requestUnderstandingTest.fakeModel();
      const structuredOutput = vi.spyOn(model, "withStructuredOutput");

      structuredOutput.mockReturnValue(
        RunnableLambda.from(() => ({
          constraints: [],
          kind: "team_recommendation",
          players: [
            {
              lookupName: null,
              mention: "Erling Haaland",
              recommendationRole: "reference",
              referenceScope: "explicit",
              referenceTargetMention: null,
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
        message,
        createInitialConversationContext()
      );

      expect(result).toMatchObject({
        kind: "player_recommendation",
        recommendation: { position: "stc" },
        recommendationAction: "replace",
        teams: [],
      });
    }
  );

  it("does not treat a player reference echoed in teams as a club recommendation", async () => {
    const message =
      "根据 Synthetic Reference 推荐 stc 球员，不要 Synthetic Far Candidate。";

    const model = requestUnderstandingTest.fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => ({
        constraints: [],
        kind: "team_recommendation",
        players: [
          {
            lookupName: null,
            mention: "Synthetic Reference",
            recommendationRole: "reference",
            referenceScope: "explicit",
            referenceTargetMention: null,
          },
          {
            lookupName: null,
            mention: "Synthetic Far Candidate",
            recommendationRole: "exclude",
            referenceScope: "explicit",
            referenceTargetMention: null,
          },
        ],
        recommendation: { position: "stc" },
        teamSearchName: "Synthetic Reference",
        teams: ["Synthetic Reference"],
      }))
    );

    const extractor = createRequestUnderstandingExtractor(
      model,
      testModelContextConfiguration
    );

    const result = await extractor(message, createInitialConversationContext());

    expect(result).toMatchObject({
      kind: "player_recommendation",
      recommendation: { position: "stc" },
      recommendationAction: "replace",
      teamSearchName: null,
      teams: [],
    });
  });
});
