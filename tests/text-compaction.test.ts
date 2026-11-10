import { createHash } from "node:crypto";
import { setImmediate as yieldNow } from "node:timers/promises";

import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { Command, MemorySaver } from "@langchain/langgraph";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { activeComparisonContext } from "../src/comparison-context.js";
import { assessModelRequest } from "../src/model-context.js";
import type { PlayerSearch } from "../src/player-data/search-records.js";
import { prepareRequestUnderstandingModelRequest } from "../src/request-extraction.js";
import {
  AgentState,
  agentStateSchemaVersion,
  createInitialConversationContext,
} from "../src/state.js";
import { createTools } from "../src/tools/search-player-records.js";
import { testModelOutputLimitAdapter } from "./fixtures/model-context.js";

type AgentStateType = ReturnType<typeof AgentState.parse>;

type ContextProcessingState = AgentStateType["contextProcessing"];

type ReferenceCandidate =
  AgentStateType["conversationContext"]["playerAliases"][number]["reference"]["candidate"];

vi.stubEnv("OPENAI_API_KEY", "vitest-placeholder");

vi.stubEnv("OPENAI_MODEL", "vitest-placeholder");

vi.stubEnv("OPENAI_BASE_URL", "");

const { createAgent } = await import("../src/agent.js");

const modelContextProfile = {
  countingMarginTokens: 64,
  maxInputTokens: 8500,
  maxOutputTokens: 256,
  softTriggerFraction: 0.8,
  targetFraction: 0.6,
};

const anchorAt = (source: string, text: string) => {
  const start = source.indexOf(text);

  return { end: start + text.length, start, text };
};

const mockDeterministicTokenCount = (model: ReturnType<typeof fakeModel>) =>
  vi.spyOn(model, "getNumTokens").mockImplementation(async (input) => {
    const serializedInput = Array.isArray(input)
      ? (JSON.stringify(input) ?? "")
      : input;

    await yieldNow();

    return Math.ceil(serializedInput.length / 4);
  });

const knownKaneCandidate = {
  candidateId: "reep:kane",
  canonicalIdentityId: "canonical-kane",
  exactNameMatch: true,
  identityBasis: "reep_registry",
  identityVerified: true,
  name: "Harry Kane",
  records: [
    {
      canonicalIdentityId: "canonical-kane",
      competition: null,
      identityVerified: true,
      name: "Harry Kane",
      provider: "fm",
      season: null,
      sourceId: "kane-fm",
      team: null,
    },
  ],
} satisfies ReferenceCandidate;

