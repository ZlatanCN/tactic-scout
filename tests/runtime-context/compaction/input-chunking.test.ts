import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { assessModelRequest } from "../../../src/model-context.js";
import type { PlayerSearch } from "../../../src/player-data/search-records.js";
import { AgentState } from "../../../src/state.js";
import { createTools } from "../../../src/tools/search-player-records.js";
import { testModelOutputLimitAdapter } from "../../fixtures/model-context.js";
import type { ReferenceCandidate } from "../../fixtures/text-compaction.js";
import { textCompactionTest } from "../../fixtures/text-compaction.js";

describe("single-message chunk planning", () => {
  it("chunks a first oversized instruction and merges a later season correction before lookup", async () => {
    const filler = "Background note with no scouting constraint. ".repeat(1000);
    const original = `Look up Harry Kane in Bundesliga at Bayern Munich for 2024/25; excluding Erling Haaland; age 22; position ST. ${filler}Use 2025/26 for him instead.`;

    const instruction =
      "Look up Harry Kane in Bundesliga at Bayern Munich for 2025/26 instead of the earlier 2024/25 request; excluding Erling Haaland; age 22; position ST.";

    const structuredOperations: string[] = [];
    const structuredInputs: unknown[] = [];

    const model = fakeModel()
      .respondWithTools([
        {
          args: { sourceRecords: [] },
          name: "search_player_records",
        },
      ])
      .respond(new AIMessage("The selected player records were checked."));

    textCompactionTest.mockDeterministicTokenCount(model);

    const candidate: ReferenceCandidate = {
      ...textCompactionTest.knownKaneCandidate,
      records: [
        ...textCompactionTest.knownKaneCandidate.records,
        {
          canonicalIdentityId: "canonical-kane",
          competition: "EPL",
          identityVerified: true,
          name: "Harry Kane",
          provider: "understat",
          season: "2025/26",
          sourceId: "kane-understat",
          team: "Fixture FC",
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
        structuredInputs.push(input);

        const humanMessage = Array.isArray(input)
          ? input.find((message) => message instanceof HumanMessage)
          : undefined;

        const humanContent = z.string().safeParse(humanMessage?.content);

        const requestPayload = humanContent.success
          ? z
              .looseObject({
                chunks: z.array(z.unknown()).optional(),
                message: z.string().optional(),
                operation: z.string().optional(),
              })
              .safeParse(JSON.parse(humanContent.data))
          : null;

        if (requestPayload === null || !requestPayload.success) {
          throw new Error("The fake model received a non-JSON user message.");
        }

        const payloadData = requestPayload.data;
        const { operation } = payloadData;

        if (operation === "extract_text_chunk") {
          structuredOperations.push(operation);

          const payload = z
            .looseObject({
              message: z.string(),
              range: z.object({ end: z.number(), start: z.number() }),
            })
            .parse(payloadData);

          const anchors = [
            { kind: "participant", text: "Harry Kane" },
            { kind: "competition", text: "Bundesliga" },
            { kind: "team", text: "Bayern Munich" },
            { kind: "season", text: "2024/25" },
            { kind: "exclusion", text: "excluding Erling Haaland" },
            { kind: "number", text: "22" },
            { kind: "position", text: "ST" },
            { kind: "season", text: "2025/26" },
          ].filter(({ text }) => payload.message.includes(text));

          const chunkInstruction = anchors.length
            ? anchors.map(({ text }) => text).join("; ")
            : "No scouting constraints in this fragment.";

          return {
            parsed: {
              ambiguities: [],
              anchors,
              instruction: chunkInstruction,
              references: anchors.map((anchor, anchorIndex) => {
                const start = payload.message.indexOf(anchor.text);

                return {
                  anchorIndex,
                  end: start + anchor.text.length,
                  start,
                  text: anchor.text,
                };
              }),
            },
            raw: new AIMessage("chunk extraction"),
          };
        }

        if (operation === "merge_text_chunks") {
          structuredOperations.push(operation);

          const anchors = [
            { kind: "participant", text: "Harry Kane" },
            { kind: "competition", text: "Bundesliga" },
            { kind: "team", text: "Bayern Munich" },
            { kind: "season", text: "2024/25" },
            { kind: "exclusion", text: "excluding Erling Haaland" },
            { kind: "number", text: "22" },
            { kind: "position", text: "ST" },
            { kind: "season", text: "2025/26" },
          ];

          return {
            parsed: {
              ambiguities: [],
              anchors,
              instruction,
              references: anchors.map(({ text }, anchorIndex) => ({
                anchorIndex,
                ...textCompactionTest.anchorAt(original, text),
              })),
            },
            raw: new AIMessage("merged chunk extraction"),
          };
        }

        if (operation === undefined) {
          structuredOperations.push("understand_request");

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
            raw: new AIMessage("understood merged request"),
          };
        }

        structuredOperations.push("unexpected");

        return {
          parsed: {
            ambiguities: [],
            anchors: [],
            instruction: "No scouting constraints in this fragment.",
            references: [],
          },
          raw: new AIMessage("unexpected structured request"),
        };
      })
    );

    const graph = textCompactionTest.createAgent({
      checkpointer: new MemorySaver(),
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
      configurable: { thread_id: "first-message-chunked-compaction" },
    };

    const result = AgentState.parse(
      await graph.invoke(
        {
          messages: [
            new HumanMessage({ content: original, id: "chunked-lookup" }),
          ],
        },
        config
      )
    );

    const checkpointSnapshot = await graph.getState(config);
    const checkpoint = AgentState.parse(checkpointSnapshot.values);
    const lookupModelInput = lookupModelInvoke.mock.calls[0]?.[0];

    const lookupHumanMessage = Array.isArray(lookupModelInput)
      ? lookupModelInput.find((message) => message instanceof HumanMessage)
      : undefined;

    const searchInput = search.mock.calls[0]?.[0];

    const unchunkedAssessment = await assessModelRequest(
      model,
      {
        messages: [new HumanMessage(original)],
        purpose: "compact_context",
      },
      {
        outputLimitAdapter: testModelOutputLimitAdapter,
        profile: textCompactionTest.modelContextProfile,
      }
    );

    expect({
      compactionStatus: result.contextProcessing.compaction?.status,
      finalInstruction: result.contextProcessing.compaction?.instruction,
      fullSourceAbsentFromModelInputs: !structuredInputs
        .map((value) => JSON.stringify(value))
        .some((value) => value.includes(original)),
      hasAllowanceForAuxiliaryCalls:
        (result.contextProcessing.allowance?.consumedAdditionalCalls ?? 0) >= 3,
      hasMergeOperation: structuredOperations.includes("merge_text_chunks"),
      hasMultipleChunkCalls:
        structuredOperations.filter(
          (operation) => operation === "extract_text_chunk"
        ).length > 1,
      hasUnderstandingOperation:
        structuredOperations.includes("understand_request"),
      lookupInstruction: lookupHumanMessage?.content,
      mergeOperationCount: structuredOperations.filter(
        (operation) => operation === "merge_text_chunks"
      ).length,
      originalMessage: checkpoint.messages[0]?.content,
      outcome: result.outcome?.status,
      seasonStartYear: searchInput?.seasonStartYear,
      sourceRecords: searchInput?.sourceRecords,
      sourceReferencesMatchOriginal:
        result.contextProcessing.compaction?.references.every(
          ({ end, start, text }) => original.slice(start, end) === text
        ),
      unchunkedFailure: unchunkedAssessment.failure,
    }).toStrictEqual({
      compactionStatus: "ready",
      finalInstruction: instruction,
      fullSourceAbsentFromModelInputs: true,
      hasAllowanceForAuxiliaryCalls: true,
      hasMergeOperation: true,
      hasMultipleChunkCalls: true,
      hasUnderstandingOperation: true,
      lookupInstruction: instruction,
      mergeOperationCount: 1,
      originalMessage: original,
      outcome: "answer_ready",
      seasonStartYear: 2025,
      sourceRecords: [
        { provider: "fm", sourceId: "kane-fm" },
        { provider: "understat", sourceId: "kane-understat" },
      ],
      sourceReferencesMatchOriginal: true,
      unchunkedFailure: "input_exceeds_limit",
    });
    expect(search).toHaveBeenCalledOnce();
  });
});
