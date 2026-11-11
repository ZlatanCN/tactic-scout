import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { Command, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v3";

import type { ReferenceIdentityLookup } from "../../../src/player-data/resolve-reference.js";
import { createRequestUnderstandingExtractor } from "../../../src/request-extraction.js";
import type { RequestUnderstandingExtractor } from "../../../src/request-extraction.js";
import { ActiveRecommendationSchema } from "../../../src/state.js";
import type { RecommendPlayerCandidates } from "../../../src/tools/recommend-player-candidates.js";
import { agentGraphTest } from "../../fixtures/agent-graph.js";
import { testModelContextConfiguration } from "../../fixtures/model-context.js";
import {
  recommendationResult,
  recommendationResultData,
} from "../../fixtures/workflow-results.js";

describe("player recommendation refinements and recovery", () => {
  it("resumes position clarification and refines a completed recommendation without losing identities", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");

    const recommend = vi
      .fn<RecommendPlayerCandidates>(() =>
        recommendationResult("no_candidates")
      )
      .mockReturnValueOnce(
        JSON.stringify({
          commonNaturalPositions: ["stc", "mc"],
          positionOptions: ["stc", "mc"],
          references: [],
          status: "position_required",
        })
      )
      .mockReturnValue(recommendationResult("no_candidates"));

    const initialMessage = "Find young high-potential alternatives to Kane.";
    const refineMessage = "只看当前能力，不考虑 PA";

    const extractor: RequestUnderstandingExtractor = async (message) => {
      if (message === initialMessage) {
        return await Promise.resolve(
          agentGraphTest.requestForPlayers("player_recommendation", ["Kane"], {
            recommendation: {
              includePotential: true,
              maxAge: 23,
              position: null,
              resultLimit: 5,
            },
            recommendationAction: "replace",
          })
        );
      }

      return await Promise.resolve(
        agentGraphTest.requestForPlayers("player_recommendation", [], {
          recommendation: { includePotential: true },
        })
      );
    };

    const model = fakeModel()
      .respond(new AIMessage("No candidates meet the requested filters."))
      .respond(new AIMessage("The refined list still has no candidates."));

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: agentGraphTest.resolvedLookup(kane),
      requestUnderstandingExtractor: extractor,
      tools: agentGraphTest.createTools(agentGraphTest.emptySearch, recommend),
    });

    const config = {
      configurable: { thread_id: "recommendation-refinement-thread" },
    };

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage(initialMessage)] },
      config
    );

    const completed = await graph.invoke(
      new Command({ resume: "中锋" }),
      config
    );

    const refined = await graph.invoke(
      { messages: [new HumanMessage(refineMessage)] },
      config
    );

    expect({
      completedRecommendation:
        completed.conversationContext.activeRecommendation,
      initialInput: recommend.mock.calls[0]?.[0],
      interrupted: Object.hasOwn(interrupted, "__interrupt__"),
      refineInput: recommend.mock.calls[2]?.[0],
      refinedRecommendation: refined.conversationContext.activeRecommendation,
      resumedPosition: recommend.mock.calls[1]?.[0].position,
      toolCalls: recommend.mock.calls.length,
    }).toMatchObject({
      completedRecommendation: {
        maxAge: 23,
        position: "stc",
        referencePlayers: [{ referenceId: "canonical-kane" }],
        status: "no_candidates",
      },
      initialInput: {
        includePotential: true,
        maxAge: 23,
        position: null,
        referenceGroups: [{ fmIds: ["kane-fm"] }],
      },
      interrupted: true,
      refineInput: {
        includePotential: false,
        maxAge: 23,
        minimumPotentialAbility: null,
        position: "stc",
        referenceGroups: [{ fmIds: ["kane-fm"] }],
      },
      refinedRecommendation: {
        includePotential: false,
        referencePlayers: [{ referenceId: "canonical-kane" }],
      },
      resumedPosition: "stc",
      toolCalls: 3,
    });
  });

  it("applies a condition-only refinement extracted without a workflow kind", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const firstMessage = "Find striker alternatives to Kane under 23.";
    const refineMessage = "Lower the age limit to 21.";

    const recommend = vi.fn<RecommendPlayerCandidates>((input) =>
      JSON.stringify(
        recommendationResultData("no_candidates", "stc", {
          filters: {
            includePotential: input.includePotential,
            maxAge: input.maxAge,
            minimumCurrentAbility: input.minimumCurrentAbility,
            minimumPotentialAbility: input.minimumPotentialAbility,
            resultLimit: input.resultLimit ?? 5,
          },
        })
      )
    );

    const model = fakeModel()
      .respond(new AIMessage("No candidates meet the original filters."))
      .respond(new AIMessage("No candidates meet the refined filters."));

    const extractor = agentGraphTest.createExtractor({
      [firstMessage]: agentGraphTest.requestForPlayers(
        "player_recommendation",
        ["Kane"],
        {
          recommendation: { maxAge: 23, position: "stc" },
          recommendationAction: "replace",
        }
      ),
      [refineMessage]: agentGraphTest.requestForPlayers(null, [], {
        continuationAction: "refine",
        recommendation: { maxAge: 21 },
        recommendationAction: "refine",
      }),
    });

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: agentGraphTest.resolvedLookup(kane),
      requestUnderstandingExtractor: extractor,
      tools: agentGraphTest.createTools(agentGraphTest.emptySearch, recommend),
    });

    const config = {
      configurable: { thread_id: "recommendation-refine-null-kind" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);

    const refined = await graph.invoke(
      { messages: [new HumanMessage(refineMessage)] },
      config
    );

    expect({
      activeMaxAge: refined.conversationContext.activeRecommendation?.maxAge,
      calls: recommend.mock.calls.length,
      refinedMaxAge: recommend.mock.calls[1]?.[0].maxAge,
      workflow: refined.request.kind,
    }).toStrictEqual({
      activeMaxAge: 21,
      calls: 2,
      refinedMaxAge: 21,
      workflow: "player_recommendation",
    });
  });

  it("recovers an explicit Chinese age ceiling omitted by request extraction", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const firstMessage = "Find striker alternatives to Kane under 23.";
    const refineMessage = "把年龄上限设为 21 岁。";
    const correctionMessage = "把年龄上限从 21 岁改为 18 岁。";

    const recommend = vi.fn<RecommendPlayerCandidates>((input) =>
      JSON.stringify(
        recommendationResultData("no_candidates", "stc", {
          filters: {
            includePotential: input.includePotential,
            maxAge: input.maxAge,
            minimumCurrentAbility: input.minimumCurrentAbility,
            minimumPotentialAbility: input.minimumPotentialAbility,
            resultLimit: input.resultLimit ?? 5,
          },
        })
      )
    );

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel()
        .respond(new AIMessage("Initial recommendation saved."))
        .respond(new AIMessage("Age-refined recommendation saved."))
        .respond(new AIMessage("Corrected recommendation saved.")),
      playerIdentityLookup: agentGraphTest.resolvedLookup(kane),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [correctionMessage]: agentGraphTest.requestForPlayers(null, [], {
          continuationAction: "refine",
          recommendation: { maxAge: 21 },
          recommendationAction: "refine",
        }),
        [firstMessage]: agentGraphTest.requestForPlayers(
          "player_recommendation",
          ["Kane"],
          {
            recommendation: { maxAge: 23, position: "stc" },
            recommendationAction: "replace",
          }
        ),
        [refineMessage]: agentGraphTest.requestForPlayers(null, [], {
          continuationAction: "refine",
          recommendationAction: "refine",
        }),
      }),
      tools: agentGraphTest.createTools(agentGraphTest.emptySearch, recommend),
    });

    const config = {
      configurable: { thread_id: "chinese-age-refinement-fallback" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);

    const refined = await graph.invoke(
      { messages: [new HumanMessage(refineMessage)] },
      config
    );

    const corrected = await graph.invoke(
      { messages: [new HumanMessage(correctionMessage)] },
      config
    );

    expect({
      activeMaxAge: refined.conversationContext.activeRecommendation?.maxAge,
      calls: recommend.mock.calls.length,
      correctedMaxAge:
        corrected.conversationContext.activeRecommendation?.maxAge,
      correctedToolMaxAge: recommend.mock.calls[2]?.[0].maxAge,
      refinedMaxAge: recommend.mock.calls[1]?.[0].maxAge,
    }).toStrictEqual({
      activeMaxAge: 21,
      calls: 3,
      correctedMaxAge: 18,
      correctedToolMaxAge: 18,
      refinedMaxAge: 21,
    });
  });

  it("keeps a condition-only refinement through structured-output repair after identity confirmation", async () => {
    const reference = agentGraphTest.playerCandidate(
      "Synthetic Reference",
      "reference"
    );

    const addedReference = agentGraphTest.playerCandidate(
      "Synthetic Close Candidate",
      "close"
    );

    const firstMessage =
      "请把 Synthetic Reference 作为参考球员，推荐 STC 位置相似球员。";

    const addMessage = "再加上 Synthetic Close Candidate 作为参考。";
    const refineMessage = "把年龄上限设为 21 岁。";
    const repairAttempts = new Map<string, number>();

    const identityLookup: ReferenceIdentityLookup = (mention) =>
      mention === reference.name
        ? {
            candidateCount: 1,
            candidates: [reference],
            candidatesTruncated: false,
            canonicalIdentityId: reference.canonicalIdentityId,
            clarificationMessage: null,
            mention,
            selectedCandidateId: reference.candidateId,
            selectedName: reference.name,
            status: "resolved",
          }
        : {
            candidateCount: 1,
            candidates: [addedReference],
            candidatesTruncated: false,
            canonicalIdentityId: null,
            clarificationMessage: "Please confirm Synthetic Close Candidate.",
            mention,
            selectedCandidateId: null,
            selectedName: null,
            status: "needs_confirmation",
          };

    const recommend = vi.fn<RecommendPlayerCandidates>((input) =>
      JSON.stringify(
        recommendationResultData("no_candidates", "stc", {
          filters: {
            includePotential: input.includePotential,
            maxAge: input.maxAge,
            minimumCurrentAbility: input.minimumCurrentAbility,
            minimumPotentialAbility: input.minimumPotentialAbility,
            resultLimit: input.resultLimit ?? 5,
          },
        })
      )
    );

    const model = fakeModel()
      .respond(new AIMessage("Initial recommendation saved."))
      .respond(new AIMessage("Added reference recommendation saved."))
      .respond(new AIMessage("Age-refined recommendation saved."));

    const structuredOutput = vi.spyOn(model, "withStructuredOutput");

    structuredOutput.mockReturnValue(
      RunnableLambda.from((messages: BaseMessage[]) => {
        const userMessage = z.string().parse(messages.at(-1)?.content);

        const input = z
          .object({
            currentMessage: z.string(),
            validationFeedback: z.string().optional(),
          })
          .passthrough()
          .parse(JSON.parse(userMessage));

        if (input.currentMessage === refineMessage) {
          const attempts = repairAttempts.get(refineMessage) ?? 0;
          repairAttempts.set(refineMessage, attempts + 1);

          if (input.validationFeedback === undefined) {
            throw Object.assign(new Error("Invalid structured request."), {
              name: "OutputParserException",
            });
          }

          return agentGraphTest.requestForPlayers(null, [], {
            continuationAction: "refine",
            recommendation: { maxAge: 21 },
            recommendationAction: "refine",
          });
        }

        if (input.currentMessage === firstMessage) {
          return agentGraphTest.requestForPlayers(
            "player_recommendation",
            ["Synthetic Reference"],
            {
              recommendation: { position: "stc" },
              recommendationAction: "replace",
            }
          );
        }

        return agentGraphTest.requestForPlayers(
          "player_recommendation",
          ["Synthetic Close Candidate"],
          {
            continuationAction: "refine",
            recommendationAction: "add",
          }
        );
      })
    );

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: createRequestUnderstandingExtractor(
        model,
        testModelContextConfiguration
      ),
      tools: agentGraphTest.createTools(agentGraphTest.emptySearch, recommend),
    });

    const config = {
      configurable: { thread_id: "recommend-refine-after-extraction-repair" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage(addMessage)] },
      config
    );

    await graph.invoke(new Command({ resume: "1" }), config);

    const refined = await graph.invoke(
      { messages: [new HumanMessage(refineMessage)] },
      config
    );

    expect({
      activeMaxAge: refined.conversationContext.activeRecommendation?.maxAge,
      interruptAsked: Object.hasOwn(interrupted, "__interrupt__"),
      recommendationCalls: recommend.mock.calls.length,
      refinedMaxAge: recommend.mock.calls.at(-1)?.[0].maxAge,
      structuredOutputRepairs: repairAttempts.get(refineMessage),
    }).toStrictEqual({
      activeMaxAge: 21,
      interruptAsked: true,
      recommendationCalls: 3,
      refinedMaxAge: 21,
      structuredOutputRepairs: 2,
    });
  });

  it("keeps existing recommendation references before newly added references", async () => {
    const existingReference = agentGraphTest.playerCandidate(
      "Existing Reference",
      "z-reference"
    );

    const addedReference = agentGraphTest.playerCandidate(
      "Added Reference",
      "a-reference"
    );

    const firstMessage = "Find STC alternatives based on Existing Reference.";
    const addMessage = "Add Added Reference as a reference.";

    const recommend = vi.fn<RecommendPlayerCandidates>((input) =>
      JSON.stringify(
        recommendationResultData("ready", "stc", {
          filters: {
            includePotential: input.includePotential,
            maxAge: input.maxAge,
            minimumCurrentAbility: input.minimumCurrentAbility,
            minimumPotentialAbility: input.minimumPotentialAbility,
            resultLimit: input.resultLimit ?? 5,
          },
          referenceFmIds: input.referenceGroups.flatMap(({ fmIds }) => fmIds),
        })
      )
    );

    const model = fakeModel()
      .respond(new AIMessage("Initial recommendation saved."))
      .respond(new AIMessage("Added reference recommendation saved."));

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: agentGraphTest.resolvedLookupFromCandidates([
        existingReference,
        addedReference,
      ]),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [addMessage]: agentGraphTest.requestForPlayers(
          "player_recommendation",
          ["Added Reference"],
          { recommendationAction: "add" }
        ),
        [firstMessage]: agentGraphTest.requestForPlayers(
          "player_recommendation",
          ["Existing Reference"],
          {
            recommendation: {
              includePotential: false,
              position: "stc",
              resultLimit: 5,
            },
            recommendationAction: "replace",
          }
        ),
      }),
      tools: agentGraphTest.createTools(agentGraphTest.emptySearch, recommend),
    });

    const config = {
      configurable: { thread_id: "recommendation-reference-order" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);
    await graph.invoke({ messages: [new HumanMessage(addMessage)] }, config);

    expect(
      recommend.mock.calls[1]?.[0].referenceGroups.map(({ fmIds }) => fmIds)
    ).toStrictEqual([["z-reference-fm"], ["a-reference-fm"]]);
  });

  it("does not run a recommendation when an extracted hard condition is unsupported", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");

    const recommend = vi.fn<RecommendPlayerCandidates>(() =>
      recommendationResult("ready")
    );

    const message = "Find alternatives to Kane under a £50m budget.";

    const graph = agentGraphTest.createAgent({
      model: fakeModel(),
      playerIdentityLookup: agentGraphTest.resolvedLookup(kane),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [message]: agentGraphTest.requestForPlayers(
          "player_recommendation",
          ["Kane"],
          {
            constraints: [{ name: "budget", value: "£50m" }],
            recommendation: {
              includePotential: false,
              position: "stc",
              resultLimit: 5,
            },
          }
        ),
      }),
      tools: agentGraphTest.createTools(agentGraphTest.emptySearch, recommend),
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "unsupported-recommendation-condition" } }
    );

    expect(recommend).not.toHaveBeenCalled();
    expect(result.messages.at(-1)?.content).toContain(
      "没有按删减后的条件生成候选"
    );
    expect(result.conversationContext.activeRecommendation).toBeNull();
  });

  it("clarifies a vague youth request and resumes with the retained reference player", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const message = "Find young alternatives to Kane.";

    const recommend = vi.fn<RecommendPlayerCandidates>(() =>
      recommendationResult("ready")
    );

    const graph = agentGraphTest.createAgent({
      model: fakeModel().respond(
        new AIMessage("The age-limited list is ready.")
      ),
      playerIdentityLookup: agentGraphTest.resolvedLookup(kane),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [message]: agentGraphTest.requestForPlayers(
          "player_recommendation",
          ["Kane"],
          {
            recommendation: { includePotential: true, position: "stc" },
          }
        ),
      }),
      tools: agentGraphTest.createTools(agentGraphTest.emptySearch, recommend),
    });

    const config = {
      configurable: { thread_id: "youth-age-clarification" },
    };

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      config
    );

    const resumed = await graph.invoke(
      new Command({ resume: "23岁以下" }),
      config
    );

    expect({
      ageLimit: recommend.mock.calls[0]?.[0].maxAge,
      interrupted: Object.hasOwn(interrupted, "__interrupt__"),
      referenceGroups: recommend.mock.calls[0]?.[0].referenceGroups,
      savedAge: resumed.conversationContext.activeRecommendation?.maxAge,
    }).toMatchObject({
      ageLimit: 23,
      interrupted: true,
      referenceGroups: [{ fmIds: ["kane-fm"] }],
      savedAge: 23,
    });
  });

  it("propagates unexpected tool errors without replacing the last successful recommendation", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const firstMessage = "Find striker alternatives to Kane under 23.";
    const refineMessage = "Lower the age limit to 21.";
    const readyResult = recommendationResult("ready");

    const recommend = vi
      .fn<RecommendPlayerCandidates>(() => readyResult)
      .mockReturnValueOnce(readyResult)
      .mockImplementationOnce(() => {
        throw new Error("Fixture recommendation read failed.");
      });

    const model = fakeModel().respond(
      new AIMessage("The first list is ready.")
    );

    const extractor: RequestUnderstandingExtractor = async (message) => {
      const selectedRequest =
        message === firstMessage
          ? agentGraphTest.requestForPlayers(
              "player_recommendation",
              ["Kane"],
              {
                recommendation: {
                  includePotential: false,
                  maxAge: 23,
                  position: "stc",
                },
              }
            )
          : agentGraphTest.requestForPlayers("player_recommendation", [], {
              recommendation: { maxAge: 21 },
            });

      return await Promise.resolve(selectedRequest);
    };

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: agentGraphTest.resolvedLookup(kane),
      requestUnderstandingExtractor: extractor,
      tools: agentGraphTest.createTools(agentGraphTest.emptySearch, recommend),
    });

    const config = {
      configurable: { thread_id: "recommendation-tool-failure" },
    };

    const first = await graph.invoke(
      { messages: [new HumanMessage(firstMessage)] },
      config
    );

    const previousRecommendation =
      first.conversationContext.activeRecommendation;

    await expect(
      graph.invoke({ messages: [new HumanMessage(refineMessage)] }, config)
    ).rejects.toThrow("Fixture recommendation read failed.");

    const failedState = z
      .object({
        values: z.object({
          conversationContext: z.object({
            activeRecommendation: ActiveRecommendationSchema.nullable(),
          }),
        }),
      })
      .safeParse(structuredClone(await graph.getState(config)));

    expect({
      activeRecommendation: failedState.success
        ? failedState.data.values.conversationContext.activeRecommendation
        : null,
      toolCalls: recommend.mock.calls.length,
    }).toMatchObject({
      activeRecommendation: previousRecommendation,
      toolCalls: 2,
    });
  });
});
