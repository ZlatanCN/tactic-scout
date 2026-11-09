import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { deflateRawSync } from "node:zlib";

import { z } from "zod/v4";

import type { PlayerMemoryManagementExtraction } from "../../src/request-extraction.js";
import type { RequestKind } from "../../src/state.js";

const fixtureKaneName = "Harry Kane";
const fixtureHaalandName = "Erling Haaland";
const fixtureTeamName = "Test Club";
const fixtureOutageTeamName = "Outage Club";
const fixtureReplacementCandidateName = "Replacement Candidate";
const fixtureRosterMemoryTeamName = "Roster Memory Club";
const fixtureRosterMemoryTeamId = 542;
const fixtureRosterMemoryPlayerId = 11;
const persistenceTestModelName = "persistence-test-model";
const savedScoutingContextAnswer = "The saved scouting context is ready.";

type RunningServer = {
  child: ReturnType<typeof spawn>;
  output: () => string;
};

type LocalGateway = {
  calls: () => string[];
  close: () => Promise<void>;
  eventUrl: string;
  events: () => string[];
  providerUrl: string;
  url: string;
};

type DevServerSession = {
  baseUrl: string;
  gateway: LocalGateway;
  sourceFixturePaths: {
    fmDatabasePath: string;
    reepDatabasePath: string;
    understatDatabasePath: string;
  };
  close: () => Promise<void>;
  restart: () => Promise<void>;
};

const repoRoot = process.cwd();

const apiThreadSchema = z.object({ thread_id: z.string() });

const threadStateSchema = z.looseObject({
  tasks: z
    .array(z.looseObject({ interrupts: z.array(z.unknown()).optional() }))
    .default([]),
  values: z.looseObject({
    contextProcessing: z
      .object({
        allowance: z
          .object({
            consumedActiveTimeMs: z.number(),
            consumedAdditionalCalls: z.number(),
            maxActiveTimeMs: z.number(),
            maxAdditionalCalls: z.number(),
            requestId: z.string(),
            reservation: z
              .object({
                maxActiveTimeMs: z.number(),
                operation: z.literal("compact_text"),
                operationId: z.string(),
                sourceHash: z.string(),
                sourceMessageId: z.string(),
              })
              .nullable(),
          })
          .nullable(),
        compaction: z
          .object({
            activeContextHash: z.string(),
            anchors: z.array(z.object({ kind: z.string(), text: z.string() })),
            formatVersion: z.number(),
            instruction: z.string().nullable(),
            instructionHash: z.string().nullable(),
            modelConfigurationHash: z.string(),
            outputTokenEstimate: z.number().nullable(),
            progress: z.object({ end: z.number(), start: z.number() }),
            references: z.array(
              z.object({
                anchorIndex: z.number(),
                end: z.number(),
                start: z.number(),
                text: z.string(),
              })
            ),
            requestId: z.string(),
            sourceHash: z.string(),
            sourceMessageId: z.string(),
            sourceTokenEstimate: z.number().nullable(),
            status: z.string(),
            stopReason: z.string().nullable(),
          })
          .nullable(),
      })
      .optional(),
    conversationContext: z.looseObject({
      activeComparison: z.looseObject({ resultJson: z.string() }).nullable(),
      activeLookup: z.looseObject({ resultJson: z.string() }).nullable(),
      activeRecommendation: z
        .looseObject({ resultJson: z.string() })
        .nullable(),
      activeTeamRecommendation: z
        .looseObject({ resultJson: z.string() })
        .nullable(),
    }),
    messages: z
      .array(
        z.object({
          content: z.unknown(),
          id: z.string().optional(),
          type: z.string(),
        })
      )
      .default([]),
    outcome: z
      .object({
        kind: z.string().optional(),
        resultJson: z.string().nullable().optional(),
        source: z.string().optional(),
        status: z.string().optional(),
      })
      .nullable(),
    pendingClarification: z
      .looseObject({
        answer: z.string().nullable(),
        kind: z.string(),
        question: z.string(),
      })
      .nullable()
      .optional(),
    request: z.looseObject({
      constraints: z
        .array(z.object({ name: z.string(), value: z.string() }))
        .optional(),
      kind: z.string(),
      players: z
        .array(
          z.looseObject({
            resolution: z
              .looseObject({
                candidates: z
                  .array(
                    z.looseObject({
                      candidateId: z.string(),
                      name: z.string(),
                      records: z.array(
                        z.looseObject({
                          canonicalIdentityId: z.string().nullable().optional(),
                          identityVerified: z.boolean().optional(),
                          provider: z.enum(["fm", "understat"]),
                          sourceId: z.string(),
                        })
                      ),
                    })
                  )
                  .optional(),
                selectedCandidateId: z.string().nullable().optional(),
                status: z.string(),
              })
              .nullable()
              .optional(),
          })
        )
        .optional(),
      recommendation: z
        .object({
          maxAge: z.number().nullable(),
          needsAgeClarification: z.boolean(),
        })
        .optional(),
      teamRecommendation: z
        .looseObject({
          includePotential: z.boolean().optional(),
          maxAge: z.number().nullable().optional(),
          minimumCurrentAbility: z.number().nullable().optional(),
          minimumPotentialAbility: z.number().nullable().optional(),
          position: z.string().nullable().optional(),
          resultLimit: z.number().nullable().optional(),
          roster: z
            .looseObject({
              members: z.array(
                z.looseObject({
                  apiFootballPlayerId: z.number().optional(),
                  fmId: z.string().nullable(),
                  mappingMethod: z.string().nullable(),
                  mappingStatus: z.string(),
                  name: z.string().optional(),
                  position: z.string().nullable().optional(),
                })
              ),
              retrievedAt: z.string().optional(),
              team: z
                .looseObject({
                  id: z.number().optional(),
                  name: z.string().optional(),
                })
                .optional(),
            })
            .nullable(),
        })
        .optional(),
    }),
    stateSchemaVersion: z.number().int().nonnegative().nullable().optional(),
  }),
});

