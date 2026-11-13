import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import type { PlayerSearch } from "../../../src/player-data/search-records.js";
import { searchPlayerRecordsResultSchema } from "../../../src/player-data/search-records.js";
import { AgentState } from "../../../src/state.js";
import { createTools } from "../../../src/tools/search-player-records.js";
import { agentGraphTest } from "../../fixtures/agent-graph.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";
import { textCompactionTest } from "../../fixtures/text-compaction.js";

const scoutingAnchors = [
  { kind: "participant", text: "Harry Kane" },
  { kind: "season", text: "2025/26" },
  { kind: "exclusion", text: "excluding Erling Haaland" },
];

const anchorIndexForReference = (
  anchors: { text: string }[],
  reference: { text: string }
): number => anchors.findIndex(({ text }) => text === reference.text);

const resultForSearch = (input: Parameters<PlayerSearch>[0]): string => {
  const hasFm = input.sourceRecords.some(({ provider }) => provider === "fm");

  const hasUnderstat = input.sourceRecords.some(
    ({ provider }) => provider === "understat"
  );

  const base = {
    identityGroups: {
      canonicalGroups: [],
      registryStatus: "not_needed" as const,
      unlinkedRecords: [],
    },
    query: input.sourceRecords,
  };

  if (hasFm && hasUnderstat) {
    return JSON.stringify(
      searchPlayerRecordsResultSchema.parse({
        ...base,
        fm: { records: [], status: "not_found" },
        requestedUnderstatSeasonStartYear: input.seasonStartYear ?? null,
        understat: { records: [], status: "not_found" },
      })
    );
  }

  if (hasUnderstat) {
    return JSON.stringify(
      searchPlayerRecordsResultSchema.parse({
        ...base,
        requestedUnderstatSeasonStartYear: input.seasonStartYear ?? null,
        understat: { records: [], status: "not_found" },
      })
    );
  }

  return JSON.stringify(
    searchPlayerRecordsResultSchema.parse({
      ...base,
      fm: { records: [], status: "not_found" },
    })
  );
};

const resultForSearchWithUnderstatRecords = (
  input: Parameters<PlayerSearch>[0]
): string => {
  const understatSource = input.sourceRecords.find(
    ({ provider }) => provider === "understat"
  );

  if (understatSource === undefined) {
    throw new Error("The lookup fixture needs a resolved Understat source.");
  }

  return JSON.stringify(
    searchPlayerRecordsResultSchema.parse({
      fm: { records: [], status: "not_found" },
      identityGroups: {
        canonicalGroups: [],
        registryStatus: "not_needed",
        unlinkedRecords: [],
      },
      query: input.sourceRecords,
      requestedUnderstatSeasonStartYear: input.seasonStartYear ?? null,
      understat: {
        records: [0, 1, 2].map((index) => ({
          appearances: 8 + index,
          assists: 2 + index,
          competition: "Bundesliga",
          expectedAssists: 0.7 + index,
          expectedGoals: 1.3 + index,
          goals: 2 + index,
          keyPasses: 11 + index,
          minutes: 606 + index,
          nonPenaltyExpectedGoals: 1.3 + index,
          player: "Harry Kane",
          position: "F",
          season: `202${3 + index}/2${4 + index}`,
          shots: 19 + index,
          source: "Understat",
          sourcePlayerId: understatSource.sourceId,
          team: "Bayern",
        })),
        status: "found",
      },
    })
  );
};

