import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import type { ReferenceIdentityLookup } from "../../../src/player-data/resolve-reference.js";
import type { PlayerSearch } from "../../../src/player-data/search-records.js";
import { agentGraphTest } from "../../fixtures/agent-graph.js";

describe("comparison workflow", () => {
  it("executes comparison directly and commits an empty completed comparison for later additions", async () => {
    const kane = agentGraphTest.playerCandidate("Harry Kane", "kane");
    const mbappe = agentGraphTest.playerCandidate("Kylian Mbappé", "mbappe");
    const parrott = agentGraphTest.playerCandidate("Troy Parrott", "parrott");

    const candidates = new Map(
      [kane, mbappe, parrott].map((candidate) => [candidate.name, candidate])
    );

    const identityLookup: ReferenceIdentityLookup = (mention) => {
      const candidate = candidates.get(mention);

      if (candidate === undefined) {
        throw new Error(`Unexpected identity lookup: ${mention}`);
      }

      return {
        candidateCount: 1,
        candidates: [candidate],
        candidatesTruncated: false,
        canonicalIdentityId: candidate.canonicalIdentityId,
        clarificationMessage: null,
        mention,
        selectedCandidateId: candidate.candidateId,
        selectedName: candidate.name,
        status: "resolved",
      };
    };

    const search = vi.fn<PlayerSearch>(agentGraphTest.emptySearchResult);
    const firstMessage = "Compare Harry Kane and Kylian Mbappé.";
    const addMessage = "Add Troy Parrott to the comparison.";

    const model = fakeModel()
      .respond(new AIMessage("No comparable data was available."))
      .respond(new AIMessage("The three-player comparison was checked."));

    const graph = agentGraphTest.createAgent({
      checkpointer: new MemorySaver(),
      model,
      playerIdentityLookup: identityLookup,
      requestUnderstandingExtractor: agentGraphTest.createExtractor({
        [addMessage]: agentGraphTest.requestForPlayers(
          "player_comparison",
          ["Troy Parrott"],
          {
            comparisonAction: "add",
          }
        ),
        [firstMessage]: agentGraphTest.requestForPlayers("player_comparison", [
          "Harry Kane",
          "Kylian Mbappé",
        ]),
      }),
      tools: agentGraphTest.createTools(search),
    });

    const config = {
      configurable: { thread_id: "comparison-thread" },
    };

    await graph.invoke({ messages: [new HumanMessage(firstMessage)] }, config);

    const completed = await graph.invoke(
      { messages: [new HumanMessage(addMessage)] },
      config
    );

    expect(search).toHaveBeenCalledTimes(5);
    expect(search.mock.calls[0]?.[0].sourceRecords).toStrictEqual([
      { provider: "fm", sourceId: "kane-fm" },
      { provider: "understat", sourceId: "kane-understat" },
    ]);
    expect(completed.conversationContext.activeComparison.players).toHaveLength(
      3
    );
    expect(
      search.mock.calls
        .slice(2)
        .map(([query]) => query.sourceRecords[0]?.sourceId)
    ).toStrictEqual(["kane-fm", "mbappe-fm", "parrott-fm"]);
    expect(completed.messages.at(-1)?.content).toBe(
      "The three-player comparison was checked."
    );
  });
});
