import path from "node:path";
import { preflightConfiguredHistoricalArchive } from "../sources/reep/historical-archive-enrichment.js";
import { PositionSchema } from "../domain/position-contracts.js";
import { type EvaluationScenario } from "./harness-evaluation.js";
import { assertIdentityFreeSummaryPathAvailable } from "./harness-summary-export.js";
import { configuredDataMode, configuredScenarios, defaultScenario } from "./local-agent-environment.js";

export const usage = [
  "用法：",
  "  pnpm eval:local-agent",
  "  pnpm eval:local-agent -- --scenario bayern-kane-replacement",
  "  TACTISCOUT_DATA_MODE=understat pnpm eval:local-agent -- --scenario understat-five-league-xg-creation",
  "  pnpm eval:local-agent -- --scenario barcelona-attacking-one-on-one-forward",
  "  pnpm eval:local-agent -- --scenario all --runs 3",
  "  TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- --scenario bayern-kane-replacement --compare-reviewer --runs 3",
  "  TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- --scenario bayern-kane-replacement --compare-interaction --runs 3",
  "  TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- --scenario bayern-kane-replacement --compare-ask-policy --runs 3",
  "  TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- --scenario bayern-kane-replacement --compare-methodology-rag --runs 3",
  "  TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- --scenario bayern-kane-replacement --compare-investigation-planning --runs 3",
  "  TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- --scenario all --compare-evidence-evaluator --runs 3",
  "  TACTISCOUT_DATA_MODE=understat pnpm eval:local-agent -- --scenario understat-five-league-xg-creation --compare-historical-archive --runs 3",
  "  TACTISCOUT_DATA_MODE=understat pnpm eval:local-agent -- --scenario understat-five-league-xg-creation --compare-understat-research --runs 3",
  "  TACTISCOUT_DATA_MODE=understat pnpm eval:local-agent -- --message \"为巴萨寻找一个新的后卫，要能参与出球和高位防守\" --expected-position DEF --compare-expansion-sufficiency --runs 3",
  "  TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- --scenario barcelona-under-23-midfielder --compare-context-management --runs 5",
  "  TACTISCOUT_DATA_MODE=curated pnpm eval:local-agent -- --scenario barcelona-under-23-midfielder --compare-context-management --context-preflight-only",
  "  pnpm eval:local-agent -- --message \"自定义球探需求\" [--answer \"补充回答\"] [--expected-position ST]",
  "  pnpm eval:local-agent -- --message \"我想给拜仁补强阵容，但位置还没定\" --expect-position-clarification",
  "",
  "选项：",
  "  --scenario <id|all> 运行当前数据源已登记场景；不传时使用该模式的默认场景",
  "  --runs <1-10>        每个场景独立运行次数，默认 1",
  "  --message <text>     自定义单个场景需求",
  "  --answer <text>      自定义补答；可重复",
  "  --expected-position <position> 检查自定义场景的搜索及推荐位置",
  "  --expect-position-clarification 验证先询问位置，可附 --answer 与 --expected-position 检查同案续跑",
  "  --summary-output <path> 写入不含候选身份、正文、trace 或进度载荷的本地聚合摘要；只支持普通运行",
  "  --compare-reviewer    在单一登记场景上配对运行完整证据复核与旁路消融（仅 curated 数据）",
  "  --compare-interaction 在单一澄清场景上配对运行完整补答与首次追问后不补答控制（仅 curated 数据）",
  "  --compare-ask-policy 在单一登记场景上配对运行正常追问与禁用追问控制（仅 curated 数据）",
  "  --compare-methodology-rag 在同一整链场景配对比较方法语料开启与屏蔽（仅 curated 数据）",
  "  --compare-investigation-planning 在同一整图配对比较动态调查与单页固定调查（仅 curated 数据）",
  "  --compare-evidence-evaluator 在完整 LangGraph 中配对比较正常能力评估与明确屏蔽评估器（仅 curated 数据；至少 3 对）",
  "  --compare-historical-archive 在 Understat 或 mosaic 场景配对开关历史 Wyscout 报告旁注；须预先启用展示与本地保留",
  "  --compare-understat-research 在同一 Understat 候选调查整图中比较目录、固定四组资料和动态调查（至少 3 轮）",
  "  --compare-expansion-sufficiency 在同一整图配对比较证据充分时的确定性收束与保留扩页 Planner（至少 3 对）",
  "  --compare-context-management 在同一长对话整图分别消融旧策略、历史投影、证据读取、组合策略和原话摘要（至少 5 组五臂配对；仅 curated 数据）",
  "  --context-preflight-only 只运行一次 legacy 基线预检，不启动上下文策略长实验",
  "  --help               显示本帮助",
].join("\n");

