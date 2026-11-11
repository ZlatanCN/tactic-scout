import { tmpdir } from "node:os";
import path from "node:path";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { vi } from "vitest";
import { z } from "zod/v4";

import { comparisonResultSchema } from "../../src/player-data/compare-records.js";
import type { understatSearchRecordSchema } from "../../src/player-data/understat.js";
import {
  AgentState,
  agentStateSchemaVersion,
  createInitialConversationContext,
  createInitialRequestState,
} from "../../src/state.js";
import { testModelContextProfile } from "./model-context.js";

const comparisonEvidenceModelName = "vitest-placeholder";

const configureComparisonEvidenceTestEnvironment = () => {
  vi.stubEnv("OPENAI_API_KEY", comparisonEvidenceModelName);
  vi.stubEnv("OPENAI_MODEL", comparisonEvidenceModelName);
  vi.stubEnv("OPENAI_BASE_URL", "");
  vi.stubEnv(
    "TACTISCOUT_FM_PROFILES_PATH",
    path.join(tmpdir(), "comparison-evidence-no-fm.sqlite")
  );
  vi.stubEnv(
    "TACTISCOUT_UNDERSTAT_DB_PATH",
    path.join(tmpdir(), "comparison-evidence-no-understat.sqlite")
  );
  vi.stubEnv(
    "TACTISCOUT_REEP_IDENTITY_DB_PATH",
    path.join(tmpdir(), "comparison-evidence-no-identity.sqlite")
  );
  vi.stubEnv(
    "TACTISCOUT_MODEL_CONTEXT_PROFILE",
    JSON.stringify({
      baseURL: null,
      ...testModelContextProfile,
      model: comparisonEvidenceModelName,
    })
  );
};

const comparisonEvidenceModelContextProfile = {
  countingMarginTokens: 64,
  maxInputTokens: 5000,
  maxOutputTokens: 256,
};

const comparisonEvidenceProjectionSchema = z.object({
  batch: z.object({
    index: z.number().int(),
    participantRefs: z.array(z.string()),
    remainingParticipantRefs: z.array(z.string()),
    total: z.number().int(),
  }),
  coverage: z.object({
    commonUnderstatScopeCount: z.number().int(),
    fmPlayerCount: z.number().int(),
    hasFmRecords: z.boolean(),
    hasUnderstatRecords: z.boolean(),
    playerCount: z.number().int(),
  }),
  participants: z.array(
    z.object({
      playerName: z.string(),
      providerCoverage: z.object({
        fm: z.looseObject({
          reason: z.string().optional(),
          status: z.string(),
        }),
        understat: z.looseObject({
          reason: z.string().optional(),
          status: z.string(),
        }),
      }),
    })
  ),
  selectedPlayers: z.array(
    z.object({
      fm: z.unknown().nullable(),
      playerName: z.string(),
      understat: z.unknown().nullable(),
    })
  ),
  understatScopes: z.array(
    z.object({
      competition: z.string(),
      coverage: z.object({
        coveredPlayerCount: z.number().int(),
        coversAllParticipants: z.boolean(),
        participantCount: z.number().int(),
      }),
      includedPlayers: z.array(
        z.object({
          playerName: z.string(),
          record: z.unknown().nullable(),
        })
      ),
      season: z.string(),
    })
  ),
});

const savedComparisonQuestion = "Explain the saved four-player comparison.";

const understatRecord = (
  playerName: string,
  sourcePlayerId: string,
  competition: string,
  season: string,
  goals: number
) => ({
  appearances: 20 + goals,
  assists: goals,
  competition,
  expectedAssists: goals / 10,
  expectedGoals: goals / 2,
  goals,
  keyPasses: goals + 1,
  minutes: 1500 + goals * 100,
  nonPenaltyExpectedGoals: goals / 3,
  player: playerName,
  position: "F M S",
  season,
  shots: 10 + goals,
  source: "Understat" as const,
  sourcePlayerId,
  team: `Synthetic Team ${goals}`,
});

type UnderstatFixtureRecord = z.output<typeof understatSearchRecordSchema>;

