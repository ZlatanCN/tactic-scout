import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { z } from "zod/v4";

import type {
  ActiveComparison,
  AgentStateType,
  ConversationContext,
  ConversationPlayerReference,
  ReferenceCandidate,
  RequestConstraint,
  RequestPlayerState,
  RequestState,
} from "./state.js";
import { ActiveComparisonSchema } from "./state.js";

const seasonConstraintNamePattern = /season|赛季/iu;

const seasonValuePattern =
  /\b(?<year>20\d{2})\s*(?:\/|[-–—])\s*(?:\d{2}|20\d{2})\b/u;

const comparisonPlayerSchema = z.object({
  canonicalIdentityId: z.string().nullable(),
  identityBasis: z
    .enum([
      "reep_registry",
      "source_record",
      "source_selection",
      "thread_candidate",
      "thread_confirmed",
    ])
    .optional(),
  playerName: z.string(),
  sourceRecords: z.array(
    z.object({
      provider: z.enum(["understat", "fm"]),
      sourceId: z.string(),
    })
  ),
});

const comparisonToolCallSchema = z.object({
  players: z.array(comparisonPlayerSchema),
  seasonStartYear: z.number().int().min(2000).max(2100).optional(),
});

const comparisonToolResultSchema = z.object({
  status: z.enum(["ready", "no_comparable_data"]),
});

type ComparisonPlayer = z.infer<typeof comparisonPlayerSchema>;

type ComparisonToolCall = z.infer<typeof comparisonToolCallSchema>;

const comparisonConstraintKey = (name: string): string =>
  seasonConstraintNamePattern.test(name)
    ? "season"
    : name.normalize("NFKC").trim().toLocaleLowerCase();

const mergeComparisonConstraints = (
  previous: RequestConstraint[],
  current: RequestConstraint[]
): RequestConstraint[] => {
  const constraints = new Map<string, RequestConstraint>();

  for (const constraint of [...previous, ...current]) {
    const key = comparisonConstraintKey(constraint.name);

    constraints.set(key, {
      name: key === "season" ? "season" : constraint.name,
      value: constraint.value,
    });
  }

  return [...constraints.values()];
};

const comparisonSeasonStartYear = (
  constraints: RequestConstraint[]
): number | undefined => {
  const season = constraints.find(
    ({ name }) => comparisonConstraintKey(name) === "season"
  );

  const year = seasonValuePattern.exec(season?.value ?? "")?.groups?.year;

  return year === undefined ? undefined : Number(year);
};

const uniqueReferences = (
  references: ConversationPlayerReference[]
): ConversationPlayerReference[] => {
  const seen = new Set<string>();

  return references.filter((reference) => {
    if (seen.has(reference.referenceId)) {
      return false;
    }

    seen.add(reference.referenceId);

    return true;
  });
};

const referenceFromComparisonPlayer = (
  player: ComparisonPlayer
): ConversationPlayerReference | null => {
  const sourceRecords = player.sourceRecords.map((record) => ({
    canonicalIdentityId: player.canonicalIdentityId,
    competition: null,
    identityVerified: player.canonicalIdentityId !== null,
    name: player.playerName,
    provider: record.provider,
    season: null,
    sourceId: record.sourceId,
    team: null,
  }));

  if (player.canonicalIdentityId === null && sourceRecords.length === 0) {
    return null;
  }

  const candidateId =
    player.canonicalIdentityId ??
    `comparison:${sourceRecords
      .map((record) => `${record.provider}:${record.sourceId}`)
      .toSorted()
      .join("|")}`;

  const candidate: ReferenceCandidate = {
    candidateId,
    canonicalIdentityId: player.canonicalIdentityId,
    exactNameMatch: true,
    identityVerified: player.canonicalIdentityId !== null,
    name: player.playerName,
    records: sourceRecords,
  };

  if (player.identityBasis !== undefined) {
    candidate.identityBasis = player.identityBasis;
  }

  return {
    candidate,
    referenceId: player.canonicalIdentityId ?? candidateId,
  };
};

