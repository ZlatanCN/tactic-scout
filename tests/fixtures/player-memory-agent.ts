import { createAgent } from "../../src/agent.js";
import { resolvePlayerReference } from "../../src/player-data/resolve-reference.js";
import type { RequestUnderstandingExtractor } from "../../src/request-extraction.js";

type ExtractedRequest = Awaited<ReturnType<RequestUnderstandingExtractor>>;

const extractions = new Map<string, ExtractedRequest>([
  [
    "Look up Kylian Mbappé",
    {
      constraints: [],
      kind: "player_lookup",
      players: [
        {
          lookupName: null,
          mention: "Kylian Mbappé",
          recommendationRole: "reference",
          referenceScope: "explicit",
          referenceTargetMention: null,
        },
      ],
      teams: [],
    },
  ],
  [
    "Look up Kylian Mbappe",
    {
      constraints: [],
      kind: "player_lookup",
      players: [
        {
          lookupName: null,
          mention: "Kylian Mbappe",
          recommendationRole: "reference",
          referenceScope: "explicit",
          referenceTargetMention: null,
        },
      ],
      teams: [],
    },
  ],
]);

const extractRequest: RequestUnderstandingExtractor = async (message) => {
  const request = extractions.get(message);

  if (request === undefined) {
    throw new Error(`Unexpected player-memory server request: ${message}`);
  }

  return await Promise.resolve(request);
};

const agent = createAgent({
  playerIdentityLookup: resolvePlayerReference,
  requestUnderstandingExtractor: extractRequest,
  store: null,
  tools: [],
});

export { agent };
