import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { activeComparisonContext } from "../../../src/comparison-context.js";
import { assessModelRequest } from "../../../src/model-context.js";
import { prepareRequestUnderstandingModelRequest } from "../../../src/request-extraction.js";
import {
  AgentState,
  agentStateSchemaVersion,
  createInitialConversationContext,
} from "../../../src/state.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";
import { textCompactionTest } from "../../fixtures/text-compaction.js";
import type { AgentStateType } from "../../fixtures/text-compaction.js";

describe("compaction triggers and allowance accounting", () => {
  it("keeps a fitting request on the ordinary one-call path", async () => {
    const model = fakeModel();
    const modelPayloads: unknown[] = [];
    textCompactionTest.mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        modelPayloads.push(input);

        return {
          parsed: {
            constraints: [],
            kind: "player_lookup",
            players: [
              {
                lookupName: null,
                mention: "Harry Kane",
                recommendationRole: "reference",
                referenceScope: "explicit",
                referenceTargetMention: null,
              },
            ],
            teams: [],
          },
          raw: new AIMessage("structured response"),
        };
      })
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile: textCompactionTest.modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      playerIdentityLookup: (mention) => ({
        candidateCount: 0,
        candidates: [],
        candidatesTruncated: false,
        canonicalIdentityId: null,
        clarificationMessage: null,
        mention,
        selectedCandidateId: null,
        selectedName: null,
        status: "data_unavailable",
      }),
      store: null,
      tools: [],
    });

    const result = AgentState.parse(
      await graph.invoke(
        { messages: [new HumanMessage("Look up Harry Kane.")] },
        { configurable: { thread_id: "small-request-no-compaction" } }
      )
    );

    const { allowance } = result.contextProcessing;

    if (allowance === null) {
      throw new Error("The request allowance was not initialized.");
    }

    expect({
      compaction: result.contextProcessing.compaction,
      consumedActiveTimeMs: allowance.consumedActiveTimeMs,
      consumedAdditionalCalls: allowance.consumedAdditionalCalls,
      modelInputCount: modelPayloads.length,
      outcome: result.outcome?.status,
      requestKind: result.request.kind,
    }).toStrictEqual({
      compaction: null,
      consumedActiveTimeMs: 0,
      consumedAdditionalCalls: 0,
      modelInputCount: 1,
      outcome: "identity_data_unavailable",
      requestKind: "player_lookup",
    });
    expect(allowance.reservation).toBeNull();
  });

  it("compacts at the configured soft trigger and passes the target to the compactor", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const original = `Look up Harry Kane for 2025/26, excluding Erling Haaland. ${filler}`;

    const instruction =
      "Look up Harry Kane for 2025/26, excluding Erling Haaland.";

    const profile = {
      ...textCompactionTest.modelContextProfile,
      maxInputTokens: 10_000,
    };

    const modelPayloads: unknown[] = [];
    textCompactionTest.mockDeterministicTokenCount(model);

    const initialState = AgentState.parse({
      messages: [new HumanMessage(original)],
    });

    const taskRequest = prepareRequestUnderstandingModelRequest({
      context: {
        ...initialState.conversationContext,
        activeComparison: activeComparisonContext(
          initialState.conversationContext
        ),
      },
      message: original,
    });

    const taskBudget = await assessModelRequest(model, taskRequest, {
      outputLimitAdapter: testModelOutputLimitAdapter,
      profile,
    });

    expect(taskBudget).toMatchObject({
      assessment: {
        compactionSuggested: true,
      },
      failure: null,
    });

    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    structuredOutput.mockReturnValue(
      RunnableLambda.from((input) => {
        modelPayloads.push(input);

        return {
          parsed: {
            ambiguities: [],
            anchors: [
              { kind: "participant", text: "Harry Kane" },
              { kind: "season", text: "2025/26" },
              { kind: "exclusion", text: "excluding Erling Haaland" },
            ],
            constraints: [],
            instruction,
            kind: "player_lookup",
            players: [
              {
                lookupName: null,
                mention: "Harry Kane",
                recommendationRole: "reference",
                referenceScope: "explicit",
                referenceTargetMention: null,
              },
            ],
            references: [
              {
                ...textCompactionTest.anchorAt(original, "Harry Kane"),
                anchorIndex: 0,
              },
              {
                ...textCompactionTest.anchorAt(original, "2025/26"),
                anchorIndex: 1,
              },
              {
                ...textCompactionTest.anchorAt(
                  original,
                  "excluding Erling Haaland"
                ),
                anchorIndex: 2,
              },
            ],
            teams: [],
          },
          raw: new AIMessage("structured response"),
        };
      })
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile: profile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      playerIdentityLookup: (mention) => ({
        candidateCount: 0,
        candidates: [],
        candidatesTruncated: false,
        canonicalIdentityId: null,
        clarificationMessage: null,
        mention,
        selectedCandidateId: null,
        selectedName: null,
        status: "data_unavailable",
      }),
      store: null,
      tools: [],
    });

    const result = AgentState.parse(
      await graph.invoke(
        { messages: [new HumanMessage(original)] },
        { configurable: { thread_id: "soft-trigger-compaction" } }
      )
    );

    expect({
      compactionCalls: modelPayloads.length - 1,
      compactionSuggested: taskBudget.assessment.compactionSuggested,
      compactionTargetIsPositive:
        (result.contextProcessing.compaction?.targetTokenEstimate ?? 0) > 0,
      targetPassedToCompactor: JSON.stringify(modelPayloads[0]).includes(
        "targetTokens"
      ),
      userTextAbsentFromBusinessRequest: !JSON.stringify(
        modelPayloads.at(-1)
      ).includes(filler),
    }).toStrictEqual({
      compactionCalls: 1,
      compactionSuggested: true,
      compactionTargetIsPositive: true,
      targetPassedToCompactor: true,
      userTextAbsentFromBusinessRequest: true,
    });
  });

  it("does not compact a short message when necessary structured context is oversized", async () => {
    const model = fakeModel();

    const focusPlayers = Array.from({ length: 1000 }, (_, index) => {
      const canonicalIdentityId = `focus-identity-${index}`;
      const name = `Focus Player ${index}`;

      return {
        candidate: {
          ...textCompactionTest.knownKaneCandidate,
          candidateId: `focus-candidate-${index}`,
          canonicalIdentityId,
          name,
          records: [
            {
              ...textCompactionTest.knownKaneCandidate.records[0],
              canonicalIdentityId,
              name,
              sourceId: `focus-source-${index}`,
            },
          ],
        },
        referenceId: `focus-reference-${index}`,
      };
    });

    const modelInputs: unknown[] = [];
    textCompactionTest.mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        modelInputs.push(input);

        return {
          parsed: {},
          raw: new AIMessage("unused"),
        };
      })
    );

    const conversationContext = {
      ...createInitialConversationContext(),
      focusPlayers,
    };

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile: textCompactionTest.modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      store: null,
      tools: [],
    });

    const result = AgentState.parse(
      await graph.invoke(
        {
          conversationContext,
          messages: [new HumanMessage("Who was he?")],
          stateSchemaVersion: agentStateSchemaVersion,
        },
        { configurable: { thread_id: "structured-context-over-budget" } }
      )
    );

    const contextLimitMessage = z
      .string()
      .safeParse(result.messages.at(-1)?.content);

    expect({
      compactionStatus: result.contextProcessing.compaction?.status,
      compactionStopReason: result.contextProcessing.compaction?.stopReason,
      contextIssue: result.faultTolerance.failure?.contextIssue,
      contextLimitCategory: result.faultTolerance.failure?.category,
      messageExplainsNecessaryContextOverflow:
        contextLimitMessage.success &&
        contextLimitMessage.data.includes("必要结构化上下文超过"),
      modelInputCount: modelInputs.length,
    }).toStrictEqual({
      compactionStatus: "failed",
      compactionStopReason: "necessary_context_exceeds_limit",
      contextIssue: "input_exceeds_limit",
      contextLimitCategory: "context_limit",
      messageExplainsNecessaryContextOverflow: true,
      modelInputCount: 0,
    });
  });

  it("rejects a draft that omits supported numeric, exclusion, and position constraints", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const original = `Look up Harry Kane for 2025/26, excluding Erling Haaland at stc. ${filler}`;
    const modelPayloads: unknown[] = [];
    textCompactionTest.mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        modelPayloads.push(input);

        return {
          parsed: {
            ambiguities: [],
            anchors: [{ kind: "participant", text: "Harry Kane" }],
            constraints: [],
            instruction: "Look up Harry Kane.",
            kind: "player_lookup",
            players: [
              {
                lookupName: null,
                mention: "Harry Kane",
                recommendationRole: "reference",
                referenceScope: "explicit",
                referenceTargetMention: null,
              },
            ],
            references: [
              {
                ...textCompactionTest.anchorAt(original, "Harry Kane"),
                anchorIndex: 0,
              },
            ],
            teams: [],
          },
          raw: new AIMessage("structured response"),
        };
      })
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile: textCompactionTest.modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      store: null,
      tools: [],
    });

    const result = AgentState.parse(
      await graph.invoke(
        { messages: [new HumanMessage(original)] },
        { configurable: { thread_id: "invalid-compaction-reference" } }
      )
    );

    const { allowance } = result.contextProcessing;
    const lastAssistantMessage = result.messages.at(-1)?.content;

    if (allowance === null) {
      throw new Error("The compaction allowance was not initialized.");
    }

    expect({
      compactionStatus: result.contextProcessing.compaction?.status,
      inputCount: modelPayloads.length,
      originalMessage: result.messages[0]?.content,
      requestKind: result.request.kind,
    }).toStrictEqual({
      compactionStatus: "failed",
      inputCount: 1,
      originalMessage: original,
      requestKind: "other",
    });
    expect(allowance.consumedAdditionalCalls).toBe(1);
    expect(allowance.reservation).toBeNull();
    expect(lastAssistantMessage).toContain("无法安全压缩");
  });

  it("requires a current-turn confirmed alias to appear in the compacted instruction", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const original = `Look up Kane. ${filler}`;
    const modelPayloads: unknown[] = [];
    textCompactionTest.mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        modelPayloads.push(input);

        return {
          parsed: {
            ambiguities: [],
            anchors: [{ kind: "other", text: "Look" }],
            instruction: "Look up the previously confirmed player.",
            references: [
              {
                anchorIndex: 0,
                ...textCompactionTest.anchorAt(original, "Look"),
              },
            ],
          },
          raw: new AIMessage("structured response"),
        };
      })
    );

    const conversationContext: AgentStateType["conversationContext"] = {
      ...createInitialConversationContext(),
      playerAliases: [
        {
          mention: "Kane",
          reference: {
            candidate: textCompactionTest.knownKaneCandidate,
            referenceId: "kane-ref",
          },
        },
      ],
    };

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile: textCompactionTest.modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      store: null,
      tools: [],
    });

    const result = AgentState.parse(
      await graph.invoke(
        {
          conversationContext,
          messages: [new HumanMessage(original)],
          stateSchemaVersion: agentStateSchemaVersion,
        },
        { configurable: { thread_id: "required-current-alias-anchor" } }
      )
    );

    expect({
      compactionStatus: result.contextProcessing.compaction?.status,
      modelCalls: modelPayloads.length,
      requestKind: result.request.kind,
    }).toStrictEqual({
      compactionStatus: "failed",
      modelCalls: 1,
      requestKind: "other",
    });
    expect(result.messages.at(-1)?.content).toContain("无法安全压缩");
  });

  it("charges preflight time and stops before the auxiliary call when it exhausts the grant", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const original = `Look up Harry Kane. ${filler}`;
    const modelPayloads: unknown[] = [];
    let fakeNow = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      fakeNow += 10;

      return fakeNow;
    });
    textCompactionTest.mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        modelPayloads.push(input);

        return { parsed: {}, raw: new AIMessage("unused") };
      })
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: {
        maxActiveTimeMs: 5,
        maxAdditionalCalls: 6,
      },
      model,
      modelContextProfile: textCompactionTest.modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      store: null,
      tools: [],
    });

    const result = AgentState.parse(
      await graph.invoke(
        { messages: [new HumanMessage(original)] },
        { configurable: { thread_id: "preflight-allowance-exhaustion" } }
      )
    );

    const { allowance } = result.contextProcessing;

    if (allowance === null) {
      throw new Error("The compaction allowance was not initialized.");
    }

    expect({
      activeTimeMs: allowance.consumedActiveTimeMs,
      additionalCalls: allowance.consumedAdditionalCalls,
      compactionStatus: result.contextProcessing.compaction?.status,
      modelCalls: modelPayloads.length,
      reservation: allowance.reservation,
    }).toStrictEqual({
      activeTimeMs: 5,
      additionalCalls: 0,
      compactionStatus: "allowance_exhausted",
      modelCalls: 0,
      reservation: null,
    });
  });

  it("settles an unknown reserved compaction from checkpoint without retrying it", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const original = `Look up Harry Kane. ${filler}`;
    const instruction = "Look up Harry Kane.";
    const modelPayloads: unknown[] = [];
    textCompactionTest.mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        modelPayloads.push(input);

        return {
          parsed: {
            ambiguities: [],
            anchors: [{ kind: "participant", text: "Harry Kane" }],
            constraints: [],
            instruction,
            kind: "player_lookup",
            players: [
              {
                lookupName: null,
                mention: "Harry Kane",
                recommendationRole: "reference",
                referenceScope: "explicit",
                referenceTargetMention: null,
              },
            ],
            references: [
              {
                anchorIndex: 0,
                ...textCompactionTest.anchorAt(original, "Harry Kane"),
              },
            ],
            teams: [],
          },
          raw: new AIMessage("structured response"),
        };
      })
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile: textCompactionTest.modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      playerIdentityLookup: (mention) => ({
        candidateCount: 0,
        candidates: [],
        candidatesTruncated: false,
        canonicalIdentityId: null,
        clarificationMessage: null,
        mention,
        selectedCandidateId: null,
        selectedName: null,
        status: "data_unavailable",
      }),
      store: null,
      tools: [],
    });

    const graphConfig = {
      configurable: { thread_id: "unknown-compaction-reservation" },
    };

    const completed = AgentState.parse(
      await graph.invoke(
        { messages: [new HumanMessage(original)] },
        graphConfig
      )
    );

    const priorAllowance = completed.contextProcessing.allowance;
    const priorCompaction = completed.contextProcessing.compaction;

    if (priorAllowance === null || priorCompaction === null) {
      throw new Error("The completed compaction checkpoint is missing.");
    }

    const reservationTimeMs = 5000;
    await graph.updateState(graphConfig, {
      contextProcessing: {
        allowance: {
          ...priorAllowance,
          reservation: {
            maxActiveTimeMs: reservationTimeMs,
            operation: "compact_text",
            operationId: "simulated-inflight-compaction",
            sourceHash: priorCompaction.sourceHash,
            sourceMessageId: priorCompaction.sourceMessageId,
          },
        },
        compaction: {
          ...priorCompaction,
          anchors: [],
          instruction: null,
          instructionHash: null,
          outputTokenEstimate: null,
          references: [],
          status: "reserved",
          stopReason: null,
        },
      },
    });
    const modelCallsBeforeRecovery = modelPayloads.length;

    const recovered = AgentState.parse(
      await graph.invoke({ messages: [] }, graphConfig)
    );

    const recoveredAllowance = recovered.contextProcessing.allowance;

    if (recoveredAllowance === null) {
      throw new Error("The recovered context allowance is missing.");
    }

    expect({
      activeTimeMs: recoveredAllowance.consumedActiveTimeMs,
      additionalCalls: recoveredAllowance.consumedAdditionalCalls,
      compactionStatus: recovered.contextProcessing.compaction?.status,
      modelCalls: modelPayloads.length,
      reservation: recoveredAllowance.reservation,
      stopReason: recovered.contextProcessing.compaction?.stopReason,
    }).toStrictEqual({
      activeTimeMs: priorAllowance.consumedActiveTimeMs + reservationTimeMs,
      additionalCalls: priorAllowance.consumedAdditionalCalls + 1,
      compactionStatus: "unknown",
      modelCalls: modelCallsBeforeRecovery,
      reservation: null,
      stopReason: "reservation_unknown",
    });
    expect(recovered.messages.at(-1)?.content).toContain("无法确认");
  });
});
