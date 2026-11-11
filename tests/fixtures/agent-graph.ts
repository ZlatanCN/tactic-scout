import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import { ChatOpenAI } from "@langchain/openai";
import { vi } from "vitest";

import type { CreateAgentOptions } from "../../src/agent.js";
import type { ReferenceIdentityLookup } from "../../src/player-data/resolve-reference.js";
import type { PlayerSearch } from "../../src/player-data/search-records.js";
import type { RequestUnderstandingExtractor } from "../../src/request-extraction.js";
import type { ReferenceCandidate } from "../../src/state.js";
import type { PlayerSearchInput } from "../../src/tools/search-player-records.js";
import {
  testModelContextProfile,
  testModelOutputLimitAdapter,
} from "./model-context.js";

const placeholder = "vitest-placeholder";

vi.stubEnv("OPENAI_API_KEY", placeholder);

vi.stubEnv("OPENAI_MODEL", placeholder);

vi.stubEnv("OPENAI_BASE_URL", "");

const testModelContextProfileEnvironment = JSON.stringify({
  baseURL: null,
  ...testModelContextProfile,
  model: placeholder,
});

vi.stubEnv(
  "TACTISCOUT_MODEL_CONTEXT_PROFILE",
  testModelContextProfileEnvironment
);

const missingPlayerSourceDatabase = path.join(
  tmpdir(),
  `tactiscout-agent-no-source-${randomUUID()}.sqlite`
);

vi.stubEnv("TACTISCOUT_FM_PROFILES_PATH", missingPlayerSourceDatabase);

vi.stubEnv("TACTISCOUT_UNDERSTAT_DB_PATH", missingPlayerSourceDatabase);

vi.stubEnv("TACTISCOUT_REEP_IDENTITY_DB_PATH", missingPlayerSourceDatabase);

const { createAgent: createAgentWithRuntime } =
  await import("../../src/agent.js");

const { createTools } =
  await import("../../src/tools/search-player-records.js");

const fakeModelWithDeterministicTokenCount = (
  model: NonNullable<CreateAgentOptions["model"]>
) => {
  if (model instanceof ChatOpenAI || Object.hasOwn(model, "getNumTokens")) {
    return model;
  }

  return Object.assign(model, {
    getNumTokens: async (text: string) => {
      await Promise.resolve();

      return Math.ceil(text.length / 4);
    },
  });
};

const createTestAgent = (options: CreateAgentOptions = {}) => {
  const { model, ...remainingOptions } = options;

  return createAgentWithRuntime({
    model:
      model === undefined
        ? undefined
        : fakeModelWithDeterministicTokenCount(model),
    modelContextProfile: testModelContextProfile,
    modelOutputLimitAdapter: testModelOutputLimitAdapter,
    playerReferenceValidator: () => ({ status: "current" }),
    ...remainingOptions,
  });
};

type ExtractedRequest = Awaited<ReturnType<RequestUnderstandingExtractor>>;

type EmptySearchResult = {
  fm?: { records: unknown[]; status: "not_found" };
  identityGroups: {
    canonicalGroups: unknown[];
    registryStatus: "not_needed";
    unlinkedRecords: unknown[];
  };
  query: PlayerSearchInput["sourceRecords"];
  requestedUnderstatSeasonStartYear?: number | null;
  understat?: { records: unknown[]; status: "not_found" };
};

const playerCandidate = (name: string, id: string): ReferenceCandidate => ({
  candidateId: `reep:${id}`,
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

const conversationReferenceFromCandidate = (candidate: ReferenceCandidate) => ({
  candidate,
  referenceId: candidate.canonicalIdentityId ?? candidate.candidateId,
});

const resolvedLookup =
  (candidate: ReferenceCandidate): ReferenceIdentityLookup =>
  (mention) => ({
    candidateCount: 1,
    candidates: [candidate],
    candidatesTruncated: false,
    canonicalIdentityId: candidate.canonicalIdentityId,
    clarificationMessage: null,
    mention,
    selectedCandidateId: candidate.candidateId,
    selectedName: candidate.name,
    status: "resolved",
  });

const resolvedLookupFromCandidates = (
  candidates: ReferenceCandidate[]
): ReferenceIdentityLookup => {
  const byName = new Map(
    candidates.map((candidate) => [candidate.name, candidate])
  );

  return async (mention) => {
    const candidate = await Promise.resolve(byName.get(mention));

    if (candidate === undefined) {
      throw new Error(`Unexpected identity lookup: ${mention}`);
    }

    return await resolvedLookup(candidate)(mention);
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

const requestForPlayers = (
  kind: ExtractedRequest["kind"],
  players: string[],
  extra: Partial<ExtractedRequest> = {}
): ExtractedRequest => ({
  constraints: [],
  kind,
  players: players.map((mention) => ({
    lookupName: null,
    mention,
    recommendationRole: "reference",
  })),
  teams: [],
  ...extra,
});

const emptySearchResult = (input: PlayerSearchInput): string => {
  const hasFmSource = input.sourceRecords.some(
    ({ provider }) => provider === "fm"
  );

  const hasUnderstatSource = input.sourceRecords.some(
    ({ provider }) => provider === "understat"
  );

  const result: EmptySearchResult = {
    identityGroups: {
      canonicalGroups: [],
      registryStatus: "not_needed",
      unlinkedRecords: [],
    },
    query: input.sourceRecords,
  };

  if (hasFmSource) {
    result.fm = { records: [], status: "not_found" };
  }

  if (hasUnderstatSource) {
    result.requestedUnderstatSeasonStartYear = input.seasonStartYear ?? null;
    result.understat = { records: [], status: "not_found" };
  }

  return JSON.stringify(result);
};

const emptySearch: PlayerSearch = (input) => emptySearchResult(input);

const fmRecord = (name: string, sourceRecordId: string) => ({
  attributes: {
    accelerationRaw: null,
    decisionsRaw: null,
    finishingRaw: null,
    first_touchRaw: null,
    off_the_ballRaw: null,
    paceRaw: null,
    passingRaw: null,
    strengthRaw: null,
    techniqueRaw: null,
    visionRaw: null,
  },
  birthDate: null,
  currentAbility: null,
  heightCm: null,
  identitySourceId: sourceRecordId,
  naturalPositions: null,
  player: name,
  potentialAbility: null,
  source: "Football Manager" as const,
  sourceRecordId,
});

const createSearchTool = (search: PlayerSearch) => createTools(search)[0];

const agentGraphTest = {
  conversationReferenceFromCandidate,
  createAgent: createTestAgent,
  createAgentWithRuntime,
  createExtractor,
  createSearchTool,
  createTools,
  emptySearch,
  emptySearchResult,
  fakeModelWithDeterministicTokenCount,
  fmRecord,
  playerCandidate,
  requestForPlayers,
  resolvedLookup,
  resolvedLookupFromCandidates,
  testModelContextProfileEnvironment,
};

export { agentGraphTest };

export type { EmptySearchResult, ExtractedRequest };
