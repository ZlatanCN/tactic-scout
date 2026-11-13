import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { contextProcessingHash } from "../../../src/context-processing-state.js";
import { AgentState, agentStateSchemaVersion } from "../../../src/state.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";
import { textCompactionTest } from "../../fixtures/text-compaction.js";

const invokeContinuation = async (
  graph: ReturnType<typeof textCompactionTest.createAgent>,
  state: ReturnType<typeof AgentState.parse>,
  threadId: string,
  messageId: string,
  content = "继续"
) =>
  AgentState.parse(
    await graph.invoke(
      {
        ...state,
        messages: [
          ...state.messages,
          new HumanMessage({ content, id: messageId }),
        ],
      },
      { configurable: { thread_id: threadId } }
    )
  );

const firstChunkPreservesSourceAnchors = (
  state: ReturnType<typeof AgentState.parse>,
  source: string
): boolean => {
  const firstChunk = state.contextProcessing.compaction?.chunking?.chunks[0];

  if (firstChunk === undefined) {
    return false;
  }

  const requiredAnchors = [
    ["participant", "Harry Kane"],
    ["season", "2025/26"],
    ["exclusion", "excluding Erling Haaland"],
  ];

  return (
    requiredAnchors.every(([kind, text]) =>
      firstChunk.anchors.some(
        (anchor) => anchor.kind === kind && anchor.text === text
      )
    ) &&
    firstChunk.references.every(
      ({ end, start, text }) => source.slice(start, end) === text
    )
  );
};

const blockedContinuationFacts = async (
  graph: ReturnType<typeof textCompactionTest.createAgent>,
  state: ReturnType<typeof AgentState.parse>,
  source: string
) => {
  const { compaction } = state.contextProcessing;

  if (compaction === null) {
    throw new Error("The exhausted instruction lost its compaction record.");
  }

  const blockedByProviderFailure = AgentState.parse({
    ...state,
    faultTolerance: {
      ...state.faultTolerance,
      failure: { category: "authentication", node: "understand_request" },
    },
  });

  const blockedByConfigurationFailure = AgentState.parse({
    ...state,
    faultTolerance: {
      ...state.faultTolerance,
      failure: { category: "configuration", node: "understand_request" },
    },
  });

  const blockedByContractFailure = AgentState.parse({
    ...state,
    faultTolerance: {
      ...state.faultTolerance,
      failure: { category: "invalid_response", node: "understand_request" },
    },
  });

  const blockedByClarification = AgentState.parse({
    ...state,
    pendingClarification: {
      answer: null,
      kind: "context_processing",
      question: "Please clarify the conflicting season.",
      sourceHash: compaction.sourceHash,
      sourceMessageId: compaction.sourceMessageId,
    },
  });

  const staleSource = AgentState.parse({
    ...state,
    messages: state.messages.map((message) =>
      message instanceof HumanMessage && message.id === "long-source"
        ? new HumanMessage({ content: `${source} changed`, id: "long-source" })
        : message
    ),
  });

  const unknownCompletion = AgentState.parse({
    ...state,
    contextProcessing: {
      ...state.contextProcessing,
      compaction: {
        ...compaction,
        status: "unknown",
        stopReason: "reservation_unknown",
      },
    },
  });

  const incompatibleState = AgentState.parse({
    ...state,
    stateSchemaVersion: 0,
  });

  const savedLookupResult = "saved lookup result";

  const ambiguousTargetState = AgentState.parse({
    ...state,
    conversationContext: {
      ...state.conversationContext,
      activeLookup: {
        player: {
          candidate: textCompactionTest.knownKaneCandidate,
          referenceId: "canonical-kane",
        },
        resultJson: savedLookupResult,
      },
    },
    lookupEvidence: {
      batches: [],
      failureReason: "allowance_exhausted",
      questionHash: contextProcessingHash(source),
      requestId: "message:long-source",
      resultDigest: contextProcessingHash(savedLookupResult),
      source: "saved",
      sourceHash: contextProcessingHash(savedLookupResult),
      sourceMessageId: "long-source",
      status: "allowance_exhausted",
    },
    outcome: {
      kind: "player_lookup",
      resultJson: savedLookupResult,
      source: "saved",
      status: "lookup_follow_up",
    },
  });

  const results = await Promise.all([
    invokeContinuation(
      graph,
      blockedByProviderFailure,
      "blocked-authentication",
      "continue-authentication"
    ),
    invokeContinuation(
      graph,
      blockedByConfigurationFailure,
      "blocked-configuration",
      "continue-configuration"
    ),
    invokeContinuation(
      graph,
      blockedByContractFailure,
      "blocked-contract",
      "continue-contract"
    ),
    invokeContinuation(
      graph,
      blockedByClarification,
      "blocked-clarification",
      "continue-clarification"
    ),
    invokeContinuation(
      graph,
      staleSource,
      "blocked-stale-source",
      "continue-stale"
    ),
    invokeContinuation(
      graph,
      unknownCompletion,
      "blocked-unknown-completion",
      "continue-unknown"
    ),
    invokeContinuation(
      graph,
      incompatibleState,
      "blocked-incompatible-state",
      "continue-incompatible"
    ),
    invokeContinuation(
      graph,
      ambiguousTargetState,
      "blocked-ambiguous-targets",
      "continue-ambiguous-targets"
    ),
  ]);

  const ambiguousReply = results.at(-1)?.messages.at(-1)?.content;

  const clarificationText = z.string().safeParse(ambiguousReply).success
    ? z.string().parse(ambiguousReply)
    : "";

  return {
    grantCounts: results.map(
      (result) => result.contextProcessing.allowance?.grants.length
    ),
    multipleTargetsClarified:
      clarificationText.includes("继续查询") &&
      clarificationText.includes("继续长指令"),
  };
};