type ThreadState = z.output<typeof threadStateSchema>;

const storeItemSchema = z.object({
  value: z.object({ confirmed: z.boolean(), sourceIds: z.array(z.string()) }),
});

const tcpAddressSchema = z.object({ port: z.number().int().positive() });

const createSourceFixtures = async (projectPath: string) => {
  const fixturePath = path.join(projectPath, "fixtures");
  const fmDatabasePath = path.join(fixturePath, "fm-profiles.sqlite");
  const reepDatabasePath = path.join(fixturePath, "reep-identity.sqlite");
  const understatDatabasePath = path.join(fixturePath, "understat.sqlite");
  await mkdir(fixturePath, { recursive: true });

  const profiles = [
    {
      ability: 14,
      birthDate: "1993-07-28",
      fmId: "fm-kane",
      name: fixtureKaneName,
      positionRating: 20,
    },
    {
      ability: 15,
      birthDate: "2000-07-21",
      fmId: "fm-haaland",
      name: fixtureHaalandName,
      positionRating: 20,
    },
    {
      ability: 16,
      birthDate: "2004-01-01",
      fmId: "fm-prospect",
      name: "Fixture Prospect",
      positionRating: 20,
    },
    {
      ability: 10,
      birthDate: "2003-03-03",
      fmId: "fm-replacement-one",
      name: fixtureReplacementCandidateName,
      positionRating: 10,
    },
    {
      ability: 11,
      birthDate: "2004-04-04",
      fmId: "fm-replacement-two",
      name: fixtureReplacementCandidateName,
      positionRating: 10,
    },
  ];

  const fmDatabase = new DatabaseSync(fmDatabasePath);

  try {
    fmDatabase.exec(`
      CREATE TABLE manifest (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE players (
        record_id TEXT PRIMARY KEY,
        unique_id TEXT,
        name TEXT,
        birth_date TEXT,
        payload BLOB NOT NULL
      );
      CREATE TABLE positions (record_id TEXT NOT NULL, position TEXT NOT NULL, rating INTEGER NOT NULL);
      CREATE TABLE aliases (record_id TEXT NOT NULL, name TEXT);
    `);
    fmDatabase.prepare("INSERT INTO manifest (id, payload) VALUES (1, ?)").run(
      JSON.stringify({
        gameBuild: "persistence-test-build",
        inGameDate: "2025-11-23",
        sha256: "persistence-test-snapshot",
      })
    );

    const insertPlayer = fmDatabase.prepare(
      "INSERT INTO players (record_id, unique_id, name, birth_date, payload) VALUES (?, ?, ?, ?, ?)"
    );

    const insertPosition = fmDatabase.prepare(
      "INSERT INTO positions (record_id, position, rating) VALUES (?, ?, ?)"
    );

    for (const profile of profiles) {
      const abilityValue = profile.ability;

      const compressedProfile = deflateRawSync(
        Buffer.from(
          JSON.stringify({
            ability_current: abilityValue * 10,
            ability_potential: abilityValue * 10 + 15,
            birth_date: profile.birthDate,
            common_name: profile.name,
            full_name: profile.name,
            height_cm: 188,
            name: profile.name,
            natural_positions: "STC",
            raw_attributes_acceleration: abilityValue,
            raw_attributes_anticipation: abilityValue,
            raw_attributes_composure: abilityValue,
            raw_attributes_decisions: abilityValue,
            raw_attributes_dribbling: abilityValue,
            raw_attributes_finishing: abilityValue,
            raw_attributes_first_touch: abilityValue,
            raw_attributes_heading: abilityValue,
            raw_attributes_jumping_reach: abilityValue,
            raw_attributes_off_the_ball: abilityValue,
            raw_attributes_pace: abilityValue,
            raw_attributes_passing: abilityValue,
            raw_attributes_stamina: abilityValue,
            raw_attributes_strength: abilityValue,
            raw_attributes_teamwork: abilityValue,
            raw_attributes_technique: abilityValue,
            raw_attributes_vision: abilityValue,
            raw_attributes_work_rate: abilityValue,
            unique_id: profile.fmId,
          })
        )
      );

      const recordId = `${profile.fmId}-record`;
      insertPlayer.run(
        recordId,
        profile.fmId,
        profile.name,
        profile.birthDate,
        compressedProfile
      );
      insertPosition.run(recordId, "stc", profile.positionRating);
    }
  } finally {
    fmDatabase.close();
  }

  const reepDatabase = new DatabaseSync(reepDatabasePath);

  try {
    reepDatabase.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE bridges (
        provider TEXT NOT NULL,
        namespace TEXT NOT NULL,
        external_id TEXT NOT NULL,
        canonical_reep_id TEXT,
        redirect_status TEXT NOT NULL
      );
    `);
    reepDatabase
      .prepare(
        "INSERT INTO metadata (key, value) VALUES ('release_stamp', 'persistence-test-release')"
      )
      .run();

    const insertBridge = reepDatabase.prepare(
      "INSERT INTO bridges (provider, namespace, external_id, canonical_reep_id, redirect_status) VALUES (?, 'player', ?, ?, 'resolved')"
    );

    for (const profile of profiles) {
      insertBridge.run(
        "fm",
        profile.fmId,
        `canonical:${profile.fmId.slice(3)}`
      );
    }

    insertBridge.run("api_football", "10", "canonical:kane");
  } finally {
    reepDatabase.close();
  }

  const understatDatabase = new DatabaseSync(understatDatabasePath);

  try {
    understatDatabase.exec(
      "CREATE TABLE source_snapshots (kind TEXT, resource_id TEXT, season_start_year INTEGER, payload_json TEXT)"
    );
  } finally {
    understatDatabase.close();
  }

  return { fmDatabasePath, reepDatabasePath, understatDatabasePath };
};

type FixtureExtraction = {
  comparisonAction?: "replace" | "add" | "refine";
  constraints: { name: string; value: string }[];
  continuationAction?: "explain" | "refine" | null;
  kind: RequestKind;
  playerMemoryManagement?: PlayerMemoryManagementExtraction;
  players: {
    lookupName: string | null;
    mention: string;
    recommendationRole: "reference";
    referenceScope: "explicit";
    referenceTargetMention: null;
  }[];
  recommendationAction?: "replace" | "add" | "refine";
  recommendation?: { position: "stc"; resultLimit: number };
  teamSearchName?: string;
  teams: string[];
};

const fixturePlayer = (
  mention: string
): FixtureExtraction["players"][number] => ({
  lookupName: null,
  mention,
  recommendationRole: "reference",
  referenceScope: "explicit",
  referenceTargetMention: null,
});

const fixtureTeamRequest = (
  teamName: string,
  continuationAction: FixtureExtraction["continuationAction"] = null
): FixtureExtraction => ({
  constraints: [],
  continuationAction,
  kind: "team_recommendation",
  players: [],
  recommendation: { position: "stc", resultLimit: 2 },
  recommendationAction: "replace",
  teamSearchName: teamName,
  teams: [teamName],
});

const fixtureExtractions = new Map<string, FixtureExtraction>([
  [
    "Look up 凯恩",
    {
      constraints: [],
      kind: "player_lookup",
      players: [
        {
          ...fixturePlayer("凯恩"),
          lookupName: fixtureKaneName,
        },
      ],
      teams: [],
    },
  ],
  [
    "Look up Kane",
    {
      constraints: [],
      kind: "player_lookup",
      players: [
        {
          ...fixturePlayer("Kane"),
          lookupName: fixtureKaneName,
        },
      ],
      teams: [],
    },
  ],
  [
    `Look up ${fixtureKaneName}`,
    {
      constraints: [],
      kind: "player_lookup",
      players: [fixturePlayer(fixtureKaneName)],
      teams: [],
    },
  ],
  [
    `Compare ${fixtureKaneName} and ${fixtureHaalandName}`,
    {
      comparisonAction: "replace",
      constraints: [],
      kind: "player_comparison",
      players: [
        fixturePlayer(fixtureKaneName),
        fixturePlayer(fixtureHaalandName),
      ],
      teams: [],
    },
  ],
  [
    `Find alternatives to ${fixtureKaneName}`,
    {
      constraints: [],
      kind: "player_recommendation",
      players: [fixturePlayer(fixtureKaneName)],
      recommendation: { position: "stc", resultLimit: 2 },
      recommendationAction: "replace",
      teams: [],
    },
  ],
  [
    `Recommend a striker for ${fixtureTeamName}`,
    fixtureTeamRequest(fixtureTeamName),
  ],
  [
    `Recommend a striker for ${fixtureRosterMemoryTeamName}`,
    fixtureTeamRequest(fixtureRosterMemoryTeamName),
  ],
  [
    "Explain the saved team recommendation",
    fixtureTeamRequest(fixtureTeamName, "explain"),
  ],
  [
    "Explain the saved Roster Memory Club recommendation",
    fixtureTeamRequest(fixtureRosterMemoryTeamName, "explain"),
  ],
  [
    "Show remembered player aliases and mappings",
    {
      constraints: [],
      kind: "other",
      playerMemoryManagement: { action: "list" },
      players: [],
      teams: [],
    },
  ],
  [
    "Clear all player memories",
    {
      constraints: [],
      kind: "other",
      playerMemoryManagement: { action: "clear" },
      players: [],
      teams: [],
    },
  ],
  [
    "Forget Harry Kane",
    {
      constraints: [],
      kind: "other",
      playerMemoryManagement: {
        action: "forget",
        targetMention: fixtureKaneName,
      },
      players: [],
      teams: [],
    },
  ],
  [
    "Forget alias 凯恩",
    {
      constraints: [],
      kind: "other",
      playerMemoryManagement: {
        action: "forget",
        targetKind: "player_identity",
        targetMention: "凯恩",
      },
      players: [],
      teams: [],
    },
  ],
  [
    "Forget roster mapping Harry Kane",
    {
      constraints: [],
      kind: "other",
      playerMemoryManagement: {
        action: "forget",
        targetKind: "roster_identity",
        targetMention: fixtureKaneName,
      },
      players: [],
      teams: [],
    },
  ],
  [
    `Correct the remembered alias ${fixtureKaneName} to ${fixtureReplacementCandidateName}`,
    {
      constraints: [],
      kind: "other",
      playerMemoryManagement: {
        action: "correct",
        replacementMention: fixtureReplacementCandidateName,
        targetKind: "player_identity",
        targetMention: fixtureKaneName,
      },
      players: [],
      teams: [],
    },
  ],
  [
    `Recommend a striker for ${fixtureOutageTeamName}`,
    fixtureTeamRequest(fixtureOutageTeamName),
  ],
  [
    `Retry the ${fixtureOutageTeamName} striker search`,
    fixtureTeamRequest(fixtureOutageTeamName),
  ],
]);

const requestExtractionForFixtureText = (message: string) =>
  fixtureExtractions.get(message) ?? null;

type CompactionFixtureArguments = {
  ambiguities: string[];
  anchors: { kind: "participant"; text: string }[];
  instruction: string;
  references: {
    anchorIndex: number;
    end: number;
    start: number;
    text: string;
  }[];
};

type StructuredFixtureArguments =
  | Exclude<ReturnType<typeof requestExtractionForFixtureText>, null>
  | CompactionFixtureArguments;

const compactionArgumentsForFixtureText = (
  message: string
): CompactionFixtureArguments | null => {
  const participant = "Harry Kane";
  const start = message.indexOf(participant);

  if (start === -1) {
    return null;
  }

  return {
    ambiguities: [],
    anchors: [{ kind: "participant", text: participant }],
    instruction: `Look up ${participant}`,
    references: [
      {
        anchorIndex: 0,
        end: start + participant.length,
        start,
        text: participant,
      },
    ],
  };
};

const currentMessageSchema = z.object({ currentMessage: z.string() });
const auxiliaryMessageSchema = z.object({ message: z.string() });

const currentUserText = (messageText: string): string => {
  try {
    const prompt = currentMessageSchema.safeParse(JSON.parse(messageText));

    if (prompt.success) {
      return prompt.data.currentMessage;
    }

    const auxiliaryPrompt = auxiliaryMessageSchema.safeParse(
      JSON.parse(messageText)
    );

    return auxiliaryPrompt.success ? auxiliaryPrompt.data.message : messageText;
  } catch {
    return messageText;
  }
};

const structuredArgumentsForTool = (
  toolName: string | undefined,
  message: string
): StructuredFixtureArguments | null => {
  if (toolName === "compact_scouting_instruction") {
    return compactionArgumentsForFixtureText(message);
  }

  if (toolName === "extract") {
    return requestExtractionForFixtureText(message);
  }

  return null;
};

type FakeProviderResponse = {
  body: unknown;
  event: string;
  statusCode: number;
};

const fakeTeamSearchResponse = (requestUrl: URL): FakeProviderResponse => {
  const search = requestUrl.searchParams.get("search");
  const isOutage = search === fixtureOutageTeamName;
  const isRosterMemoryTeam = search === fixtureRosterMemoryTeamName;

  return {
    body: isOutage
      ? { errors: { message: "Temporary provider outage." }, response: [] }
      : {
          errors: [],
          response: [
            {
              team: {
                country: "England",
                id: isRosterMemoryTeam ? fixtureRosterMemoryTeamId : 541,
                name: isRosterMemoryTeam
                  ? fixtureRosterMemoryTeamName
                  : fixtureTeamName,
              },
            },
          ],
        },
    event: isOutage ? "team-search-failure" : "team-search",
    statusCode: isOutage ? 503 : 200,
  };
};

const fakeTeamRosterResponse = (
  requestUrl: URL,
  rosterMemoryFetchCount: number
): FakeProviderResponse => {
  const teamId = Number(requestUrl.searchParams.get("team"));
  const isRosterMemoryTeam = teamId === fixtureRosterMemoryTeamId;

  return {
    body: {
      errors: [],
      response: [
        {
          players:
            isRosterMemoryTeam && rosterMemoryFetchCount > 2
              ? []
              : [
                  {
                    id: isRosterMemoryTeam ? fixtureRosterMemoryPlayerId : 10,
                    name: fixtureKaneName,
                    position: "Attacker",
                  },
                ],
          team: {
            country: "England",
            id: teamId,
            name: isRosterMemoryTeam
              ? fixtureRosterMemoryTeamName
              : fixtureTeamName,
          },
        },
      ],
    },
    event: "team-roster",
    statusCode: 200,
  };
};

const fakeProviderResponse = (
  requestUrl: URL,
  rosterMemoryFetchCount: number
): FakeProviderResponse | null => {
  if (requestUrl.pathname === "/api-football/teams") {
    return fakeTeamSearchResponse(requestUrl);
  }

  if (requestUrl.pathname === "/api-football/players/squads") {
    return fakeTeamRosterResponse(requestUrl, rosterMemoryFetchCount);
  }

  return null;
};

const nextRosterMemoryFetchCount = (
  requestUrl: URL,
  currentCount: number
): number =>
  requestUrl.pathname === "/api-football/players/squads" &&
  Number(requestUrl.searchParams.get("team")) === fixtureRosterMemoryTeamId
    ? currentCount + 1
    : currentCount;

type StructuredFixtureResponse = {
  callId: string | null;
  extractionArguments: StructuredFixtureArguments | null;
  extractionTool: string | undefined;
  structured: boolean;
};

const sendNonStreamingCompletion = (
  response: ServerResponse,
  chatCompletionId: string,
  chatModelName: string,
  fixtureResponse: StructuredFixtureResponse
): void => {
  const message = fixtureResponse.structured
    ? {
        content: null,
        role: "assistant",
        tool_calls: [
          {
            function: {
              arguments: JSON.stringify(fixtureResponse.extractionArguments),
              name: fixtureResponse.extractionTool ?? "extract",
            },
            id: fixtureResponse.callId ?? "call-persistence-request",
            type: "function",
          },
        ],
      }
    : {
        content: savedScoutingContextAnswer,
        role: "assistant",
      };

  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      choices: [
        {
          finish_reason: fixtureResponse.structured ? "tool_calls" : "stop",
          index: 0,
          message,
        },
      ],
      created: 0,
      id: chatCompletionId,
      model: chatModelName,
      object: "chat.completion",
      usage: { completion_tokens: 8, prompt_tokens: 12, total_tokens: 20 },
    })
  );
};

const structuredResponseIsAvailable = (
  extractionArguments: StructuredFixtureArguments | null
): boolean => extractionArguments !== null;

const reservePort = async (): Promise<number> => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = tcpAddressSchema.safeParse(server.address());
  await server[Symbol.asyncDispose]();

  if (!address.success) {
    throw new Error("Expected an available TCP port.");
  }

  return address.data.port;
};

const startGateway = async (): Promise<LocalGateway> => {
  const receivedCalls: string[] = [];
  const receivedEvents: string[] = [];
  let extractionCallIndex = 0;
  let rosterMemoryFetchCount = 0;
  const eventSchema = z.object({ name: z.string() });

  const chatRequestSchema = z.looseObject({
    messages: z
      .array(
        z.looseObject({ content: z.unknown(), role: z.string().optional() })
      )
      .optional(),
    stream: z.boolean().optional(),
    tool_choice: z.unknown().optional(),
    tools: z
      .array(z.looseObject({ function: z.looseObject({ name: z.string() }) }))
      .optional(),
  });

  const chatCompletionId = "chatcmpl-persistence-test";
  const chatModelName = persistenceTestModelName;

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf-8");
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.url === "/events") {
        const event = eventSchema.safeParse(JSON.parse(body));

        if (!event.success) {
          response.writeHead(400).end();

          return;
        }

        receivedEvents.push(event.data.name);
        response.writeHead(204).end();

        return;
      }

      rosterMemoryFetchCount = nextRosterMemoryFetchCount(
        requestUrl,
        rosterMemoryFetchCount
      );

      const providerResponse = fakeProviderResponse(
        requestUrl,
        rosterMemoryFetchCount
      );

      if (providerResponse !== null) {
        receivedEvents.push(providerResponse.event);
        response.writeHead(providerResponse.statusCode, {
          "content-type": "application/json",
        });
        response.end(JSON.stringify(providerResponse.body));

        return;
      }

      receivedCalls.push(body);
      const chatRequest = chatRequestSchema.safeParse(JSON.parse(body));

      const lastUserMessage = chatRequest.success
        ? chatRequest.data.messages
            ?.toReversed()
            .find((message) => message.role === "user")
        : undefined;

      const userText = z.string().safeParse(lastUserMessage?.content);

      const extractionTool = chatRequest.success
        ? chatRequest.data.tools?.[0]?.function.name
        : undefined;

      let sourceText = "";

      if (userText.success) {
        sourceText = currentUserText(userText.data);
      }

      const extractionArguments = structuredArgumentsForTool(
        extractionTool,
        sourceText
      );

      const structuredResponse =
        structuredResponseIsAvailable(extractionArguments);

      const extractionCallId = structuredResponse
        ? `call-persistence-request-${extractionCallIndex}`
        : null;

      if (structuredResponse && extractionTool === "extract") {
        extractionCallIndex += 1;
      }

      if (chatRequest.success && chatRequest.data.stream === true) {
        const chunkMetadata = {
          created: 0,
          id: chatCompletionId,
          model: chatModelName,
          object: "chat.completion.chunk",
        };

        response.writeHead(200, {
          "cache-control": "no-cache",
          connection: "keep-alive",
          "content-type": "text/event-stream",
        });
        response.write(
          `data: ${JSON.stringify({
            ...chunkMetadata,
            choices: [
              {
                delta: structuredResponse
                  ? {
                      role: "assistant",
                      tool_calls: [
                        {
                          function: {
                            arguments: JSON.stringify(extractionArguments),
                            name: extractionTool,
                          },
                          id: extractionCallId,
                          index: 0,
                          type: "function",
                        },
                      ],
                    }
                  : {
                      content: savedScoutingContextAnswer,
                      role: "assistant",
                    },
                finish_reason: null,
                index: 0,
              },
            ],
          })}\n\n`
        );
        response.write(
          `data: ${JSON.stringify({
            ...chunkMetadata,
            choices: [
              {
                delta: {},
                finish_reason: structuredResponse ? "tool_calls" : "stop",
                index: 0,
              },
            ],
          })}\n\n`
        );
        response.write(
          `data: ${JSON.stringify({
            ...chunkMetadata,
            choices: [],
            usage: {
              completion_tokens: 8,
              prompt_tokens: 12,
              total_tokens: 20,
            },
          })}\n\n`
        );
        response.end("data: [DONE]\n\n");

        return;
      }

      sendNonStreamingCompletion(response, chatCompletionId, chatModelName, {
        callId: extractionCallId,
        extractionArguments,
        extractionTool,
        structured: structuredResponse,
      });
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = tcpAddressSchema.safeParse(server.address());

  if (!address.success) {
    await server[Symbol.asyncDispose]();
    throw new Error("Expected a local model gateway port.");
  }

  const baseUrl = `http://127.0.0.1:${address.data.port}`;

  return {
    calls: () => [...receivedCalls],
    close: async () => {
      server.closeAllConnections();
      await server[Symbol.asyncDispose]();
    },
    eventUrl: `${baseUrl}/events`,
    events: () => [...receivedEvents],
    providerUrl: baseUrl,
    url: `${baseUrl}/v1`,
  };
};

const createTemporaryProject = async (
  gatewayUrl: string,
  eventUrl: string,
  providerUrl: string,
  graphImport = "./src/agent.ts:agent"
) => {
  const projectPath = await mkdtemp(
    path.join(tmpdir(), "tactiscout-persistence-")
  );

  await Promise.all([
    symlink(
      path.join(repoRoot, "node_modules"),
      path.join(projectPath, "node_modules"),
      "dir"
    ),
    symlink(path.join(repoRoot, "src"), path.join(projectPath, "src"), "dir"),
    symlink(
      path.join(repoRoot, "tests"),
      path.join(projectPath, "tests"),
      "dir"
    ),
    symlink(
      path.join(repoRoot, "package.json"),
      path.join(projectPath, "package.json"),
      "file"
    ),
  ]);

  const sourceFixtures = await createSourceFixtures(projectPath);

  await writeFile(
    path.join(projectPath, "langgraph.json"),
    JSON.stringify({
      dependencies: ["."],
      env: ".env",
      graphs: { agent: graphImport },
      node_version: "22",
    })
  );
  await writeFile(
    path.join(projectPath, ".env"),
    [
      "OPENAI_API_KEY=persistence-test-key",
      "OPENAI_MODEL=persistence-test-model",
      `OPENAI_BASE_URL=${gatewayUrl}`,
      "LANGSMITH_TRACING=false",
      "LANGCHAIN_TRACING_V2=false",
      `PERSISTENCE_TEST_EVENTS_URL=${eventUrl}`,
      `PERSISTENCE_TEST_PROVIDER_URL=${providerUrl}`,
      "API_FOOTBALL_KEY=test",
      `TACTISCOUT_FM_PROFILES_PATH=${sourceFixtures.fmDatabasePath}`,
      `TACTISCOUT_UNDERSTAT_DB_PATH=${sourceFixtures.understatDatabasePath}`,
      `TACTISCOUT_REEP_IDENTITY_DB_PATH=${sourceFixtures.reepDatabasePath}`,
    ].join("\n")
  );

  return projectPath;
};

const startServer = async (
  projectPath: string,
  gatewayUrl: string,
  port: number
): Promise<RunningServer> => {
  let serverOutput = "";
  const readOutput = () => serverOutput;

  const child = spawn(
    process.execPath,
    [
      path.join(
        repoRoot,
        "node_modules",
        "@langchain",
        "langgraph-cli",
        "dist",
        "cli",
        "cli.mjs"
      ),
      "dev",
      "--no-browser",
      "--no-reload",
      "--n-jobs-per-worker",
      "1",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--config",
      path.join(projectPath, "langgraph.json"),
    ],
    {
      cwd: projectPath,
      env: {
        ...process.env,
        API_FOOTBALL_KEY: "test",
        LANGCHAIN_API_KEY: "",
        LANGCHAIN_TRACING_V2: "false",
        LANGSMITH_API_KEY: "",
        LANGSMITH_TRACING: "false",
        OPENAI_API_KEY: "persistence-test-key",
        OPENAI_BASE_URL: gatewayUrl,
        OPENAI_MODEL: persistenceTestModelName,
        TACTISCOUT_MODEL_CONTEXT_PROFILE: JSON.stringify({
          baseURL: gatewayUrl,
          contextWindowTokens: 100_000,
          countingMarginTokens: 64,
          maxInputTokens: 100_000,
          maxOutputTokens: 2048,
          model: persistenceTestModelName,
        }),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  const appendOutput = (chunk: Buffer) => {
    serverOutput = `${serverOutput}${chunk.toString("utf-8")}`.slice(-8000);
  };

  child.stdout?.on("data", appendOutput);
  child.stderr?.on("data", appendOutput);

  const pollUntilReady = async (attempt = 0): Promise<boolean> => {
    if (child.exitCode !== null) {
      throw new Error(`Development server exited early: ${readOutput()}`);
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/ok`, {
        signal: AbortSignal.timeout(500),
      });

      if (response.ok) {
        return true;
      }
    } catch {
      if (attempt >= 150) {
        throw new Error(
          `Development server did not become ready: ${readOutput()}`
        );
      }

      await delay(100);

      return await pollUntilReady(attempt + 1);
    }

    if (attempt >= 150) {
      throw new Error(
        `Development server did not become ready: ${readOutput()}`
      );
    }

    await delay(100);

    return await pollUntilReady(attempt + 1);
  };

  if (!(await pollUntilReady())) {
    throw new Error(`Development server did not become ready: ${readOutput()}`);
  }

  return { child, output: readOutput };
};

const stopServer = async (running: RunningServer) => {
  if (running.child.exitCode !== null) {
    return;
  }

  const exited = once(running.child, "exit", {
    signal: AbortSignal.timeout(10_000),
  });

  running.child.kill("SIGINT");
  await exited;
};

const waitForServerStop = async (port: number): Promise<void> => {
  const pollUntilStopped = async (attempt = 0): Promise<boolean> => {
    try {
      await fetch(`http://127.0.0.1:${port}/ok`, {
        signal: AbortSignal.timeout(300),
      });
    } catch {
      return true;
    }

    if (attempt >= 100) {
      throw new Error(
        "Development server is still listening after normal shutdown."
      );
    }

    await delay(100);

    return await pollUntilStopped(attempt + 1);
  };

  if (!(await pollUntilStopped())) {
    throw new Error(
      "Development server is still listening after normal shutdown."
    );
  }
};

const requestJson = async <Response>(
  baseUrl: string,
  pathname: string,
  schema: z.ZodType<Response>,
  init: RequestInit = {}
): Promise<Response> => {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}${pathname}`, { ...init, headers });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${pathname} returned ${response.status}: ${body}`
    );
  }

  const parsedBody = schema.safeParse(
    body.length > 0 ? JSON.parse(body) : null
  );

  if (!parsedBody.success) {
    throw new Error(
      `Response shape invalid for ${pathname}: ${parsedBody.error.message}`
    );
  }

  return parsedBody.data;
};