const comparisonFromToolResult = (
  resultMessage: ToolMessage,
  precedingMessages: AgentStateType["messages"]
): ComparisonToolCall | null => {
  const content = z.string().safeParse(resultMessage.content);

  if (!content.success) {
    return null;
  }

  let resultContent: unknown;

  try {
    resultContent = JSON.parse(content.data);
  } catch {
    return null;
  }

  if (!comparisonToolResultSchema.safeParse(resultContent).success) {
    return null;
  }

  const toolCallMessage = precedingMessages
    .toReversed()
    .find(
      (message) =>
        message instanceof AIMessage &&
        message.tool_calls?.some(
          (call) =>
            call.name === "compare_player_records" &&
            call.id === resultMessage.tool_call_id
        ) === true
    );

  const toolCall =
    toolCallMessage instanceof AIMessage
      ? toolCallMessage.tool_calls?.find(
          (call) =>
            call.name === "compare_player_records" &&
            call.id === resultMessage.tool_call_id
        )
      : undefined;

  const parsedCall = comparisonToolCallSchema.safeParse(toolCall?.args);

  return parsedCall.success ? parsedCall.data : null;
};

const successfulComparisonFromMessages = (
  messages: AgentStateType["messages"]
): ComparisonToolCall | null => {
  for (
    let resultIndex = messages.length - 1;
    resultIndex >= 0;
    resultIndex -= 1
  ) {
    const resultMessage = messages[resultIndex];

    if (
      resultMessage instanceof ToolMessage &&
      resultMessage.name === "compare_player_records"
    ) {
      const comparison = comparisonFromToolResult(
        resultMessage,
        messages.slice(0, resultIndex)
      );

      if (comparison !== null) {
        return comparison;
      }
    }
  }

  return null;
};

const comparisonContextFromMessages = (
  messages: AgentStateType["messages"]
): ActiveComparison => {
  const comparison = successfulComparisonFromMessages(messages);
  const year = comparison?.seasonStartYear;

  return {
    constraints:
      year === undefined
        ? []
        : [{ name: "season", value: `${year}/${String(year + 1).slice(-2)}` }],
    players: uniqueReferences(
      (comparison?.players ?? []).flatMap((player) => {
        const reference = referenceFromComparisonPlayer(player);

        return reference === null ? [] : [reference];
      })
    ),
  };
};

const activeComparisonContext = (
  messages: AgentStateType["messages"],
  context: ConversationContext
): ActiveComparison => {
  const stored = ActiveComparisonSchema.safeParse(context.activeComparison);

  if (stored.success && stored.data.players.length > 0) {
    return {
      constraints: mergeComparisonConstraints([], stored.data.constraints),
      players: uniqueReferences(stored.data.players),
    };
  }

  return comparisonContextFromMessages(messages);
};

const requestPlayerFromReference = (
  reference: ConversationPlayerReference
): RequestPlayerState => {
  const { candidate } = reference;

  return {
    attempts: 0,
    lookupName: null,
    mention: candidate.name,
    referenceScope: "explicit",
    referenceTargetMention: null,
    resolution: {
      candidateCount: 1,
      candidates: [candidate],
      candidatesTruncated: false,
      canonicalIdentityId: candidate.canonicalIdentityId,
      clarificationMessage: null,
      mention: candidate.name,
      selectedCandidateId: candidate.candidateId,
      selectedName: candidate.name,
      status: "resolved",
    },
  };
};

const comparisonContextFromRequest = (
  request: RequestState
): ActiveComparison => ({
  constraints: mergeComparisonConstraints([], request.constraints),
  players: uniqueReferences(
    request.players.flatMap((player) => {
      const { resolution } = player;

      if (resolution?.status !== "resolved") {
        return [];
      }

      const candidate = resolution.candidates.find(
        (item) => item.candidateId === resolution.selectedCandidateId
      );

      if (candidate === undefined) {
        return [];
      }

      return [
        {
          candidate,
          referenceId: candidate.canonicalIdentityId ?? candidate.candidateId,
        },
      ];
    })
  ),
});

const hasSuccessfulComparisonInCurrentTurn = (
  messages: AgentStateType["messages"]
): boolean => {
  const latestHumanMessageIndex = messages.findLastIndex(
    (message) => message instanceof HumanMessage
  );

  const currentTurnMessages =
    latestHumanMessageIndex === -1
      ? messages
      : messages.slice(latestHumanMessageIndex);

  return successfulComparisonFromMessages(currentTurnMessages) !== null;
};

export {
  activeComparisonContext,
  comparisonContextFromRequest,
  comparisonSeasonStartYear,
  hasSuccessfulComparisonInCurrentTurn,
  mergeComparisonConstraints,
  requestPlayerFromReference,
};