describe("context processing continuation", () => {
  it("continues an exhausted long instruction once for each new message ID", async () => {
    const model = fakeModel();
    const source = `Look up Harry Kane for the 2025/26 season, excluding Erling Haaland. ${"Background note with no scouting constraint. ".repeat(1000)}`;
    const operations: string[] = [];

    textCompactionTest.mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        const humanMessage = Array.isArray(input)
          ? input.find((message) => message instanceof HumanMessage)
          : undefined;

        const payload = z
          .looseObject({ message: z.string(), operation: z.string() })
          .parse(JSON.parse(z.string().parse(humanMessage?.content)));

        operations.push(payload.operation);

        const anchors = [
          { kind: "participant" as const, text: "Harry Kane" },
          { kind: "season" as const, text: "2025/26" },
          { kind: "exclusion" as const, text: "excluding Erling Haaland" },
        ].filter(({ text }) => payload.message.includes(text));

        const instruction = anchors.length
          ? anchors.map(({ text }) => text).join("; ")
          : "No scouting constraints in this fragment.";

        return {
          parsed: {
            ambiguities: [],
            anchors,
            instruction,
            references: anchors.map(({ text }, anchorIndex) => {
              const start = payload.message.indexOf(text);

              return {
                anchorIndex,
                end: start + text.length,
                start,
                text,
              };
            }),
          },
          raw: new AIMessage("chunk extraction"),
        };
      })
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 1 },
      model,
      modelContextProfile: textCompactionTest.modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      store: null,
      tools: [],
    });

    const config = { configurable: { thread_id: "continue-long-instruction" } };

    const exhausted = AgentState.parse(
      await graph.invoke(
        {
          messages: [new HumanMessage({ content: source, id: "long-source" })],
          stateSchemaVersion: agentStateSchemaVersion,
        },
        config
      )
    );

    const firstProgress =
      exhausted.contextProcessing.compaction?.chunking?.nextStart ?? 0;

    expect({
      operations,
      status: exhausted.contextProcessing.compaction?.status,
      stopReason: exhausted.contextProcessing.compaction?.stopReason,
    }).toStrictEqual({
      operations: ["extract_text_chunk"],
      status: "allowance_exhausted",
      stopReason: "allowance_exhausted",
    });

    const continued = AgentState.parse(
      await graph.invoke(
        { messages: [new HumanMessage({ content: "继续", id: "continue-1" })] },
        config
      )
    );

    const continuedProgress =
      continued.contextProcessing.compaction?.chunking?.nextStart ?? 0;

    await graph.invoke(
      { messages: [new HumanMessage({ content: "继续", id: "continue-1" })] },
      config
    );

    const twiceContinued = AgentState.parse(
      await graph.invoke(
        { messages: [new HumanMessage({ content: "继续", id: "continue-2" })] },
        config
      )
    );

    const twiceContinuedProgress =
      twiceContinued.contextProcessing.compaction?.chunking?.nextStart ?? 0;

    await graph.invoke(
      { messages: [new HumanMessage({ content: "继续", id: "continue-2" })] },
      config
    );

    const grantHistory = z
      .looseObject({
        grants: z.array(
          z.looseObject({
            additionalActiveTimeMs: z.number(),
            additionalCalls: z.number(),
            continuationMessageId: z.string(),
            kind: z.string(),
            requestId: z.string(),
            sourceHash: z.string(),
            sourceMessageId: z.string(),
          })
        ),
      })
      .safeParse(twiceContinued.contextProcessing.allowance);

    const grants = grantHistory.success ? grantHistory.data.grants : [];

    expect({
      allowanceCalls:
        twiceContinued.contextProcessing.allowance?.consumedAdditionalCalls,
      compactionSource:
        twiceContinued.contextProcessing.compaction?.sourceMessageId,
      grants,
      operationCount: operations.length,
      originalMessagePreserved: twiceContinued.messages[0]?.content === source,
      progressAdvanced:
        continuedProgress > firstProgress &&
        twiceContinuedProgress > continuedProgress,
      progressInSourceBounds: twiceContinuedProgress <= source.length,
      sourceAnchorsAndReferencesPreserved: firstChunkPreservesSourceAnchors(
        twiceContinued,
        source
      ),
      status: twiceContinued.contextProcessing.compaction?.status,
    }).toStrictEqual({
      allowanceCalls: 3,
      compactionSource: "long-source",
      grants: [
        {
          additionalActiveTimeMs: 120_000,
          additionalCalls: 1,
          continuationMessageId: "continue-1",
          kind: "text_compaction",
          requestId: "message:long-source",
          sourceHash: continued.contextProcessing.compaction?.sourceHash,
          sourceMessageId: "long-source",
        },
        {
          additionalActiveTimeMs: 120_000,
          additionalCalls: 1,
          continuationMessageId: "continue-2",
          kind: "text_compaction",
          requestId: "message:long-source",
          sourceHash: twiceContinued.contextProcessing.compaction?.sourceHash,
          sourceMessageId: "long-source",
        },
      ],
      operationCount: 3,
      originalMessagePreserved: true,
      progressAdvanced: true,
      progressInSourceBounds: true,
      sourceAnchorsAndReferencesPreserved: true,
      status: "allowance_exhausted",
    });

    const blockedFacts = await blockedContinuationFacts(
      graph,
      exhausted,
      source
    );

    expect({
      grantCounts: blockedFacts.grantCounts,
      multipleTargetsClarified: blockedFacts.multipleTargetsClarified,
      operationCount: operations.length,
    }).toStrictEqual({
      grantCounts: [0, 0, 0, 0, 0, 0, 0, 0],
      multipleTargetsClarified: true,
      operationCount: 3,
    });
  });
});
