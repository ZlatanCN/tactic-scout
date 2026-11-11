import { isDeepStrictEqual } from "node:util";

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { Command, InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v3";

import type { ReferenceIdentityLookup } from "../../../src/player-data/resolve-reference.js";
import type { PlayerSearch } from "../../../src/player-data/search-records.js";
import {
  agentStateSchemaVersion,
  createInitialConversationContext,
} from "../../../src/state.js";
import type { ReferenceCandidate } from "../../../src/state.js";
import type { RecommendPlayerCandidates } from "../../../src/tools/recommend-player-candidates.js";
import { agentGraphTest } from "../../fixtures/agent-graph.js";
import { recommendationResult } from "../../fixtures/workflow-results.js";

describe("identity memory and confirmation workflows", () => {
  it("falls back to source resolution and discloses a shared-memory read failure", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "memory-kane");
    const message = "Look up Harry Kane after a memory outage.";

    const identityLookup = vi.fn<ReferenceIdentityLookup>(
      agentGraphTest.resolvedLookup(kane)
    );

    const store = new InMemoryStore();

    const storeSearch = vi
      .spyOn(store, "search")
      .mockRejectedValue(new Error("fixture Store read failure"));

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [message]: agentGraphTest.requestForPlayers("player_lookup", [
          kane.name,
        ]),
      }),
      store,
      tools: [],
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "player-memory-read-failure" } }
    );

    const answer = z.string().safeParse(result.messages.at(-1)?.content);

    const actual = {
      candidateId:
        result.request.players[0]?.resolution?.selectedCandidateId ?? null,
      identityLookupCalls: identityLookup.mock.calls.length,
      memoryReadFailed: result.playerMemoryStatus.readFailed,
      memoryReadNoticeShown:
        answer.success && answer.data.includes("无法读取跨对话的球员身份记忆"),
      memorySearchCalls: storeSearch.mock.calls.length,
    };

    const expected = {
      candidateId: kane.candidateId,
      identityLookupCalls: 1,
      memoryReadFailed: true,
      memoryReadNoticeShown: true,
      memorySearchCalls: 1,
    };

    if (!isDeepStrictEqual(actual, expected)) {
      throw new Error(JSON.stringify({ actual, expected }, null, 2));
    }

    expect(actual).toStrictEqual(expected);
  });

  it("does not share an automatically resolved identity across threads", async () => {
    const kane = agentGraphTest.playerCandidate(
      "Harry Kane",
      "automatic-memory-kane"
    );

    const message = "Look up Harry Kane after an automatic match.";

    const identityLookup = vi.fn<ReferenceIdentityLookup>(
      agentGraphTest.resolvedLookup(kane)
    );

    const store = new InMemoryStore();

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [message]: agentGraphTest.requestForPlayers("player_lookup", [
          kane.name,
        ]),
      }),
      store,
      tools: [],
    });

    const threadA = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "automatic-identity-a" } }
    );

    const threadB = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "automatic-identity-b" } }
    );

    expect({
      identityLookupCalls: identityLookup.mock.calls.length,
      playerA: threadA.request.players[0]?.resolution?.status,
      playerB: threadB.request.players[0]?.resolution?.status,
    }).toStrictEqual({
      identityLookupCalls: 2,
      playerA: "resolved",
      playerB: "resolved",
    });
  });

  it("keeps default standalone player stores isolated between graph instances", async () => {
    const kane = agentGraphTest.playerCandidate(
      "Harry Kane",
      "isolated-memory-kane"
    );

    const message = "Confirm Harry Kane in a standalone graph.";

    const identityLookup = vi.fn<ReferenceIdentityLookup>((mention) => ({
      candidateCount: 1,
      candidates: [kane],
      candidatesTruncated: false,
      canonicalIdentityId: null,
      clarificationMessage: "Select Harry Kane.",
      mention,
      selectedCandidateId: null,
      selectedName: null,
      status: "needs_confirmation",
    }));

    const createGraph = () =>
      agentGraphTest.createAgent({
        checkpointer: new MemorySaver(),
        model: fakeModel(),
        playerIdentityLookup: identityLookup,
        requestUnderstandingExtractor: agentGraphTest.createExtractor({
          [message]: agentGraphTest.requestForPlayers("player_lookup", [
            kane.name,
          ]),
        }),
        tools: [],
      });

    const graphA = createGraph();
    const graphB = createGraph();
    const threadA = { configurable: { thread_id: "isolated-memory-thread-a" } };
    const threadB = { configurable: { thread_id: "isolated-memory-thread-b" } };

    const firstInterrupt = await graphA.invoke(
      { messages: [new HumanMessage(message)] },
      threadA
    );

    await graphA.invoke(new Command({ resume: "1" }), threadA);

    const secondInterrupt = await graphB.invoke(
      { messages: [new HumanMessage(message)] },
      threadB
    );

    expect({
      firstWasPending: Object.hasOwn(firstInterrupt, "__interrupt__"),
      identityLookupCalls: identityLookup.mock.calls.length,
      secondWasPending: Object.hasOwn(secondInterrupt, "__interrupt__"),
    }).toStrictEqual({
      firstWasPending: true,
      identityLookupCalls: 2,
      secondWasPending: true,
    });
  });

  it("does not read player memory from another namespace", async () => {
    const kane = agentGraphTest.playerCandidate(
      "Harry Kane",
      "other-namespace-kane"
    );

    const message = "Look up Harry Kane from a separate memory namespace.";

    const identityLookup = vi.fn<ReferenceIdentityLookup>(
      agentGraphTest.resolvedLookup(kane)
    );

    const store = new InMemoryStore();

    await store.put(
      ["tactiscout", "another-user", "player-memory"],
      "player-alias-test",
      {
        kind: "player_identity",
        normalizedMention: "harrykane",
      }
    );

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [message]: agentGraphTest.requestForPlayers("player_lookup", [
          kane.name,
        ]),
      }),
      store,
      tools: [],
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "player-memory-namespace-boundary" } }
    );

    expect({
      identityLookupCalls: identityLookup.mock.calls.length,
      selectedCandidateId:
        result.request.players[0]?.resolution?.selectedCandidateId,
    }).toStrictEqual({
      identityLookupCalls: 1,
      selectedCandidateId: kane.candidateId,
    });
  });

  it("keeps a thread-local identity confirmation when saving shared memory fails", async () => {
    const kane = agentGraphTest.playerCandidate(
      "Harry Kane",
      "memory-kane-write-failure"
    );

    const message = "Look up Harry Kane with a memory write failure.";

    const identityLookup: ReferenceIdentityLookup = (mention) => ({
      candidateCount: 1,
      candidates: [kane],
      candidatesTruncated: false,
      canonicalIdentityId: null,
      clarificationMessage: "Select Harry Kane.",
      mention,
      selectedCandidateId: null,
      selectedName: null,
      status: "needs_confirmation",
    });

    const store = new InMemoryStore();

    const storePut = vi
      .spyOn(store, "put")
      .mockRejectedValue(new Error("fixture Store write failure"));

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [message]: agentGraphTest.requestForPlayers("player_lookup", [
          kane.name,
        ]),
      }),
      store,
      tools: [],
    });

    const config = {
      configurable: { thread_id: "player-memory-write-failure" },
    };

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      config
    );

    const resumed = await graph.invoke(new Command({ resume: "1" }), config);
    const answer = z.string().safeParse(resumed.messages.at(-1)?.content);

    const actual = {
      interrupted: Object.hasOwn(interrupted, "__interrupt__"),
      localAlias: resumed.conversationContext.playerAliases.map((alias) => ({
        mention: alias.mention,
        referenceId: alias.reference.referenceId,
      })),
      memoryWriteFailed: resumed.playerMemoryStatus.writeFailed,
      memoryWriteNoticeShown:
        answer.success && answer.data.includes("未能保存到跨对话记忆"),
      storeWrites: storePut.mock.calls.length,
    };

    const expected = {
      interrupted: true,
      localAlias: [
        {
          mention: "Harry Kane",
          referenceId: kane.canonicalIdentityId ?? kane.candidateId,
        },
      ],
      memoryWriteFailed: true,
      memoryWriteNoticeShown: true,
      storeWrites: 1,
    };

    if (!isDeepStrictEqual(actual, expected)) {
      throw new Error(JSON.stringify({ actual, expected }, null, 2));
    }

    expect(actual).toStrictEqual(expected);
  });

  it("remembers a confirmed Chinese alias and resolves it without another identity lookup", async () => {
    const kimmich = agentGraphTest.playerCandidate("Joshua Kimmich", "kimmich");

    const identityLookup = vi.fn<ReferenceIdentityLookup>((mention) => ({
      candidateCount: 1,
      candidates: [kimmich],
      candidatesTruncated: false,
      canonicalIdentityId: null,
      clarificationMessage: `Confirm whether “${mention}” means Joshua Kimmich.`,
      mention,
      selectedCandidateId: null,
      selectedName: null,
      status: "needs_confirmation",
    }));

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

    const model = fakeModel()
      .respondWithTools([
        {
          args: { sourceRecords: [] },
          name: "search_player_records",
        },
      ])
      .respond(new AIMessage("The first Kimmich lookup is complete."))
      .respondWithTools([
        {
          args: { sourceRecords: [] },
          name: "search_player_records",
        },
      ])
      .respond(new AIMessage("The repeated Kimmich lookup is complete."));

    const first = "查询基米希的资料";
    const second = "再介绍一下基米希";

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [first]: agentGraphTest.requestForPlayers("player_lookup", ["基米希"]),
        [second]: agentGraphTest.requestForPlayers("player_lookup", ["基米希"]),
      }),
      tools: [agentGraphTest.createSearchTool(search)],
    });

    const config = {
      configurable: { thread_id: "confirmed-alias-thread" },
    };

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage(first)] },
      config
    );

    const completed = await graph.invoke(new Command({ resume: "1" }), config);

    const repeated = await graph.invoke(
      { messages: [new HumanMessage(second)] },
      config
    );

    expect(interrupted).toHaveProperty("__interrupt__");
    expect(identityLookup).toHaveBeenCalledOnce();
    expect(
      search.mock.calls.map(([input]) => input.sourceRecords)
    ).toStrictEqual([
      [
        { provider: "fm", sourceId: "kimmich-fm" },
        { provider: "understat", sourceId: "kimmich-understat" },
      ],
      [
        { provider: "fm", sourceId: "kimmich-fm" },
        { provider: "understat", sourceId: "kimmich-understat" },
      ],
    ]);
    expect(completed.conversationContext.playerAliases).toMatchObject([
      {
        mention: "基米希",
        reference: { referenceId: "canonical-kimmich" },
      },
    ]);
    expect(repeated.messages.at(-1)?.content).toBe(
      "The repeated Kimmich lookup is complete."
    );
  });

  it("asks the user to choose a source profile when one identity has multiple FM records", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");

    const firstFmRecord = kane.records.find(
      (record) => record.provider === "fm"
    );

    if (firstFmRecord === undefined) {
      throw new Error("The Kane fixture needs an FM profile.");
    }

    const multiProfileKane: ReferenceCandidate = {
      ...kane,
      records: [...kane.records, { ...firstFmRecord, sourceId: "kane-fm-alt" }],
    };

    const recommend = vi.fn<RecommendPlayerCandidates>(() =>
      recommendationResult("no_candidates")
    );

    const message = "Find STC alternatives to Kane.";

    const graph = agentGraphTest.createAgent({
      model: fakeModel().respond(new AIMessage("No candidates were found.")),
      playerIdentityLookup: agentGraphTest.resolvedLookup(multiProfileKane),
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [message]: agentGraphTest.requestForPlayers(
          "player_recommendation",
          ["Kane"],
          {
            recommendation: { includePotential: false, position: "stc" },
          }
        ),
      }),
      tools: agentGraphTest.createTools(agentGraphTest.emptySearch, recommend),
    });

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "ambiguous-fm-profile" } }
    );

    const resumed = await graph.invoke(new Command({ resume: "2" }), {
      configurable: { thread_id: "ambiguous-fm-profile" },
    });

    expect({
      interrupted: Object.hasOwn(interrupted, "__interrupt__"),
      savedFmIds:
        resumed.conversationContext.activeRecommendation?.referencePlayers[0]?.candidate.records
          .filter((record) => record.provider === "fm")
          .map((record) => record.sourceId),
      selectedFmIds: recommend.mock.calls[0]?.[0].referenceGroups[0]?.fmIds,
      toolCalls: recommend.mock.calls.length,
    }).toStrictEqual({
      interrupted: true,
      savedFmIds: ["kane-fm-alt"],
      selectedFmIds: ["kane-fm-alt"],
      toolCalls: 1,
    });
  });

  it("preserves reference and exclusion roles when the extractor misses confirmed aliases", async () => {
    const kimmich = agentGraphTest.playerCandidate("Joshua Kimmich", "kimmich");
    const haaland = agentGraphTest.playerCandidate("Erling Haaland", "haaland");
    const message = "给基米希找替代者，不要哈兰德";

    const identityLookup = vi.fn<ReferenceIdentityLookup>(() => {
      throw new Error("Confirmed aliases should not be re-resolved.");
    });

    const recommend = vi.fn<RecommendPlayerCandidates>(() =>
      recommendationResult("ready")
    );

    const conversationContext = {
      ...createInitialConversationContext(),
      playerAliases: [
        {
          mention: "基米希",
          reference: {
            candidate: kimmich,
            referenceId: "canonical-kimmich",
          },
        },
        {
          mention: "哈兰德",
          reference: {
            candidate: haaland,
            referenceId: "canonical-haaland",
          },
        },
      ],
    };

    const graph = agentGraphTest.createAgent({
      model: fakeModel().respond(new AIMessage("The exclusion was applied.")),
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [message]: agentGraphTest.requestForPlayers(
          "player_recommendation",
          [],
          {
            recommendation: { includePotential: false, position: "stc" },
          }
        ),
      }),
      tools: agentGraphTest.createTools(agentGraphTest.emptySearch, recommend),
    });

    const result = await graph.invoke(
      {
        conversationContext,
        messages: [new HumanMessage(message)],
        stateSchemaVersion: agentStateSchemaVersion,
      },
      { configurable: { thread_id: "alias-recommendation-roles" } }
    );

    expect({
      excludeGroups: recommend.mock.calls[0]?.[0].excludeGroups,
      identityLookups: identityLookup.mock.calls.length,
      referenceGroups: recommend.mock.calls[0]?.[0].referenceGroups,
      roles: result.request.players.map((player) => player.recommendationRole),
    }).toMatchObject({
      excludeGroups: [{ fmIds: ["haaland-fm"] }],
      identityLookups: 0,
      referenceGroups: [{ fmIds: ["kimmich-fm"] }],
      roles: ["reference", "exclude"],
    });
  });

  it("commits an already resolved participant alias before interrupting on another identity", async () => {
    const kimmich = agentGraphTest.playerCandidate("Joshua Kimmich", "kimmich");
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const message = "Compare Joshua Kimmich and Harry Kane.";

    const identityLookup: ReferenceIdentityLookup = (mention) =>
      mention === "Joshua Kimmich"
        ? {
            candidateCount: 1,
            candidates: [kimmich],
            candidatesTruncated: false,
            canonicalIdentityId: kimmich.canonicalIdentityId,
            clarificationMessage: null,
            mention,
            selectedCandidateId: kimmich.candidateId,
            selectedName: kimmich.name,
            status: "resolved",
          }
        : {
            candidateCount: 1,
            candidates: [kane],
            candidatesTruncated: false,
            canonicalIdentityId: null,
            clarificationMessage: "Please confirm Harry Kane.",
            mention,
            selectedCandidateId: null,
            selectedName: null,
            status: "needs_confirmation",
          };

    const search = vi.fn<PlayerSearch>(agentGraphTest.emptySearchResult);

    const graph = agentGraphTest.createAgent({
      model: fakeModel(),
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [message]: agentGraphTest.requestForPlayers("player_comparison", [
          "Joshua Kimmich",
          "Harry Kane",
        ]),
      }),
      tools: agentGraphTest.createTools(search),
    });

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "early-alias-commit" } }
    );

    expect({
      confirmedAlias: interrupted.conversationContext.playerAliases,
      focusPlayers: interrupted.conversationContext.focusPlayers,
      interrupted: Object.hasOwn(interrupted, "__interrupt__"),
      searchCalls: search.mock.calls.length,
    }).toMatchObject({
      confirmedAlias: [
        {
          mention: "Joshua Kimmich",
          reference: { referenceId: "canonical-kimmich" },
        },
      ],
      focusPlayers: [],
      interrupted: true,
      searchCalls: 0,
    });
  });
});