function option(name: string): string | undefined {
  let index = -1;
  for (let candidateIndex = 0; candidateIndex < process.argv.length; candidateIndex += 1) {
    if (process.argv[candidateIndex] !== name) continue;
    if (index >= 0) throw new Error(`${name} 只能指定一次。`);
    index = candidateIndex;
  }
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 缺少参数值。`);
  return value;
}

function options(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== name) continue;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} 缺少参数值。`);
    values.push(value);
    index += 1;
  }
  return values;
}

function parseRunCount(value: string | undefined): number {
  if (value === undefined) return 1;
  if (!/^\d+$/.test(value)) throw new Error("--runs 必须是 1 到 10 之间的整数。");
  const count = Number(value);
  if (count < 1 || count > 10) throw new Error("--runs 必须是 1 到 10 之间的整数。");
  return count;
}

function selectScenarios(): { scenarios: EvaluationScenario[]; runsPerScenario: number } {
  const scenarioId = option("--scenario");
  const message = option("--message");
  const answers = options("--answer");
  const expectPositionClarification = process.argv.includes("--expect-position-clarification");
  const expectedPositionInput = option("--expected-position");
  const expectedPositionResult = expectedPositionInput ? PositionSchema.safeParse(expectedPositionInput) : undefined;
  if (expectedPositionInput && !expectedPositionResult?.success) {
    throw new Error(`--expected-position 必须是以下值之一：${PositionSchema.options.join(", ")}。`);
  }
  const expectedPosition = expectedPositionResult?.success ? expectedPositionResult.data : undefined;
  const runsPerScenario = parseRunCount(option("--runs"));

  if (expectPositionClarification && !message) {
    throw new Error("--expect-position-clarification 必须与 --message 一起使用。");
  }
  if (scenarioId) {
    if (message || expectedPosition) throw new Error("--scenario 不能与 --message 或 --expected-position 一起使用。");
    if (expectPositionClarification) throw new Error("--scenario 不能与 --expect-position-clarification 一起使用。");
    if (scenarioId === "all") {
      if (answers.length) throw new Error("--scenario all 使用数据集内登记的补答，不接受 --answer。");
      return { scenarios: configuredScenarios, runsPerScenario };
    }
    const selected = configuredScenarios.find((scenario) => scenario.id === scenarioId);
    if (!selected) throw new Error(`未知场景：${scenarioId}。当前数据源可选：${configuredScenarios.map(({ id }) => id).join(", ")}、all。`);
    return {
      scenarios: [{ ...selected, answers: answers.length ? answers : selected.answers }],
      runsPerScenario,
    };
  }

  if (!message && !answers.length && !expectedPosition) {
    return { scenarios: [defaultScenario], runsPerScenario };
  }
  return {
    scenarios: [{
      id: "custom",
      message: message ?? defaultScenario.message,
      answers,
      kind: "custom",
      requireClarificationResume: answers.length > 0 && !expectPositionClarification,
      ...(expectPositionClarification ? { expectedClarificationTopic: "position" as const } : {}),
      ...(expectedPosition ? {
        expectedPosition,
        requireRecommendationsWhenEvidenceObserved: true,
      } : {}),
    }],
    runsPerScenario,
  };
}

