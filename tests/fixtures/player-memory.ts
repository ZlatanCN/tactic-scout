import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { vi } from "vitest";

import type { CreateAgentOptions } from "../../src/agent.js";
import type { RequestUnderstandingExtractor } from "../../src/request-extraction.js";
import { AgentState } from "../../src/state.js";
import type { AgentStateType, ReferenceCandidate } from "../../src/state.js";
import type { ThreadState } from "./langgraph-dev-server.js";
import {
  testModelContextProfile,
  testModelOutputLimitAdapter,
  testModelWithDeterministicTokenCount,
} from "./model-context.js";
import { createPlayerMemorySources } from "./player-memory-sources.js";

const kaneName = "Harry Kane";
const haalandName = "Erling Haaland";
const aliasName = "凯恩";

vi.stubEnv("OPENAI_API_KEY", "vitest-placeholder");

vi.stubEnv("OPENAI_MODEL", "vitest-placeholder");

vi.stubEnv("OPENAI_BASE_URL", "");

const { createAgent: createAgentWithRuntime } =
  await import("../../src/agent.js");

const createAgent = (options: CreateAgentOptions = {}) => {
  const { model, ...remainingOptions } = options;

  return createAgentWithRuntime({
    model:
      model === undefined
        ? undefined
        : testModelWithDeterministicTokenCount(model),
    modelContextProfile: testModelContextProfile,
    modelOutputLimitAdapter: testModelOutputLimitAdapter,
    ...remainingOptions,
  });
};

const temporaryDirectories: string[] = [];

const sourceGroupExtraction = (mention: string) => ({
  constraints: [],
  kind: "player_lookup" as const,
  players: [
    { lookupName: null, mention, recommendationRole: "reference" as const },
  ],
  teams: [],
});

const sourceGroupExtractor =
  (mentions: string[]): RequestUnderstandingExtractor =>
  async (message) => {
    const mention = mentions.find(
      (name) => message === `Look up ${name}` || message === `重新解析 ${name}`
    );

    if (mention === undefined) {
      throw new Error(`Unexpected player-memory test message: ${message}`);
    }

    return await Promise.resolve(sourceGroupExtraction(mention));
  };

const aliasCorrectionMessage =
  "Correct the remembered alias 凯恩 to Erling Haaland";

const aliasCorrectionExtractor: RequestUnderstandingExtractor = async (
  message
) => {
  if (message === "Clear all player memories") {
    return await Promise.resolve({
      constraints: [],
      kind: "other" as const,
      playerMemoryManagement: { action: "clear" as const },
      players: [],
      teams: [],
    });
  }

  if (message === "Show remembered player memories") {
    return await Promise.resolve({
      constraints: [],
      kind: "other" as const,
      playerMemoryManagement: { action: "list" as const },
      players: [],
      teams: [],
    });
  }

  if (message === `Look up ${aliasName}`) {
    return await Promise.resolve({
      ...sourceGroupExtraction(aliasName),
      players: [
        {
          lookupName: kaneName,
          mention: aliasName,
          recommendationRole: "reference" as const,
        },
      ],
    });
  }

  if (message === `Look up ${kaneName}`) {
    return await Promise.resolve(sourceGroupExtraction(kaneName));
  }

  if (message === aliasCorrectionMessage) {
    return await Promise.resolve({
      constraints: [],
      kind: "other" as const,
      playerMemoryManagement: {
        action: "correct" as const,
        replacementMention: haalandName,
        targetKind: "player_identity" as const,
        targetMention: aliasName,
      },
      players: [],
      teams: [],
    });
  }

  throw new Error(`Unexpected player-memory correction input: ${message}`);
};

const playerIdentityMemoryFixture = (
  mention: string,
  sourceId: string,
  confirmationId: string,
  stableIdentityKey: string
) => ({
  canonicalIdentityId: null,
  confirmationId,
  confirmedAt: "2026-11-08T00:00:00.000Z",
  displayName: sourceId === "fm-kane" ? kaneName : haalandName,
  identityVerified: false,
  kind: "player_identity" as const,
  normalizedMention: mention.trim().toLocaleLowerCase().replaceAll(/\s/gu, ""),
  originThreadId: "clear-fixture-thread",
  originalMention: mention,
  schemaVersion: 1,
  sourceRecords: [
    {
      canonicalIdentityId: null,
      competition: null,
      identityVerified: false,
      name: sourceId === "fm-kane" ? kaneName : haalandName,
      provider: "fm" as const,
      season: null,
      sourceId,
    },
  ],
  sourceVersions: {
    fmManifestSha256: null,
    fmSnapshotDate: null,
    identityRegistryRelease: null,
    understatScopes: [],
  },
  stableIdentityKey,
});

const withSourceFixtures = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "tactiscout-memory-"));
  temporaryDirectories.push(directory);
  const sourcePaths = await createPlayerMemorySources(directory);

  vi.stubEnv("OPENAI_BASE_URL", "http://127.0.0.1:1");
  vi.stubEnv("TACTISCOUT_FM_PROFILES_PATH", sourcePaths.fmDatabasePath);
  vi.stubEnv("TACTISCOUT_REEP_IDENTITY_DB_PATH", sourcePaths.reepDatabasePath);
  vi.stubEnv("TACTISCOUT_UNDERSTAT_DB_PATH", sourcePaths.understatDatabasePath);
  vi.stubEnv("TACTISCOUT_UNDERSTAT_AI_PROCESSING_ALLOWED", "true");

  return sourcePaths;
};

const candidateWithSource = (
  candidates: ReferenceCandidate[],
  provider: "fm" | "understat",
  sourceId: string
): ReferenceCandidate => {
  const candidate = candidates.find((item) =>
    item.records.some(
      (record) => record.provider === provider && record.sourceId === sourceId
    )
  );

  if (candidate === undefined) {
    throw new Error(`Could not find ${provider} source ${sourceId}.`);
  }

  return candidate;
};

const selectedIdentity = (state: AgentStateType) => {
  const resolution = state.request.players[0]?.resolution;

  if (resolution?.status !== "resolved") {
    return {
      candidates: resolution?.candidates ?? [],
      status: resolution?.status,
    };
  }

  const candidate = resolution.candidates.find(
    (item) => item.candidateId === resolution.selectedCandidateId
  );

  return {
    canonicalIdentityId: resolution.canonicalIdentityId,
    identityBasis: candidate?.identityBasis,
    records:
      candidate?.records.map(
        ({ canonicalIdentityId, identityVerified, provider, sourceId }) => ({
          canonicalIdentityId,
          identityVerified,
          provider,
          sourceId,
        })
      ) ?? [],
    status: resolution.status,
  };
};

const selectedServerIdentity = (state: ThreadState) =>
  selectedIdentity(AgentState.parse(state.values));

const cleanup = async () => {
  vi.unstubAllEnvs();

  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    })
  );
};

const playerMemoryTest = {
  aliasCorrectionExtractor,
  aliasCorrectionMessage,
  candidateWithSource,
  cleanup,
  createAgent,
  playerIdentityMemoryFixture,
  selectedIdentity,
  selectedServerIdentity,
  sourceGroupExtraction,
  sourceGroupExtractor,
  withSourceFixtures,
};

export { playerMemoryTest };
