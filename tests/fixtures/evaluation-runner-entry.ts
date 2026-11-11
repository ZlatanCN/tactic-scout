import { readFileSync, rmSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import path from "node:path";

import { vi } from "vitest";
import { z } from "zod/v4";

import type { loadEvaluationCases } from "../../evals/benchmark.js";
import {
  availableResultKindSchema,
  evaluationCaseSchema,
} from "../../evals/contracts.js";
import type {
  EvaluationCase,
  EvaluationTrialReport,
} from "../../evals/contracts.js";
import { runEvaluation as runEvaluationWithRuntime } from "../../evals/runner.js";
import type { RunEvaluationOptions } from "../../evals/runner.js";
import { testModelContextProfile } from "./model-context.js";

const runEvaluation = async (options: RunEvaluationOptions) =>
  await runEvaluationWithRuntime({
    ...options,
    modelContextProfile: testModelContextProfile,
  });

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
  | "judge_invalid_quote_repaired"
  | "judge_invalid_quote"
  | "judge_missing_contradiction_evidence"
  | "judge_self_denying_contradiction"
  | "judge_supported_contradiction"
  | "judge_unsupported_finding"
  | "judge_wrong_anchor"
  | "judge_invalid_quote_repaired_after_transient"
  | "judge_transient_server_error"
  | "malformed_extraction"
  | "malformed_search"
  | "normal"
  | "season_team_abstention"
  | "loop_search";

type FakeGatewayState = {
  judgeFailuresRemaining: number;
  judgeRequests: number;
};

const requestContextSchema = z.looseObject({ currentMessage: z.string() });

const judgeRequestSchema = z.object({
  actions: z.array(
    z.looseObject({
      actionId: z.string(),
      eventId: z.string(),
      name: z.string().optional(),
      outcome: z.string().nullable().optional(),
      turnId: z.string().optional(),
    })
  ),
  caseId: z.string(),
  contract: z.looseObject({
    requiredFacts: z.array(z.object({ factId: z.string() })),
  }),
  evidence: z.array(z.looseObject({ evidenceId: z.string() })),
  teamRosterCoverage: z.json().nullable().optional(),
  turns: z.array(
    z.looseObject({
      assistantMessages: z.array(z.string()),
      availableResultKinds: z.array(availableResultKindSchema).nullable(),
      turnId: z.string(),
    })
  ),
  validationFeedback: z.array(z.string()).optional(),
});

const judgeInputFromRequestBody = (requestBody: string) => {
  const body = openAiRequestSchema.parse(JSON.parse(requestBody));

  const userMessage = body.messages
    ?.toReversed()
    .find(({ role }) => role === "user");

  const content = z.string().parse(userMessage?.content);

  return judgeRequestSchema.parse(JSON.parse(content));
};

const evaluationCheckStatus = (
  trial: EvaluationTrialReport | undefined,
  checkId: string
): EvaluationTrialReport["checks"][number]["status"] | null =>
  trial?.checks.find(({ id }) => id === checkId)?.status ?? null;

const judgeSystemPromptFromRequest = (
  body: z.output<typeof openAiRequestSchema>
): string => {
  const systemMessage = body.messages?.find(({ role }) => role === "system");
  const parsedContent = z.string().safeParse(systemMessage?.content);

  return parsedContent.success ? parsedContent.data : "";
};

const judgeBusinessRules = [
  "2001-09-05",
  "5 September 2001",
  "explicit start year 2024 is the 2024/25 season",
  "techniqueRaw and dribblingRaw",
  "maximum season_start_year in local snapshots",
  "filters.resultLimit is the requested player-list cap",
  "A non-null canonicalIdentityId repeated across resolved turn participants",
  "FM currentAbility means CA or 当前能力",
  "numeric value rounded to the displayed decimal places",
];

const promptRuleFailureForAnchor = (
  caseId: string,
  systemPrompt: string
): string | null => {
  if (
    caseId === "correct-paraphrase-date-normalization-v7" &&
    !judgeBusinessRules.every((rule) => systemPrompt.includes(rule))
  ) {
    return "factual_contradiction";
  }

  if (
    caseId === "false-execution-claim-03-v5" &&
    !systemPrompt.includes("cache_hit")
  ) {
    return "factual_contradiction";
  }

  if (
    (caseId === "false-execution-claim-01-v5" ||
      caseId === "false-execution-claim-02-v5") &&
    !systemPrompt.includes("no matching current-turn action")
  ) {
    return "factual_contradiction";
  }

  if (
    caseId === "false-execution-claim-04-v5" &&
    (!systemPrompt.includes(
      "Requested events record proposed tool arguments"
    ) ||
      !systemPrompt.includes("no competition filter was supplied"))
  ) {
    return "factual_contradiction";
  }

  if (
    caseId === "correct-paraphrase-result-retained-after-failure-v8" &&
    (!systemPrompt.includes("data_unavailable") ||
      !systemPrompt.includes("availableResultKinds") ||
      !systemPrompt.includes("explicitly historical statement"))
  ) {
    return "factual_contradiction";
  }

  return null;
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
    readFileSync(path.join(process.cwd(), "evals/anchors/v9.json"), "utf-8")
  )
).anchors;

