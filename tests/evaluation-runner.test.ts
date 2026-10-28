import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { loadEvaluationCases, previewEvaluation } from "../evals/benchmark.js";
import {
  evaluationCaseSchema,
  evaluationReportSchema,
} from "../evals/contracts.js";
import type { EvaluationCase } from "../evals/contracts.js";
import { compareEvaluationReportFiles } from "../evals/report.js";
import { runEvaluation } from "../evals/runner.js";

const openAiRequestSchema = z.object({
  messages: z
    .array(z.object({ content: z.json().optional(), role: z.string() }))
    .optional(),
  response_format: z.json().optional(),
  tools: z
    .array(
      z.object({
        function: z.object({ name: z.string().optional() }).optional(),
      })
    )
    .optional(),
});

const completionMessageSchema = z.object({
  content: z.string().nullable().optional(),
  tool_calls: z
    .array(
      z.object({
        function: z.object({
          arguments: z.string(),
          name: z.string(),
        }),
        id: z.string(),
        type: z.literal("function"),
      })
    )
    .optional(),
});

type CompletionMessage = z.input<typeof completionMessageSchema>;

type FakeGatewayMode =
  | "comparison_resume"
  | "judge_action_id_in_evidence"
  | "judge_invalid_quote"
  | "judge_missing_contradiction_evidence"
  | "judge_unsupported_finding"
  | "judge_wrong_anchor"
  | "malformed_search"
  | "normal"
  | "season_team_abstention"
  | "loop_search";

const requestContextSchema = z.looseObject({ currentMessage: z.string() });

const judgeRequestSchema = z.object({
  actions: z.array(
    z.looseObject({ actionId: z.string(), eventId: z.string() })
  ),
  caseId: z.string(),
  contract: z.looseObject({
    requiredFacts: z.array(z.object({ factId: z.string() })),
  }),
  evidence: z.array(z.looseObject({ evidenceId: z.string() })),
  turns: z.array(
    z.looseObject({
      assistantMessages: z.array(z.string()),
      turnId: z.string(),
    })
  ),
});

const judgeInputFromRequestBody = (requestBody: string) => {
  const body = openAiRequestSchema.parse(JSON.parse(requestBody));

  const userMessage = body.messages
    ?.toReversed()
    .find(({ role }) => role === "user");

  const content = z.string().parse(userMessage?.content);

  return judgeRequestSchema.parse(JSON.parse(content));
};

const judgeAnchorPackSchema = z.object({
  anchors: z.array(
    z.object({
      anchorId: z.string(),
      answer: z.string(),
      category: z.string(),
      expectedCategories: z.array(z.string()),
      scenarioFamily: z.string(),
      split: z.enum(["development", "validation"]),
    })
  ),
});

const judgeAnchors = judgeAnchorPackSchema.parse(
  JSON.parse(
    readFileSync(path.join(process.cwd(), "evals/anchors/v3.json"), "utf-8")
  )
).anchors;

const judgeOverrideForRequest = (
  input: z.output<typeof judgeRequestSchema>,
  mode: FakeGatewayMode,
  firstTurn: z.output<typeof judgeRequestSchema>["turns"][number] | undefined,
  firstAction:
    | z.output<typeof judgeRequestSchema>["actions"][number]
    | undefined
) => {
  if (input.caseId !== "lookup-smoke-v1" || firstTurn === undefined) {
    return null;
  }

  const requiredFactCoverage = input.contract.requiredFacts.map(
    ({ factId }) => ({
      factId,
      status: "covered" as const,
    })
  );

  let finding = null;

  if (mode === "judge_invalid_quote" || mode === "judge_unsupported_finding") {
    finding = {
      actionIds: [],
      category: "unsupported_fact" as const,
      evidenceIds: [],
      explanation: "The controlled judge provides a test finding.",
      quote:
        mode === "judge_invalid_quote"
          ? "This quotation is absent from the answer."
          : (firstTurn.assistantMessages[0] ?? ""),
      turnId: firstTurn.turnId,
    };
  } else if (
    mode === "judge_action_id_in_evidence" ||
    mode === "judge_missing_contradiction_evidence"
  ) {
    finding = {
      actionIds: [],
      category: "factual_contradiction" as const,
      evidenceIds:
        mode === "judge_action_id_in_evidence" && firstAction !== undefined
          ? [firstAction.actionId]
          : [],
      explanation: "The controlled judge provides a test finding.",
      quote: firstTurn.assistantMessages[0] ?? "",
      turnId: firstTurn.turnId,
    };
  }

  return finding === null
    ? null
    : { findings: [finding], requiredFactCoverage };
};

const parseRequest = async (request: IncomingMessage) => {
  request.setEncoding("utf-8");
  const chunks: string[] = [];

  for await (const chunk of request) {
    chunks.push(z.string().parse(chunk));
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(chunks.join(""));
  } catch {
    throw new Error("The fake gateway received invalid JSON.");
  }

  return openAiRequestSchema.parse(parsedJson);
};

const currentMessageFromRequest = (
  body: z.output<typeof openAiRequestSchema>
): string | null => {
  for (const message of body.messages?.toReversed() ?? []) {
    const content = z.string().safeParse(message.content);

    if (!content.success) {
      continue;
    }

    try {
      const context = requestContextSchema.safeParse(JSON.parse(content.data));

      if (context.success) {
        return context.data.currentMessage;
      }
    } catch {
      // Non-JSON prompts are expected for model turns other than request parsing.
    }
  }

  return null;
};

const seasonFromRequest = (
  body: z.output<typeof openAiRequestSchema>
): string | null => {
  const latestUserMessage = body.messages
    ?.toReversed()
    .find(({ role }) => role === "user");

  const content = z.string().safeParse(latestUserMessage?.content);

  if (!content.success) {
    return null;
  }

  return /\b20\d{2}\/\d{2}\b/u.exec(content.data)?.[0] ?? null;
};

const seasonStartYearFromRequest = (
  body: z.output<typeof openAiRequestSchema>
): number | null => {
  const startYear = z
    .string()
    .regex(/^20\d{2}$/u)
    .safeParse(seasonFromRequest(body)?.slice(0, 4));

  return startYear.success ? Number(startYear.data) : null;
};

const fixturePlayerMentions = [
  { lookupName: "Erling Haaland", mention: "哈兰德", text: "哈兰德" },
  {
    lookupName: "Kylian Mbappe",
    mention: "Kylian Mbappé",
    text: "Kylian Mbappé",
  },
  { lookupName: null, mention: "Bukayo Saka", text: "Bukayo Saka" },
  {
    lookupName: null,
    mention: "Erling Haaland",
    text: "Erling Haaland",
  },
  {
    lookupName: null,
    mention: "Jude Bellingham",
    text: "Jude Bellingham",
  },
  { lookupName: null, mention: "Harry Kane", text: "Harry Kane" },
  { lookupName: null, mention: "Alexander Isak", text: "Alexander Isak" },
  { lookupName: null, mention: "Ollie Watkins", text: "Ollie Watkins" },
  { lookupName: null, mention: "Jonathan David", text: "Jonathan David" },
  { lookupName: null, mention: "Patrik Schick", text: "Patrik Schick" },
  { lookupName: null, mention: "Serhou Guirassy", text: "Serhou Guirassy" },
  { lookupName: null, mention: "Dušan Vlahović", text: "Dušan Vlahović" },
  { lookupName: null, mention: "Raphinha", text: "Raphinha" },
  {
    lookupName: null,
    mention: "Synthetic Failure Demo",
    text: "Synthetic Failure Demo",
  },
  {
    lookupName: null,
    mention: "Synthetic Failure Reference",
    text: "Synthetic Failure Reference",
  },
  { lookupName: null, mention: "Zed Missing", text: "Zed Missing" },
  { lookupName: null, mention: "Virgil van Dijk", text: "Virgil van Dijk" },
  { lookupName: null, mention: "Jamal Musiala", text: "Jamal Musiala" },
  { lookupName: null, mention: "Michael Olise", text: "Michael Olise" },
  { lookupName: null, mention: "Phil Foden", text: "Phil Foden" },
  {
    lookupName: null,
    mention: "Synthetic Midfielder",
    text: "Synthetic Midfielder",
  },
  {
    lookupName: null,
    mention: "Synthetic Winger",
    text: "Synthetic Winger",
  },
  {
    lookupName: null,
    mention: "Synthetic Reference",
    text: "Synthetic Reference",
  },
  {
    lookupName: null,
    mention: "Synthetic Close Candidate",
    text: "Synthetic Close Candidate",
  },
  {
    lookupName: null,
    mention: "Synthetic Far Candidate",
    text: "Synthetic Far Candidate",
  },
  {
    lookupName: null,
    mention: "Synthetic Ambiguous",
    text: "Synthetic Ambiguous",
  },
  { lookupName: null, mention: "Demo", text: "alias Demo" },
  { lookupName: null, mention: "Elias Demo", text: "Elias Demo" },
];

const fixtureTeamNames = [
  "Synthetic Town FC",
  "Synthetic Town",
  "Unknown City FC",
  "Real Madrid",
  "Bayer Leverkusen",
];

const recommendationIntentFromText = (text: string): boolean =>
  /推荐|推荐参考|作为参考|recommend|寻找|找.{0,12}球员|年龄上限|高潜/iu.test(
    text
  );

const fixtureRecommendationRole = (
  text: string,
  mention: string
): "ambiguous" | "exclude" | "reference" => {
  const mentionIndex = text.indexOf(mention);

  if (mentionIndex === -1) {
    return "ambiguous";
  }

  const before = text.slice(Math.max(0, mentionIndex - 20), mentionIndex);

  const after = text.slice(
    mentionIndex + mention.length,
    mentionIndex + mention.length + 24
  );

  if (
    /(?:不要|排除|不考虑)\s*$/iu.test(before) ||
    /^\s*(?:不要|排除|不考虑)/iu.test(after)
  ) {
    return "exclude";
  }

  if (
    /(?:给|为|按|根据|参考|替代)\s*$/iu.test(before) ||
    /(?:作为参考|参考|替代)/iu.test(after)
  ) {
    return "reference";
  }

  return "ambiguous";
};

const fixturePlayersFromText = (text: string, isRecommendation: boolean) =>
  fixturePlayerMentions.flatMap(({ lookupName, mention, text: matchText }) =>
    text.includes(matchText)
      ? [
          {
            lookupName,
            mention,
            recommendationRole: isRecommendation
              ? fixtureRecommendationRole(text, mention)
              : ("reference" as const),
            referenceScope: "explicit" as const,
            referenceTargetMention: null,
          },
        ]
      : []
  );

type FixtureRecommendationPatch = {
  includePotential?: boolean;
  maxAge?: number | null;
  minimumCurrentAbility?: number;
  minimumPotentialAbility?: number;
  position?: "stc";
  resultLimit?: number;
};

const numberAfter = (pattern: RegExp, text: string): number | null => {
  const match = pattern.exec(text);
  const value = match?.groups?.value;

  return value === undefined ? null : Number(value);
};

const recommendationPatchFromText = (
  text: string
): FixtureRecommendationPatch => {
  const patch: FixtureRecommendationPatch = {};
  const position = /\bstc\b|中锋/iu.test(text) ? "stc" : null;

  const maxAge = numberAfter(
    /(?:年龄上限|年龄|under|below)\D{0,8}(?<value>\d{1,2})/iu,
    text
  );

  const minimumCurrentAbility = numberAfter(
    /(?:\bCA\b|当前能力)\D{0,8}(?<value>\d{1,3})/iu,
    text
  );

  const minimumPotentialAbility = numberAfter(
    /(?:\bPA\b|潜力下限|最低潜力)\D{0,8}(?<value>\d{1,3})/iu,
    text
  );

  const resultLimit = numberAfter(
    /(?:前|最多|top)\s*(?<value>\d{1,2})\s*[名人]?/iu,
    text
  );

  if (position !== null) {
    patch.position = position;
  }

  if (/年轻|青年|小将|高潜|\byoung\b|\byouth\b/iu.test(text)) {
    patch.includePotential = true;
  }

  if (maxAge !== null) {
    patch.maxAge = maxAge;
  }

  if (/移除.{0,8}年龄上限|取消.{0,8}年龄上限|不设年龄上限/iu.test(text)) {
    patch.maxAge = null;
  }

  if (minimumCurrentAbility !== null) {
    patch.minimumCurrentAbility = minimumCurrentAbility;
  }

  if (minimumPotentialAbility !== null) {
    patch.minimumPotentialAbility = minimumPotentialAbility;
    patch.includePotential = true;
  }

  if (resultLimit !== null) {
    patch.resultLimit = resultLimit;
  }

  return patch;
};

const recommendationConstraintsFromPatch = (
  patch: FixtureRecommendationPatch
): { name: string; value: string }[] => {
  const constraints: { name: string; value: string }[] = [];

  if (patch.maxAge !== undefined && patch.maxAge !== null) {
    constraints.push({ name: "age", value: String(patch.maxAge) });
  }

  if (patch.minimumCurrentAbility !== undefined) {
    constraints.push({
      name: "CA",
      value: String(patch.minimumCurrentAbility),
    });
  }

  if (patch.minimumPotentialAbility !== undefined) {
    constraints.push({
      name: "PA",
      value: String(patch.minimumPotentialAbility),
    });
  }

  if (patch.resultLimit !== undefined) {
    constraints.push({
      name: "result_limit",
      value: String(patch.resultLimit),
    });
  }

  return constraints;
};

