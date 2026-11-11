import { createHash } from "node:crypto";

import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import type { PlayerSearch } from "../../../src/player-data/search-records.js";
import { AgentState } from "../../../src/state.js";
import { createTools } from "../../../src/tools/search-player-records.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";
import { textCompactionTest } from "../../fixtures/text-compaction.js";
import type { ReferenceCandidate } from "../../fixtures/text-compaction.js";

describe("source reference validation", () => {
  it("continues a compacted lookup with clarification answers and preserves the source message", async () => {
    const filler = "Background note with no scouting constraint. ".repeat(600);
    const original = `请查一下 Elias Demo 的表现资料。 ${filler}`;
    const clarification = "请按 2024/25 赛季查询。";
    const sourceText = `${original}\n\nUser clarification: ${clarification}`;
    const instruction = "请查一下 Elias Demo 的 2024/25 表现资料。";

    const participantAnchor = textCompactionTest.anchorAt(
      sourceText,
      "Elias Demo"
    );

    const seasonAnchor = textCompactionTest.anchorAt(sourceText, "2024/25");
    const structuredPayloads: unknown[] = [];

    const model = fakeModel()
      .respondWithTools([
        {
          args: { sourceRecords: [] },
          name: "search_player_records",
        },
      ])
      .respond(new AIMessage("已完成对已确认来源记录的查询。"));

    textCompactionTest.mockDeterministicTokenCount(model);

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

    const graph = textCompactionTest.createAgent({
      checkpointer,
      model,
      modelContextProfile: textCompactionTest.modelContextProfile,
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
      originalMessagePreserved: result.messages[0]?.content === original,
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
      originalMessagePreserved: true,
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

    const expectedReference = textCompactionTest.anchorAt(
      original,
      "Harry Kane"
    );

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
    textCompactionTest.mockDeterministicTokenCount(model);
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
});