const contradictionEvidenceIds = (
  input: z.output<typeof judgeRequestSchema>,
  mode: FakeGatewayMode,
  firstAction:
    | z.output<typeof judgeRequestSchema>["actions"][number]
    | undefined
): string[] => {
  if (
    mode === "judge_self_denying_contradiction" ||
    mode === "judge_supported_contradiction"
  ) {
    const evidenceId = input.evidence[0]?.evidenceId;

    return evidenceId === undefined ? [] : [evidenceId];
  }

  return mode === "judge_action_id_in_evidence" && firstAction !== undefined
    ? [firstAction.actionId]
    : [];
};

const contradictionExplanation = (mode: FakeGatewayMode): string => {
  if (mode === "judge_self_denying_contradiction") {
    return "The evidence supports the answer and does not conflict with it.";
  }

  if (mode === "judge_supported_contradiction") {
    return "The answer matches the source and is supported by the evidence.";
  }

  return "The controlled judge provides a test finding.";
};

const judgeOverrideForRequest = (
  input: z.output<typeof judgeRequestSchema>,
  mode: FakeGatewayMode,
  firstTurn: z.output<typeof judgeRequestSchema>["turns"][number] | undefined,
  firstAction:
    | z.output<typeof judgeRequestSchema>["actions"][number]
    | undefined
) => {
  if (
    mode === "judge_invalid_quote_repaired" &&
    (input.validationFeedback?.length ?? 0) > 0
  ) {
    return {
      findings: [],
      requiredFactCoverage: input.contract.requiredFacts.map(({ factId }) => ({
        factId,
        status: "covered" as const,
      })),
    };
  }

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

  if (
    mode === "judge_invalid_quote" ||
    mode === "judge_invalid_quote_repaired" ||
    mode === "judge_unsupported_finding"
  ) {
    finding = {
      actionIds: [],
      category: "unsupported_fact" as const,
      evidenceIds: [],
      explanation: "The controlled judge provides a test finding.",
      quote:
        mode === "judge_unsupported_finding"
          ? (firstTurn.assistantMessages[0] ?? "")
          : "This quotation is absent from the answer.",
      turnId: firstTurn.turnId,
    };
  } else if (
    mode === "judge_action_id_in_evidence" ||
    mode === "judge_missing_contradiction_evidence" ||
    mode === "judge_self_denying_contradiction" ||
    mode === "judge_supported_contradiction"
  ) {
    finding = {
      actionIds: [],
      category: "factual_contradiction" as const,
      evidenceIds: contradictionEvidenceIds(input, mode, firstAction),
      explanation: contradictionExplanation(mode),
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

const erlingHaalandName = "Erling Haaland";
const eliasDemoName = "Elias Demo";
const syntheticMidfielderName = "Synthetic Midfielder";
const syntheticReferenceName = "Synthetic Reference";
const syntheticWingerName = "Synthetic Winger";

const fixturePlayerMentions = [
  { lookupName: erlingHaalandName, mention: "哈兰德", text: "哈兰德" },
  {
    lookupName: "Kylian Mbappe",
    mention: "Kylian Mbappé",
    text: "Kylian Mbappé",
  },
  { lookupName: null, mention: "Bukayo Saka", text: "Bukayo Saka" },
  {
    lookupName: null,
    mention: erlingHaalandName,
    text: erlingHaalandName,
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
    mention: syntheticMidfielderName,
    text: syntheticMidfielderName,
  },
  {
    lookupName: null,
    mention: syntheticWingerName,
    text: syntheticWingerName,
  },
  {
    lookupName: null,
    mention: syntheticReferenceName,
    text: syntheticReferenceName,
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
  { lookupName: null, mention: eliasDemoName, text: eliasDemoName },
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

const recommendationAnswerForRequest = (
  body: z.output<typeof openAiRequestSchema>
): string | null => {
  const systemPrompt = body.messages?.find(({ role }) => role === "system");
  const promptText = z.string().safeParse(systemPrompt?.content);

  if (
    !promptText.success ||
    !promptText.data.includes("当前请求是 FM 球员能力推荐")
  ) {
    return null;
  }

  const userMessage = body.messages
    ?.toReversed()
    .find(({ role }) => role === "user");

  const userText = z.string().safeParse(userMessage?.content);

  if (!userText.success) {
    return "推荐结果已就绪。";
  }

  const resultMarker = "结构化工具结果：";
  const resultStart = userText.data.lastIndexOf(resultMarker);

  if (resultStart === -1) {
    return "推荐结果已就绪。";
  }

  const result = z
    .looseObject({
      currentCandidates: z.array(
        z.looseObject({ fmId: z.string(), name: z.string() })
      ),
      references: z.array(
        z.looseObject({
          currentAbility: z.number().nullable(),
          fmId: z.string(),
          name: z.string(),
          potentialAbility: z.number().nullable(),
        })
      ),
    })
    .safeParse(
      JSON.parse(userText.data.slice(resultStart + resultMarker.length))
    );

  const references = result.success ? result.data.references : [];

  const currentCandidates = result.success ? result.data.currentCandidates : [];

  const reference = references.find(({ fmId }) => fmId === "fm-amb-b");

  const alternateProfileReturned = currentCandidates.some(
    ({ fmId }) => fmId === "fm-amb-a"
  );

  if (
    reference !== undefined &&
    !alternateProfileReturned &&
    promptText.data.includes("为每个所选参考画像说明 FM ID、CA 和 PA")
  ) {
    const candidateNames = currentCandidates.map(({ name }) => name).join("、");

    return `参考画像 ${reference.name}（FM ID ${reference.fmId}）：CA ${reference.currentAbility}，PA ${reference.potentialAbility}。推荐候选：${candidateNames}。`;
  }

  return "推荐结果已就绪。";
};

const isJudgeRequest = (body: z.output<typeof openAiRequestSchema>): boolean =>
  body.messages?.some(({ content }) => {
    const text = z.string().safeParse(content);

    return (
      text.success &&
      text.data.includes("automated reviewer for a football scouting assistant")
    );
  }) ?? false;

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
        text.data.includes("team 字段只表示对应赛事和赛季表现记录中的球队") &&
        text.data.includes(
          "不要使用“当前俱乐部”或“Current club”作为标题或字段名"
        )
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

const expectedCategoriesForJudgeRequest = (
  body: z.output<typeof openAiRequestSchema>,
  input: z.output<typeof judgeRequestSchema>,
  mode: FakeGatewayMode,
  anchor: z.output<typeof judgeAnchorPackSchema>["anchors"][number] | undefined
): string[] => {
  if (
    mode === "judge_wrong_anchor" &&
    anchor?.anchorId === "factual-contradiction-05-v5"
  ) {
    return [];
  }

  const promptRuleFailureCategory = promptRuleFailureForAnchor(
    input.caseId,
    judgeSystemPromptFromRequest(body)
  );

  if (promptRuleFailureCategory !== null) {
    return [promptRuleFailureCategory];
  }

  const requiresSavedLookupState =
    input.caseId === "correct-paraphrase-07-v5" ||
    input.caseId === "correct-paraphrase-08-v5";

  if (
    requiresSavedLookupState &&
    !(input.turns[0]?.availableResultKinds ?? []).includes("player_lookup")
  ) {
    return ["unsupported_fact"];
  }

  return anchor?.expectedCategories ?? [];
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

  const expectedCategories = expectedCategoriesForJudgeRequest(
    body,
    input,
    mode,
    anchor
  );

  const [firstTurn] = input.turns;
  const [firstEvidence] = input.evidence;
  const [firstAction] = input.actions;

  const overridden = judgeOverrideForRequest(
    input,
    mode === "judge_invalid_quote_repaired_after_transient"
      ? "judge_invalid_quote_repaired"
      : mode,
    firstTurn,
    firstAction
  );

  if (overridden !== null) {
    return overridden;
  }

  if (input.caseId === "lookup-identity-unavailable-v1") {
    const identityFailureWasObserved = input.actions.some(
      ({ actionId, eventId, name, outcome, turnId }) =>
        [
          name === "resolve_player_identity",
          outcome === "data_unavailable",
          turnId === "lookup-identity-unavailable-v1-turn-1",
          actionId.startsWith("action:"),
          eventId.startsWith("action-event:"),
        ].every(Boolean)
    );

    const [turn] = input.turns;

    return {
      findings:
        identityFailureWasObserved || turn === undefined
          ? []
          : [
              {
                actionIds: [],
                category: "unsupported_fact",
                evidenceIds: [],
                explanation:
                  "The judge was not supplied the current identity lookup outcome.",
                quote: turn.assistantMessages[0] ?? "",
                turnId: turn.turnId,
              },
            ],
      requiredFactCoverage: input.contract.requiredFacts.map(({ factId }) => ({
        factId,
        status: "covered" as const,
      })),
    };
  }

  if (input.caseId === "compare-season-resume-add-synthetic-v1") {
    const lastTurn = input.turns.at(-1);

    const comparisonRemainsAvailable =
      lastTurn?.availableResultKinds?.includes("player_comparison") === true;

    return {
      findings: comparisonRemainsAvailable
        ? []
        : [
            {
              actionIds: [],
              category: "unsupported_fact",
              evidenceIds: [],
              explanation:
                "No active comparison state was observed after the failed turn.",
              quote: "此前已完成的结果仍保留。",
              turnId: lastTurn?.turnId ?? "missing-final-turn",
            },
          ],
      requiredFactCoverage: input.contract.requiredFacts.map(({ factId }) => ({
        factId,
        status: "covered" as const,
      })),
    };
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

const shouldFailTransientJudgeRequest = (
  mode: FakeGatewayMode,
  state: FakeGatewayState | undefined,
  judgeRequestIndex: number
): boolean => {
  if (state === undefined || state.judgeFailuresRemaining === 0) {
    return false;
  }

  if (mode === "judge_transient_server_error") {
    return true;
  }

  return (
    mode === "judge_invalid_quote_repaired_after_transient" &&
    judgeRequestIndex === 33
  );
};

const respondToJudgeRequest = (
  body: z.output<typeof openAiRequestSchema>,
  response: ServerResponse,
  callNumber: number,
  mode: FakeGatewayMode,
  state: FakeGatewayState | undefined,
  toolNames: string[]
): boolean => {
  if (
    !isJudgeRequest(body) &&
    !toolNames.includes("evaluate_scouting_answer")
  ) {
    return false;
  }

  const judgeRequestIndex = state?.judgeRequests ?? 0;

  if (state !== undefined) {
    state.judgeRequests += 1;
  }

  const shouldFailTransiently = shouldFailTransientJudgeRequest(
    mode,
    state,
    judgeRequestIndex
  );

  if (shouldFailTransiently) {
    if (state !== undefined) {
      state.judgeFailuresRemaining -= 1;
    }

    response.writeHead(502, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        error: {
          code: "server_error",
          message: "temporary judge gateway failure",
          type: "api_error",
        },
      })
    );

    return true;
  }

  sendJudgeResponse(
    response,
    callNumber,
    body,
    judgeArgumentsFromRequest(
      body,
      mode === "judge_invalid_quote_repaired_after_transient"
        ? "judge_invalid_quote_repaired"
        : mode
    )
  );

  return true;
};

const handleGatewayRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  callNumber: number,
  mode: FakeGatewayMode = "normal",
  state?: FakeGatewayState
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

    const judgeHandled = respondToJudgeRequest(
      body,
      response,
      callNumber,
      mode,
      state,
      toolNames
    );

    if (judgeHandled) {
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

    const recommendationAnswer = recommendationAnswerForRequest(body);

    if (recommendationAnswer !== null) {
      sendCompletion(
        response,
        callNumber,
        { content: recommendationAnswer },
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
      if (mode === "malformed_extraction" && requestedName === "extract") {
        sendCompletion(
          response,
          callNumber,
          {
            content: null,
            tool_calls: [
              {
                function: {
                  arguments:
                    '{"kind":"player_lookup","players":[{"mention":"Elias Demo","lookupName":null,"recommendationRole":"reference","referenceScope":"explicit","referenceTargetMention":null}],"teams":[],"constraints[]} { "  :  " } } {"  }',
                  name: requestedName,
                },
                id: `call-malformed-extract-${callNumber}`,
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

const temporaryDirectories: string[] = [];
const servers: Server[] = [];

const cleanup = async () => {
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
};

const evaluationRunnerTest = {
  categoryCounts,
  cleanup,
  completionMessageSchema,
  contradictionEvidenceIds,
  contradictionExplanation,
  currentMessageFromRequest,
  evaluationCheckStatus,
  expectedCategoriesForJudgeRequest,
  explicitCompetitionComparisonCase,
  extractionArgumentsFromRequest,
  fixtureConstraints,
  fixturePlayerMentions,
  fixturePlayersForRequest,
  fixturePlayersFromText,
  fixtureRecommendationAction,
  fixtureRecommendationRole,
  fixtureRequestKind,
  fixtureTeamNames,
  handleGatewayRequest,
  isJudgeRequest,
  judgeAnchorPackSchema,
  judgeAnchors,
  judgeArgumentsFromRequest,
  judgeBusinessRules,
  judgeInputFromRequestBody,
  judgeOverrideForRequest,
  judgeRequestSchema,
  judgeSystemPromptFromRequest,
  numberAfter,
  openAiRequestSchema,
  originCounts,
  parseRequest,
  promptRuleFailureForAnchor,
  recommendationAnswerForRequest,
  recommendationConstraintsFromPatch,
  recommendationIntentFromText,
  recommendationPatchFromText,
  requestContextSchema,
  respondToJudgeRequest,
  runEvaluation,
  seasonFromRequest,
  seasonStartYearFromRequest,
  sendCompletion,
  sendJudgeResponse,
  sendJudgeToolCall,
  sendSearchToolCall,
  sendSeasonTeamAnswer,
  servers,
  shouldFailTransientJudgeRequest,
  temporaryDirectories,
};

export { evaluationRunnerTest };

export type {
  CompletionMessage,
  FakeGatewayMode,
  FakeGatewayState,
  FixtureRecommendationPatch,
  FixtureRequestKind,
};