const mockTextCompaction = (
  model: ReturnType<typeof fakeModel>,
  chunkOperations: string[]
) => {
  vi.spyOn(model, "withStructuredOutput").mockReturnValue(
    RunnableLambda.from((input) => {
      const messages = Array.isArray(input) ? input : [];

      const humanMessage = messages.find(
        (message) => message instanceof HumanMessage
      );

      const payload = z
        .looseObject({
          chunks: z.array(z.unknown()).optional(),
          message: z.string().optional(),
          operation: z.string().optional(),
        })
        .parse(JSON.parse(z.string().parse(humanMessage?.content)));

      if (payload.operation === "extract_text_chunk") {
        chunkOperations.push(payload.operation);
        const chunkText = z.string().parse(payload.message);

        const anchors = scoutingAnchors.filter(({ text }) =>
          chunkText.includes(text)
        );

        return {
          parsed: {
            ambiguities: [],
            anchors,
            instruction:
              anchors.map(({ text }) => text).join("; ") || "No constraints.",
            references: anchors.map(({ text }, anchorIndex) => {
              const start = chunkText.indexOf(text);

              return { anchorIndex, end: start + text.length, start, text };
            }),
          },
          raw: new AIMessage("chunk extracted"),
        };
      }

      if (payload.operation === "merge_text_chunks") {
        chunkOperations.push(payload.operation);

        const chunks = z
          .array(
            z.object({
              anchors: z.array(
                z.object({ kind: z.string(), text: z.string() })
              ),
              references: z.array(
                z.object({
                  end: z.number(),
                  start: z.number(),
                  text: z.string(),
                })
              ),
            })
          )
          .parse(payload.chunks);

        const anchors = chunks.flatMap((chunk) => chunk.anchors);

        return {
          parsed: {
            ambiguities: [],
            anchors,
            instruction: `Look up ${anchors.map(({ text }) => text).join("; ")}.`,
            references: chunks.flatMap((chunk) =>
              chunk.references.map((reference) => ({
                ...reference,
                anchorIndex: anchorIndexForReference(anchors, reference),
              }))
            ),
          },
          raw: new AIMessage("chunks merged"),
        };
      }

      throw new Error("Unexpected structured model operation.");
    })
  );
};

const lookupToolProjection = (messages: BaseMessage[]) => {
  const toolMessage = messages.find(
    (message) => message instanceof ToolMessage
  );

  if (toolMessage === undefined) {
    throw new Error("The lookup model request has no paired tool result.");
  }

  return z
    .object({
      batch: z.object({ recordRefs: z.array(z.string()) }),
      records: z.array(z.unknown()),
    })
    .parse(JSON.parse(z.string().parse(toolMessage.content)));
};

