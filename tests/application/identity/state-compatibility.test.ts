import { HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import type { RequestUnderstandingExtractor } from "../../../src/request-extraction.js";
import { createInitialRequestState } from "../../../src/state.js";
import { playerMemoryTest } from "../../fixtures/player-memory.js";

describe("memory access and state compatibility", () => {
  it("blocks an incompatible checkpoint before request extraction or memory access", async () => {
    const store = new InMemoryStore();
    const storeSearch = vi.spyOn(store, "search");

    const extractor = vi.fn<RequestUnderstandingExtractor>(
      playerMemoryTest.aliasCorrectionExtractor
    );

    const graph = playerMemoryTest.createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      requestUnderstandingExtractor: extractor,
      store,
      tools: [],
    });

    const result = await graph.invoke(
      {
        messages: [new HumanMessage("Look up 凯恩")],
        request: {
          ...createInitialRequestState(),
          processedMessageId: "completed-old-turn",
        },
        stateSchemaVersion: 0,
      },
      { configurable: { thread_id: "incompatible-state-version" } }
    );

    expect({
      extractorCalls: extractor.mock.calls.length,
      memoryReads: storeSearch.mock.calls.length,
      notice: result.messages.at(-1)?.content,
      outcome: result.outcome,
      requestMessageId: result.request.processedMessageId,
    }).toStrictEqual({
      extractorCalls: 0,
      memoryReads: 0,
      notice:
        "这个对话使用的状态版本（0）与当前应用版本 1 不兼容。历史记录仍可查看；请新建 thread 继续。此次请求没有执行，也没有修改球员记忆。",
      outcome: {
        kind: "state_compatibility",
        resultJson: JSON.stringify({ currentVersion: 1, storedVersion: 0 }),
        status: "incompatible",
      },
      requestMessageId: "completed-old-turn",
    });
  });

  it("blocks a legacy unversioned State that contains a pending interrupt", async () => {
    const store = new InMemoryStore();

    const extractor = vi.fn<RequestUnderstandingExtractor>(
      playerMemoryTest.aliasCorrectionExtractor
    );

    const graph = playerMemoryTest.createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      requestUnderstandingExtractor: extractor,
      store,
      tools: [],
    });

    const result = await graph.invoke(
      {
        messages: [new HumanMessage("1")],
        pendingClarification: {
          answer: null,
          kind: "identity",
          playerIndex: 0,
          question: "Which player did you mean?",
        },
        stateSchemaVersion: null,
      },
      { configurable: { thread_id: "legacy-unversioned-pending-state" } }
    );

    expect({
      extractorCalls: extractor.mock.calls.length,
      outcomeStatus: result.outcome?.status,
      pendingKind: result.pendingClarification?.kind,
    }).toStrictEqual({
      extractorCalls: 0,
      outcomeStatus: "incompatible",
      pendingKind: "identity",
    });
  });
});