type FixtureRequestKind =
  | "other"
  | "player_comparison"
  | "player_lookup"
  | "player_recommendation"
  | "team_recommendation";

const fixtureRequestKind = (
  text: string,
  teamName: string | null
): FixtureRequestKind => {
  if (/刚才查到的是什么赛季|刚才查到的是哪个联赛/iu.test(text)) {
    return "other";
  }

  if (
    (teamName !== null || /球队推荐|team recommendation/iu.test(text)) &&
    /推荐|recommend/iu.test(text)
  ) {
    return "team_recommendation";
  }

  if (recommendationIntentFromText(text)) {
    return "player_recommendation";
  }

  if (/\bcompare\b|\bcomparison\b|\badd\b|比较|对比|再加上/iu.test(text)) {
    return "player_comparison";
  }

  return "player_lookup";
};

const fixturePlayersForRequest = (text: string, kind: FixtureRequestKind) => {
  if (kind === "other" || kind === "team_recommendation") {
    return [];
  }

  const players = fixturePlayersFromText(
    text,
    kind === "player_recommendation"
  );

  if (kind !== "player_lookup" || players.length > 0) {
    return players;
  }

  return [
    {
      lookupName: null,
      mention: "Elias Demo",
      recommendationRole: "reference" as const,
      referenceScope: "explicit" as const,
      referenceTargetMention: null,
    },
  ];
};

const fixtureRecommendationAction = (
  text: string,
  playerCount: number
): "add" | "refine" | "replace" => {
  if (/再加上|加入.{0,12}参考|\badd\b.{0,80}\breference\b/iu.test(text)) {
    return "add";
  }

  return playerCount === 0 ? "refine" : "replace";
};

const fixtureConstraints = (
  body: z.output<typeof openAiRequestSchema>,
  text: string,
  recommendation: FixtureRecommendationPatch,
  kind: FixtureRequestKind
) => {
  const constraints = recommendationConstraintsFromPatch(recommendation);

  const season =
    seasonFromRequest(body) ??
    (/\blast season\b|上赛季/iu.test(text) ? "last season" : null);

  if (season !== null) {
    constraints.unshift({ name: "season", value: season });
  }

  let competition: string | null = null;

  if (kind === "player_comparison" && /\bEPL\b/iu.test(text)) {
    competition = "EPL";
  } else if (kind === "player_comparison" && /\bLa\s+Liga\b/iu.test(text)) {
    competition = "La Liga";
  }

  if (competition !== null) {
    constraints.push({ name: "competition", value: competition });
  }

  return constraints;
};

const extractionArgumentsFromRequest = (
  body: z.output<typeof openAiRequestSchema>,
  mode: FakeGatewayMode = "normal"
) => {
  const text = currentMessageFromRequest(body) ?? "";
  const teamName = fixtureTeamNames.find((name) => text.includes(name)) ?? null;
  const kind = fixtureRequestKind(text, teamName);
  const extractedPlayers = fixturePlayersForRequest(text, kind);

  const players =
    mode === "comparison_resume"
      ? extractedPlayers.toSorted(
          (left, right) =>
            text.indexOf(left.mention) - text.indexOf(right.mention)
        )
      : extractedPlayers;

  const recommendation = recommendationPatchFromText(text);

  const common = {
    comparisonAction: /\badd\b|再加上/iu.test(text) ? "add" : "replace",
    constraints: fixtureConstraints(body, text, recommendation, kind),
    kind,
    players,
    teams: teamName === null ? [] : [teamName],
  };

  if (kind === "team_recommendation") {
    if (teamName !== null) {
      return { ...common, recommendation, teamSearchName: teamName };
    }

    return { ...common, recommendation };
  }

  if (kind === "player_recommendation") {
    return {
      ...common,
      recommendation,
      recommendationAction: fixtureRecommendationAction(text, players.length),
    };
  }

  return common;
};

const sendCompletion = (
  response: ServerResponse,
  callNumber: number,
  message: CompletionMessage,
  finishReason: "stop" | "tool_calls"
): void => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      choices: [
        {
          finish_reason: finishReason,
          index: 0,
          message: { role: "assistant", ...message },
        },
      ],
      created: 1_750_000_000,
      id: `chatcmpl-eval-${callNumber}`,
      model: "eval-fixture-model",
      object: "chat.completion",
      usage: { completion_tokens: 12, prompt_tokens: 24, total_tokens: 36 },
    })
  );
};

const sendSeasonTeamAnswer = (
  response: ServerResponse,
  callNumber: number,
  body: z.output<typeof openAiRequestSchema>
): void => {
  const seasonTeamPolicyPresent =
    body.messages?.some(({ content, role }) => {
      const text = z.string().safeParse(content);

      return (
        role === "system" &&
        text.success &&
        text.data.includes("team 字段只表示对应赛事和赛季表现记录中的球队")
      );
    }) ?? false;

  sendCompletion(
    response,
    callNumber,
    {
      content: seasonTeamPolicyPresent
        ? "Understat 的 2026/27 EPL 赛季表现记录列出的球队是 Arsenal。FM 和 Understat 都没有提供当前注册球队，因此无法从这些资料确定 Elias Demo 目前效力的俱乐部。"
        : "Elias Demo 目前效力于 Arsenal。",
    },
    "stop"
  );
};

const sendSearchToolCall = (
  response: ServerResponse,
  callNumber: number,
  seasonStartYear: number | null,
  malformedArguments = false
): void => {
  const searchArguments =
    seasonStartYear === null
      ? { sourceRecords: [] }
      : { seasonStartYear, sourceRecords: [] };

  const argumentsText = malformedArguments
    ? "{"
    : JSON.stringify(searchArguments);

  sendCompletion(
    response,
    callNumber,
    {
      content: null,
      tool_calls: [
        {
          function: {
            arguments: argumentsText,
            name: "search_player_records",
          },
          id: `call-search-demo-${callNumber}`,
          type: "function",
        },
      ],
    },
    "tool_calls"
  );
};

const judgeArgumentsFromRequest = (
  body: z.output<typeof openAiRequestSchema>,
  mode: FakeGatewayMode
) => {
  const latestUserMessage = body.messages
    ?.toReversed()
    .find(({ role }) => role === "user");

  const rawContent = z.string().safeParse(latestUserMessage?.content);

  if (!rawContent.success) {
    throw new Error("The fake judge received a non-text request.");
  }

  const input = judgeRequestSchema.parse(JSON.parse(rawContent.data));
  const anchor = judgeAnchors.find(({ anchorId }) => anchorId === input.caseId);

  const expectedCategories =
    mode === "judge_wrong_anchor" &&
    anchor?.anchorId === "factual-contradiction-05-v1"
      ? []
      : (anchor?.expectedCategories ?? []);

  const [firstTurn] = input.turns;
  const [firstEvidence] = input.evidence;
  const [firstAction] = input.actions;

  const overridden = judgeOverrideForRequest(
    input,
    mode,
    firstTurn,
    firstAction
  );

  if (overridden !== null) {
    return overridden;
  }

  return {
    findings: expectedCategories.flatMap((category) =>
      firstTurn === undefined || anchor === undefined
        ? []
        : [
            {
              actionIds:
                category === "false_execution_claim" &&
                firstAction !== undefined
                  ? [firstAction.actionId]
                  : [],
              category,
              evidenceIds:
                category === "factual_contradiction" &&
                firstEvidence !== undefined
                  ? [firstEvidence.evidenceId]
                  : [],
              explanation:
                "The test judge uses the anchor's frozen expected label.",
              quote: anchor.answer,
              turnId: firstTurn.turnId,
            },
          ]
    ),
    requiredFactCoverage: input.contract.requiredFacts.map(({ factId }) => ({
      factId,
      status: "covered",
    })),
  };
};

const sendJudgeToolCall = (
  response: ServerResponse,
  callNumber: number,
  args: ReturnType<typeof judgeArgumentsFromRequest>
): void => {
  sendCompletion(
    response,
    callNumber,
    {
      content: null,
      tool_calls: [
        {
          function: {
            arguments: JSON.stringify(args),
            name: "evaluate_scouting_answer",
          },
          id: `call-judge-${callNumber}`,
          type: "function",
        },
      ],
    },
    "tool_calls"
  );
};

const sendJudgeResponse = (
  response: ServerResponse,
  callNumber: number,
  body: z.output<typeof openAiRequestSchema>,
  args: ReturnType<typeof judgeArgumentsFromRequest>
): void => {
  if (body.response_format !== undefined) {
    sendCompletion(
      response,
      callNumber,
      { content: JSON.stringify(args) },
      "stop"
    );

    return;
  }

  sendJudgeToolCall(response, callNumber, args);
};

const handleGatewayRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  callNumber: number,
  mode: FakeGatewayMode = "normal"
): Promise<void> => {
  try {
    const body = await parseRequest(request);

    const toolNames =
      body.tools?.flatMap(({ function: callable }) =>
        callable?.name === undefined ? [] : [callable.name]
      ) ?? [];

    const seasonStartYear = seasonStartYearFromRequest(body);

    const toolMessages =
      body.messages?.filter(({ role }) => role === "tool") ?? [];

    const isJudgePrompt =
      body.messages?.some(({ content }) => {
        const text = z.string().safeParse(content);

        return (
          text.success &&
          text.data.includes(
            "automated reviewer for a football scouting assistant"
          )
        );
      }) ?? false;

    if (isJudgePrompt || toolNames.includes("evaluate_scouting_answer")) {
      sendJudgeResponse(
        response,
        callNumber,
        body,
        judgeArgumentsFromRequest(body, mode)
      );

      return;
    }

    if (toolMessages.length > 0) {
      if (mode === "season_team_abstention") {
        sendSeasonTeamAnswer(response, callNumber, body);

        return;
      }

      if (mode === "loop_search" && toolMessages.length < 4) {
        sendSearchToolCall(response, callNumber, seasonStartYear);

        return;
      }

      sendCompletion(
        response,
        callNumber,
        {
          content:
            "FM 记录显示 CA 132、PA 184；Understat 的 EPL 2024/25 xG 为 5.2。",
        },
        "stop"
      );

      return;
    }

    if (toolNames.includes("search_player_records")) {
      sendSearchToolCall(
        response,
        callNumber,
        seasonStartYear,
        mode === "malformed_search"
      );

      return;
    }

    const [requestedName] = toolNames;

    if (requestedName !== undefined) {
      sendCompletion(
        response,
        callNumber,
        {
          content: null,
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify(
                  extractionArgumentsFromRequest(body, mode)
                ),
                name: requestedName,
              },
              id: `call-extract-demo-${callNumber}`,
              type: "function",
            },
          ],
        },
        "tool_calls"
      );

      return;
    }

    sendCompletion(
      response,
      callNumber,
      {
        content:
          "FM 记录显示 CA 132、PA 184；Understat 的 EPL 2024/25 xG 为 5.2。",
      },
      "stop"
    );
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : "fixture error",
      })
    );
  }
};

const categoryCounts = (cases: ReturnType<typeof loadEvaluationCases>) => ({
  boundary: cases.filter(
    ({ caseDefinition }) => caseDefinition.category === "boundary"
  ).length,
  multi_turn: cases.filter(
    ({ caseDefinition }) => caseDefinition.category === "multi_turn"
  ).length,
  ordinary: cases.filter(
    ({ caseDefinition }) => caseDefinition.category === "ordinary"
  ).length,
});

const originCounts = (cases: ReturnType<typeof loadEvaluationCases>) => ({
  real: cases.filter(({ caseDefinition }) => caseDefinition.origin === "real")
    .length,
  synthetic: cases.filter(
    ({ caseDefinition }) => caseDefinition.origin === "synthetic"
  ).length,
});

const explicitCompetitionComparisonCase = (
  baseCase: EvaluationCase
): EvaluationCase => {
  const caseId = "compare-explicit-competition-regression-v1";
  const turnId = `${caseId}-turn-1`;

  const selectedMentions = new Set([
    "Synthetic Midfielder",
    "Synthetic Winger",
  ]);

  const selectedPlayers = baseCase.contract.resolvedPlayers.filter(
    ({ mention }) => selectedMentions.has(mention)
  );

  const selectedSourceRecords = selectedPlayers.flatMap(
    ({ sourceRecords }) => sourceRecords
  );

  const selectedFmIds = new Set(
    selectedSourceRecords.flatMap(({ provider, sourceId }) =>
      provider === "fm" ? [sourceId] : []
    )
  );

  const returnedSourceRecords = selectedSourceRecords.filter(
    ({ provider, sourceId }) =>
      provider === "fm" ||
      (provider === "understat" && sourceId === "us-wing-01")
  );

  const [baseTurn] = baseCase.turns;

  if (baseTurn === undefined) {
    throw new Error("The synthetic comparison fixture has no user turn.");
  }

  const expectedToolAction = {
    businessOutcome: "ready",
    name: "compare_player_records",
    sourceRecords: returnedSourceRecords,
    turnId,
  };

  return evaluationCaseSchema.parse({
    ...baseCase,
    caseId,
    contract: {
      ...baseCase.contract,
      expectedIdentityLookups: [],
      expectedIdentityStatuses: selectedPlayers.map(({ mention }) => ({
        mention,
        status: "resolved",
      })),
      expectedTurnConstraints: [
        {
          constraints: [
            { name: "season", value: "2024/25" },
            { name: "competition", value: "La Liga" },
          ],
          turnId,
        },
      ],
      expectedTurnIdentityStatuses: [],
      expectedTurnToolActions: [expectedToolAction],
      outcomeStatus: "ready",
      requiredEvidence: baseCase.contract.requiredEvidence.filter(
        ({ provider, sourceId }) =>
          provider === "fm" && selectedFmIds.has(sourceId)
      ),
      resolvedPlayers: selectedPlayers,
      sourceScope: selectedSourceRecords,
      toolActions: [expectedToolAction],
    },
    priorTuningExposure:
      "Generated for a fake-gateway regression from versioned synthetic comparison evidence.",
    scenarioFamily: "comparison-explicit-competition-scope-regression",
    turns: [
      {
        ...baseTurn,
        clarificationAlternatives: [],
        clarificationAnswers: [],
        turnId,
        userMessage:
          "Compare Synthetic Midfielder and Synthetic Winger for La Liga 2024/25 performance and FM ability.",
      },
    ],
  });
};