const postJson = async <Response>(
  baseUrl: string,
  pathname: string,
  schema: z.ZodType<Response>,
  body: string
) =>
  await requestJson(baseUrl, pathname, schema, {
    body,
    method: "POST",
  });

const putJson = async (baseUrl: string, pathname: string, body: string) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    body,
    headers: { "content-type": "application/json" },
    method: "PUT",
  });

  if (!response.ok) {
    throw new Error(
      `PUT ${pathname} returned ${response.status}: ${await response.text()}`
    );
  }
};

const startDevServerSession = async (
  graphImport?: string
): Promise<DevServerSession> => {
  const gateway = await startGateway();
  let cleanupPath: string | undefined;

  try {
    const projectPath = await createTemporaryProject(
      gateway.url,
      gateway.eventUrl,
      gateway.providerUrl,
      graphImport
    );

    const sourceFixturePaths = {
      fmDatabasePath: path.join(projectPath, "fixtures", "fm-profiles.sqlite"),
      reepDatabasePath: path.join(
        projectPath,
        "fixtures",
        "reep-identity.sqlite"
      ),
      understatDatabasePath: path.join(
        projectPath,
        "fixtures",
        "understat.sqlite"
      ),
    };

    cleanupPath = projectPath;
    const port = await reservePort();
    let runningServer = await startServer(projectPath, gateway.url, port);

    const close = async () => {
      await stopServer(runningServer);
      await waitForServerStop(port);
      await rm(projectPath, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 100,
      });
      await gateway.close();
    };

    const restart = async () => {
      await stopServer(runningServer);
      await waitForServerStop(port);
      runningServer = await startServer(projectPath, gateway.url, port);
    };

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      close,
      gateway,
      restart,
      sourceFixturePaths,
    };
  } catch (error) {
    if (cleanupPath !== undefined) {
      await rm(cleanupPath, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 100,
      });
    }

    await gateway.close();
    throw error;
  }
};

const waitResponseSchema = z.unknown();

export {
  apiThreadSchema,
  createTemporaryProject,
  postJson,
  putJson,
  requestJson,
  reservePort,
  startGateway,
  startServer,
  startDevServerSession,
  stopServer,
  storeItemSchema,
  threadStateSchema,
  waitForServerStop,
  waitResponseSchema,
};

export type { DevServerSession, LocalGateway, RunningServer };

export type { ThreadState };
