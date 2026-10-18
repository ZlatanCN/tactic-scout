import "dotenv/config";
import { open } from "node:fs/promises";
import { parseArgs } from "node:util";
import { briefInterpretationInstructions, createRecruitmentBriefInterpreter } from "../recruitment/brief-interpreter.js";
import { createHash } from "node:crypto";
import { replacementTargetMention } from "../domain/replacement-reference.js";
import { resolveCandidateSearchIntent } from "../recruitment/candidate-search-intent.js";
import { competitionNamesMatch } from "../domain/competition-names.js";
import { RecruitmentBriefSchema, RecruitmentBriefValidationError, type RecruitmentBrief, type VisibleRecruitmentCandidate } from "../recruitment/brief.js";

interface Scenario {
  message: string;
  task: RecruitmentBrief["task"];
  reference: string | null;
  positions?: RecruitmentBrief["positions"];
  maxAge?: number | null;
  excludedCompetitions?: string[];
  previous?: RecruitmentBrief;
  recentMessages?: string[];
  visibleCandidates?: VisibleRecruitmentCandidate[];
  selectedCandidateId?: string;
}

const regression: Scenario[] = [
  { message: "推荐类似切尔基的球员", task: "similarity", reference: "切尔基" },
  { message: "找个切尔基这种类型的", task: "similarity", reference: "切尔基" },
  { message: "有没有便宜版切尔基", task: "similarity", reference: "切尔基" },
  { message: "给拜仁找基米希的接班人", task: "replacement", reference: "基米希" },
  { message: "Recommend players similar to Rayan Cherki", task: "similarity", reference: "Rayan Cherki" },
  { message: "推荐类似切耳基的球员", task: "similarity", reference: "切耳基" },
  { message: "找个魔笛这种风格的中场", task: "similarity", reference: "魔笛" },
  { message: "我想为巴萨找一个新的后卫", task: "reinforcement", reference: null, positions: ["DEF"] },
  { message: "找一个能拿球推进的中前卫", task: "reinforcement", reference: null, positions: ["CM"] },
];
const heldout: Scenario[] = [
  { message: "有没有和穆西亚拉踢法接近的人", task: "similarity", reference: "穆西亚拉" },
  { message: "Please find a left-back who can carry the ball forward.", task: "reinforcement", reference: null, positions: ["LB"] },
  { message: "想给国米补强门将，扑救稳定优先", task: "reinforcement", reference: null, positions: ["GK"] },
  { message: "Can you suggest a successor to Manuel Neuer for Bayern?", task: "replacement", reference: "Manuel Neuer" },
  { message: "找一个类似 Rayan Cherki 的，但别考虑英超", task: "similarity", reference: "Rayan Cherki", excludedCompetitions: ["EPL"] },
];
const previous = RecruitmentBriefSchema.parse({ task: "similarity", targetTeam: null, referencePlayer: { value: "切尔基", quote: "切尔基", basis: "explicit" }, positions: [], priorities: [], constraints: [], filters: { maxAge: null, minimumMinutes: 0, competition: null, season: null }, unresolved: [] });
const followup: Scenario[] = [
  { message: "再年轻一点", task: "similarity", reference: "切尔基", previous, recentMessages: ["推荐类似切尔基的球员"] },
  { message: "只看25岁以下", task: "similarity", reference: "切尔基", previous, recentMessages: ["推荐类似切尔基的球员"], maxAge: 25 },
  { message: "第三个这种类型再找几个", task: "similarity", reference: "Candidate Three", previous, recentMessages: ["推荐类似切尔基的球员"], selectedCandidateId: "visible-3",
    visibleCandidates: [{ playerId: "visible-1", name: "Candidate One", rank: 1 }, { playerId: "visible-2", name: "Candidate Two", rank: 2 }, { playerId: "visible-3", name: "Candidate Three", rank: 3 }] },
  { message: "算了，改为给巴萨找后卫，不参考切尔基了", task: "reinforcement", reference: null, positions: ["DEF"], previous, recentMessages: ["推荐类似切尔基的球员"] },
];