const comparisonFixture = () => {
  const players = Array.from({ length: 4 }, (_playerUnused, index) => {
    const id = `comparison-batch-${index + 1}`;
    const playerName = `Synthetic Comparison Player ${index + 1}`;

    const commonRecord = understatRecord(
      playerName,
      `${id}-understat`,
      "Bundesliga",
      "2025/26",
      index + 1
    );

    const localRecord = understatRecord(
      playerName,
      `${id}-understat`,
      "La_liga",
      "2024/25",
      index + 2
    );

    return {
      fm: {
        records: Array.from({ length: 10 }, (_recordUnused, profileIndex) => ({
          attributes: {
            accelerationRaw: 10 + index + profileIndex,
            decisionsRaw: 11 + index + profileIndex,
            finishingRaw: 12 + index + profileIndex,
            first_touchRaw: 13 + index + profileIndex,
            off_the_ballRaw: 14 + index + profileIndex,
            paceRaw: 15 + index + profileIndex,
            passingRaw: 16 + index + profileIndex,
            strengthRaw: 17 + index + profileIndex,
            techniqueRaw: 18 + index + profileIndex,
            visionRaw: 19 + index + profileIndex,
          },
          birthDate: `200${index}-01-02`,
          currentAbility: 130 + index + profileIndex,
          heightCm: 180 + index + profileIndex,
          identitySourceId: `${id}-fm-${profileIndex + 1}`,
          naturalPositions: "STC",
          player: playerName,
          potentialAbility: 160 + index + profileIndex,
          source: "Football Manager" as const,
          sourceRecordId: `${id}-fm-record-${profileIndex + 1}`,
        })),
        status: "found" as const,
      },
      identityBasis: "thread_confirmed" as const,
      playerName,
      understat: {
        records: index < 2 ? [commonRecord, localRecord] : [commonRecord],
        status: "found" as const,
      },
    };
  });

  const result = {
    coverage: {
      commonUnderstatScopeCount: 1,
      fmPlayerCount: 4,
      hasFmRecords: true,
      hasUnderstatRecords: true,
      playerCount: 4,
    },
    players,
    status: "ready" as const,
    understatScopeGroups: [
      {
        competition: "Bundesliga",
        coverage: {
          coveredPlayerCount: 4,
          coversAllParticipants: true,
          participantCount: 4,
        },
        players: players.map((player) => ({
          playerName: player.playerName,
          record: player.understat.records[0] ?? null,
        })),
        season: "2025/26",
      },
      {
        competition: "La_liga",
        coverage: {
          coveredPlayerCount: 2,
          coversAllParticipants: false,
          participantCount: 4,
        },
        players: players.map((player) => ({
          playerName: player.playerName,
          record: player.understat.records[1] ?? null,
        })),
        season: "2024/25",
      },
    ],
  };

  return { players, result, resultJson: JSON.stringify(result) };
};

const fixtureSerieRecordForPlayer = (playerName: string, index: number) =>
  understatRecord(
    playerName,
    `comparison-batch-${index + 1}-understat`,
    "Serie_A",
    "2025/26",
    index + 1
  );

const understatResultForRecord = (record: UnderstatFixtureRecord | null) =>
  record === null
    ? { records: [], status: "not_found" as const }
    : { records: [record], status: "found" as const };

const comparisonFixtureWithProviderStatuses = () => {
  const fixture = comparisonFixture();

  const fmResultFor = (
    player: (typeof fixture.players)[number],
    index: number
  ) => {
    if (index === 1) {
      return {
        reason: "The FM source is unavailable for this participant.",
        status: "unavailable" as const,
      };
    }

    if (index === 2) {
      return { records: [], status: "not_found" as const };
    }

    return index === 3 ? null : player.fm;
  };

  const players = fixture.players.map((player, index) => {
    let sourceRecord: UnderstatFixtureRecord | null = null;

    if (index < 2 && player.understat?.status === "found") {
      sourceRecord =
        player.understat.records.find(
          (record) => record.competition === "La_liga"
        ) ?? null;
    } else if (index >= 2) {
      sourceRecord = fixtureSerieRecordForPlayer(player.playerName, index);
    }

    if (index === 0 && sourceRecord !== null) {
      sourceRecord = { ...sourceRecord, expectedAssists: null };
    }

    return {
      ...player,
      fm: fmResultFor(player, index),
      understat: understatResultForRecord(sourceRecord),
    };
  });

  const understatScopeGroups = [
    {
      competition: "La_liga",
      coverage: {
        coveredPlayerCount: 2,
        coversAllParticipants: false,
        participantCount: 4,
      },
      players: players.map((player, index) => ({
        playerName: player.playerName,
        record:
          index < 2 && player.understat.status === "found"
            ? (player.understat.records[0] ?? null)
            : null,
      })),
      season: "2024/25",
    },
    {
      competition: "Serie_A",
      coverage: {
        coveredPlayerCount: 2,
        coversAllParticipants: false,
        participantCount: 4,
      },
      players: players.map((player, index) => ({
        playerName: player.playerName,
        record:
          index >= 2 && player.understat.status === "found"
            ? (player.understat.records[0] ?? null)
            : null,
      })),
      season: "2025/26",
    },
  ];

  const result = comparisonResultSchema.parse({
    ...fixture.result,
    coverage: {
      ...fixture.result.coverage,
      commonUnderstatScopeCount: 0,
      fmPlayerCount: 1,
    },
    players,
    understatScopeGroups,
  });

  if (!("coverage" in result)) {
    throw new Error("The provider-state comparison must be complete.");
  }

  return { players: result.players, resultJson: JSON.stringify(result) };
};

