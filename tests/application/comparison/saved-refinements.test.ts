import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import type { PlayerSearch } from "../../../src/player-data/search-records.js";
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
  it("refines comparison conditions while inheriting the completed participants", async () => {
    const kane = candidateFor("Harry Kane", "kane");
    const mbappe = candidateFor("Kylian Mbappé", "mbappe");
    const firstMessage = "Compare Harry Kane and Kylian Mbappé in 2024/25.";
    const refineMessage = "Change the comparison season to 2025/26.";
    const search = vi.fn<PlayerSearch>(searchResult);

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel()
        .respond(new AIMessage("The first comparison has no shared records."))
        .respond(
          new AIMessage("The refined comparison has no shared records.")
        ),
      playerIdentityLookup: createLookup([kane, mbappe]),
      requestUnderstandingExtractor: createExtractor({
        [firstMessage]: compareRequest(
          ["Harry Kane", "Kylian Mbappé"],
          [{ name: "season", value: "2024/25" }]
        ),
        [refineMessage]: compareRequest(
          [],
          [{ name: "season", value: "2025/26" }],
          "refine"
        ),
      }),
      tools: createTools(search),
    });

    const config = {
      configurable: { thread_id: "comparison-condition-refinement" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);

    const refined = await graph.invoke(
      { messages: [new HumanMessage(refineMessage)] },
      config
    );

    expect({
      participants: refined.conversationContext.activeComparison.players.map(
        ({ candidate: item }) => item.name
      ),
      requestedSeasons: search.mock.calls.map(
        ([input]) => input.seasonStartYear
      ),
      storedSeason: refined.conversationContext.activeComparison.constraints,
    }).toStrictEqual({
      participants: ["Harry Kane", "Kylian Mbappé"],
      requestedSeasons: [2024, 2024, 2025, 2025],
      storedSeason: [{ name: "season", value: "2025/26" }],
    });
  });

  it("continues a failed condition-only comparison refinement from its saved participants and conditions", async () => {
    const kane = candidateFor("Harry Kane", "kane");
    const mbappe = candidateFor("Kylian Mbappé", "mbappe");
    const firstMessage = "Compare Harry Kane and Kylian Mbappé in 2024/25.";
    const failedRefinement = "Change the comparison season to 2025/26.";
    const nextRefinement = "Also restrict the comparison to EPL.";

    const search = vi.fn<PlayerSearch>((input) => {
      if (input.seasonStartYear === 2025) {
        return JSON.stringify({
          fm: { records: [], status: "not_found" },
          identityGroups: { canonicalGroups: [] },
          query: input.sourceRecords,
          understat: { reason: "Snapshot unavailable", status: "unavailable" },
        });
      }

      return searchResult(input);
    });

    const graph = createAgent({
      checkpointer: new MemorySaver(),
      model: fakeModel()
        .respond(new AIMessage("Initial comparison."))
        .respond(new AIMessage("The saved comparison was refined.")),
      playerIdentityLookup: createLookup([kane, mbappe]),
      requestUnderstandingExtractor: createExtractor({
        [failedRefinement]: compareRequest(
          [],
          [{ name: "season", value: "2025/26" }],
          "refine"
        ),
        [firstMessage]: compareRequest(
          ["Harry Kane", "Kylian Mbappé"],
          [{ name: "season", value: "2024/25" }]
        ),
        [nextRefinement]: {
          constraints: [{ name: "competition", value: "EPL" }],
          continuationAction: "refine",
          kind: null,
          players: [],
          teams: [],
        },
      }),
      tools: createTools(search),
    });

    const config = {
      configurable: { thread_id: "failed-comparison-refine-baseline" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);

    const failed = await graph.invoke(
      { messages: [new HumanMessage(failedRefinement)] },
      config
    );

    const resumed = await graph.invoke(
      { messages: [new HumanMessage(nextRefinement)] },
      config
    );

    expect({
      failedOutcome: failed.outcome?.status,
      participants: resumed.conversationContext.activeComparison.players.map(
        ({ candidate: item }) => item.name
      ),
      requestedSeasons: search.mock.calls.map(
        ([input]) => input.seasonStartYear
      ),
      scopes: resumed.conversationContext.activeComparison.constraints,
    }).toStrictEqual({
      failedOutcome: "data_unavailable",
      participants: ["Harry Kane", "Kylian Mbappé"],
      requestedSeasons: [2024, 2024, 2025, 2025, 2024, 2024],
      scopes: [
        { name: "season", value: "2024/25" },
        { name: "competition", value: "EPL" },
      ],
    });
  });
});