const { values } = parseArgs({ options: { output: { type: "string" }, limit: { type: "string" }, suite: { type: "string", default: "regression" }, help: { type: "boolean" } } });
if (values.help) { console.log("pnpm eval:recruitment-understanding --suite regression|heldout|followup --output <new-private.json> [--limit N]"); process.exit(0); }
if (!["regression", "heldout", "followup"].includes(values.suite)) throw new Error("未知 suite。");
const scenarios = values.suite === "heldout" ? heldout : values.suite === "followup" ? followup : regression;
const limit = values.limit ? Number(values.limit) : scenarios.length;
if (!Number.isInteger(limit) || limit < 1 || limit > scenarios.length) throw new Error("limit 必须为场景范围内的正整数。");
if (!values.output) throw new Error("请指定 --output；文件必须尚不存在。");
const output = await open(values.output, "wx", 0o600);
try {
  const interpreter = createRecruitmentBriefInterpreter();
  const runs: unknown[] = [];
  const persist = async () => { const data = JSON.stringify({ protocol: "recruitment-understanding-v2", suite: values.suite, model: process.env.OPENAI_MODEL,
    briefPromptSha256: createHash("sha256").update(briefInterpretationInstructions).digest("hex"),
    scope: "Paired entry-understanding only. Does not measure identity accuracy, shortlist quality or full-graph completion.", runs }, null, 2);
    await output.truncate(0); await output.write(data, 0, "utf8"); await output.sync(); };
  await persist();
  for (const scenario of scenarios.slice(0, limit)) {
    const reference = replacementTargetMention([...(scenario.recentMessages ?? []), scenario.message]) ?? null;
    const baselineTask = reference ? "replacement" : "reinforcement";
    const baselineIntent = resolveCandidateSearchIntent({ userMessages: [...(scenario.recentMessages ?? []), scenario.message], latestMessage: scenario.message, confirmedPosition: null });
    const baselinePositions = baselineIntent.positions ?? (baselineIntent.position ? [baselineIntent.position] : []);
    const baselineBasicCorrect = baselineTask === scenario.task && reference === scenario.reference;
    const baselineConditionsCorrect = (!scenario.positions || JSON.stringify([...baselinePositions].sort()) === JSON.stringify(scenario.positions.slice().sort()))
      && baselineIntent.maxAge === (scenario.maxAge ?? null) && !scenario.excludedCompetitions?.length && !scenario.selectedCandidateId;
    const startedAt = performance.now();
    const usage: Array<{ inputTokens?: number; outputTokens?: number; totalTokens?: number }> = [];
    let brief: RecruitmentBrief | undefined;
    let error: string | undefined;
    let validationFailure: string | undefined;
    try { brief = await interpreter.interpret({ message: scenario.message, previous: scenario.previous ?? null, recentMessages: scenario.recentMessages ?? [], visibleCandidates: scenario.visibleCandidates,
      signal: AbortSignal.timeout(90000), onUsage: value => { usage.push(value); } }); }
    catch (failure) { error = failure instanceof Error ? failure.name : "unknown"; validationFailure = failure instanceof RecruitmentBriefValidationError ? failure.message : undefined; }
    const tokens = (key: "inputTokens" | "outputTokens" | "totalTokens") => usage.length && usage.every(value => value[key] !== undefined) ? usage.reduce((sum, value) => sum + value[key]!, 0) : null;
    const basicCorrect = brief?.task === scenario.task && (brief?.referencePlayer?.value ?? null) === scenario.reference;
    const conditionsCorrect = Boolean(brief) && (!scenario.positions || JSON.stringify(brief!.positions.slice().sort()) === JSON.stringify(scenario.positions.slice().sort()))
      && brief!.filters.maxAge === (scenario.maxAge ?? null) && (!scenario.excludedCompetitions || (brief!.filters.excludedCompetitions.length === scenario.excludedCompetitions.length
        && scenario.excludedCompetitions.every(expected => brief!.filters.excludedCompetitions.some(actual => competitionNamesMatch(actual, expected)))))
      && (!scenario.selectedCandidateId || brief!.selectedCandidateId === scenario.selectedCandidateId);
    runs.push({ ...scenario, baseline: { task: baselineTask, reference, basicCorrect: baselineBasicCorrect, conditionsCorrect: baselineConditionsCorrect, correct: baselineBasicCorrect && baselineConditionsCorrect },
      model: { brief, error, validationFailure, elapsedMs: performance.now() - startedAt, modelCalls: usage.length,
        inputTokens: tokens("inputTokens"), outputTokens: tokens("outputTokens"), totalTokens: tokens("totalTokens"),
        basicCorrect, conditionsCorrect, correct: basicCorrect && conditionsCorrect,
        unexpectedNumericFilter: brief ? brief.filters.maxAge !== (scenario.maxAge ?? null) || brief.filters.minimumMinutes > 0 : null } });
    await persist();
    process.stdout.write(`Completed ${runs.length}/${scenarios.length}\n`);
  }
} finally { await output.close(); }