const candidateFor = (
  playerName: string,
  id: string,
  fmSourceIds: string[]
) => ({
  candidateId: `reep:${id}`,
  canonicalIdentityId: `canonical-${id}`,
  exactNameMatch: true,
  identityBasis: "thread_confirmed" as const,
  identityVerified: true,
  name: playerName,
  records: [
    ...fmSourceIds.map((sourceId) => ({
      canonicalIdentityId: `canonical-${id}`,
      competition: null,
      identityVerified: true,
      name: playerName,
      provider: "fm" as const,
      season: null,
      sourceId,
      team: null,
    })),
    {
      canonicalIdentityId: `canonical-${id}`,
      competition: "Bundesliga",
      identityVerified: true,
      name: playerName,
      provider: "understat" as const,
      season: "2025/26",
      sourceId: `${id}-understat`,
      team: `Synthetic Team ${id}`,
    },
  ],
});

type ComparisonFixturePlayer = Extract<
  z.output<typeof comparisonResultSchema>,
  { status: "ready" | "no_comparable_data" }
>["players"][number];

const graphStateForSavedComparison = (
  resultJson: string,
  players: ComparisonFixturePlayer[] = comparisonFixture().players
) => {
  const message = new HumanMessage({
    content: savedComparisonQuestion,
    id: "saved-four-player-comparison-batches",
  });

  return AgentState.parse({
    conversationContext: {
      ...createInitialConversationContext(),
      activeComparison: {
        constraints: [],
        players: players.map((player, index) => {
          let fmSourceIds: string[] = [];

          if (player.fm !== null) {
            fmSourceIds =
              player.fm.status === "found"
                ? player.fm.records.map(
                    ({ identitySourceId }) => identitySourceId
                  )
                : [`comparison-batch-${index + 1}-fm-1`];
          }

          const candidate = candidateFor(
            player.playerName,
            `comparison-batch-${index + 1}`,
            fmSourceIds
          );

          return {
            candidate,
            referenceId: candidate.canonicalIdentityId,
          };
        }),
        resultJson,
      },
    },
    messages: [message],
    outcome: {
      kind: "player_comparison",
      resultJson,
      source: "saved",
      status: "ready",
    },
    request: {
      ...createInitialRequestState(),
      processedMessageId: message.id,
    },
    stateSchemaVersion: agentStateSchemaVersion,
  });
};

const comparisonProjectionFromCall = (
  input: Parameters<BaseChatModel["invoke"]>[0]
) => {
  const parsedMessages = z.array(z.instanceof(BaseMessage)).safeParse(input);

  if (!parsedMessages.success) {
    throw new Error("The comparison evidence call must send chat messages.");
  }

  const humanMessage = parsedMessages.data.find(
    (message) => message instanceof HumanMessage
  );

  if (humanMessage === undefined) {
    throw new Error(
      "The comparison evidence call must include a user message."
    );
  }

  const content = z.string().parse(humanMessage.content);
  const marker = "Comparison evidence projection JSON:\n";
  const markerIndex = content.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(
      "The model did not receive a comparison evidence projection."
    );
  }

  return comparisonEvidenceProjectionSchema.parse(
    JSON.parse(content.slice(markerIndex + marker.length))
  );
};

const modelMessagesFromCall = (
  input: Parameters<BaseChatModel["invoke"]>[0]
): BaseMessage[] => {
  const parsedMessages = z.array(z.instanceof(BaseMessage)).safeParse(input);

  if (!parsedMessages.success) {
    throw new Error("The comparison evidence call must send chat messages.");
  }

  return parsedMessages.data;
};

const comparisonEvidenceTest = {
  comparisonEvidenceModelContextProfile,
  comparisonEvidenceProjectionSchema,
  comparisonFixture,
  comparisonFixtureWithProviderStatuses,
  comparisonProjectionFromCall,
  graphStateForSavedComparison,
  modelMessagesFromCall,
  savedComparisonQuestion,
};

export { comparisonEvidenceTest, configureComparisonEvidenceTestEnvironment };