export async function parseLocalAgentOptions() {
  const summaryOutputFlags = process.argv.filter((argument) => argument === "--summary-output").length;
  if (summaryOutputFlags > 1) throw new Error("--summary-output 只能指定一次。");
  const summaryOutputArgument = option("--summary-output");
  const summaryOutputPath = summaryOutputArgument ? path.resolve(process.cwd(), summaryOutputArgument) : null;
  const compareUnderstatResearch = process.argv.includes("--compare-understat-research");
  if (compareUnderstatResearch && configuredDataMode !== "understat") {
    throw new Error("--compare-understat-research 需要 TACTISCOUT_DATA_MODE=understat，以固定单一 Understat 来源。");
  }
  const { scenarios, runsPerScenario } = selectScenarios();
  const compareReviewer = process.argv.includes("--compare-reviewer");
  const compareInteraction = process.argv.includes("--compare-interaction");
  const compareAskPolicy = process.argv.includes("--compare-ask-policy");
  const compareMethodologyRag = process.argv.includes("--compare-methodology-rag");
  const compareInvestigationPlanning = process.argv.includes("--compare-investigation-planning");
  const compareHistoricalArchive = process.argv.includes("--compare-historical-archive");
  const compareEvidenceEvaluator = process.argv.includes("--compare-evidence-evaluator");
  const compareExpansionSufficiency = process.argv.includes("--compare-expansion-sufficiency");
  const compareContextManagement = process.argv.includes("--compare-context-management");
  const contextManagementPreflightOnly = process.argv.includes("--context-preflight-only");
  if (contextManagementPreflightOnly && !compareContextManagement) {
    throw new Error("--context-preflight-only 必须与 --compare-context-management 一起使用。");
  }
  if ([compareReviewer, compareInteraction, compareAskPolicy, compareMethodologyRag, compareInvestigationPlanning, compareHistoricalArchive, compareEvidenceEvaluator, compareUnderstatResearch, compareExpansionSufficiency, compareContextManagement].filter(Boolean).length > 1) {
    throw new Error("比较实验选项一次只能使用一个。");
  }
  if (summaryOutputPath && [compareReviewer, compareInteraction, compareAskPolicy, compareMethodologyRag, compareInvestigationPlanning, compareHistoricalArchive, compareEvidenceEvaluator, compareUnderstatResearch, compareExpansionSufficiency, compareContextManagement].some(Boolean)) {
    throw new Error("--summary-output 目前只支持普通 Harness 运行，不能与消融实验选项一起使用。");
  }
  if (summaryOutputPath) await assertIdentityFreeSummaryPathAvailable(summaryOutputPath);
  if (compareEvidenceEvaluator) {
    const scenarioId = option("--scenario");
    if (!scenarioId) {
      throw new Error("--compare-evidence-evaluator 必须与 --scenario <id|all> 一起使用。");
    }
    if (option("--message") || options("--answer").length || option("--expected-position")) {
      throw new Error("--compare-evidence-evaluator 使用登记场景与固定补答，不能与自定义输入一起使用。");
    }
    if (runsPerScenario < 3) {
      throw new Error("--compare-evidence-evaluator 至少需要 --runs 3，才能完成三组交错配对复跑。");
    }
    if (configuredDataMode !== "curated") {
      throw new Error("--compare-evidence-evaluator 需要 TACTISCOUT_DATA_MODE=curated，以固定男性足球数据快照。");
    }
  }
  if (compareReviewer) {
    const scenarioId = option("--scenario");
    if (!scenarioId || scenarioId === "all") {
      throw new Error("--compare-reviewer 必须与单个 --scenario <id> 一起使用。");
    }
    if (option("--message") || options("--answer").length || option("--expected-position")) {
      throw new Error("--compare-reviewer 使用登记场景的固定输入，不能与自定义需求或补答一起使用。");
    }
    if (configuredDataMode !== "curated") {
      throw new Error("--compare-reviewer 需要 TACTISCOUT_DATA_MODE=curated，以固定候选数据来源。");
    }
  }
  if (compareInteraction) {
    const scenarioId = option("--scenario");
    if (!scenarioId || scenarioId === "all") {
      throw new Error("--compare-interaction 必须与单个 --scenario <id> 一起使用。");
    }
    if (option("--message") || options("--answer").length || option("--expected-position")) {
      throw new Error("--compare-interaction 使用登记场景的固定需求和补答，不能与自定义输入一起使用。");
    }
    if (!scenarios[0] || !["barcelona-under-23-midfielder", "bayern-kane-replacement"].includes(scenarios[0].id)) {
      throw new Error("--compare-interaction 只支持巴萨 U23 中场清晰需求和拜仁凯恩接班人澄清场景。");
    }
    if (configuredDataMode !== "curated") {
      throw new Error("--compare-interaction 需要 TACTISCOUT_DATA_MODE=curated，以固定候选数据来源。");
    }
  }
  if (compareAskPolicy) {
    const scenarioId = option("--scenario");
    if (!scenarioId || scenarioId === "all") {
      throw new Error("--compare-ask-policy 必须与单个 --scenario <id> 一起使用。");
    }
    if (option("--message") || options("--answer").length || option("--expected-position")) {
      throw new Error("--compare-ask-policy 使用登记场景和预设补答，不能与自定义需求或补答一起使用。");
    }
    if (!scenarios[0] || !["barcelona-under-23-midfielder", "bayern-kane-replacement"].includes(scenarios[0].id)) {
      throw new Error("--compare-ask-policy 只支持巴萨 U23 中场清晰需求和拜仁凯恩接班人澄清场景。");
    }
    if (configuredDataMode !== "curated") {
      throw new Error("--compare-ask-policy 需要 TACTISCOUT_DATA_MODE=curated，以固定候选数据来源。");
    }
  }
  if (compareMethodologyRag) {
    const scenarioId = option("--scenario");
    if (!scenarioId || scenarioId === "all") {
      throw new Error("--compare-methodology-rag 必须与单个 --scenario bayern-kane-replacement 一起使用。");
    }
    if (option("--message") || options("--answer").length || option("--expected-position")) {
      throw new Error("--compare-methodology-rag 使用登记场景和预设补答，不能与自定义输入一起使用。");
    }
    if (scenarioId !== "bayern-kane-replacement") {
      throw new Error("--compare-methodology-rag 当前只支持已验证方法来源命中的拜仁凯恩接班人场景。");
    }
    if (configuredDataMode !== "curated") {
      throw new Error("--compare-methodology-rag 需要 TACTISCOUT_DATA_MODE=curated，以固定候选数据来源。");
    }
  }
  if (compareInvestigationPlanning) {
    const scenarioId = option("--scenario");
    if (!scenarioId || scenarioId === "all") {
      throw new Error("--compare-investigation-planning 必须与单个 --scenario <id> 一起使用。");
    }
    if (option("--message") || options("--answer").length || option("--expected-position")) {
      throw new Error("--compare-investigation-planning 使用登记场景的固定输入与补答，不能与自定义输入一起使用。");
    }
    if (configuredDataMode !== "curated") {
      throw new Error("--compare-investigation-planning 需要 TACTISCOUT_DATA_MODE=curated，以固定候选数据来源。");
    }
  }
  if (compareUnderstatResearch) {
    const scenarioId = option("--scenario");
    if (!scenarioId || scenarioId !== "understat-five-league-xg-creation") {
      throw new Error("--compare-understat-research 必须与单个 --scenario understat-five-league-xg-creation 一起使用。");
    }
    if (option("--message") || options("--answer").length || option("--expected-position")) {
      throw new Error("--compare-understat-research 使用登记场景的固定需求，不能与自定义输入或补答一起使用。");
    }
    if (runsPerScenario < 3) {
      throw new Error("--compare-understat-research 至少需要 --runs 3，才能让三种策略各自经历首位、中位和末位执行顺序。");
    }
    if (configuredDataMode !== "understat") {
      throw new Error("--compare-understat-research 需要 TACTISCOUT_DATA_MODE=understat，以固定单一 Understat 来源。");
    }
  }
  if (compareExpansionSufficiency) {
    const scenarioId = option("--scenario");
    if (!scenarioId && (!option("--message") || !option("--expected-position"))) {
      throw new Error("--compare-expansion-sufficiency 需要单个 --scenario，或同时提供 --message 与 --expected-position。");
    }
    if (scenarioId === "all") {
      throw new Error("--compare-expansion-sufficiency 必须使用单个场景。");
    }
    if (runsPerScenario < 3) {
      throw new Error("--compare-expansion-sufficiency 至少需要 --runs 3，才能完成三组交错配对复跑。");
    }
    if (option("--answer")) {
      throw new Error("--compare-expansion-sufficiency 的单轮实验不接受 --answer；该需求应在首回合完成。");
    }
    if (configuredDataMode !== "understat") {
      throw new Error("--compare-expansion-sufficiency 需要 TACTISCOUT_DATA_MODE=understat，以固定单一 Understat 来源。");
    }
  }
  if (compareContextManagement) {
    const scenarioId = option("--scenario");
    if (scenarioId !== "barcelona-under-23-midfielder") {
      throw new Error("--compare-context-management 必须使用固定场景 --scenario barcelona-under-23-midfielder。");
    }
    if (option("--message") || options("--answer").length || option("--expected-position")) {
      throw new Error("--compare-context-management 使用固定场景和 20 轮压力脚本，不能与自定义输入或补答一起使用。");
    }
    if (!contextManagementPreflightOnly && runsPerScenario < 5) {
      throw new Error("--compare-context-management 至少需要 --runs 5，才能让五种策略各自轮换到每个执行位置。");
    }
    if (configuredDataMode !== "curated") {
      throw new Error("--compare-context-management 需要 TACTISCOUT_DATA_MODE=curated，以固定候选数据快照。");
    }
  }
  let historicalArchivePreflight: Awaited<ReturnType<typeof preflightConfiguredHistoricalArchive>> | null = null;
  if (compareHistoricalArchive) {
    const scenarioId = option("--scenario");
    if (!scenarioId || scenarioId === "all") {
      throw new Error("--compare-historical-archive 必须与单个已登记场景一起使用。");
    }
    if (option("--message") || options("--answer").length || option("--expected-position")) {
      throw new Error("--compare-historical-archive 使用已登记场景与固定输入，不能与自定义需求或补答一起使用。");
    }
    if (configuredDataMode !== "understat" && configuredDataMode !== "mosaic") {
      throw new Error("--compare-historical-archive 只支持 TACTISCOUT_DATA_MODE=understat 或 mosaic。");
    }
    if (runsPerScenario < 3) {
      throw new Error("--compare-historical-archive 至少需要 --runs 3，才能做三组交错顺序配对复跑。");
    }
    if (process.env.TACTISCOUT_WYSCOUT_HISTORICAL_REPORT_DISPLAY_ALLOWED !== "true"
      || process.env.TACTISCOUT_WYSCOUT_HISTORICAL_LOCAL_RETENTION_ALLOWED !== "true") {
      throw new Error("--compare-historical-archive 需要预先启用历史报告展示和本地保留两个选项；Runner 不会替你开启。");
    }
    historicalArchivePreflight = await preflightConfiguredHistoricalArchive();
    if (historicalArchivePreflight.status !== "ready") {
      throw new Error("--compare-historical-archive 无法读取有效的 Reep 身份索引与本机 Wyscout 档案；未联系模型。");
    }
  }

  const comparison = compareReviewer ? "reviewer" as const : compareInteraction ? "interaction" as const : compareAskPolicy ? "ask_policy" as const : compareMethodologyRag ? "methodology_rag" as const : compareInvestigationPlanning ? "investigation_planning" as const : compareHistoricalArchive ? "historical_archive" as const : compareEvidenceEvaluator ? "evidence_evaluator" as const : compareUnderstatResearch ? "understat_research" as const : compareExpansionSufficiency ? "expansion_sufficiency" as const : compareContextManagement ? "context_management" as const : null;
  return { scenarios, runsPerScenario, summaryOutputPath, comparison, historicalArchivePreflight, contextManagementPreflightOnly };
}