describe("lookup tool-loop provider overflow recovery", () => {
  it("compacts the request and preserves the tool-call/result pair on lookup re-entry", async () => {
    const original =
      `Look up Harry Kane in Bundesliga for 2025/26, excluding Erling Haaland. ${"Background detail. ".repeat(80)}`.trimEnd();

    const chunkOperations: string[] = [];

    const model = fakeModel()
      .respond(
        Object.assign(
          new Error("The request exceeds the maximum context length."),
          { code: "context_length_exceeded", status: 400 }
        )
      )
      .respondWithTools([
        {
          args: { sourceRecords: [] },
          name: "search_player_records",
        },
      ])
      .respond(new AIMessage("The selected player records were checked."));

    textCompactionTest.mockDeterministicTokenCount(model);

    mockTextCompaction(model, chunkOperations);

    const candidate = textCompactionTest.knownKaneCandidate;

    const message = new HumanMessage({
      content: original,
      id: "lookup-overflow",
    });

    const search = vi.fn<PlayerSearch>(resultForSearch);

    const [actualLookupTool] = createTools(search);

    if (actualLookupTool === undefined) {
      throw new Error("The player lookup tool is unavailable.");
    }

    const searchModel = model.bindTools([actualLookupTool]);
    vi.spyOn(model, "bindTools").mockReturnValue(searchModel);

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 6 },
      model,
      modelContextProfile: {
        countingMarginTokens: 64,
        maxInputTokens: 10_000,
        maxOutputTokens: 512,
        softTriggerFraction: 0.99,
        targetFraction: 0.6,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      playerIdentityLookup: agentGraphTest.resolvedLookup(candidate),
      playerReferenceValidator: () => ({ status: "current" }),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [original]: agentGraphTest.requestForPlayers("player_lookup", [
          candidate.name,
        ]),
      }),
      store: null,
      tools: [actualLookupTool],
    });

    const result = AgentState.parse(
      await graph.invoke(
        { messages: [message] },
        { configurable: { thread_id: "lookup-tool-pair-overflow" } }
      )
    );

    const toolCallMessage = result.messages.find(
      (item): item is AIMessage =>
        item instanceof AIMessage && (item.tool_calls ?? []).length > 0
    );

    const toolCall = toolCallMessage?.tool_calls?.[0];

    const toolResult = result.messages.find(
      (item): item is ToolMessage => item instanceof ToolMessage
    );

    const recoveryMessages = model.calls[1]?.messages ?? [];

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      chunkOperations: chunkOperations.length,
      compactionStatus: result.contextProcessing.compaction?.status,
      lookupToolPairMatches:
        toolCall !== undefined && toolResult?.tool_call_id === toolCall.id,
      lookupVisibleInputPreservesConstraints:
        JSON.stringify(recoveryMessages).includes("Harry Kane") &&
        JSON.stringify(recoveryMessages).includes("2025/26") &&
        JSON.stringify(recoveryMessages).includes("excluding Erling Haaland"),
      modelCalls: model.callCount,
      searchSourceRecords: search.mock.calls[0]?.[0].sourceRecords,
    }).toStrictEqual({
      allowanceCalls: 4,
      chunkOperations: 3,
      compactionStatus: "ready",
      lookupToolPairMatches: true,
      lookupVisibleInputPreservesConstraints: true,
      modelCalls: 3,
      searchSourceRecords: [{ provider: "fm", sourceId: "kane-fm" }],
    });
  });

  it("shrinks completed tool evidence after overflow and preserves its pairing", async () => {
    const original =
      `Look up Harry Kane's Understat xA for 2025/26. ${"Background detail. ".repeat(80)}`.trimEnd();

    const chunkOperations: string[] = [];
    const knownCandidate = textCompactionTest.knownKaneCandidate;

    const candidate = {
      ...knownCandidate,
      records: [
        ...knownCandidate.records,
        {
          canonicalIdentityId: "canonical-kane",
          competition: "Bundesliga",
          identityVerified: true,
          name: "Harry Kane",
          provider: "understat" as const,
          season: "2025/26",
          sourceId: "kane-understat",
          team: "Bayern",
        },
      ],
    };

    const model = fakeModel()
      .respondWithTools([
        {
          args: { sourceRecords: [] },
          name: "search_player_records",
        },
      ])
      .respond((messages) => {
        const projection = lookupToolProjection(messages);

        return projection.records.length > 1
          ? Object.assign(
              new Error("The request exceeds the maximum context length."),
              { code: "context_length_exceeded", status: 400 }
            )
          : new AIMessage("The selected player records were checked.");
      })
      .respond(new AIMessage("The selected player records were checked."));

    for (let attempt = 0; attempt < 6; attempt += 1) {
      model.respond(new AIMessage("A projected lookup batch was reviewed."));
    }

    textCompactionTest.mockDeterministicTokenCount(model);
    mockTextCompaction(model, chunkOperations);

    const search = vi.fn<PlayerSearch>(resultForSearchWithUnderstatRecords);
    const [actualLookupTool] = createTools(search);

    if (actualLookupTool === undefined) {
      throw new Error("The player lookup tool is unavailable.");
    }

    vi.spyOn(model, "bindTools").mockReturnValue(
      model.bindTools([actualLookupTool])
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: { maxAdditionalCalls: 10 },
      model,
      modelContextProfile: {
        countingMarginTokens: 64,
        maxInputTokens: 10_000,
        maxOutputTokens: 512,
        softTriggerFraction: 0.99,
        targetFraction: 0.6,
      },
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      playerIdentityLookup: agentGraphTest.resolvedLookup(candidate),
      playerReferenceValidator: () => ({ status: "current" }),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [original]: agentGraphTest.requestForPlayers(
          "player_lookup",
          [candidate.name],
          {
            constraints: [{ name: "understatSeasonStartYear", value: "2025" }],
          }
        ),
      }),
      store: null,
      tools: [actualLookupTool],
    });

    const result = AgentState.parse(
      await graph.invoke(
        {
          messages: [
            new HumanMessage({
              content: original,
              id: "lookup-result-overflow",
            }),
          ],
        },
        { configurable: { thread_id: "lookup-result-overflow" } }
      )
    );

    const overflowingRequest = model.calls[1]?.messages ?? [];
    const recoveredRequest = model.calls[2]?.messages ?? [];

    const overflowToolMessage = overflowingRequest.find(
      (message) => message instanceof ToolMessage
    );

    const recoveredToolMessage = recoveredRequest.find(
      (message) => message instanceof ToolMessage
    );

    expect({
      allowanceCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      compactionStatus: result.contextProcessing.compaction?.status,
      lookupProjectionSizes: [
        lookupToolProjection(overflowingRequest).records.length,
        lookupToolProjection(recoveredRequest).records.length,
      ],
      lookupResultAvailable:
        (result.conversationContext.activeLookup?.resultJson.length ?? 0) > 0,
      outcomeStatus: result.outcome?.status,
      recoveredToolPairMatches:
        overflowToolMessage?.tool_call_id ===
        recoveredToolMessage?.tool_call_id,
      searchCalls: search.mock.calls.length,
    }).toStrictEqual({
      allowanceCalls: 6,
      compactionStatus: "ready",
      lookupProjectionSizes: [2, 1],
      lookupResultAvailable: true,
      outcomeStatus: "answer_ready",
      recoveredToolPairMatches: true,
      searchCalls: 1,
    });
  });
});
