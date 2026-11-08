import { setTimeout as delay } from "node:timers/promises";

import { HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import type { RunnableConfig } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver, NodeTimeoutError } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { modelRequestTimeoutMs } from "../src/fault-tolerance.js";
import type { ModelRequestBudget } from "../src/model-requests.js";
import {
  createRequestUnderstandingExtractor,
  normalizeExtractedPlayers,
} from "../src/request-extraction.js";
import type { ConversationContext } from "../src/state.js";
import { createInitialConversationContext } from "../src/state.js";

vi.stubEnv("OPENAI_API_KEY", "vitest-placeholder");

vi.stubEnv("OPENAI_MODEL", "vitest-placeholder");

vi.stubEnv("OPENAI_BASE_URL", "");

const { createAgent } = await import("../src/agent.js");

const mockShortModelTimeout = () => {
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);

  return vi
    .spyOn(AbortSignal, "timeout")
    .mockImplementation((milliseconds) =>
      originalTimeout(milliseconds === modelRequestTimeoutMs ? 5 : milliseconds)
    );
};

describe("request understanding extraction", () => {
  it.each([
    ["up to three players", 3],
    ["最多 3 名球员", 3],
  ])(
    "deterministically extracts the requested recommendation limit from %s",
    async (limitPhrase, expectedLimit) => {
      const model = fakeModel();
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

      const extractor = createRequestUnderstandingExtractor(model);

      const result = await extractor(
        `Based on Erling Haaland's STC profile, recommend ${limitPhrase}.`,
        createInitialConversationContext()
      );

      expect(result.recommendation?.resultLimit).toBe(expectedLimit);
    }
  );

  it("does not accept model-inferred memory type or IDs absent from the forget command", async () => {
    const model = fakeModel();
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
    const extractor = createRequestUnderstandingExtractor(model);

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
    const model = fakeModel();
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
    const extractor = createRequestUnderstandingExtractor(model);

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
    const model = fakeModel();
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
    const extractor = createRequestUnderstandingExtractor(model);

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
    const model = fakeModel();
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
    const extractor = createRequestUnderstandingExtractor(model);

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

  it("treats a literal null placeholder as no lookup-name override", async () => {
    const model = fakeModel();
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
    const extractor = createRequestUnderstandingExtractor(model);

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

  it("keeps real ChatOpenAI SDK retries inside the graph's physical request budget", async () => {
    const requestSchema = z.looseObject({
      tools: z.array(
        z.looseObject({
          function: z.looseObject({ name: z.string() }),
        })
      ),
    });

    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      await delay(0);
      const requestInit = z.object({ body: z.string() }).parse(init);
      const request = requestSchema.parse(JSON.parse(requestInit.body));
      const functionName = request.tools[0]?.function.name;

      if (functionName === undefined) {
        throw new Error(
          "The request did not include the structured-output tool."
        );
      }

      if (fetcher.mock.calls.length === 1) {
        return Response.json(
          { error: { message: "temporary upstream error" } },
          { status: 503 }
        );
      }

      return Response.json({
        choices: [
          {
            finish_reason: "tool_calls",
            index: 0,
            message: {
              content: null,
              role: "assistant",
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify({
                      constraints: [],
                      kind: "other",
                      players: [],
                      teams: [],
                    }),
                    name: functionName,
                  },
                  id: "structured-request-1",
                  type: "function",
                },
              ],
            },
          },
        ],
        created: 1_700_000_000,
        id: "chatcmpl-fault-test",
        model: "fault-test",
        object: "chat.completion",
        usage: {
          completion_tokens: 1,
          prompt_tokens: 1,
          total_tokens: 2,
        },
      });
    });

    const model = new ChatOpenAI({
      apiKey: "test-key",
      configuration: {
        baseURL: "https://gateway.test/v1",
        fetch: fetcher,
      },
      maxRetries: 0,
      model: "fault-test",
      temperature: 0,
    });

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "chat-openai-physical-budget" } }
    );

    expect({
      kind: result.request.kind,
      physicalRequests: fetcher.mock.calls.length,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      kind: "other",
      physicalRequests: 2,
      response:
        "当前版本支持查询、比较和推荐球员资料。请说明你要完成哪一种任务。",
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

  it("maps a generic maximum-age constraint into the recommendation filter", async () => {
    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
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
    const model = fakeModel();
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

    const extractor = createRequestUnderstandingExtractor(model);

    const result = await extractor(
      "Compare Elias Demo and Synthetic Midfielder from last season.",
      createInitialConversationContext()
    );

    expect(result.constraints).toContainEqual({
      name: "season",
      value: "last season",
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

  it("preserves an explicitly written supported position code for team recommendations", async () => {
    const model = fakeModel();
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

    const extractor = createRequestUnderstandingExtractor(model);

    const result = await extractor(
      "为 Synthetic Town 推荐 stc 球员。",
      createInitialConversationContext()
    );

    expect(result.recommendation?.position).toBe("stc");
  });

  it("requires repeated explicit team names to stay in the team list during refinement", async () => {
    const model = fakeModel();
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

    const extractor = createRequestUnderstandingExtractor(model);
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
    const model = fakeModel();
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

    const extractor = createRequestUnderstandingExtractor(model);
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

  it("maps an explicit supported position code even when structured extraction omits it", async () => {
    const model = fakeModel();
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

    const extractor = createRequestUnderstandingExtractor(model);

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

  it("recovers an explicit team recommendation when structured extraction says other", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => ({
        constraints: [],
        kind: "other",
        players: [],
        teams: [],
      }))
    );

    const extractor = createRequestUnderstandingExtractor(model);

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
      const model = fakeModel();
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

      const extractor = createRequestUnderstandingExtractor(model);

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

    const model = fakeModel();
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

    const extractor = createRequestUnderstandingExtractor(model);

    const result = await extractor(message, createInitialConversationContext());

    expect(result).toMatchObject({
      kind: "player_recommendation",
      recommendation: { position: "stc" },
      recommendationAction: "replace",
      teamSearchName: null,
      teams: [],
    });
  });

  it("treats an explicit non-pronoun ambiguous mention as a name to resolve", async () => {
    const model = fakeModel();
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

    const extractor = createRequestUnderstandingExtractor(model);

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

  it("retries a transient request, then repairs one invalid structured response", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => {
        calls += 1;

        if (calls === 1) {
          throw Object.assign(new Error("temporary connection failure"), {
            code: "ECONNRESET",
          });
        }

        if (calls === 2) {
          throw Object.assign(new Error("Invalid structured request."), {
            name: "OutputParserException",
          });
        }

        return {
          constraints: [],
          kind: "other",
          players: [],
          teams: [],
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-output-repair" } }
    );

    expect({
      kind: result.request.kind,
      outputCalls: calls,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      kind: "other",
      outputCalls: 3,
      response:
        "当前版本支持查询、比较和推荐球员资料。请说明你要完成哪一种任务。",
    });
  });

  it("does not restart extraction when the single repair request fails", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => {
        calls += 1;

        if (calls === 1) {
          throw Object.assign(new Error("Invalid structured request."), {
            name: "OutputParserException",
          });
        }

        throw Object.assign(new Error("temporary connection failure"), {
          code: "ECONNRESET",
        });
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-repair-failure" } }
    );

    expect({
      outputCalls: calls,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      outputCalls: 2,
      response: "请求理解模型暂时不可用，因此没有执行这条新请求。",
    });
    expect(result).not.toHaveProperty("request");
  });

  it("reminds structured-output repair to include required request fields", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let repairFeedback = "";
    let requestsUsed = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from((messages: BaseMessage[]) => {
        const userMessage = z.string().parse(messages.at(-1)?.content);

        const input = z
          .looseObject({
            currentMessage: z.string(),
            validationFeedback: z.string().optional(),
          })
          .parse(JSON.parse(userMessage));

        if (input.validationFeedback === undefined) {
          throw Object.assign(new Error("Invalid structured request."), {
            name: "OutputParserException",
          });
        }

        repairFeedback = input.validationFeedback;

        return {
          constraints: [],
          continuationAction: "refine",
          kind: null,
          players: [],
          recommendation: { maxAge: 21 },
          recommendationAction: "refine",
          teams: [],
        };
      })
    );

    const budget: ModelRequestBudget = {
      canMakeRequest: () => true,
      invoke: async <Value>(
        request: (signal?: AbortSignal) => Promise<Value>
      ) => {
        requestsUsed += 1;

        return await request();
      },
      lastRequestDurationMs: () => 0,
      logRepair: () => {},
      requestsUsed: () => requestsUsed,
    };

    const extractor = createRequestUnderstandingExtractor(model);

    const result = await extractor(
      "把年龄上限设为 21 岁。",
      createInitialConversationContext(),
      budget
    );

    expect({
      hasRequiredFields: ["constraints", "kind", "players", "teams"].every(
        (field) => repairFeedback.includes(field)
      ),
      maxAge: result.recommendation?.maxAge,
      removesNullComparisonAction: repairFeedback.includes("comparisonAction"),
      requestsUsed,
    }).toStrictEqual({
      hasRequiredFields: true,
      maxAge: 21,
      removesNullComparisonAction: true,
      requestsUsed: 2,
    });
  });

  it("stops after a timed-out structured repair instead of restarting extraction", async () => {
    const timeoutSpy = mockShortModelTimeout();

    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(async (_input, options: RunnableConfig) => {
        calls += 1;

        if (calls === 1) {
          throw Object.assign(new Error("Invalid structured request."), {
            name: "OutputParserException",
          });
        }

        await delay(1000, undefined, { signal: options.signal });

        return {
          constraints: [],
          kind: "other",
          players: [],
          teams: [],
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-repair-timeout" } }
    );

    timeoutSpy.mockRestore();

    expect({
      calls,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      calls: 2,
      response: "请求理解模型暂时不可用，因此没有执行这条新请求。",
    });
    expect(result).not.toHaveProperty("request");
  });

  it("retries a short model 429 only with delay and remaining-quota evidence", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => {
        calls += 1;

        if (calls === 1) {
          throw Object.assign(new Error("short rate limit"), {
            code: "rate_limit_exceeded",
            headers: new Headers({
              "retry-after": "0",
              "x-ratelimit-remaining-requests": "5",
            }),
            status: 429,
          });
        }

        return {
          constraints: [],
          kind: "other",
          players: [],
          teams: [],
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-model-short-rate-limit" } }
    );

    expect({
      kind: result.request.kind,
      outputCalls: calls,
    }).toStrictEqual({ kind: "other", outputCalls: 2 });
  });

  it("does not restart a model node after a timeout following an internal 429 retry", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => {
        calls += 1;

        if (calls === 1) {
          throw Object.assign(new Error("short rate limit"), {
            code: "rate_limit_exceeded",
            headers: new Headers({
              "retry-after": "0",
              "x-ratelimit-remaining-requests": "5",
            }),
            status: 429,
          });
        }

        throw new NodeTimeoutError({
          elapsed: 60_000,
          kind: "run",
          node: "understand_request",
          runTimeout: 60_000,
        });
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-rate-timeout-budget" } }
    );

    expect({
      calls,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      calls: 2,
      response: "请求理解模型暂时不可用，因此没有执行这条新请求。",
    });
  });

  it("uses the final physical request after a short-429 retry has a transient failure", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => {
        calls += 1;

        if (calls === 1) {
          throw Object.assign(new Error("short rate limit"), {
            code: "rate_limit_exceeded",
            headers: new Headers({
              "retry-after": "0",
              "x-ratelimit-remaining-requests": "5",
            }),
            status: 429,
          });
        }

        if (calls === 2) {
          throw Object.assign(new Error("temporary network failure"), {
            code: "ECONNRESET",
          });
        }

        return {
          constraints: [],
          kind: "other",
          players: [],
          teams: [],
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-429-then-transient" } }
    );

    expect({ calls, kind: result.request.kind }).toStrictEqual({
      calls: 3,
      kind: "other",
    });
  });

  it("does not retry a model 429 that reports exhausted quota", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => {
        calls += 1;
        throw Object.assign(new Error("quota exhausted"), {
          code: "insufficient_quota",
          headers: new Headers({
            "retry-after": "0",
            "x-ratelimit-remaining-requests": "5",
          }),
          status: 429,
        });
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-model-quota" } }
    );

    expect({
      outputCalls: calls,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      outputCalls: 1,
      response: "模型服务额度已用完，本次请求没有完成。",
    });
  });

  it("does not retry a model 429 with a non-standard quota code", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => {
        calls += 1;
        throw Object.assign(new Error("organization quota exhausted"), {
          code: "organization_quota_exceeded",
          headers: new Headers({
            "retry-after": "0",
            "x-ratelimit-remaining-requests": "5",
          }),
          status: 429,
        });
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-model-organization-quota" } }
    );

    expect({
      calls,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      calls: 1,
      response: "模型服务额度已用完，本次请求没有完成。",
    });
  });

  it("does not retry a model 429 without positive remaining-quota evidence", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => {
        calls += 1;
        throw Object.assign(new Error("rate limit without quota evidence"), {
          code: "rate_limit_exceeded",
          headers: new Headers({ "retry-after": "0" }),
          status: 429,
        });
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-model-429-no-quota-evidence" } }
    );

    expect({
      calls,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      calls: 1,
      response: "模型服务正在限流，本次请求没有完成。",
    });
  });

  it("does not wait beyond the model rate-limit wait bound", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => {
        calls += 1;
        throw Object.assign(new Error("long rate limit"), {
          code: "rate_limit_exceeded",
          headers: new Headers({
            "retry-after": "20",
            "x-ratelimit-remaining-requests": "5",
          }),
          status: 429,
        });
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-model-long-rate-limit" } }
    );

    expect({
      calls,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      calls: 1,
      response: "模型服务正在限流，本次请求没有完成。",
    });
  });

  it("retries a recognized model-attempt timeout", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(() => {
        calls += 1;

        if (calls === 1) {
          throw Object.assign(new Error("model request timed out"), {
            name: "TimeoutError",
          });
        }

        return {
          constraints: [],
          kind: "other",
          players: [],
          teams: [],
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-model-attempt-timeout" } }
    );

    expect({ calls, kind: result.request.kind }).toStrictEqual({
      calls: 2,
      kind: "other",
    });
  });

  it("ignores late model responses and caps timed-out physical requests at three", async () => {
    const timeoutSpy = mockShortModelTimeout();

    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(async () => {
        calls += 1;
        await delay(20);

        return {
          constraints: [],
          kind: "other",
          players: [],
          teams: [],
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      { configurable: { thread_id: "request-model-timeout-budget" } }
    );

    timeoutSpy.mockRestore();

    expect({
      calls,
      response: result.messages.at(-1)?.content,
    }).toStrictEqual({
      calls: 3,
      response: "请求理解模型暂时不可用，因此没有执行这条新请求。",
    });
  });

  it("propagates caller cancellation to an in-flight model request", async () => {
    const model = fakeModel();
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    let calls = 0;

    structuredOutput.mockReturnValue(
      RunnableLambda.from(async (_input, options: RunnableConfig) => {
        calls += 1;
        await delay(1000, undefined, { signal: options?.signal });

        return {
          constraints: [],
          kind: "other",
          players: [],
          teams: [],
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
    });

    const controller = new AbortController();

    const abortTimer = setTimeout(() => {
      controller.abort();
    }, 5);

    const pending = graph.invoke(
      { messages: [new HumanMessage("Help me with a football question.")] },
      {
        configurable: { thread_id: "request-model-cancellation" },
        signal: controller.signal,
      }
    );

    await expect(pending).rejects.toThrow("aborted");
    clearTimeout(abortTimer);

    expect(calls).toBe(1);
  });
});
