import { vi } from "vitest";

import type { CreateAgentOptions } from "../../src/agent.js";
import type { ReferenceIdentityLookup } from "../../src/player-data/resolve-reference.js";
import type { RequestUnderstandingExtractor } from "../../src/request-extraction.js";
import type { ReferenceCandidate } from "../../src/state.js";
import type { PlayerSearchInput } from "../../src/tools/search-player-records.js";
import {
  testModelContextProfile,
  testModelOutputLimitAdapter,
} from "./model-context.js";

vi.stubEnv("OPENAI_API_KEY", "vitest-placeholder");

vi.stubEnv("OPENAI_MODEL", "vitest-placeholder");

vi.stubEnv("OPENAI_BASE_URL", "");

const { createAgent: createAgentWithRuntime } =
  await import("../../src/agent.js");

const { createTools } =
  await import("../../src/tools/search-player-records.js");

const createAgent = (options: CreateAgentOptions = {}) => {
  const configuredModel = options.model;

  const model =
    configuredModel === undefined ||
    Object.hasOwn(configuredModel, "getNumTokens")
      ? configuredModel
      : Object.assign(configuredModel, {
          getNumTokens: async (text: string) => {
            await Promise.resolve();

            return Math.ceil(text.length / 4);
          },
        });

  return createAgentWithRuntime({
    ...options,
    model,
    modelContextProfile: options.modelContextProfile ?? testModelContextProfile,
    modelOutputLimitAdapter:
      options.modelOutputLimitAdapter ?? testModelOutputLimitAdapter,
  });
};

type ExtractedRequest = Awaited<ReturnType<RequestUnderstandingExtractor>>;

const candidateFor = (name: string, id: string): ReferenceCandidate => ({
  candidateId: `candidate-${id}`,
  canonicalIdentityId: `canonical-${id}`,
  exactNameMatch: true,
  identityBasis: "reep_registry",
  identityVerified: true,
  name,
  records: [
    {
      canonicalIdentityId: `canonical-${id}`,
      competition: null,
      identityVerified: true,
      name,
      provider: "fm",
      season: null,
      sourceId: `${id}-fm`,
      team: null,
    },
    {
      canonicalIdentityId: `canonical-${id}`,
      competition: "Bundesliga",
      identityVerified: true,
      name,
      provider: "understat",
      season: "2025/26",
      sourceId: `${id}-understat`,
      team: "Fixture FC",
    },
  ],
});

const compareRequest = (
  players: string[],
  constraints: ExtractedRequest["constraints"] = [],
  comparisonAction: "replace" | "add" | "refine" = "replace"
): ExtractedRequest => ({
  comparisonAction,
  constraints,
  kind: "player_comparison",
  players: players.map((mention) => ({
    lookupName: null,
    mention,
    recommendationRole: "reference",
  })),
  teams: [],
});

const searchResult = (input: PlayerSearchInput): string =>
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
  });

const createLookup = (
  candidates: ReferenceCandidate[]
): ReferenceIdentityLookup => {
  const byName = new Map(candidates.map((item) => [item.name, item]));

  return (mention) => {
    const selected = byName.get(mention);

    if (selected === undefined) {
      throw new Error(`Unexpected identity lookup: ${mention}`);
    }

    return {
      candidateCount: 1,
      candidates: [selected],
      candidatesTruncated: false,
      canonicalIdentityId: selected.canonicalIdentityId,
      clarificationMessage: null,
      mention,
      selectedCandidateId: selected.candidateId,
      selectedName: selected.name,
      status: "resolved",
    };
  };
};

const createExtractor =
  (requests: Record<string, ExtractedRequest>): RequestUnderstandingExtractor =>
  async (message) => {
    const request = await Promise.resolve(requests[message]);

    if (request === undefined) {
      throw new Error(`Unexpected test message: ${message}`);
    }

    return request;
  };

export {
  candidateFor,
  compareRequest,
  createAgent,
  createExtractor,
  createLookup,
  createTools,
  searchResult,
};