describe("local scouting evaluation entry", () => {
  const temporaryDirectories: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();

    await Promise.all(
      servers.splice(0).map(async (server) => {
        server.closeAllConnections();
        await server[Symbol.asyncDispose]();
      })
    );

    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it.each([
    "player_lookup",
    "player_comparison",
    "player_recommendation",
    "team_recommendation",
  ] as const)("keeps 12 %s cases in the approved split", (workflow) => {
    const development = loadEvaluationCases("development", []).filter(
      ({ caseDefinition }) => caseDefinition.workflow === workflow
    );

    const heldOut = loadEvaluationCases("held_out", []).filter(
      ({ caseDefinition }) => caseDefinition.workflow === workflow
    );

    const scenarioSplits = new Map<string, Set<string>>();

    for (const loadedCase of [...development, ...heldOut]) {
      const { scenarioFamily, split } = loadedCase.caseDefinition;
      const splits = scenarioSplits.get(scenarioFamily) ?? new Set<string>();
      splits.add(split);
      scenarioSplits.set(scenarioFamily, splits);
    }

    expect({
      development: {
        categories: categoryCounts(development),
        count: development.length,
        origins: originCounts(development),
      },
      heldOut: {
        categories: categoryCounts(heldOut),
        count: heldOut.length,
        origins: originCounts(heldOut),
      },
      scenarioFamiliesStayInOneSplit: [...scenarioSplits.values()].every(
        (splits) => splits.size === 1
      ),
      total: development.length + heldOut.length,
    }).toStrictEqual({
      development: {
        categories: { boundary: 3, multi_turn: 2, ordinary: 3 },
        count: 8,
        origins: { real: 4, synthetic: 4 },
      },
      heldOut: {
        categories: { boundary: 1, multi_turn: 2, ordinary: 1 },
        count: 4,
        origins: { real: 4, synthetic: 0 },
      },
      scenarioFamiliesStayInOneSplit: true,
      total: 12,
    });
  });

  it("keeps judge anchors in four balanced, independent groups", () => {
    const categories = [
      "correct_paraphrase",
      "factual_contradiction",
      "unsupported_fact",
      "false_execution_claim",
    ];

    expect({
      categoryCounts: categories.map((category) => ({
        category,
        count: judgeAnchors.filter((anchor) => anchor.category === category)
          .length,
        development: judgeAnchors.filter(
          (anchor) =>
            anchor.category === category && anchor.split === "development"
        ).length,
        validation: judgeAnchors.filter(
          (anchor) =>
            anchor.category === category && anchor.split === "validation"
        ).length,
      })),
      familySplits: new Map(
        judgeAnchors.map((anchor) => [anchor.scenarioFamily, anchor.split])
      ).size,
      total: judgeAnchors.length,
    }).toStrictEqual({
      categoryCounts: categories.map((category) => ({
        category,
        count: 8,
        development: 4,
        validation: 4,
      })),
      familySplits: 32,
      total: 32,
    });
  });

  it("allows held-out preview but requires a freeze ID before dispatch", async () => {
    vi.stubEnv("OPENAI_API_KEY", "evaluation-freeze-test-key");
    vi.stubEnv("OPENAI_MODEL", "evaluation-freeze-test-model");
    vi.stubEnv("OPENAI_BASE_URL", "https://gateway.example.test/v1");

    const preview = previewEvaluation({
      caseIds: ["recommend-isak-real-heldout-v1"],
      mode: "smoke",
    });

    expect(preview.heldOutFreezeReady).toBeFalsy();
    expect(preview.freezeFingerprint).toMatch(
      /^scouting-eval-v1-[a-f0-9]{64}$/u
    );
    expect(
      previewEvaluation({
        caseIds: ["recommend-isak-real-heldout-v1"],
        freezeId: "arbitrary-freeze-name",
        mode: "smoke",
      }).heldOutFreezeReady
    ).toBeFalsy();
    expect(
      previewEvaluation({
        caseIds: ["recommend-isak-real-heldout-v1"],
        freezeId: preview.freezeFingerprint ?? undefined,
        mode: "smoke",
      }).heldOutFreezeReady
    ).toBeTruthy();

    await expect(
      runEvaluation({
        caseIds: ["recommend-isak-real-heldout-v1"],
        maxModelRequests: 10,
        mode: "held_out",
        outputDirectory: ".data/evals/freeze-gate-test-runs",
        workspaceDirectory: ".data/evals/freeze-gate-test-work",
      })
    ).rejects.toThrow("Held-out cases require --freeze-id to match");
  });

  it("invalidates a held-out freeze fingerprint when the model changes", () => {
    vi.stubEnv("OPENAI_MODEL", "freeze-agent-v1");
    vi.stubEnv("OPENAI_BASE_URL", "https://gateway.example.test/v1");

    const initialPreview = previewEvaluation({
      caseIds: ["recommend-isak-real-heldout-v1"],
      mode: "smoke",
    });

    vi.stubEnv("OPENAI_MODEL", "freeze-agent-v2");

    const changedPreview = previewEvaluation({
      caseIds: ["recommend-isak-real-heldout-v1"],
      freezeId: initialPreview.freezeFingerprint ?? undefined,
      mode: "smoke",
    });

    expect({
      fingerprintChanged:
        changedPreview.freezeFingerprint !== initialPreview.freezeFingerprint,
      heldOutFreezeReady: changedPreview.heldOutFreezeReady,
    }).toStrictEqual({ fingerprintChanged: true, heldOutFreezeReady: false });
  });

  it("retains three isolated formal trials and compares only compatible report rows", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(request, response, requestCount);
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const { port } = z
      .object({ port: z.number().int().positive() })
      .parse(gateway.address());

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-repeat-eval-")
    );

    temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${port}/v1`);

    const report = await runEvaluation({
      caseIds: ["lookup-smoke-v1"],
      maxModelRequests: 50,
      mode: "development",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const reportPath = path.join(
      workspace,
      "reports",
      report.runId,
      "report.json"
    );

    const comparison = compareEvaluationReportFiles(reportPath, reportPath);

    const trialIds = new Set(
      report.trials.flatMap((trial) =>
        trial.observation.actionEvents.map(({ trialId }) => trialId)
      )
    );

    expect({
      codeStatuses: report.trials.map(({ codeStatus }) => codeStatus),
      comparisonHasCompatibleCoverage:
        comparison.includes("Compatible paired trials: 3") &&
        comparison.includes(
          "N/A: both runs need all reserved validation anchors"
        ),
      estimatedRequests: report.estimatedModelRequests,
      requestCount,
      runStatus: report.status,
      trialCount: report.trials.length,
      uniqueTrialIds: trialIds.size,
    }).toStrictEqual({
      codeStatuses: ["passed", "passed", "passed"],
      comparisonHasCompatibleCoverage: true,
      estimatedRequests: 45,
      requestCount: report.modelRequests,
      runStatus: "completed",
      trialCount: 3,
      uniqueTrialIds: 3,
    });
  }, 20_000);

  it("runs the real lookup graph with fixed source evidence under its request allowance", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(request, response, requestCount);
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const parsedAddress = z
      .object({ port: z.number().int().positive() })
      .safeParse(gateway.address());

    if (!parsedAddress.success) {
      throw new Error("The fake gateway did not bind to a TCP port.");
    }

    const workspace = mkdtempSync(path.join(tmpdir(), "tactiscout-eval-"));
    temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const preview = previewEvaluation({
      caseIds: [
        "lookup-smoke-v1",
        "lookup-identity-unavailable-v1",
        "lookup-followup-smoke-v1",
        "lookup-identity-clarification-v1",
      ],
      mode: "smoke",
    });

    expect({
      caseIds: preview.cases.map(({ caseId }) => caseId),
      categories: preview.cases.map(({ category }) => category),
      estimatedModelRequests: preview.estimatedModelRequests,
      evidenceStatuses: preview.cases.map(
        ({ evidenceStatus }) => evidenceStatus
      ),
      modelConfigurationReady: preview.modelConfigurationReady,
      requestCount,
      sourceProcessingAllowed: preview.sourceProcessingAllowed,
      trials: preview.trials,
    }).toStrictEqual({
      caseIds: [
        "lookup-smoke-v1",
        "lookup-identity-unavailable-v1",
        "lookup-followup-smoke-v1",
        "lookup-identity-clarification-v1",
      ],
      categories: ["ordinary", "boundary", "multi_turn", "multi_turn"],
      estimatedModelRequests: 105,
      evidenceStatuses: ["ready", "ready", "ready", "ready"],
      modelConfigurationReady: true,
      requestCount: 0,
      sourceProcessingAllowed: true,
      trials: 4,
    });

    const report = await runEvaluation({
      caseIds: [
        "lookup-smoke-v1",
        "lookup-identity-unavailable-v1",
        "lookup-followup-smoke-v1",
        "lookup-identity-clarification-v1",
      ],
      maxModelRequests: 30,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "workspace"),
    });

    const [
      lookupTrial,
      unavailableTrial,
      followupTrial,
      identityClarificationTrial,
    ] = report.trials;

    if (
      lookupTrial === undefined ||
      unavailableTrial === undefined ||
      followupTrial === undefined ||
      identityClarificationTrial === undefined
    ) {
      throw new Error(
        "The evaluation did not return all selected trial results."
      );
    }

    expect({
      actionEvents: lookupTrial.observation.actionEvents.map(
        ({ kind, name, outcome, sourceRecords, turnId }) => ({
          kind,
          name,
          outcome,
          sourceRecords: sourceRecords.map(({ provider, sourceId }) => ({
            provider,
            sourceId,
          })),
          turnId,
        })
      ),
      checkIds: lookupTrial.checks.map(({ id }) => id),
      codeStatus: lookupTrial.codeStatus,
      deliveredEvidence: lookupTrial.observation.deliveredEvidence.map(
        ({ provider, sourceId, turnId }) => ({ provider, sourceId, turnId })
      ),
      executedTools: lookupTrial.observation.toolMessages.map(
        ({ name, status }) => ({ name, status })
      ),
      followupActionEvents: followupTrial.observation.actionEvents.map(
        ({ kind, name, outcome, turnId }) => ({ kind, name, outcome, turnId })
      ),
      followupIdentityStatus:
        followupTrial.observation.players[0]?.resolutionStatus,
      followupOutcome: followupTrial.observation.outcomeStatus,
      followupStatus: followupTrial.status,
      followupTurnEvidence: followupTrial.observation.turns.map(
        ({
          clarificationAnswers,
          clarificationKinds,
          deliveredEvidenceIds,
          reuse,
          turnId,
        }) => ({
          clarificationAnswers,
          clarificationKinds,
          evidenceCount: deliveredEvidenceIds.length,
          reuseKind: reuse?.kind ?? null,
          turnId,
        })
      ),
      identityClarification: identityClarificationTrial.observation.turns.map(
        ({
          clarificationAnswers,
          clarificationKinds,
          players,
          reuse,
          turnId,
        }) => ({
          clarificationAnswers,
          clarificationKinds,
          identityStatus: players[0]?.resolutionStatus,
          reuseKind: reuse?.kind ?? null,
          turnId,
        })
      ),
      identityClarificationCheck: identityClarificationTrial.checks.find(
        ({ id }) => id === "turn-identity-continuity"
      )?.status,
      identityClarificationOutcome:
        identityClarificationTrial.observation.outcomeStatus,
      identityClarificationStatus: identityClarificationTrial.status,
      modelRequests: report.modelRequests,
      observationError: lookupTrial.observation.error ?? null,
      requestCount,
      requestCountsByRole: report.requestCountsByRole,
      semanticStatus: lookupTrial.semanticStatus,
      sourceRecords: lookupTrial.sourceRecords,
      status: lookupTrial.status,
      tokenUsageByRole: report.tokenUsageByRole.agent,
      unavailableChecks: unavailableTrial.checks.map(({ id, status }) => ({
        id,
        status,
      })),
      unavailableOutcome: unavailableTrial.observation.outcomeStatus,
      unavailableReply:
        unavailableTrial.observation.conversationContext.at(-1)?.content,
      unavailableStatus: unavailableTrial.status,
      workflow: lookupTrial.workflow,
    }).toStrictEqual({
      actionEvents: [
        {
          kind: "attempted",
          name: "search_player_records",
          outcome: null,
          sourceRecords: [
            { provider: "fm", sourceId: "fm-demo-01" },
            { provider: "understat", sourceId: "us-demo-01" },
          ],
          turnId: "lookup-smoke-v1-turn-1",
        },
        {
          kind: "returned",
          name: "search_player_records",
          outcome: "found",
          sourceRecords: [
            { provider: "fm", sourceId: "fm-demo-01" },
            { provider: "understat", sourceId: "us-demo-01" },
          ],
          turnId: "lookup-smoke-v1-turn-1",
        },
        {
          kind: "requested",
          name: "search_player_records",
          outcome: null,
          sourceRecords: [
            { provider: "fm", sourceId: "fm-demo-01" },
            { provider: "understat", sourceId: "us-demo-01" },
          ],
          turnId: "lookup-smoke-v1-turn-1",
        },
      ],
      checkIds: [
        "task-kind",
        "task-outcome",
        "identity-resolution-status",
        "resolved-identity",
        "identity-lookup-observations",
        "lookup-result",
        "required-evidence",
      ],
      codeStatus: "passed",
      deliveredEvidence: [
        {
          provider: "fm",
          sourceId: "fm-demo-01",
          turnId: "lookup-smoke-v1-turn-1",
        },
        {
          provider: "understat",
          sourceId: "us-demo-01",
          turnId: "lookup-smoke-v1-turn-1",
        },
      ],
      executedTools: [{ name: "search_player_records", status: "success" }],
      followupActionEvents: [
        {
          kind: "attempted",
          name: "search_player_records",
          outcome: null,
          turnId: "lookup-followup-smoke-v1-turn-1",
        },
        {
          kind: "returned",
          name: "search_player_records",
          outcome: "found",
          turnId: "lookup-followup-smoke-v1-turn-1",
        },
        {
          kind: "requested",
          name: "search_player_records",
          outcome: null,
          turnId: "lookup-followup-smoke-v1-turn-1",
        },
        {
          kind: "attempted",
          name: "search_player_records",
          outcome: null,
          turnId: "lookup-followup-smoke-v1-turn-2",
        },
        {
          kind: "returned",
          name: "search_player_records",
          outcome: "found",
          turnId: "lookup-followup-smoke-v1-turn-2",
        },
        {
          kind: "requested",
          name: "search_player_records",
          outcome: null,
          turnId: "lookup-followup-smoke-v1-turn-2",
        },
      ],
      followupIdentityStatus: "resolved",
      followupOutcome: "answer_ready",
      followupStatus: "not_assessed",
      followupTurnEvidence: [
        {
          clarificationAnswers: [{ kind: "identity", value: "1" }],
          clarificationKinds: ["identity"],
          evidenceCount: 2,
          reuseKind: null,
          turnId: "lookup-followup-smoke-v1-turn-1",
        },
        {
          clarificationAnswers: [],
          clarificationKinds: [],
          evidenceCount: 2,
          reuseKind: null,
          turnId: "lookup-followup-smoke-v1-turn-2",
        },
      ],
      identityClarification: [
        {
          clarificationAnswers: [{ kind: "identity", value: "1" }],
          clarificationKinds: ["identity"],
          identityStatus: "resolved",
          reuseKind: null,
          turnId: "lookup-identity-clarification-v1-turn-1",
        },
        {
          clarificationAnswers: [],
          clarificationKinds: [],
          identityStatus: "saved_result_reuse",
          reuseKind: "saved_lookup_result",
          turnId: "lookup-identity-clarification-v1-turn-2",
        },
        {
          clarificationAnswers: [],
          clarificationKinds: [],
          identityStatus: "data_unavailable",
          reuseKind: null,
          turnId: "lookup-identity-clarification-v1-turn-3",
        },
      ],
      identityClarificationCheck: "passed",
      identityClarificationOutcome: "identity_data_unavailable",
      identityClarificationStatus: "not_assessed",
      modelRequests: 16,
      observationError: null,
      requestCount: 16,
      requestCountsByRole: { agent: 16, calibration: 0, judge: 0 },
      semanticStatus: "not_assessed",
      sourceRecords: [
        { provider: "fm", sourceId: "fm-demo-01" },
        { provider: "understat", sourceId: "us-demo-01" },
      ],
      status: "not_assessed",
      tokenUsageByRole: {
        completionTokensReported: 192,
        deniedRequests: 0,
        dispatchedRequests: 16,
        modelIds: ["eval-fixture-model"],
        promptTokensReported: 384,
        responsesWithUsage: 16,
        responsesWithoutUsage: 0,
        totalTokensReported: 576,
      },
      unavailableChecks: [
        { id: "task-kind", status: "passed" },
        { id: "task-outcome", status: "passed" },
        { id: "identity-resolution-status", status: "passed" },
        { id: "resolved-identity", status: "passed" },
        { id: "identity-lookup-observations", status: "passed" },
        { id: "lookup-result", status: "passed" },
        { id: "required-evidence", status: "passed" },
      ],
      unavailableOutcome: "identity_data_unavailable",
      unavailableReply:
        "本地球员身份资料无法读取，本次无法确认球员身份，也没有执行依赖该身份的查询或计算。",
      unavailableStatus: "not_assessed",
      workflow: "player_lookup",
    });

    let savedReportJson: unknown;

    try {
      savedReportJson = JSON.parse(
        readFileSync(
          path.join(workspace, "reports", report.runId, "report.json"),
          "utf-8"
        )
      );
    } catch {
      throw new Error("The evaluation did not persist a valid JSON report.");
    }

    const savedReport = evaluationReportSchema.parse(savedReportJson);

    const savedMarkdown = readFileSync(
      path.join(workspace, "reports", report.runId, "report.md"),
      "utf-8"
    );

    expect({
      markdownContainsCase:
        savedMarkdown.includes("lookup-smoke-v1") &&
        savedMarkdown.includes("lookup-identity-unavailable-v1"),
      markdownContainsEvaluationDetails:
        savedMarkdown.includes("Expected vs observed checks") &&
        savedMarkdown.includes("Evidence delivered to the model") &&
        savedMarkdown.includes("search_player_records"),
      savedRunId: savedReport.runId,
      savedStatus: savedReport.trials[0]?.status,
    }).toStrictEqual({
      markdownContainsCase: true,
      markdownContainsEvaluationDetails: true,
      savedRunId: report.runId,
      savedStatus: "not_assessed",
    });

    const limitedReport = await runEvaluation({
      caseIds: ["lookup-smoke-v1"],
      maxModelRequests: 2,
      mode: "smoke",
      outputDirectory: path.join(workspace, "limited-reports"),
      workspaceDirectory: path.join(workspace, "limited-workspace"),
    });

    expect({
      deniedRequests: limitedReport.deniedRequests,
      deniedRequestsByRole: limitedReport.deniedRequestsByRole,
      fakeGatewayRequests: requestCount,
      modelRequests: limitedReport.modelRequests,
      status: limitedReport.trials[0]?.status,
    }).toStrictEqual({
      deniedRequests: 1,
      deniedRequestsByRole: { agent: 1, calibration: 0, judge: 0 },
      fakeGatewayRequests: 18,
      modelRequests: 2,
      status: "budget_exhausted",
    });

    const abortController = new AbortController();
    abortController.abort();

    const cancelledReport = await runEvaluation({
      caseIds: ["lookup-smoke-v1"],
      maxModelRequests: 3,
      mode: "smoke",
      outputDirectory: path.join(workspace, "cancelled-reports"),
      signal: abortController.signal,
      workspaceDirectory: path.join(workspace, "cancelled-workspace"),
    });

    const cancelledPersistedStatus = evaluationReportSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(
            workspace,
            "cancelled-reports",
            cancelledReport.runId,
            "report.json"
          ),
          "utf-8"
        )
      )
    ).status;

    const alteredDefinitions = path.join(workspace, "altered-definitions");
    const caseDirectory = path.join(alteredDefinitions, "cases");
    const evidenceDirectory = path.join(alteredDefinitions, "evidence");
    mkdirSync(caseDirectory, { recursive: true });
    mkdirSync(evidenceDirectory, { recursive: true });

    const sourceCase = z
      .looseObject({ evidenceBundleSha256: z.string() })
      .parse(
        JSON.parse(
          readFileSync(
            path.join(process.cwd(), "evals/cases/lookup-smoke-v1.json"),
            "utf-8"
          )
        )
      );

    const sourceEvidence = readFileSync(
      path.join(process.cwd(), "evals/evidence/lookup-smoke-evidence-v1.json"),
      "utf-8"
    );

    writeFileSync(
      path.join(caseDirectory, "lookup-smoke-v1.json"),
      JSON.stringify({ ...sourceCase, evidenceBundleSha256: "0".repeat(64) })
    );
    writeFileSync(
      path.join(evidenceDirectory, "lookup-smoke-evidence-v1.json"),
      sourceEvidence
    );

    const tamperedFixtureReport = await runEvaluation({
      caseDirectory,
      caseIds: ["lookup-smoke-v1"],
      evidenceDirectory,
      maxModelRequests: 3,
      mode: "smoke",
      outputDirectory: path.join(workspace, "tampered-reports"),
      workspaceDirectory: path.join(workspace, "tampered-workspace"),
    });

    expect({
      cancellation: {
        fakeGatewayRequests: requestCount,
        persistedStatus: cancelledPersistedStatus,
        status: cancelledReport.status,
        trialStatus: cancelledReport.trials[0]?.status,
      },
      tamperedFixture: {
        fakeGatewayRequests: requestCount,
        modelRequests: tamperedFixtureReport.modelRequests,
        preflightErrors: tamperedFixtureReport.preflightErrors,
        status: tamperedFixtureReport.status,
        trialStatus: tamperedFixtureReport.trials[0]?.status,
      },
    }).toStrictEqual({
      cancellation: {
        fakeGatewayRequests: 18,
        persistedStatus: "partial",
        status: "partial",
        trialStatus: "not_run",
      },
      tamperedFixture: {
        fakeGatewayRequests: 18,
        modelRequests: 0,
        preflightErrors: ["lookup-smoke-v1:EvidencePreflightError"],
        status: "partial",
        trialStatus: "preflight_error",
      },
    });
  }, 15_000);

  it("records a scripted clarification mismatch without resuming the graph", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(request, response, requestCount);
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const parsedAddress = z
      .object({ port: z.number().int().positive() })
      .safeParse(gateway.address());

    if (!parsedAddress.success) {
      throw new Error("The fake gateway did not bind to a TCP port.");
    }

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-eval-script-")
    );

    temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const caseDirectory = path.join(workspace, "cases");
    const evidenceDirectory = path.join(workspace, "evidence");
    mkdirSync(caseDirectory, { recursive: true });
    mkdirSync(evidenceDirectory, { recursive: true });

    const caseContents = readFileSync(
      path.join(
        process.cwd(),
        "evals/cases/lookup-identity-clarification-v1.json"
      ),
      "utf-8"
    ).replace('"expectedKind": "identity"', '"expectedKind": "season"');

    const evidenceContents = readFileSync(
      path.join(
        process.cwd(),
        "evals/evidence/lookup-ambiguous-evidence-v1.json"
      ),
      "utf-8"
    );

    writeFileSync(
      path.join(caseDirectory, "lookup-identity-clarification-v1.json"),
      caseContents
    );
    writeFileSync(
      path.join(evidenceDirectory, "lookup-ambiguous-evidence-v1.json"),
      evidenceContents
    );

    const report = await runEvaluation({
      caseDirectory,
      caseIds: ["lookup-identity-clarification-v1"],
      evidenceDirectory,
      maxModelRequests: 3,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    expect({
      clarificationKinds: trial?.observation.turns[0]?.clarificationKinds,
      codeStatus: trial?.codeStatus,
      driverIssue: trial?.observation.driverIssue,
      modelRequests: report.modelRequests,
      requestCount,
      scriptCheck: trial?.checks.find(
        ({ id }) => id === "scripted-clarifications"
      )?.status,
      status: trial?.status,
    }).toStrictEqual({
      clarificationKinds: ["identity"],
      codeStatus: "failed",
      driverIssue: "The scripted clarification does not match the graph.",
      modelRequests: 1,
      requestCount: 1,
      scriptCheck: "failed",
      status: "failed",
    });
  }, 15_000);

  it("uses a clarification path only when its declared kind matches the real interrupt", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(request, response, requestCount);
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const parsedAddress = z
      .object({ port: z.number().int().positive() })
      .safeParse(gateway.address());

    if (!parsedAddress.success) {
      throw new Error("The fake gateway did not bind to a TCP port.");
    }

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-eval-paths-")
    );

    temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const caseDirectory = path.join(workspace, "cases");
    const evidenceDirectory = path.join(workspace, "evidence");
    mkdirSync(caseDirectory, { recursive: true });
    mkdirSync(evidenceDirectory, { recursive: true });

    const answerSchema = z.looseObject({
      expectedKind: z.string(),
      resumeValue: z.string(),
    });

    const caseSchema = z.looseObject({
      turns: z.array(
        z.looseObject({
          clarificationAlternatives: z.array(z.array(answerSchema)).optional(),
          clarificationAnswers: z.array(answerSchema).default([]),
        })
      ),
    });

    const originalCase = caseSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(
            process.cwd(),
            "evals/cases/lookup-identity-clarification-v1.json"
          ),
          "utf-8"
        )
      )
    );

    const [firstTurn] = originalCase.turns;

    if (firstTurn === undefined) {
      throw new Error("The clarification case needs a first turn.");
    }

    const alternativeCase = {
      ...originalCase,
      turns: [
        {
          ...firstTurn,
          clarificationAlternatives: [
            [{ expectedKind: "identity", resumeValue: "1" }],
          ],
          clarificationAnswers: [
            { expectedKind: "season", resumeValue: "2024/25" },
          ],
        },
        ...originalCase.turns.slice(1),
      ],
    };

    const evidenceContents = readFileSync(
      path.join(
        process.cwd(),
        "evals/evidence/lookup-ambiguous-evidence-v1.json"
      ),
      "utf-8"
    );

    writeFileSync(
      path.join(caseDirectory, "lookup-identity-clarification-v1.json"),
      JSON.stringify(alternativeCase)
    );
    writeFileSync(
      path.join(evidenceDirectory, "lookup-ambiguous-evidence-v1.json"),
      evidenceContents
    );

    const report = await runEvaluation({
      caseDirectory,
      caseIds: ["lookup-identity-clarification-v1"],
      evidenceDirectory,
      maxModelRequests: 10,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    expect({
      answers: trial?.observation.turns[0]?.clarificationAnswers,
      driverIssue: trial?.observation.driverIssue,
      modelRequests: report.modelRequests,
      requestCount,
      scriptCheck: trial?.checks.find(
        ({ id }) => id === "scripted-clarifications"
      )?.status,
      status: trial?.status,
    }).toStrictEqual({
      answers: [{ kind: "identity", value: "1" }],
      driverIssue: null,
      modelRequests: 6,
      requestCount: 6,
      scriptCheck: "passed",
      status: "not_assessed",
    });
  }, 15_000);

  it("runs comparison computation, duplicate identity rejection, scope limits, and multi-turn refinements", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(
        request,
        response,
        requestCount,
        "comparison_resume"
      );
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const parsedAddress = z
      .object({ port: z.number().int().positive() })
      .safeParse(gateway.address());

    if (!parsedAddress.success) {
      throw new Error("The fake gateway did not bind to a TCP port.");
    }

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-comparison-eval-")
    );

    temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const report = await runEvaluation({
      caseIds: [
        "compare-same-identity-synthetic-v1",
        "compare-synthetic-cross-scope-v1",
        "compare-add-third-synthetic-v1",
        "compare-season-resume-add-synthetic-v1",
      ],
      maxModelRequests: 30,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const trials = report.trials.map((trial) => ({
      actionOutcomes: trial.observation.actionEvents
        .filter(
          ({ kind, name }) =>
            kind === "returned" && name === "compare_player_records"
        )
        .map(({ outcome }) => outcome),
      caseId: trial.caseId,
      codeStatus: trial.codeStatus,
      identityCountsByTurn: trial.observation.turns.map(
        ({ players, turnId }) => ({
          playerCount: players.length,
          turnId,
        })
      ),
      outcomeStatus: trial.observation.outcomeStatus,
      status: trial.status,
    }));

    expect(
      report.trials
        .at(-1)
        ?.checks.filter(({ status }) => status === "failed")
        .map(({ actual, expected, id }) => ({ actual, expected, id }))
    ).toStrictEqual([]);

    expect({
      fakeGatewayRequests: requestCount,
      modelRequests: report.modelRequests,
      reportStatus: report.status,
      trials,
    }).toStrictEqual({
      fakeGatewayRequests: requestCount,
      modelRequests: requestCount,
      reportStatus: "completed",
      trials: [
        {
          actionOutcomes: ["insufficient_distinct_players"],
          caseId: "compare-same-identity-synthetic-v1",
          codeStatus: "passed",
          identityCountsByTurn: [
            {
              playerCount: 2,
              turnId: "compare-same-identity-synthetic-v1-turn-1",
            },
          ],
          outcomeStatus: "insufficient_distinct_players",
          status: "not_assessed",
        },
        {
          actionOutcomes: ["no_comparable_data"],
          caseId: "compare-synthetic-cross-scope-v1",
          codeStatus: "passed",
          identityCountsByTurn: [
            {
              playerCount: 2,
              turnId: "compare-synthetic-cross-scope-v1-turn-1",
            },
          ],
          outcomeStatus: "no_comparable_data",
          status: "not_assessed",
        },
        {
          actionOutcomes: ["ready", "ready"],
          caseId: "compare-add-third-synthetic-v1",
          codeStatus: "passed",
          identityCountsByTurn: [
            {
              playerCount: 2,
              turnId: "compare-add-third-synthetic-v1-turn-1",
            },
            {
              playerCount: 3,
              turnId: "compare-add-third-synthetic-v1-turn-2",
            },
          ],
          outcomeStatus: "ready",
          status: "not_assessed",
        },
        {
          actionOutcomes: ["ready", "ready", "ready", "no_comparable_data"],
          caseId: "compare-season-resume-add-synthetic-v1",
          codeStatus: "passed",
          identityCountsByTurn: [
            {
              playerCount: 2,
              turnId: "compare-season-resume-add-synthetic-v1-turn-1",
            },
            {
              playerCount: 3,
              turnId: "compare-season-resume-add-synthetic-v1-turn-2",
            },
            {
              playerCount: 2,
              turnId: "compare-season-resume-add-synthetic-v1-turn-3",
            },
            {
              playerCount: 2,
              turnId: "compare-season-resume-add-synthetic-v1-turn-4",
            },
          ],
          outcomeStatus: "data_unavailable",
          status: "not_assessed",
        },
      ],
    });
  }, 20_000);

  it("isolates declared turn faults across repeated comparison trials", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(
        request,
        response,
        requestCount,
        "comparison_resume"
      );
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const address = z
      .object({ port: z.number().int().positive() })
      .parse(gateway.address());

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-comparison-repeat-eval-")
    );

    temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${address.port}/v1`);

    const report = await runEvaluation({
      caseIds: ["compare-season-resume-add-synthetic-v1"],
      maxModelRequests: 100,
      mode: "development",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const summarizeTrial = (trial: (typeof report.trials)[number]) => {
      const activeComparison = z
        .object({
          constraints: z.array(
            z.object({ name: z.string(), value: z.string() })
          ),
          players: z.array(z.object({ name: z.string() })),
        })
        .parse(JSON.parse(trial.observation.activeResults.comparison ?? "{}"));

      return {
        activePlayers: activeComparison.players.map(({ name }) => name),
        codeStatus: trial.codeStatus,
        comparisonCount: trial.observation.actionEvents.filter(
          ({ kind, name }) =>
            kind === "returned" && name === "compare_player_records"
        ).length,
        outcomeStatus: trial.observation.outcomeStatus,
        season: activeComparison.constraints.find(
          ({ name }) => name === "season"
        )?.value,
        turnIdentityStatuses: trial.observation.turns.flatMap((turn) =>
          turn.players.map(({ resolutionStatus }) => resolutionStatus)
        ),
      };
    };

    expect({
      modelRequests: requestCount,
      reportStatus: report.status,
      trials: report.trials.map(summarizeTrial),
    }).toStrictEqual({
      modelRequests: report.modelRequests,
      reportStatus: "completed",
      trials: [1, 2, 3].map(() => ({
        activePlayers: ["Elias Demo", "Synthetic Winger"],
        codeStatus: "passed",
        comparisonCount: 4,
        outcomeStatus: "data_unavailable",
        season: "2024/25",
        turnIdentityStatuses: [
          "resolved",
          "resolved",
          "resolved",
          "resolved",
          "resolved",
          "resolved",
          "resolved",
          "resolved",
          "resolved",
        ],
      })),
    });
  }, 30_000);

  it("keeps a season team separate from current registration in lookup answers", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(
        request,
        response,
        requestCount,
        "season_team_abstention"
      );
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const parsedAddress = z
      .object({ port: z.number().int().positive() })
      .parse(gateway.address());

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-season-team-eval-")
    );

    temporaryDirectories.push(workspace);

    const caseDirectory = path.join(workspace, "cases");
    const evidenceDirectory = path.join(workspace, "evidence");
    mkdirSync(caseDirectory, { recursive: true });
    mkdirSync(evidenceDirectory, { recursive: true });

    const sourceCase = evaluationCaseSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(process.cwd(), "evals/cases/lookup-smoke-v1.json"),
          "utf-8"
        ).replaceAll("2024/25", "2026/27")
      )
    );

    const sourceEvidence = readFileSync(
      path.join(process.cwd(), "evals/evidence/lookup-smoke-evidence-v1.json"),
      "utf-8"
    );

    const evidenceContents = sourceEvidence
      .replace(
        '"capturedAt": "2025-11-23T00:00:00.000Z"',
        '"capturedAt": "2026-10-28T00:00:00.000Z"'
      )
      .replace('"seasonStartYear": 2024', '"seasonStartYear": 2026')
      .replace('"team_title": "Fixture City"', '"team_title": "Arsenal"');

    const evidenceBundleSha256 = createHash("sha256")
      .update(evidenceContents)
      .digest("hex");

    const seasonalTeamCase = {
      ...sourceCase,
      contract: {
        ...sourceCase.contract,
        requiredAbstentions: [
          "Current registration is not present in FM or Understat and must be stated as unknown.",
        ],
        requiredEvidence: [
          ...sourceCase.contract.requiredEvidence,
          {
            competition: "EPL",
            field: "team",
            provider: "understat" as const,
            season: "2026/27",
            sourceId: "us-demo-01",
            value: "Arsenal",
          },
        ],
      },
      evidenceBundleSha256,
      turns: sourceCase.turns.map((turn) => ({
        ...turn,
        userMessage:
          "请查一下 Elias Demo 的 2026/27 EPL 表现记录对应球队，以及当前注册俱乐部。",
      })),
    };

    writeFileSync(
      path.join(caseDirectory, "lookup-smoke-v1.json"),
      JSON.stringify(seasonalTeamCase)
    );
    writeFileSync(
      path.join(evidenceDirectory, "lookup-smoke-evidence-v1.json"),
      evidenceContents
    );

    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${parsedAddress.port}/v1`);

    const report = await runEvaluation({
      caseDirectory,
      caseIds: ["lookup-smoke-v1"],
      evidenceDirectory,
      maxModelRequests: 10,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "workspace"),
    });

    const [trial] = report.trials;

    const answer = trial?.observation.conversationContext
      .toReversed()
      .find(({ role }) => role === "assistant")?.content;

    expect(answer).toBe(
      "Understat 的 2026/27 EPL 赛季表现记录列出的球队是 Arsenal。FM 和 Understat 都没有提供当前注册球队，因此无法从这些资料确定 Elias Demo 目前效力的俱乐部。"
    );
    expect(
      trial?.checks.find(({ id }) => id === "required-evidence")?.status
    ).toBe("passed");
    expect(trial?.codeStatus).toBe("passed");
    expect(requestCount).toBe(report.modelRequests);
  }, 20_000);

  it("applies an explicit competition scope in the real comparison workflow", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(request, response, requestCount);
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const parsedAddress = z
      .object({ port: z.number().int().positive() })
      .safeParse(gateway.address());

    if (!parsedAddress.success) {
      throw new Error("The fake gateway did not bind to a TCP port.");
    }

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-comparison-competition-eval-")
    );

    temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const [loadedCase] = loadEvaluationCases("development", [
      "compare-add-third-synthetic-v1",
    ]);

    if (loadedCase === undefined) {
      throw new Error("The synthetic comparison fixture is missing.");
    }

    const caseDefinition = explicitCompetitionComparisonCase(
      loadedCase.caseDefinition
    );

    const { caseId } = caseDefinition;

    const caseDirectory = path.join(workspace, "cases");
    const evidenceDirectory = path.join(workspace, "evidence");

    mkdirSync(caseDirectory, { recursive: true });
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(
      path.join(caseDirectory, `${caseId}.json`),
      JSON.stringify(caseDefinition)
    );
    writeFileSync(
      path.join(evidenceDirectory, `${caseDefinition.evidenceBundleId}.json`),
      readFileSync(
        path.join(
          process.cwd(),
          "evals/evidence",
          `${caseDefinition.evidenceBundleId}.json`
        ),
        "utf-8"
      )
    );

    const report = await runEvaluation({
      caseDirectory,
      caseIds: [caseId],
      evidenceDirectory,
      maxModelRequests: 10,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "workspace"),
    });

    const [trial] = report.trials;

    const returnedAction = trial?.observation.actionEvents.find(
      ({ kind, name }) =>
        kind === "returned" && name === "compare_player_records"
    );

    const comparisonOutputSchema = z.object({
      players: z.array(
        z.object({
          fm: z.object({ status: z.string() }).nullable().optional(),
          playerName: z.string(),
          understat: z.object({ status: z.string() }).nullable().optional(),
        })
      ),
      sharedUnderstatScopes: z.array(
        z.object({ competition: z.string(), season: z.string() })
      ),
      status: z.string(),
    });

    const parsedOutput = comparisonOutputSchema.safeParse(
      returnedAction?.result === null || returnedAction?.result === undefined
        ? null
        : JSON.parse(returnedAction.result)
    );

    expect({
      codeStatus: trial?.codeStatus,
      comparisonStatus: parsedOutput.success ? parsedOutput.data.status : null,
      effectiveConstraints: trial?.observation.turns[0]?.effectiveConstraints,
      sharedUnderstatScopes: parsedOutput.success
        ? parsedOutput.data.sharedUnderstatScopes
        : null,
      syntheticMidfielderUnderstatStatus: parsedOutput.success
        ? parsedOutput.data.players.find(
            ({ playerName }) => playerName === "Synthetic Midfielder"
          )?.understat?.status
        : null,
      syntheticWingerUnderstatStatus: parsedOutput.success
        ? parsedOutput.data.players.find(
            ({ playerName }) => playerName === "Synthetic Winger"
          )?.understat?.status
        : null,
    }).toStrictEqual({
      codeStatus: "passed",
      comparisonStatus: "ready",
      effectiveConstraints: [
        { name: "season", value: "2024/25" },
        { name: "competition", value: "La Liga" },
      ],
      sharedUnderstatScopes: [],
      syntheticMidfielderUnderstatStatus: "not_found",
      syntheticWingerUnderstatStatus: "found",
    });
  }, 20_000);

  it("runs synthetic player recommendations through the real graph and ranking algorithm", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(request, response, requestCount);
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const parsedAddress = z
      .object({ port: z.number().int().positive() })
      .safeParse(gateway.address());

    if (!parsedAddress.success) {
      throw new Error("The fake gateway did not bind to a TCP port.");
    }

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-recommendation-eval-")
    );

    temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const caseIds = [
      "recommend-smoke-synthetic-v1",
      "recommend-youth-clarification-synthetic-v1",
      "recommend-ambiguous-profile-synthetic-v1",
      "recommend-add-refine-synthetic-v1",
    ];

    const report = await runEvaluation({
      caseIds,
      maxModelRequests: 60,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    expect(
      report.trials.flatMap((trial) =>
        trial.checks
          .filter(({ status }) => status === "failed")
          .map(({ actual, expected, id }) => ({
            actual,
            caseId: trial.caseId,
            expected,
            id,
          }))
      )
    ).toStrictEqual([]);

    expect({
      reportRequests: report.modelRequests,
      requestCount,
      statuses: report.trials.map(({ caseId, codeStatus, status }) => ({
        caseId,
        codeStatus,
        status,
      })),
      values: report.trials.map((trial) => ({
        actionOutcomes: trial.observation.actionEvents
          .filter(
            ({ kind, name }) =>
              kind === "returned" && name === "recommend_player_candidates"
          )
          .map(({ outcome }) => outcome),
        clarifications: trial.observation.turns.map(
          ({ clarificationAnswers, clarificationKinds }) => ({
            answers: clarificationAnswers,
            kinds: clarificationKinds,
          })
        ),
        identityLookups: trial.observation.identityLookupEvents
          .filter(({ kind }) => kind === "returned")
          .map(({ lookupName, outcome }) => ({ lookupName, outcome })),
      })),
    }).toStrictEqual({
      reportRequests: report.modelRequests,
      requestCount: report.modelRequests,
      statuses: caseIds.map((caseId) => ({
        caseId,
        codeStatus: "passed",
        status: "not_assessed",
      })),
      values: [
        {
          actionOutcomes: ["ready"],
          clarifications: [
            {
              answers: [{ kind: "identity", value: "1" }],
              kinds: ["identity"],
            },
          ],
          identityLookups: [
            { lookupName: "Synthetic Reference", outcome: "resolved" },
            {
              lookupName: "Synthetic Far Candidate",
              outcome: "needs_confirmation",
            },
          ],
        },
        {
          actionOutcomes: ["position_required", "ready"],
          clarifications: [
            {
              answers: [
                { kind: "age", value: "21" },
                { kind: "position", value: "stc" },
              ],
              kinds: ["age", "position"],
            },
          ],
          identityLookups: [
            { lookupName: "Synthetic Reference", outcome: "resolved" },
          ],
        },
        {
          actionOutcomes: ["ready"],
          clarifications: [
            {
              answers: [{ kind: "fm_profile", value: "fm-amb-b" }],
              kinds: ["fm_profile"],
            },
          ],
          identityLookups: [
            { lookupName: "Synthetic Ambiguous", outcome: "resolved" },
          ],
        },
        {
          actionOutcomes: ["ready", "ready", "ready"],
          clarifications: [
            { answers: [], kinds: [] },
            {
              answers: [{ kind: "identity", value: "1" }],
              kinds: ["identity"],
            },
            { answers: [], kinds: [] },
            { answers: [], kinds: [] },
          ],
          identityLookups: [
            { lookupName: "Synthetic Reference", outcome: "resolved" },
            {
              lookupName: "Synthetic Close Candidate",
              outcome: "needs_confirmation",
            },
            {
              lookupName: "Synthetic Failure Reference",
              outcome: "data_unavailable",
            },
          ],
        },
      ],
    });

    const ambiguousProfileTrial = report.trials.find(
      ({ caseId }) => caseId === "recommend-ambiguous-profile-synthetic-v1"
    );

    const finalAssistantMessage =
      ambiguousProfileTrial?.observation.turns
        .at(-1)
        ?.assistantMessages.at(-1) ?? "";

    expect(finalAssistantMessage.trim().length).toBeGreaterThan(0);
  }, 20_000);

  it("runs a fixed API-Football roster through its real adapter and the complete team graph", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(request, response, requestCount);
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const parsedAddress = z
      .object({ port: z.number().int().positive() })
      .safeParse(gateway.address());

    if (!parsedAddress.success) {
      throw new Error("The fake gateway did not bind to a TCP port.");
    }

    const workspace = mkdtempSync(path.join(tmpdir(), "tactiscout-team-eval-"));

    temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const report = await runEvaluation({
      caseIds: ["team-rec-synthetic-v1"],
      maxModelRequests: 30,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    expect(
      trial?.checks.filter(({ status }) => status === "failed")
    ).toStrictEqual([]);
    expect({
      actionEvents: trial?.observation.actionEvents
        .filter(({ kind }) => kind === "returned")
        .map(({ name, outcome, sourceRecords }) => ({
          name,
          outcome,
          sourceRecords: sourceRecords.map(({ provider, sourceId }) => ({
            provider,
            sourceId,
          })),
        })),
      apiFootballCapture: trial?.evidenceSourceMetadata?.apiFootball,
      clarification: trial?.observation.turns[0]?.clarificationAnswers,
      codeStatus: trial?.codeStatus,
      modelRequests: report.modelRequests,
      requestCount,
      status: trial?.status,
    }).toStrictEqual({
      actionEvents: [
        {
          name: "api_football.search_teams",
          outcome: "ok",
          sourceRecords: [{ provider: "api_football", sourceId: "team:901" }],
        },
        {
          name: "api_football.get_squad",
          outcome: "ok",
          sourceRecords: [
            { provider: "api_football", sourceId: "team:901" },
            { provider: "api_football", sourceId: "player:501" },
            { provider: "api_football", sourceId: "player:502" },
          ],
        },
        {
          name: "resolve_team_roster_identity",
          outcome: "resolved",
          sourceRecords: [
            { provider: "api_football", sourceId: "player:501" },
            { provider: "fm", sourceId: "fm-ref-01" },
          ],
        },
        {
          name: "resolve_team_roster_identity",
          outcome: "needs_confirmation",
          sourceRecords: [
            { provider: "api_football", sourceId: "player:502" },
            { provider: "fm", sourceId: "fm-close-01" },
          ],
        },
        {
          name: "recommend_team_player_candidates",
          outcome: "ready",
          sourceRecords: [
            { provider: "api_football", sourceId: "team:901" },
            { provider: "fm", sourceId: "fm-close-01" },
            { provider: "fm", sourceId: "fm-far-01" },
            { provider: "fm", sourceId: "fm-future-01" },
            { provider: "fm", sourceId: "fm-ref-01" },
          ],
        },
      ],
      apiFootballCapture: {
        capturedAt: "2025-11-20T12:00:00.000Z",
        requestedTeams: [],
        sourceRequests: null,
        teamIds: [901],
      },
      clarification: [{ kind: "team_roster_profile", value: "1" }],
      codeStatus: "passed",
      modelRequests: requestCount,
      requestCount,
      status: "not_assessed",
    });
  }, 20_000);

  it("calibrates the semantic judge and scores a real graph trial through the shared entry", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(request, response, requestCount);
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const parsedAddress = z
      .object({ port: z.number().int().positive() })
      .safeParse(gateway.address());

    if (!parsedAddress.success) {
      throw new Error("The fake gateway did not bind to a TCP port.");
    }

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-judge-eval-")
    );

    temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const preview = previewEvaluation({
      caseIds: ["lookup-smoke-v1"],
      includeSemanticJudge: true,
      mode: "smoke",
    });

    const report = await runEvaluation({
      caseIds: ["lookup-smoke-v1"],
      includeSemanticJudge: true,
      maxModelRequests: 100,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    expect({
      anchorCounts: {
        development: report.judgeCalibration?.development,
        validation: report.judgeCalibration?.validation,
      },
      anchorPriorTuningExposure:
        report.judgeCalibration?.anchorPriorTuningExposure,
      anchorVersion: report.judgeCalibration?.anchorVersion,
      calibrationRequests: report.requestCountsByRole.calibration,
      calibrationStatus: report.judgeCalibration?.status,
      judgeEnabled: preview.judgeEnabled && report.judgeEnabled,
      judgeRequests: report.requestCountsByRole.judge,
      modelRequests: report.modelRequests,
      requestCount,
      retiredValidationAnchorIds:
        report.judgeCalibration?.retiredValidationAnchorIds,
      semanticStatus: trial?.semanticStatus,
      status: trial?.status,
      trialRequestsByRole: trial?.modelRequestsByRole,
    }).toStrictEqual({
      anchorCounts: {
        development: { passed: 16, total: 16 },
        validation: { passed: 16, total: 16 },
      },
      anchorPriorTuningExposure:
        "Version 3 retires factual-contradiction-08-v1 and false-execution-claim-07-v1 after the second smoke exposed missing overlapping category labels. It preserves the v2 development set, the v2 unsupported-fact-08 validation replacement, and the 13 other v2 validation anchors that were scored but not used for rubric tuning. Two fresh validation families replace the retired examples; v1/v2 packs remain historical.",
      anchorVersion: "scouting-judge-anchors-v3",
      calibrationRequests: 32,
      calibrationStatus: "passed",
      judgeEnabled: true,
      judgeRequests: 1,
      modelRequests: requestCount,
      requestCount,
      retiredValidationAnchorIds: [
        "unsupported-fact-08-v1",
        "factual-contradiction-08-v1",
        "false-execution-claim-07-v1",
      ],
      semanticStatus: "passed",
      status: "passed",
      trialRequestsByRole: {
        agent: trial?.modelRequestsByRole.agent,
        calibration: 0,
        judge: 1,
      },
    });
  }, 30_000);

  it("keeps semantic scores unassessed when a reserved judge anchor is misclassified", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(
        request,
        response,
        requestCount,
        "judge_wrong_anchor"
      );
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const parsedAddress = z
      .object({ port: z.number().int().positive() })
      .safeParse(gateway.address());

    if (!parsedAddress.success) {
      throw new Error("The fake gateway did not bind to a TCP port.");
    }

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-judge-calibration-fail-")
    );

    temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const report = await runEvaluation({
      caseIds: ["lookup-smoke-v1"],
      includeSemanticJudge: true,
      maxModelRequests: 100,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    expect({
      calibrationStatus: report.judgeCalibration?.status,
      codeStatus: report.trials[0]?.codeStatus,
      judgeRequests: report.requestCountsByRole.judge,
      modelRequests: report.modelRequests,
      requestCount,
      semanticStatus: report.trials[0]?.semanticStatus,
      trialStatus: report.trials[0]?.status,
      validation: report.judgeCalibration?.validation,
    }).toStrictEqual({
      calibrationStatus: "failed",
      codeStatus: "passed",
      judgeRequests: 0,
      modelRequests: requestCount,
      requestCount,
      semanticStatus: "not_assessed",
      trialStatus: "not_assessed",
      validation: { passed: 15, total: 16 },
    });
  }, 30_000);

  it("fails a trial when the calibrated judge confirms an unsupported claim", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(
        request,
        response,
        requestCount,
        "judge_unsupported_finding"
      );
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const address = z
      .object({ port: z.number().int().positive() })
      .parse(gateway.address());

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-judge-claim-eval-")
    );

    temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${address.port}/v1`);

    const report = await runEvaluation({
      caseIds: ["lookup-smoke-v1"],
      includeSemanticJudge: true,
      maxModelRequests: 100,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    const judgeExchange = trial?.gatewayExchanges.find(
      ({ role }) => role === "judge"
    );

    if (judgeExchange === undefined) {
      throw new Error("The trial did not record its judge request.");
    }

    const judgeInput = judgeInputFromRequestBody(judgeExchange.requestBody);

    expect({
      actionEventIdsAreNamespaced: judgeInput.actions.every(({ eventId }) =>
        eventId.startsWith("action-event:")
      ),
      actionIdsAreNamespaced: judgeInput.actions.every(({ actionId }) =>
        actionId.startsWith("action:")
      ),
      calibration: report.judgeCalibration?.status,
      codeStatus: trial?.codeStatus,
      evidenceIdsAreNamespaced: judgeInput.evidence.every(({ evidenceId }) =>
        evidenceId.startsWith("evidence:")
      ),
      findingCategories: trial?.semanticFindings.map(
        ({ category }) => category
      ),
      semanticStatus: trial?.semanticStatus,
      status: trial?.status,
    }).toStrictEqual({
      actionEventIdsAreNamespaced: true,
      actionIdsAreNamespaced: true,
      calibration: "passed",
      codeStatus: "passed",
      evidenceIdsAreNamespaced: true,
      findingCategories: ["unsupported_fact"],
      semanticStatus: "failed",
      status: "failed",
    });
  }, 30_000);

  it("invalidates factual contradictions without evidence citations", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(
        request,
        response,
        requestCount,
        "judge_missing_contradiction_evidence"
      );
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const address = z
      .object({ port: z.number().int().positive() })
      .parse(gateway.address());

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-judge-missing-evidence-eval-")
    );

    temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${address.port}/v1`);

    const report = await runEvaluation({
      caseIds: ["lookup-smoke-v1"],
      includeSemanticJudge: true,
      maxModelRequests: 100,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    expect({
      calibration: report.judgeCalibration?.status,
      judgeRequests: report.requestCountsByRole.judge,
      semanticStatus: trial?.semanticStatus,
      status: trial?.status,
      validationErrors: trial?.semanticValidationErrors,
    }).toStrictEqual({
      calibration: "passed",
      judgeRequests: 1,
      semanticStatus: "invalid",
      status: "judge_invalid",
      validationErrors: ["contradiction_missing_evidence_reference"],
    });
  }, 30_000);

  it("rejects an action identifier placed in evidenceIds without retrying", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(
        request,
        response,
        requestCount,
        "judge_action_id_in_evidence"
      );
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const address = z
      .object({ port: z.number().int().positive() })
      .parse(gateway.address());

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-judge-action-as-evidence-eval-")
    );

    temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${address.port}/v1`);

    const report = await runEvaluation({
      caseIds: ["lookup-smoke-v1"],
      includeSemanticJudge: true,
      maxModelRequests: 100,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    const judgeExchange = trial?.gatewayExchanges.find(
      ({ role }) => role === "judge"
    );

    if (judgeExchange === undefined) {
      throw new Error("The trial did not record its judge request.");
    }

    const judgeInput = judgeInputFromRequestBody(judgeExchange.requestBody);
    const [firstAction] = judgeInput.actions;

    if (firstAction === undefined) {
      throw new Error("The judge request did not contain an action.");
    }

    expect({
      actionIdIsNamespaced: firstAction.actionId.startsWith("action:"),
      judgeRequests: report.requestCountsByRole.judge,
      semanticStatus: trial?.semanticStatus,
      status: trial?.status,
      validationErrors: trial?.semanticValidationErrors,
    }).toStrictEqual({
      actionIdIsNamespaced: true,
      judgeRequests: 1,
      semanticStatus: "invalid",
      status: "judge_invalid",
      validationErrors: [`unknown_evidence:${firstAction.actionId}`],
    });
  }, 30_000);

  it("invalidates semantic grading when the judge quote is not in the answer", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(
        request,
        response,
        requestCount,
        "judge_invalid_quote"
      );
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const address = z
      .object({ port: z.number().int().positive() })
      .parse(gateway.address());

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-judge-invalid-eval-")
    );

    temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${address.port}/v1`);

    const report = await runEvaluation({
      caseIds: ["lookup-smoke-v1"],
      includeSemanticJudge: true,
      maxModelRequests: 100,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    expect({
      calibration: report.judgeCalibration?.status,
      codeStatus: trial?.codeStatus,
      judgeRequests: report.requestCountsByRole.judge,
      semanticStatus: trial?.semanticStatus,
      status: trial?.status,
      validationErrors: trial?.semanticValidationErrors,
    }).toStrictEqual({
      calibration: "passed",
      codeStatus: "passed",
      judgeRequests: 1,
      semanticStatus: "invalid",
      status: "judge_invalid",
      validationErrors: ["quote_not_found:lookup-smoke-v1-turn-1"],
    });
  }, 30_000);

  it("keeps undelivered required evidence inconclusive", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(request, response, requestCount);
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const address = z
      .object({ port: z.number().int().positive() })
      .parse(gateway.address());

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-judge-undelivered-evidence-eval-")
    );

    const caseDirectory = path.join(workspace, "cases");
    const evidenceDirectory = path.join(workspace, "evidence");

    temporaryDirectories.push(workspace);
    mkdirSync(caseDirectory, { recursive: true });
    mkdirSync(evidenceDirectory, { recursive: true });

    const sourceCase = evaluationCaseSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(
            process.cwd(),
            "evals/cases/lookup-identity-unavailable-v1.json"
          ),
          "utf-8"
        )
      )
    );

    const evidenceContents = readFileSync(
      path.join(process.cwd(), "evals/evidence/lookup-smoke-evidence-v1.json"),
      "utf-8"
    );

    const caseWithRequiredEvidence = {
      ...sourceCase,
      contract: {
        ...sourceCase.contract,
        requiredEvidence: [
          {
            field: "currentAbility",
            provider: "fm" as const,
            sourceId: "fm-demo-01",
            value: 132,
          },
        ],
      },
    };

    writeFileSync(
      path.join(caseDirectory, "lookup-identity-unavailable-v1.json"),
      JSON.stringify(caseWithRequiredEvidence)
    );
    writeFileSync(
      path.join(evidenceDirectory, "lookup-smoke-evidence-v1.json"),
      evidenceContents
    );

    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${address.port}/v1`);

    const report = await runEvaluation({
      caseDirectory,
      caseIds: ["lookup-identity-unavailable-v1"],
      evidenceDirectory,
      includeSemanticJudge: true,
      maxModelRequests: 100,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    expect({
      judgeRequests: report.requestCountsByRole.judge,
      semanticStatus: trial?.semanticStatus,
      validationErrors: trial?.semanticValidationErrors,
    }).toStrictEqual({
      judgeRequests: 1,
      semanticStatus: "inconclusive",
      validationErrors: ["required_evidence_not_delivered"],
    });
  }, 30_000);

  it("enforces one total request cap across agent and judge calibration roles", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(request, response, requestCount);
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const parsedAddress = z
      .object({ port: z.number().int().positive() })
      .safeParse(gateway.address());

    if (!parsedAddress.success) {
      throw new Error("The fake gateway did not bind to a TCP port.");
    }

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-judge-budget-eval-")
    );

    temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const report = await runEvaluation({
      caseIds: ["lookup-smoke-v1"],
      includeSemanticJudge: true,
      maxModelRequests: 34,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    expect({
      calibrationStatus: report.judgeCalibration?.status,
      deniedCalibration: report.deniedRequestsByRole.calibration,
      deniedRequests: report.deniedRequests,
      forwardedCalibration: report.requestCountsByRole.calibration,
      modelRequests: report.modelRequests,
      reportStatus: report.status,
      requestCount,
      semanticStatus: report.trials[0]?.semanticStatus,
      trialStatus: report.trials[0]?.status,
    }).toStrictEqual({
      calibrationStatus: "incomplete",
      deniedCalibration: 1,
      deniedRequests: 1,
      forwardedCalibration: 31,
      modelRequests: 34,
      reportStatus: "partial",
      requestCount: 34,
      semanticStatus: "not_assessed",
      trialStatus: "not_assessed",
    });
  }, 30_000);

  it("covers ambiguous teams, unmapped roster members, and saved-squad refinements", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(request, response, requestCount);
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const parsedAddress = z
      .object({ port: z.number().int().positive() })
      .safeParse(gateway.address());

    if (!parsedAddress.success) {
      throw new Error("The fake gateway did not bind to a TCP port.");
    }

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-team-boundary-eval-")
    );

    temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const caseIds = [
      "team-rec-synthetic-v1",
      "team-rec-ambiguous-team-synthetic-v1",
      "team-rec-unmapped-roster-synthetic-v1",
      "team-rec-refine-synthetic-v1",
    ];

    const report = await runEvaluation({
      caseIds,
      maxModelRequests: 120,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    expect(
      report.trials.flatMap((trial) =>
        trial.checks
          .filter(({ status }) => status === "failed")
          .map(({ actual, expected, id }) => ({
            actual,
            caseId: trial.caseId,
            expected,
            id,
          }))
      )
    ).toStrictEqual([]);

    const ambiguousTeamTrial = report.trials.find(
      ({ caseId }) => caseId === "team-rec-ambiguous-team-synthetic-v1"
    );

    const noProfileTrial = report.trials.find(
      ({ caseId }) => caseId === "team-rec-unmapped-roster-synthetic-v1"
    );

    const refinementTrial = report.trials.find(
      ({ caseId }) => caseId === "team-rec-refine-synthetic-v1"
    );

    expect({
      ambiguousTeamClarification:
        ambiguousTeamTrial?.observation.turns[0]?.clarificationAnswers,
      ambiguousTeamId: ambiguousTeamTrial?.observation.actionEvents.find(
        ({ input, kind, name }) =>
          name === "api_football.get_squad" &&
          kind === "attempted" &&
          input !== null
      )?.input,
      noProfileOutcome: noProfileTrial?.observation.outcomeStatus,
      noProfileRecommendationCalls:
        noProfileTrial?.observation.actionEvents.filter(
          ({ name }) => name === "recommend_team_player_candidates"
        ).length,
      refinementFetchCount: refinementTrial?.observation.actionEvents.filter(
        ({ kind, name }) =>
          kind === "returned" && name === "api_football.get_squad"
      ).length,
      refinementRecommendationCalls:
        refinementTrial?.observation.actionEvents.filter(
          ({ kind, name }) =>
            kind === "returned" && name === "recommend_team_player_candidates"
        ).length,
    }).toStrictEqual({
      ambiguousTeamClarification: [{ kind: "team", value: "2" }],
      ambiguousTeamId: { teamId: 902 },
      noProfileOutcome: "team_roster_member_unmapped",
      noProfileRecommendationCalls: 0,
      refinementFetchCount: 1,
      refinementRecommendationCalls: 2,
    });
  }, 25_000);

  it("runs prepared real team cases or reports missing local preparation", async () => {
    const caseIds = [
      "team-real-madrid-stc-dev-v1",
      "team-real-madrid-ca-filter-dev-v1",
      "team-real-madrid-roster-gap-dev-v1",
      "team-real-madrid-refine-dev-v1",
      "team-bayer-leverkusen-stc-heldout-v1",
      "team-bayer-leverkusen-roster-gap-heldout-v1",
      "team-bayer-leverkusen-ca-filter-heldout-v1",
      "team-bayer-leverkusen-pa-filter-heldout-v1",
    ];

    const evidenceDirectory = path.join(process.cwd(), ".data/evals/evidence");

    const sourcePreview = previewEvaluation({
      caseIds,
      evidenceDirectory,
      mode: "smoke",
    });

    const expectedEvidenceStatuses = caseIds.map((caseId) => {
      const bundleId = caseId.startsWith("team-real-madrid-")
        ? "team-real-madrid-development-v1"
        : "team-bayer-leverkusen-heldout-v1";

      return existsSync(path.join(evidenceDirectory, `${bundleId}.json`))
        ? "ready"
        : "requires_preparation";
    });

    expect(
      sourcePreview.cases.map(({ evidenceStatus }) => evidenceStatus)
    ).toStrictEqual(expectedEvidenceStatuses);

    const bundlesReady = expectedEvidenceStatuses.every(
      (evidenceStatus) => evidenceStatus === "ready"
    );

    if (!bundlesReady) {
      return;
    }

    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(request, response, requestCount);
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const parsedAddress = z
      .object({ port: z.number().int().positive() })
      .safeParse(gateway.address());

    if (!parsedAddress.success) {
      throw new Error("The fake gateway did not bind to a TCP port.");
    }

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-real-team-eval-")
    );

    temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const { freezeFingerprint } = previewEvaluation({
      caseIds,
      evidenceDirectory,
      mode: "smoke",
    });

    if (freezeFingerprint === null) {
      throw new Error("The real team fixture needs a freeze fingerprint.");
    }

    const report = await runEvaluation({
      caseIds,
      evidenceDirectory,
      freezeId: freezeFingerprint,
      maxModelRequests: 400,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "workspace"),
    });

    expect({
      cases: report.caseCount,
      preflightErrors: report.preflightErrors,
      runStatus: report.status,
      trialCount: report.trials.length,
    }).toStrictEqual({
      cases: 8,
      preflightErrors: [],
      runStatus: "completed",
      trialCount: 8,
    });

    const failedChecks = report.trials.flatMap((trial) =>
      trial.checks
        .filter(({ status }) => status === "failed")
        .map(({ actual, expected, id }) => ({
          actual,
          caseId: trial.caseId,
          expected,
          id,
        }))
    );

    expect(failedChecks).toStrictEqual([]);

    expect(
      report.trials.map(({ observation }) => observation.outcomeStatus)
    ).toStrictEqual(
      Array.from({ length: 8 }, () => "team_roster_member_unmapped")
    );

    expect(
      report.trials.flatMap(({ observation }) =>
        observation.actionEvents.filter(
          ({ name }) => name === "recommend_team_player_candidates"
        )
      )
    ).toStrictEqual([]);
  }, 45_000);

  it("records malformed model tool arguments without claiming a search ran", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(
        request,
        response,
        requestCount,
        "malformed_search"
      );
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const parsedAddress = z
      .object({ port: z.number().int().positive() })
      .safeParse(gateway.address());

    if (!parsedAddress.success) {
      throw new Error("The fake gateway did not bind to a TCP port.");
    }

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-schema-eval-")
    );

    temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const caseDirectory = path.join(workspace, "cases");
    const evidenceDirectory = path.join(workspace, "evidence");
    mkdirSync(caseDirectory, { recursive: true });
    mkdirSync(evidenceDirectory, { recursive: true });

    const caseContents = readFileSync(
      path.join(process.cwd(), "evals/cases/lookup-smoke-v1.json"),
      "utf-8"
    ).replace(
      "请查一下 Elias Demo 的 FM 画像和表现资料。",
      "MALFORMED_TOOL_ARGS_TEST: 请查一下 Elias Demo 的 FM 画像和表现资料。"
    );

    const evidenceContents = readFileSync(
      path.join(process.cwd(), "evals/evidence/lookup-smoke-evidence-v1.json"),
      "utf-8"
    );

    writeFileSync(
      path.join(caseDirectory, "lookup-smoke-v1.json"),
      caseContents
    );
    writeFileSync(
      path.join(evidenceDirectory, "lookup-smoke-evidence-v1.json"),
      evidenceContents
    );

    const report = await runEvaluation({
      caseDirectory,
      caseIds: ["lookup-smoke-v1"],
      evidenceDirectory,
      maxModelRequests: 10,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    expect({
      invalidCalls: trial?.observation.conversationContext.flatMap(
        ({ invalidToolCalls }) => invalidToolCalls.map(({ name }) => name)
      ),
      modelRequests: report.modelRequests,
      requestCount,
      schemaRejectedEvents: trial?.observation.actionEvents
        .flatMap(({ kind, name }) =>
          kind === "schema_rejected" ? [`${name}:${kind}`] : []
        )
        .toSorted(),
      searchToolMessages: trial?.observation.toolMessages.length,
    }).toStrictEqual({
      invalidCalls: ["search_player_records"],
      modelRequests: 2,
      requestCount: 2,
      schemaRejectedEvents: ["search_player_records:schema_rejected"],
      searchToolMessages: 0,
    });
  }, 15_000);

  it("distinguishes a requested but guard-blocked lookup from completed searches", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(request, response, requestCount, "loop_search");
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const parsedAddress = z
      .object({ port: z.number().int().positive() })
      .safeParse(gateway.address());

    if (!parsedAddress.success) {
      throw new Error("The fake gateway did not bind to a TCP port.");
    }

    const workspace = mkdtempSync(
      path.join(tmpdir(), "tactiscout-guard-eval-")
    );

    temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv(
      "OPENAI_BASE_URL",
      `http://127.0.0.1:${parsedAddress.data.port}/v1`
    );

    const report = await runEvaluation({
      caseIds: ["lookup-smoke-v1"],
      maxModelRequests: 10,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "run-data"),
    });

    const [trial] = report.trials;

    const searchEvents =
      trial?.observation.actionEvents.filter(
        ({ name }) => name === "search_player_records"
      ) ?? [];

    expect({
      attempted: searchEvents.filter(({ kind }) => kind === "attempted").length,
      blocked: searchEvents.filter(({ kind }) => kind === "blocked").length,
      modelRequests: report.modelRequests,
      requestCount,
      requested: searchEvents.filter(({ kind }) => kind === "requested").length,
      returned: searchEvents.filter(({ kind }) => kind === "returned").length,
      toolMessageStatuses: trial?.observation.toolMessages.map(
        ({ status }) => status
      ),
    }).toStrictEqual({
      attempted: 3,
      blocked: 1,
      modelRequests: 5,
      requestCount: 5,
      requested: 4,
      returned: 3,
      toolMessageStatuses: ["success", "success", "success", "error"],
    });
  }, 15_000);

  it("runs prepared private real-source cases or reports preparation needs", async () => {
    let requestCount = 0;

    const gateway = createServer((request, response) => {
      requestCount += 1;
      void handleGatewayRequest(request, response, requestCount);
    });

    servers.push(gateway);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");

    const { port } = z
      .object({ port: z.number().int().positive() })
      .parse(gateway.address());

    const workspace = mkdtempSync(path.join(tmpdir(), "tactiscout-real-eval-"));

    temporaryDirectories.push(workspace);
    vi.stubEnv("OPENAI_API_KEY", "eval-test-key");
    vi.stubEnv("OPENAI_MODEL", "eval-fixture-model");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${port}/v1`);

    const caseIds = [
      "lookup-saka-real-v1",
      "lookup-haaland-real-v1",
      "lookup-bellingham-confirmation-real-v1",
      "lookup-mbappe-confirmation-real-v1",
      "lookup-kane-real-heldout-v1",
      "lookup-raphinha-confirmation-heldout-v1",
      "lookup-kane-followup-heldout-v1",
      "lookup-van-dijk-followup-heldout-v1",
      "compare-saka-haaland-real-v1",
      "compare-saka-foden-real-v1",
      "compare-haaland-foden-real-v1",
      "compare-saka-bellingham-cross-scope-real-v1",
      "compare-kane-musiala-heldout-v1",
      "compare-kane-van-dijk-cross-scope-heldout-v1",
      "compare-add-raphinha-heldout-v1",
      "compare-season-add-van-dijk-heldout-v1",
      "recommend-haaland-real-v1",
      "recommend-kane-real-v1",
      "recommend-ca-empty-real-v1",
      "recommend-add-haaland-kane-real-v1",
      "recommend-isak-real-heldout-v1",
      "recommend-ca-empty-real-heldout-v1",
      "recommend-add-isak-watkins-heldout-v1",
      "recommend-refine-young-isak-heldout-v1",
    ];

    const evidenceDirectory = path.join(process.cwd(), ".data/evals/evidence");

    const evidencePreview = previewEvaluation({
      caseIds,
      evidenceDirectory,
      mode: "smoke",
    });

    expect(
      evidencePreview.cases.every(
        ({ evidenceStatus }) =>
          evidenceStatus === "ready" ||
          evidenceStatus === "requires_preparation"
      )
    ).toBeTruthy();

    const requiredBundles = [
      "lookup-real-development-v1",
      "lookup-real-heldout-v1",
      "recommendation-real-development-v1",
      "recommendation-real-heldout-v1",
    ];

    const bundlesReady = requiredBundles.every((bundleId) =>
      existsSync(path.join(evidenceDirectory, `${bundleId}.json`))
    );

    if (!bundlesReady) {
      return;
    }

    const { freezeFingerprint } = evidencePreview;

    if (freezeFingerprint === null) {
      throw new Error(
        "The real-source fixture test needs a freeze fingerprint."
      );
    }

    const report = await runEvaluation({
      caseIds,
      evidenceDirectory,
      freezeId: freezeFingerprint,
      maxModelRequests: 250,
      mode: "smoke",
      outputDirectory: path.join(workspace, "reports"),
      workspaceDirectory: path.join(workspace, "workspace"),
    });

    const missingSeasonTrial = report.trials.find(
      ({ caseId }) => caseId === "lookup-mbappe-confirmation-real-v1"
    );

    const notFoundTrial = report.trials.find(
      ({ caseId }) => caseId === "lookup-kane-followup-heldout-v1"
    );

    const comparisonTrial = report.trials.find(
      ({ caseId }) => caseId === "compare-saka-haaland-real-v1"
    );

    const resetComparisonTrial = report.trials.find(
      ({ caseId }) => caseId === "compare-season-add-van-dijk-heldout-v1"
    );

    const resetTurn = resetComparisonTrial?.observation.turns.at(-1);

    const recommendationTrials = report.trials.filter(
      ({ workflow }) => workflow === "player_recommendation"
    );

    const recommendationFailures = recommendationTrials.flatMap((trial) =>
      trial.checks
        .filter(({ status }) => status === "failed")
        .map(({ actual, expected, id }) => ({
          actual,
          caseId: trial.caseId,
          expected,
          id,
        }))
    );

    if (recommendationFailures.length > 0) {
      throw new Error(JSON.stringify(recommendationFailures, null, 2));
    }

    expect({
      allPreparedFromRealSources: report.trials.every(
        ({ evidenceSourceMetadata, origin }) =>
          origin === "real" && evidenceSourceMetadata !== null
      ),
      caseCount: report.caseCount,
      comparisonActionStatus: comparisonTrial?.observation.actionEvents.find(
        ({ kind, name }) =>
          kind === "returned" && name === "compare_player_records"
      )?.outcome,
      comparisonCaseChecks: report.trials
        .filter(({ workflow }) => workflow === "player_comparison")
        .map(({ caseId, codeStatus }) => ({ caseId, codeStatus })),
      comparisonCodeStatus: comparisonTrial?.codeStatus,
      comparisonWorkflowCount: report.trials.filter(
        ({ workflow }) => workflow === "player_comparison"
      ).length,
      fakeGatewayRequests: requestCount,
      finalNotFoundIdentityStatus:
        notFoundTrial?.observation.players[0]?.resolutionStatus,
      finalNotFoundOutcome: notFoundTrial?.observation.outcomeStatus,
      freshComparisonCodeStatus: resetComparisonTrial?.codeStatus,
      freshComparisonConstraints: resetTurn?.effectiveConstraints,
      freshComparisonParticipants: resetTurn?.players.map(
        ({ mention }) => mention
      ),
      freshComparisonToolCount:
        resetComparisonTrial?.observation.actionEvents.filter(
          ({ kind, name }) =>
            kind === "returned" && name === "compare_player_records"
        ).length,
      missingSeasonActionOutcome:
        missingSeasonTrial?.observation.actionEvents.find(
          ({ kind, name }) =>
            kind === "returned" && name === "search_player_records"
        )?.outcome,
      missingSeasonStatus: missingSeasonTrial?.status,
      modelRequests: report.modelRequests,
      preflightErrors: report.preflightErrors,
      previousLookupPreserved: notFoundTrial?.checks.find(
        ({ id }) => id === "active-lookup-preserved"
      )?.status,
      recommendationCaseChecks: recommendationTrials.map(
        ({ caseId, codeStatus, status }) => ({ caseId, codeStatus, status })
      ),
      recommendationWorkflowCount: recommendationTrials.length,
      runStatus: report.status,
      savedResultReuseTurns: report.trials
        .flatMap(({ observation }) => observation.turns)
        .filter(({ reuse }) => reuse?.kind === "saved_lookup_result").length,
      trialCount: report.trials.length,
      workflowCount: report.trials.filter(
        ({ workflow }) => workflow === "player_lookup"
      ).length,
    }).toStrictEqual({
      allPreparedFromRealSources: true,
      caseCount: 24,
      comparisonActionStatus: "ready",
      comparisonCaseChecks: [
        {
          caseId: "compare-saka-haaland-real-v1",
          codeStatus: "passed",
        },
        {
          caseId: "compare-saka-foden-real-v1",
          codeStatus: "passed",
        },
        {
          caseId: "compare-haaland-foden-real-v1",
          codeStatus: "passed",
        },
        {
          caseId: "compare-saka-bellingham-cross-scope-real-v1",
          codeStatus: "passed",
        },
        {
          caseId: "compare-kane-musiala-heldout-v1",
          codeStatus: "passed",
        },
        {
          caseId: "compare-kane-van-dijk-cross-scope-heldout-v1",
          codeStatus: "passed",
        },
        {
          caseId: "compare-add-raphinha-heldout-v1",
          codeStatus: "passed",
        },
        {
          caseId: "compare-season-add-van-dijk-heldout-v1",
          codeStatus: "passed",
        },
      ],
      comparisonCodeStatus: "passed",
      comparisonWorkflowCount: 8,
      fakeGatewayRequests: requestCount,
      finalNotFoundIdentityStatus: "not_found",
      finalNotFoundOutcome: null,
      freshComparisonCodeStatus: "passed",
      freshComparisonConstraints: [{ name: "season", value: "2026/27" }],
      freshComparisonParticipants: ["Harry Kane", "Virgil van Dijk"],
      freshComparisonToolCount: 3,
      missingSeasonActionOutcome: "not_found",
      missingSeasonStatus: "not_assessed",
      modelRequests: requestCount,
      preflightErrors: [],
      previousLookupPreserved: "passed",
      recommendationCaseChecks: [
        "recommend-haaland-real-v1",
        "recommend-kane-real-v1",
        "recommend-ca-empty-real-v1",
        "recommend-add-haaland-kane-real-v1",
        "recommend-isak-real-heldout-v1",
        "recommend-ca-empty-real-heldout-v1",
        "recommend-add-isak-watkins-heldout-v1",
        "recommend-refine-young-isak-heldout-v1",
      ].map((caseId) => ({
        caseId,
        codeStatus: "passed",
        status: "not_assessed",
      })),
      recommendationWorkflowCount: 8,
      runStatus: "completed",
      savedResultReuseTurns: 2,
      trialCount: 24,
      workflowCount: 8,
    });
  }, 45_000);
});