describe("automatic text compaction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("compacts an oversized request once, preserves its source, and continues the graph", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const original = `Look up Harry Kane in Bundesliga for 2025/26, excluding Erling Haaland. ${filler}`;

    const instruction =
      "Look up Harry Kane in Bundesliga for 2025/26, excluding Erling Haaland.";

    const compaction = {
      ambiguities: [],
      anchors: [
        { kind: "participant", text: "Harry Kane" },
        { kind: "competition", text: "Bundesliga" },
        { kind: "season", text: "2025/26" },
        { kind: "exclusion", text: "excluding Erling Haaland" },
      ],
      instruction,
      references: [
        { ...anchorAt(original, "Harry Kane"), anchorIndex: 0 },
        { ...anchorAt(original, "Bundesliga"), anchorIndex: 1 },
        { ...anchorAt(original, "2025/26"), anchorIndex: 2 },
        {
          ...anchorAt(original, "excluding Erling Haaland"),
          anchorIndex: 3,
        },
      ],
    };

    const modelPayloads: unknown[] = [];
    mockDeterministicTokenCount(model);
    let fakeNow = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      fakeNow += 10;

      return fakeNow;
    });

    const checkpointer = new MemorySaver();

    const graph = createAgent({
      checkpointer,
      model,
      modelContextProfile,
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
      configurable: { thread_id: "text-compaction-graph" },
    };

    const checkpointsBeforeCompaction: ContextProcessingState[] = [];
    const structuredOutput = vi.spyOn(model, "withStructuredOutput");
    structuredOutput.mockReturnValue(
      RunnableLambda.from(async (input) => {
        modelPayloads.push(input);

        if (modelPayloads.length === 1) {
          const checkpoint = await graph.getState(graphConfig);
          checkpointsBeforeCompaction.push(
            AgentState.parse(checkpoint.values).contextProcessing
          );
        }

        return {
          parsed: {
            ...compaction,
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

    const result = AgentState.parse(
      await graph.invoke(
        { messages: [new HumanMessage(original)] },
        graphConfig
      )
    );

    const serializedModelInputs = modelPayloads.map((payload) =>
      JSON.stringify(payload)
    );

    const lastSerializedInput = serializedModelInputs.at(-1) ?? "";
    const expectedHash = createHash("sha256").update(original).digest("hex");
    const { allowance } = result.contextProcessing;
    const [checkpoint] = checkpointsBeforeCompaction;

    if (allowance === null || checkpoint === undefined) {
      throw new Error("The compaction allowance checkpoint was not written.");
    }

    expect({
      compactedInstruction: result.contextProcessing?.compaction?.instruction,
      compactedSourceHash: result.contextProcessing?.compaction?.sourceHash,
      modelInputCount: serializedModelInputs.length,
      originalMessage: result.messages[0]?.content,
      originalTextAbsentFromBusinessRequest:
        !lastSerializedInput.includes(filler),
      outcome: result.outcome?.status,
      preflightTimeCharged:
        (checkpoint.allowance?.consumedActiveTimeMs ?? 0) > 0,
      requestKind: result.request.kind,
      requestPlayer: result.request.players[0]?.mention,
    }).toStrictEqual({
      compactedInstruction: instruction,
      compactedSourceHash: expectedHash,
      modelInputCount: 2,
      originalMessage: original,
      originalTextAbsentFromBusinessRequest: true,
      outcome: "identity_data_unavailable",
      preflightTimeCharged: true,
      requestKind: "player_lookup",
      requestPlayer: "Harry Kane",
    });
    expect({
      activeTimeIsNonnegative: allowance.consumedActiveTimeMs >= 0,
      checkpointCallCount: checkpoint.allowance?.consumedAdditionalCalls,
      checkpointCompactionHash: checkpoint.compaction?.sourceHash,
      checkpointCompactionStatus: checkpoint.compaction?.status,
      checkpointOperation: checkpoint.allowance?.reservation?.operation,
      checkpointSourceHash: checkpoint.allowance?.reservation?.sourceHash,
      consumedAdditionalCalls: allowance.consumedAdditionalCalls,
      maxActiveTimeMs: allowance.maxActiveTimeMs,
      maxAdditionalCalls: allowance.maxAdditionalCalls,
      reservation: allowance.reservation,
    }).toStrictEqual({
      activeTimeIsNonnegative: true,
      checkpointCallCount: 0,
      checkpointCompactionHash: expectedHash,
      checkpointCompactionStatus: "reserved",
      checkpointOperation: "compact_text",
      checkpointSourceHash: expectedHash,
      consumedAdditionalCalls: 1,
      maxActiveTimeMs: 120_000,
      maxAdditionalCalls: 6,
      reservation: null,
    });
  });

  it("continues a compacted lookup with clarification answers and preserves the source message", async () => {
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const original = `请查一下 Elias Demo 的表现资料。 ${filler}`;
    const clarification = "请按 2024/25 赛季查询。";
    const sourceText = `${original}\n\nUser clarification: ${clarification}`;
    const instruction = "请查一下 Elias Demo 的 2024/25 表现资料。";
    const participantAnchor = anchorAt(sourceText, "Elias Demo");
    const seasonAnchor = anchorAt(sourceText, "2024/25");
    const structuredPayloads: unknown[] = [];

    const model = fakeModel()
      .respondWithTools([
        {
          args: { sourceRecords: [] },
          name: "search_player_records",
        },
      ])
      .respond(new AIMessage("已完成对已确认来源记录的查询。"));

    mockDeterministicTokenCount(model);

    const candidate: ReferenceCandidate = {
      candidateId: "reep:identity-demo-01",
      canonicalIdentityId: "identity-demo-01",
      exactNameMatch: true,
      identityBasis: "reep_registry",
      identityVerified: true,
      name: "Elias Demo",
      records: [
        {
          canonicalIdentityId: "identity-demo-01",
          competition: null,
          identityVerified: true,
          name: "Elias Demo",
          provider: "fm",
          season: null,
          sourceId: "fm-demo-01",
          team: null,
        },
        {
          canonicalIdentityId: "identity-demo-01",
          competition: "EPL",
          identityVerified: true,
          name: "Elias Demo",
          provider: "understat",
          season: "2024/25",
          sourceId: "us-demo-01",
          team: "Demo FC",
        },
      ],
    };

    const search = vi.fn<PlayerSearch>((input) =>
      JSON.stringify({
        fm: { records: [], status: "not_found" },
        identityGroups: {
          canonicalGroups: [],
          registryStatus: "not_needed",
          unlinkedRecords: [],
        },
        query: input.sourceRecords,
        requestedUnderstatSeasonStartYear: input.seasonStartYear ?? null,
        understat: { records: [], status: "not_found" },
      })
    );

    const [lookupTool] = createTools(search);

    if (lookupTool === undefined) {
      throw new Error("The player lookup tool is unavailable.");
    }

    const modelWithTools = model.bindTools([lookupTool]);
    const lookupModelInvoke = vi.spyOn(modelWithTools, "invoke");
    vi.spyOn(model, "bindTools").mockReturnValue(modelWithTools);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        structuredPayloads.push(input);

        return {
          parsed: {
            ambiguities: [],
            anchors: [
              { kind: "participant", text: "Elias Demo" },
              { kind: "season", text: "2024/25" },
            ],
            constraints: [],
            instruction,
            kind: "player_lookup",
            players: [
              {
                lookupName: null,
                mention: "Elias Demo",
                recommendationRole: "reference",
                referenceScope: "explicit",
                referenceTargetMention: null,
              },
            ],
            references: [
              { anchorIndex: 0, ...participantAnchor },
              { anchorIndex: 1, ...seasonAnchor },
            ],
            teams: [],
          },
          raw: new AIMessage("structured instruction"),
        };
      })
    );

    const checkpointer = new MemorySaver();

    const graph = createAgent({
      checkpointer,
      model,
      modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      playerIdentityLookup: (mention) => ({
        candidateCount: 1,
        candidates: [candidate],
        candidatesTruncated: false,
        canonicalIdentityId: candidate.canonicalIdentityId,
        clarificationMessage: null,
        mention,
        selectedCandidateId: candidate.candidateId,
        selectedName: candidate.name,
        status: "resolved",
      }),
      store: null,
      tools: [lookupTool],
    });

    const config = {
      configurable: { thread_id: "long-input-lookup-continuation" },
    };

    const originalHash = createHash("sha256").update(original).digest("hex");

    const initialState = AgentState.parse({
      contextProcessing: {
        allowance: null,
        clarification: {
          answers: [clarification],
          sourceHash: originalHash,
          sourceMessageId: "long-lookup",
        },
        compaction: null,
      },
      messages: [new HumanMessage({ content: original, id: "long-lookup" })],
    });

    const result = AgentState.parse(await graph.invoke(initialState, config));

    const lookupCallInput = lookupModelInvoke.mock.calls[0]?.[0];

    const lookupHumanMessage = Array.isArray(lookupCallInput)
      ? lookupCallInput.find((message) => message instanceof HumanMessage)
      : undefined;

    const lookupFollowUpInput = lookupModelInvoke.mock.calls[1]?.[0];

    const checkpointSnapshot = await graph.getState(config);
    const checkpoint = AgentState.parse(checkpointSnapshot.values);

    const searchInput = search.mock.calls[0]?.[0];
    const [, requestUnderstandingPayload] = structuredPayloads;

    expect({
      compactedInstruction: result.contextProcessing.compaction?.instruction,
      compactionStatus: result.contextProcessing.compaction?.status,
      lookupReceivedCompactedInstruction:
        lookupHumanMessage?.content === `${clarification}\n\n${instruction}`,
      lookupReceivedFiller: JSON.stringify(lookupCallInput).includes(filler),
      lookupRetainedCurrentToolMessage:
        Array.isArray(lookupFollowUpInput) &&
        lookupFollowUpInput.some((message) => message instanceof ToolMessage),
      lookupSearchCount: search.mock.calls.length,
      lookupWorkingMessageId: lookupHumanMessage?.id,
      originalCheckpointMessage: checkpoint.messages[0]?.content,
      originalMessage: result.messages[0]?.content,
      outcome: result.outcome?.status,
      requestUnderstandingReceivedClarification: JSON.stringify(
        requestUnderstandingPayload
      ).includes(clarification),
      requestUnderstandingReceivedFiller: JSON.stringify(
        requestUnderstandingPayload
      ).includes(filler),
      requestUnderstandingReceivedInstruction: JSON.stringify(
        requestUnderstandingPayload
      ).includes(instruction),
      seasonStartYear: searchInput?.seasonStartYear,
      sourceRecords: searchInput?.sourceRecords,
    }).toStrictEqual({
      compactedInstruction: instruction,
      compactionStatus: "ready",
      lookupReceivedCompactedInstruction: true,
      lookupReceivedFiller: false,
      lookupRetainedCurrentToolMessage: true,
      lookupSearchCount: 1,
      lookupWorkingMessageId: "long-lookup",
      originalCheckpointMessage: original,
      originalMessage: original,
      outcome: "answer_ready",
      requestUnderstandingReceivedClarification: true,
      requestUnderstandingReceivedFiller: false,
      requestUnderstandingReceivedInstruction: true,
      seasonStartYear: 2024,
      sourceRecords: [
        { provider: "fm", sourceId: "fm-demo-01" },
        { provider: "understat", sourceId: "us-demo-01" },
      ],
    });
  });

  it("repairs a unique exact anchor when the model offset is wrong", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const original = `Look up Harry Kane. ${filler}`;
    const expectedReference = anchorAt(original, "Harry Kane");
    const modelPayloads: unknown[] = [];
    mockDeterministicTokenCount(model);
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
                anchorIndex: 0,
                end: expectedReference.end + 1,
                start: expectedReference.start + 1,
                text: expectedReference.text,
              },
            ],
            teams: [],
          },
          raw: new AIMessage("structured response"),
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile,
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
        { configurable: { thread_id: "repair-reference-offset" } }
      )
    );

    expect({
      modelCallCount: modelPayloads.length,
      reference: result.contextProcessing.compaction?.references[0],
      status: result.contextProcessing.compaction?.status,
    }).toStrictEqual({
      modelCallCount: 2,
      reference: { anchorIndex: 0, ...expectedReference },
      status: "ready",
    });
  });

  it("rejects overlapping source matches instead of guessing an anchor offset", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const original = `Look up aaa. ${filler}`;
    const firstMatch = original.indexOf("aa");
    const modelPayloads: unknown[] = [];
    mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        modelPayloads.push(input);

        return {
          parsed: {
            ambiguities: [],
            anchors: [{ kind: "participant", text: "aa" }],
            constraints: [],
            instruction: "Look up aa.",
            kind: "player_lookup",
            players: [
              {
                lookupName: null,
                mention: "aa",
                recommendationRole: "reference",
                referenceScope: "explicit",
                referenceTargetMention: null,
              },
            ],
            references: [
              {
                anchorIndex: 0,
                end: firstMatch + 4,
                start: firstMatch + 2,
                text: "aa",
              },
            ],
            teams: [],
          },
          raw: new AIMessage("overlapping anchor response"),
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile,
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
        { configurable: { thread_id: "overlapping-reference-offset" } }
      )
    );

    expect({
      modelCallCount: modelPayloads.length,
      status: result.contextProcessing.compaction?.status,
      stopReason: result.contextProcessing.compaction?.stopReason,
    }).toStrictEqual({
      modelCallCount: 1,
      status: "failed",
      stopReason: "source_reference_invalid",
    });
  });

  it("clarifies an ambiguous compaction and resumes the original request", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const original = `Compare Harry Kane in Bundesliga for 2024/25 or 2025/26, excluding Erling Haaland. ${filler}`;
    const clarification = "Use 2025/26.";
    const combinedSource = `${original}\n\nUser clarification: ${clarification}`;

    const instruction =
      "Compare Harry Kane in Bundesliga for 2024/25 and 2025/26, excluding Erling Haaland. User clarification: Use 2025/26.";

    const modelPayloads: unknown[] = [];
    mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        modelPayloads.push(input);

        if (modelPayloads.length === 1) {
          return {
            parsed: {
              ambiguities: ["请确认使用 2024/25 还是 2025/26。"],
              anchors: [],
              instruction: "Look up Harry Kane.",
              references: [],
            },
            raw: new AIMessage("ambiguous compaction"),
          };
        }

        if (modelPayloads.length === 2) {
          const seasonLastStart = combinedSource.lastIndexOf("2025/26");

          return {
            parsed: {
              ambiguities: [],
              anchors: [
                { kind: "participant", text: "Harry Kane" },
                { kind: "competition", text: "Bundesliga" },
                { kind: "season", text: "2024/25" },
                { kind: "season", text: "2025/26" },
                { kind: "exclusion", text: "excluding Erling Haaland" },
              ],
              instruction,
              references: [
                { ...anchorAt(combinedSource, "Harry Kane"), anchorIndex: 0 },
                { ...anchorAt(combinedSource, "Bundesliga"), anchorIndex: 1 },
                { ...anchorAt(combinedSource, "2024/25"), anchorIndex: 2 },
                { ...anchorAt(combinedSource, "2025/26"), anchorIndex: 3 },
                {
                  ...anchorAt(combinedSource, "excluding Erling Haaland"),
                  anchorIndex: 4,
                },
                {
                  anchorIndex: 3,
                  end: seasonLastStart + "2025/26".length,
                  start: seasonLastStart,
                  text: "2025/26",
                },
              ],
            },
            raw: new AIMessage("clarified compaction"),
          };
        }

        return {
          parsed: {
            constraints: [
              { name: "season", value: "2024/25" },
              { name: "season", value: "2025/26" },
              { name: "competition", value: "Bundesliga" },
            ],
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
          raw: new AIMessage("understood clarified request"),
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile,
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
      configurable: { thread_id: "ambiguous-compaction-resume" },
    };

    const pausedResponse = await graph.invoke(
      { messages: [new HumanMessage(original)] },
      graphConfig
    );

    const paused = AgentState.parse(pausedResponse);
    const pausedSnapshot = await graph.getState(graphConfig);

    expect({
      interruptAsked: pausedSnapshot.tasks.some(
        ({ interrupts }) => interrupts.length > 0
      ),
      next: pausedSnapshot.next,
      pendingKind: paused.pendingClarification?.kind,
      sourceMessage: paused.messages[0]?.content,
      taskNames: pausedSnapshot.tasks.map(({ name }) => name),
    }).toStrictEqual({
      interruptAsked: true,
      next: ["clarify"],
      pendingKind: "context_processing",
      sourceMessage: original,
      taskNames: ["clarify"],
    });

    const resumed = AgentState.parse(
      await graph.invoke(new Command({ resume: clarification }), graphConfig)
    );

    expect({
      clarificationAnswers: resumed.contextProcessing.clarification?.answers,
      compactedInstruction: resumed.contextProcessing.compaction?.instruction,
      compactionCalls: modelPayloads.length,
      compactionSourceHash: resumed.contextProcessing.compaction?.sourceHash,
      compactionStatus: resumed.contextProcessing.compaction?.status,
      compactionStopReason: resumed.contextProcessing.compaction?.stopReason,
      consumedCalls:
        resumed.contextProcessing.allowance?.consumedAdditionalCalls,
      expectedSourceHash: createHash("sha256")
        .update(combinedSource)
        .digest("hex"),
      modelSawClarificationInSecondCall: JSON.stringify(
        modelPayloads[1]
      ).includes("User clarification: Use 2025/26."),
      pendingKind: resumed.pendingClarification?.kind ?? null,
      requestKind: resumed.request.kind,
      requestPlayer: resumed.request.players[0]?.mention,
      requestSeasonConstraint: resumed.request.constraints.find(
        ({ name }) => name === "understatSeasonStartYear"
      ),
    }).toStrictEqual({
      clarificationAnswers: [clarification],
      compactedInstruction: instruction,
      compactionCalls: 3,
      compactionSourceHash: createHash("sha256")
        .update(combinedSource)
        .digest("hex"),
      compactionStatus: "ready",
      compactionStopReason: null,
      consumedCalls: 2,
      expectedSourceHash: createHash("sha256")
        .update(combinedSource)
        .digest("hex"),
      modelSawClarificationInSecondCall: true,
      pendingKind: null,
      requestKind: "player_lookup",
      requestPlayer: "Harry Kane",
      requestSeasonConstraint: {
        name: "understatSeasonStartYear",
        value: "2025",
      },
    });
    expect(resumed.messages[0]?.content).toBe(original);
  });

  it("resumes an unprocessed request from its cached compaction checkpoint", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const original = `Look up Harry Kane. ${filler}`;
    const instruction = "Look up Harry Kane.";
    const modelPayloads: unknown[] = [];
    mockDeterministicTokenCount(model);
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
              { anchorIndex: 0, ...anchorAt(original, "Harry Kane") },
            ],
            teams: [],
          },
          raw: new AIMessage("structured response"),
        };
      })
    );

    const checkpointer = new MemorySaver();

    const options = {
      checkpointer,
      model,
      modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      playerIdentityLookup: (mention: string) => ({
        candidateCount: 0,
        candidates: [],
        candidatesTruncated: false,
        canonicalIdentityId: null,
        clarificationMessage: null,
        mention,
        selectedCandidateId: null,
        selectedName: null,
        status: "data_unavailable" as const,
      }),
      store: null,
      tools: [],
    };

    const graph = createAgent(options);

    const graphConfig = {
      configurable: { thread_id: "resume-cached-compaction" },
    };

    await graph.invoke({ messages: [new HumanMessage(original)] }, graphConfig);

    const graphConfigSchema = z.looseObject({
      configurable: z.looseObject({
        checkpoint_id: z.string().optional(),
        thread_id: z.string(),
      }),
    });

    let cachedCheckpointConfig: z.output<typeof graphConfigSchema> | null =
      null;

    let cachedCheckpointState: AgentStateType | null = null;

    for await (const snapshot of graph.getStateHistory(graphConfig)) {
      const checkpointState = AgentState.parse(snapshot.values);

      const hasPendingRequest =
        checkpointState.request.processedMessageId === null;

      const hasCompaction =
        checkpointState.contextProcessing.compaction?.status === "ready";

      if (
        snapshot.next.includes("understand_request") &&
        hasCompaction &&
        hasPendingRequest
      ) {
        cachedCheckpointConfig = graphConfigSchema.parse(snapshot.config);
        cachedCheckpointState = checkpointState;
        break;
      }
    }

    if (cachedCheckpointConfig === null || cachedCheckpointState === null) {
      throw new Error("No unprocessed cached compaction checkpoint was found.");
    }

    const resumedGraph = createAgent(options);

    const resumed = AgentState.parse(
      await resumedGraph.invoke({ messages: [] }, cachedCheckpointConfig)
    );

    const resumedModelInput = JSON.stringify(modelPayloads.at(-1));

    expect({
      allowanceCalls:
        resumed.contextProcessing.allowance?.consumedAdditionalCalls,
      compactedInstructionInModelInput:
        resumedModelInput.includes("compactedScoutingInstruction") &&
        resumedModelInput.includes(instruction),
      modelCallCount: modelPayloads.length,
      originalTextInModelInput: resumedModelInput.includes(filler),
      requestKind: resumed.request.kind,
      requestPlayer: resumed.request.players[0]?.mention,
    }).toStrictEqual({
      allowanceCalls: 1,
      compactedInstructionInModelInput: true,
      modelCallCount: 3,
      originalTextInModelInput: false,
      requestKind: "player_lookup",
      requestPlayer: "Harry Kane",
    });

    const cachedCompaction = cachedCheckpointState.contextProcessing.compaction;

    if (cachedCompaction === null) {
      throw new Error("The cached compaction record is missing.");
    }

    const staleCompactions = [
      {
        field: "source hash",
        record: { ...cachedCompaction, sourceHash: "stale-source-hash" },
      },
      {
        field: "source message ID",
        record: { ...cachedCompaction, sourceMessageId: "stale-message-id" },
      },
      {
        field: "request ID",
        record: { ...cachedCompaction, requestId: "stale-request-id" },
      },
      {
        field: "model configuration",
        record: {
          ...cachedCompaction,
          modelConfigurationHash: "stale-model-configuration",
        },
      },
      {
        field: "format version",
        record: {
          ...cachedCompaction,
          formatVersion: cachedCompaction.formatVersion + 1,
        },
      },
      {
        field: "instruction digest",
        record: {
          ...cachedCompaction,
          instructionHash: "stale-instruction-digest",
        },
      },
    ];

    await Promise.all(
      staleCompactions.map(async (staleCache, index) => {
        const staleModel = fakeModel();
        const staleModelPayloads: unknown[] = [];
        mockDeterministicTokenCount(staleModel);
        vi.spyOn(staleModel, "withStructuredOutput").mockReturnValue(
          RunnableLambda.from((input) => {
            staleModelPayloads.push(input);

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
                  { anchorIndex: 0, ...anchorAt(original, "Harry Kane") },
                ],
                teams: [],
              },
              raw: new AIMessage("rebuilt compaction"),
            };
          })
        );

        const staleState = AgentState.parse({
          ...cachedCheckpointState,
          contextProcessing: {
            ...cachedCheckpointState.contextProcessing,
            compaction: staleCache.record,
          },
        });

        const staleCacheGraph = createAgent({
          ...options,
          checkpointer: new MemorySaver(),
          model: staleModel,
        });

        const rebuilt = AgentState.parse(
          await staleCacheGraph.invoke(staleState, {
            configurable: { thread_id: `stale-cache-${index}` },
          })
        );

        expect({
          allowanceCalls:
            rebuilt.contextProcessing.allowance?.consumedAdditionalCalls,
          compactionStatus: rebuilt.contextProcessing.compaction?.status,
          invalidatedField: staleCache.field,
          modelCallCount: staleModelPayloads.length,
          requestKind: rebuilt.request.kind,
        }).toStrictEqual({
          allowanceCalls: 2,
          compactionStatus: "ready",
          invalidatedField: staleCache.field,
          modelCallCount: 2,
          requestKind: "player_lookup",
        });
      })
    );
  });

  it("rebuilds a cached compaction when its context digest is stale", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const messageId = "stale-context-compaction";
    const original = `Look up Harry Kane. ${filler}`;
    const instruction = "Look up Harry Kane.";
    const modelPayloads: unknown[] = [];
    mockDeterministicTokenCount(model);
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
              { anchorIndex: 0, ...anchorAt(original, "Harry Kane") },
            ],
            teams: [],
          },
          raw: new AIMessage("structured response"),
        };
      })
    );

    const originalHash = createHash("sha256").update(original).digest("hex");
    const staleInstruction = "Old stale request.";

    const staleState = AgentState.parse({
      contextProcessing: {
        allowance: {
          consumedActiveTimeMs: 10,
          consumedAdditionalCalls: 1,
          maxActiveTimeMs: 120_000,
          maxAdditionalCalls: 6,
          requestId: `message:${messageId}`,
          reservation: null,
        },
        clarification: null,
        compaction: {
          activeContextHash: "stale-context-digest",
          ambiguities: [],
          anchors: [{ kind: "participant", text: "Harry Kane" }],
          formatVersion: 2,
          instruction: staleInstruction,
          instructionHash: createHash("sha256")
            .update(staleInstruction)
            .digest("hex"),
          modelConfigurationHash: "stale-model-digest",
          outputTokenEstimate: 5,
          progress: { end: original.length, start: 0 },
          references: [{ anchorIndex: 0, ...anchorAt(original, "Harry Kane") }],
          requestId: `message:${messageId}`,
          sourceHash: originalHash,
          sourceMessageId: messageId,
          sourceTokenEstimate: 100,
          status: "ready",
          stopReason: null,
          targetTokenEstimate: 50,
        },
      },
      messages: [new HumanMessage({ content: original, id: messageId })],
      stateSchemaVersion: agentStateSchemaVersion,
    });

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile,
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
      await graph.invoke(staleState, {
        configurable: { thread_id: "stale-context-compaction" },
      })
    );

    const businessInput = JSON.stringify(modelPayloads.at(-1));

    expect({
      compactedInstruction: result.contextProcessing.compaction?.instruction,
      consumedAdditionalCalls:
        result.contextProcessing.allowance?.consumedAdditionalCalls,
      modelCallCount: modelPayloads.length,
      requestKind: result.request.kind,
      staleInstructionAbsent: !businessInput.includes(staleInstruction),
    }).toStrictEqual({
      compactedInstruction: instruction,
      consumedAdditionalCalls: 2,
      modelCallCount: 2,
      requestKind: "player_lookup",
      staleInstructionAbsent: true,
    });
  });

  it("keeps a fitting request on the ordinary one-call path", async () => {
    const model = fakeModel();
    const modelPayloads: unknown[] = [];
    mockDeterministicTokenCount(model);
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

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile,
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
      ...modelContextProfile,
      maxInputTokens: 10_000,
    };

    const modelPayloads: unknown[] = [];
    mockDeterministicTokenCount(model);

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
              { ...anchorAt(original, "Harry Kane"), anchorIndex: 0 },
              { ...anchorAt(original, "2025/26"), anchorIndex: 1 },
              {
                ...anchorAt(original, "excluding Erling Haaland"),
                anchorIndex: 2,
              },
            ],
            teams: [],
          },
          raw: new AIMessage("structured response"),
        };
      })
    );

    const graph = createAgent({
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
          ...knownKaneCandidate,
          candidateId: `focus-candidate-${index}`,
          canonicalIdentityId,
          name,
          records: [
            {
              ...knownKaneCandidate.records[0],
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
    mockDeterministicTokenCount(model);
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

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile,
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
    mockDeterministicTokenCount(model);
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
                ...anchorAt(original, "Harry Kane"),
                anchorIndex: 0,
              },
            ],
            teams: [],
          },
          raw: new AIMessage("structured response"),
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile,
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
    mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        modelPayloads.push(input);

        return {
          parsed: {
            ambiguities: [],
            anchors: [{ kind: "other", text: "Look" }],
            instruction: "Look up the previously confirmed player.",
            references: [{ anchorIndex: 0, ...anchorAt(original, "Look") }],
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
          reference: { candidate: knownKaneCandidate, referenceId: "kane-ref" },
        },
      ],
    };

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile,
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
    mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        modelPayloads.push(input);

        return { parsed: {}, raw: new AIMessage("unused") };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      contextProcessingAllowance: {
        maxActiveTimeMs: 5,
        maxAdditionalCalls: 6,
      },
      model,
      modelContextProfile,
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
    mockDeterministicTokenCount(model);
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
              { anchorIndex: 0, ...anchorAt(original, "Harry Kane") },
            ],
            teams: [],
          },
          raw: new AIMessage("structured response"),
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile,
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

  it("leaves oversized text pending for bounded chunk processing", async () => {
    const model = fakeModel();
    const filler = "Background note with no scouting constraint. ".repeat(1100);
    const original = `Look up Harry Kane. ${filler}`;
    const modelPayloads: unknown[] = [];
    mockDeterministicTokenCount(model);
    vi.spyOn(model, "withStructuredOutput").mockReturnValue(
      RunnableLambda.from((input) => {
        modelPayloads.push(input);

        return {
          parsed: {},
          raw: new AIMessage("unexpected response"),
        };
      })
    );

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model,
      modelContextProfile,
      modelOutputLimitAdapter: testModelOutputLimitAdapter,
      store: null,
      tools: [],
    });

    const result = AgentState.parse(
      await graph.invoke(
        { messages: [new HumanMessage(original)] },
        { configurable: { thread_id: "text-needs-chunking" } }
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
      progress: result.contextProcessing.compaction?.progress,
    }).toStrictEqual({
      compactionStatus: "needs_chunking",
      inputCount: 0,
      originalMessage: original,
      progress: { end: original.length, start: 0 },
    });
    expect(allowance.consumedAdditionalCalls).toBe(0);
    expect(allowance.reservation).toBeNull();
    expect(lastAssistantMessage).toContain("拆分或缩短");
  });
});
