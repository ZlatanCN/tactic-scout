import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { Command, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v3";

import type { PlayerSearch } from "../../../src/player-data/search-records.js";
import { ActiveComparisonSchema } from "../../../src/state.js";
import {
  candidateFor,
  compareRequest,
  createAgent,
  createExtractor,
  createLookup,
  createTools,
  searchResult,
} from "../../fixtures/comparison-workflow.js";

describe("comparison workflow state", () => {
  it("keeps rejecting unsupported comparison filters", async () => {
    const kane = candidateFor("Harry Kane", "kane");
    const mbappe = candidateFor("Kylian Mbappé", "mbappe");

    const message =
      "Compare Harry Kane and Kylian Mbappé by a custom attribute.";

    const search = vi.fn<PlayerSearch>(searchResult);

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel(),
      playerIdentityLookup: createLookup([kane, mbappe]),
      requestUnderstandingExtractor: createExtractor({
        [message]: compareRequest(
          ["Harry Kane", "Kylian Mbappé"],
          [{ name: "attribute", value: "custom" }]
        ),
      }),
      tools: createTools(search),
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: "comparison-unsupported-filter" } }
    );

    expect({
      outcome: result.outcome?.status,
      searchCalls: search.mock.calls.length,
    }).toStrictEqual({
      outcome: "unsupported_constraints",
      searchCalls: 0,
    });
  });

  it("interrupts on an unparseable hard season and resumes the same comparison", async () => {
    const kane = candidateFor("Harry Kane", "kane");
    const mbappe = candidateFor("Kylian Mbappé", "mbappe");
    const message = "Compare Harry Kane and Kylian Mbappé in the 2026 season.";
    const search = vi.fn<PlayerSearch>(searchResult);

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel().respond(new AIMessage("Comparison checked.")),
      playerIdentityLookup: createLookup([kane, mbappe]),
      requestUnderstandingExtractor: createExtractor({
        [message]: compareRequest(
          ["Harry Kane", "Kylian Mbappé"],
          [{ name: "season", value: "2026赛季" }]
        ),
      }),
      tools: createTools(search),
    });

    const config = {
      configurable: { thread_id: "clarify-season-thread" },
    };

    const interrupted = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      config
    );

    const resumed = await graph.invoke(
      new Command({ resume: "2026/27" }),
      config
    );

    expect(interrupted).toHaveProperty("__interrupt__");
    expect(
      search.mock.calls.map(([query]) => query.seasonStartYear)
    ).toStrictEqual([2026, 2026]);
    expect(
      resumed.conversationContext.activeComparison.constraints
    ).toStrictEqual([{ name: "season", value: "2026/27" }]);
  });

  it("propagates unexpected data-tool errors without replacing the previous comparison", async () => {
    const kane = candidateFor("Harry Kane", "kane");
    const mbappe = candidateFor("Kylian Mbappé", "mbappe");
    const parrott = candidateFor("Troy Parrott", "parrott");
    const first = "Compare Harry Kane and Kylian Mbappé in 2024/25.";
    const addParrott = "Add Troy Parrott to the comparison.";

    const search = vi.fn<PlayerSearch>((input) => {
      if (
        input.sourceRecords.some((record) => record.sourceId === "parrott-fm")
      ) {
        throw new Error("Fixture data read failed.");
      }

      return searchResult(input);
    });

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel().respond(new AIMessage("First comparison checked.")),
      playerIdentityLookup: createLookup([kane, mbappe, parrott]),
      requestUnderstandingExtractor: createExtractor({
        [addParrott]: compareRequest(["Troy Parrott"], [], "add"),
        [first]: compareRequest(
          ["Harry Kane", "Kylian Mbappé"],
          [{ name: "season", value: "2024/25" }]
        ),
      }),
      tools: createTools(search),
    });

    const config = {
      configurable: { thread_id: "comparison-failure-thread" },
    };

    const firstResult = await graph.invoke(
      { messages: [new HumanMessage(first)] },
      config
    );

    const remembered = firstResult.conversationContext.activeComparison;

    await expect(
      graph.invoke({ messages: [new HumanMessage(addParrott)] }, config)
    ).rejects.toThrow("Fixture data read failed.");

    const failedState = z
      .object({
        values: z.object({
          conversationContext: z.object({
            activeComparison: ActiveComparisonSchema,
          }),
        }),
      })
      .safeParse(structuredClone(await graph.getState(config)));

    expect(failedState.success).toBeTruthy();

    if (!failedState.success) {
      throw new Error("The checkpoint did not retain the previous comparison.");
    }

    expect(
      failedState.data.values.conversationContext.activeComparison
    ).toStrictEqual(remembered);
  });
});
