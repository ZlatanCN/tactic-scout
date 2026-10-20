import "dotenv/config";
import path from "node:path";
import { createLocalKnowledgeBase } from "../knowledge/index.js";
import { createWebSearchKnowledgeRepository } from "../knowledge/web-player-report-search.js";
import { summarizeEvaluationRuns } from "./harness-run-summary.js";
import { createIdentityFreeHarnessSummary, writeIdentityFreeHarnessSummary } from "./harness-summary-export.js";
import { contextSummaryMechanismWasExercised, historicalArchivePair, sameRecommendationEvidenceOrder, sameRecommendationOrder, summarizeAblationArm, summarizeAblationRun, summarizeAskPolicyArm, summarizeAskPolicyRun, summarizeContextManagementArm, summarizeEvidenceEvaluatorArm, summarizeEvidenceEvaluatorPair, summarizeExpansionSufficiencyArm, summarizeExpansionSufficiencyRun, summarizeInteractionArm, summarizeInteractionRun, summarizeInvestigationPlanningArm, summarizeInvestigationPlanningRun, summarizeMethodologyRagArm, summarizeMethodologyRagRun, summarizeToolProtocolArm, summarizeToolProtocolPair, summarizeUnderstatResearchArm, suppressMethodologyCorpus } from "./local-agent-comparisons.js";
import { curatedDatasetSha256, getDataRepository, prepareUnderstatResearchSnapshot, safeEndpoint } from "./local-agent-environment.js";
import { parseLocalAgentOptions, usage } from "./local-agent-options.js";
import { canRunContextManagementComparison, isComparableContextCapacityPreflight, operationLatencySamplesFromTrace, runScenarioOnce } from "./local-agent-run.js";
import { runCounterbalancedArms, runCounterbalancedPairs, runCounterbalancedTriples } from "./paired-runs.js";

if (process.argv.includes("--help")) {
  process.stdout.write(`${usage}\n`);
} else {
  try {
    const { scenarios, runsPerScenario, summaryOutputPath, comparison, historicalArchivePreflight, contextManagementPreflightOnly } = await parseLocalAgentOptions();
    if (comparison === "understat_research") process.stderr.write("[harness] 正在加载 Understat 五大联赛目录，并为本场景首轮 12 名同位置候选预热资料快照。\n");
    const understatResearchSnapshot = comparison === "understat_research"
      ? await prepareUnderstatResearchSnapshot()
      : null;
    const datasetSnapshotSha256 = await curatedDatasetSha256();
    const localKnowledgeBase = createLocalKnowledgeBase();
    const knowledgeBase = comparison === "context_management" || comparison === "tool_protocol"
      ? localKnowledgeBase
      : createWebSearchKnowledgeRepository(localKnowledgeBase);
    const outputs: Array<Record<string, unknown>> = [];
    const baselinePassRates: number[] = [];
    const ablationPassRates: number[] = [];
    let contextPreflightFailed = false;

    for (const scenario of scenarios) {
      if (comparison === "understat_research") {
        process.stderr.write("[harness] Understat 目录与首轮同位置候选资料已冻结并预热，开始按轮换顺序运行三种整图策略。\n");
        const runsByArm = await runCounterbalancedTriples(runsPerScenario, [
          {
            id: "catalog_only",
            run: (runNumber) => runScenarioOnce(scenario, runNumber, knowledgeBase, {
              understatResearchMode: "catalog_only",
              suppressTraceOutput: true,
            }),
          },
          {
            id: "fixed_profile",
            run: (runNumber) => runScenarioOnce(scenario, runNumber, knowledgeBase, {
              understatResearchMode: "fixed_profile",
              suppressTraceOutput: true,
            }),
          },
          {
            id: "adaptive",
            run: (runNumber) => runScenarioOnce(scenario, runNumber, knowledgeBase, {
              understatResearchMode: "adaptive",
              suppressTraceOutput: true,
            }),
          },
        ]);
        const catalogRuns = runsByArm.catalog_only!;
        const fixedRuns = runsByArm.fixed_profile!;
        const adaptiveRuns = runsByArm.adaptive!;
        const arms = [
          summarizeUnderstatResearchArm("catalog_only", catalogRuns),
          summarizeUnderstatResearchArm("fixed_profile", fixedRuns),
          summarizeUnderstatResearchArm("adaptive", adaptiveRuns),
        ];
        baselinePassRates.push(arms[2]!.summary.passRate);
        ablationPassRates.push(Math.min(arms[0]!.summary.passRate, arms[1]!.summary.passRate, arms[2]!.summary.passRate));
        outputs.push({
          id: scenario.id,
          sourceSnapshot: understatResearchSnapshot,
          comparison: {
            arms: [
              { id: "catalog_only", change: "只使用同一首轮候选目录与常规统计；禁止读取 Understat 球员详情。" },
              { id: "fixed_profile", change: "在候选评估前固定读取 positions、history、recent、shotProfile 四组资料；不允许决赛下钻。" },
              { id: "adaptive", change: "同一 LangGraph 自主选择调查字段，并可对重点候选追加 shots 资料。" },
            ],
            controls: ["同一登记需求与答复脚本", "同一当前赛季 Understat 目录与持久化 SQLite 快照", "同一位置、同一首轮 12 人资料快照预热", "同一模型配置、知识库、Reviewer 与工具预算"],
            order: "三种策略按 catalog→fixed→adaptive、fixed→adaptive→catalog、adaptive→catalog→fixed 轮换；每轮独立 LangGraph thread。",
            frozenDataBoundary: `实验启动时固定五大联赛目录和首轮 12 名 ${understatResearchSnapshot?.position ?? "ST"} 候选的原始球员资料；所有策略共用同一进程内仓库与本地快照，缓存有效期至少 24 小时。实验内新读取的候选详情写入相同 SQLite 快照，后续轮次复用。`,
            caveat: "该实验检验调查策略是否改变工具选择、证据覆盖、Harness 检查、调用成本与耗时；没有球探排序金标，不能据此声称引援准确率或真实球员推荐质量提升。样本仅覆盖这一登记场景。",
          },
          arms,
          pairedRuns: catalogRuns.map((catalogRun, index) => ({
            run: index + 1,
            catalogOnly: summarizeInvestigationPlanningRun(catalogRun),
            fixedProfile: summarizeInvestigationPlanningRun(fixedRuns[index]!),
            adaptive: summarizeInvestigationPlanningRun(adaptiveRuns[index]!),
            recommendationOrderSame: {
              catalogVsFixed: sameRecommendationOrder(catalogRun, fixedRuns[index]!),
              catalogVsAdaptive: sameRecommendationOrder(catalogRun, adaptiveRuns[index]!),
              fixedVsAdaptive: sameRecommendationOrder(fixedRuns[index]!, adaptiveRuns[index]!),
            },
            recommendationEvidenceOrderSame: {
              catalogVsFixed: sameRecommendationEvidenceOrder(catalogRun, fixedRuns[index]!),
              catalogVsAdaptive: sameRecommendationEvidenceOrder(catalogRun, adaptiveRuns[index]!),
              fixedVsAdaptive: sameRecommendationEvidenceOrder(fixedRuns[index]!, adaptiveRuns[index]!),
            },
          })),
        });
        continue;
      }
      if (comparison === "context_management") {
        process.stderr.write("[harness] context-management preflight started arm=legacy stress_turns=0\n");
        const preflightStartedAt = Date.now();
        const preflightHeartbeat = setInterval(() => {
          process.stderr.write(`[harness] context-management preflight running elapsed_seconds=${Math.floor((Date.now() - preflightStartedAt) / 1_000)}\n`);
        }, 30_000);
        preflightHeartbeat.unref();
        let preflight: Awaited<ReturnType<typeof runScenarioOnce>>;
        try {
          preflight = await runScenarioOnce(scenario, 0, knowledgeBase, {
            contextManagementMode: "legacy",
            suppressTraceOutput: true,
            suppressProgressOutput: true,
          });
        } finally {
          clearInterval(preflightHeartbeat);
        }
        const preflightFailedChecks = Object.entries(preflight.checks)
          .filter(([, passed]) => !passed)
          .map(([check]) => check);
        const preflightErrors = "errors" in preflight
          ? preflight.errors.map(({ name, category, code, status, stage, estimatedInputTokens, inputBudgetTokens, plannerResponseDiagnostics }) => ({
            name,
            category,
            ...(code ? { code } : {}),
            ...(status ? { status } : {}),
            ...(stage ? { stage } : {}),
            ...(estimatedInputTokens !== undefined ? { estimatedInputTokens } : {}),
            ...(inputBudgetTokens !== undefined ? { inputBudgetTokens } : {}),
            ...(plannerResponseDiagnostics ? { plannerResponseDiagnostics } : {}),
          }))
          : [];
        const successfulPlannerResponses = preflight.trace.filter(event => event.phase === "model_usage" && event.outcome === "response").length;
        const comparableContextCapacityFailure = isComparableContextCapacityPreflight({ errors: preflightErrors, plannerResponseCount: successfulPlannerResponses });
        const reportGenerated = Boolean(preflight.report);
        const preflightCanRunComparison = canRunContextManagementComparison({
          allChecksPassed: preflight.allPassed,
          finalStatus: preflight.finalStatus,
          reportGenerated,
          errors: preflightErrors,
          plannerResponseCount: successfulPlannerResponses,
        });
        const preflightStatus = preflight.allPassed ? "passed"
          : comparableContextCapacityFailure ? "capacity_limited"
            : preflight.finalStatus === "completed" && reportGenerated ? "completed_with_check_failures"
              : "failed";
        const preflightSummary = {
          status: preflightStatus,
          finalStatus: preflight.finalStatus,
          reportGenerated,
          failedChecks: preflightFailedChecks,
          errors: preflightErrors,
          modelRequests: {
            requests: preflight.modelUsage.requestCount,
            responses: preflight.modelUsage.responseCount,
            failures: preflight.modelUsage.failedRequestCount,
            inputTokens: preflight.modelUsage.inputTokens,
          },
          elapsedMs: preflight.elapsedMs,
        };
        process.stderr.write(`[harness] context-management preflight finished status=${preflightSummary.status} final_status=${preflightSummary.finalStatus ?? "error"} report_generated=${reportGenerated} failed_checks=${preflightFailedChecks.join(",") || "none"} errors=${preflightErrors.map(({ name, category, stage, estimatedInputTokens, inputBudgetTokens }) => `${name}:${category}${stage ? `:${stage}` : ""}${estimatedInputTokens !== undefined && inputBudgetTokens !== undefined ? `:${estimatedInputTokens}/${inputBudgetTokens}` : ""}`).join(",") || "none"} requests=${preflight.modelUsage.requestCount} responses=${preflight.modelUsage.responseCount} elapsed_ms=${preflight.elapsedMs}\n`);
        if (!preflightCanRunComparison) {
          contextPreflightFailed = true;
          baselinePassRates.push(0);
          outputs.push({
            id: scenario.id,
            preflightStatus: "failed",
            preflight: preflightSummary,
            experimentInformative: false,
            armsRun: 0,
            reason: "The legacy baseline failed before the context stress script; no strategy comparison was run.",
          });
          continue;
        }
        if (contextManagementPreflightOnly) {
          baselinePassRates.push(preflight.allPassed ? 1 : 0);
          if (!preflight.allPassed) contextPreflightFailed = true;
          outputs.push({
            id: scenario.id,
            preflightStatus: preflightSummary.status,
            preflight: preflightSummary,
            experimentInformative: false,
            armsRun: 0,
            reason: preflight.allPassed
              ? "Preflight-only mode; no strategy comparison was run."
              : comparableContextCapacityFailure
                ? "The legacy baseline reached a context-capacity limit after a successful Planner response; preflight-only mode does not run strategy arms."
                : "A completed report with failed quality checks was observed; preflight-only mode does not run strategy arms.",
          });
          continue;
        }
        process.stderr.write("[harness] preflight passed; beginning counterbalanced 5-arm context-stress runs.\n");
        const contextStrategies = [
          { id: "legacy", mode: "legacy" as const, change: "保留既有历史策略和完整案件状态。" },
          { id: "projection", mode: "projection" as const, change: "只启用近期历史投影和原话事件引用。" },
          { id: "evidence", mode: "evidence" as const, change: "只启用案件证据目录与受限按需读取，保留既有历史策略。" },
          { id: "unified", mode: "unified" as const, change: "同时启用历史投影和案件证据读取，不使用摘要。" },
          { id: "summarized", mode: "summarized" as const, change: "在组合策略上增加带原话来源校验的导航摘要。" },
        ];
        const runsByArm = await runCounterbalancedArms(runsPerScenario, contextStrategies.map(strategy => ({
          id: strategy.id,
          run: async runNumber => {
            const label = `[harness] context-management round=${runNumber}/${runsPerScenario} arm=${strategy.id}`;
            const startedAt = Date.now();
            process.stderr.write(`${label} started\n`);
            const heartbeat = setInterval(() => {
              const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1_000);
              process.stderr.write(`${label} running elapsed_seconds=${elapsedSeconds}\n`);
            }, 30_000);
            heartbeat.unref();
            try {
              const result = await runScenarioOnce(scenario, runNumber, knowledgeBase, {
                contextManagementMode: strategy.mode,
                contextStressTurns: 20,
                suppressTraceOutput: true,
                suppressProgressOutput: true,
              });
              const failedChecks = Object.entries(result.checks)
                .filter(([, passed]) => !passed)
                .map(([check]) => check);
              const errorKinds = "errors" in result
                ? result.errors.map(({ category, code, status, plannerResponseDiagnostics }) => `${category}${plannerResponseDiagnostics?.toolCallProtocolFailure ? `:${plannerResponseDiagnostics.toolCallProtocolFailure}` : ""}${plannerResponseDiagnostics?.toolCallIssuePaths?.length ? `:fields=${plannerResponseDiagnostics.toolCallIssuePaths.join(",")}` : ""}${plannerResponseDiagnostics?.toolCallIssueCodes?.length ? `:issues=${plannerResponseDiagnostics.toolCallIssueCodes.join(",")}` : ""}${code ? `:${code}` : ""}${status ? `:${status}` : ""}`)
                : [];
              const inputUsage = result.modelUsage.inputTokens;
              const stressFailures = result.contextStressTurnMatrix
                .filter(turn => !turn.allPassed)
                .map(turn => `${turn.turn}:${Object.entries(turn.checks).filter(([, passed]) => !passed).map(([check]) => check).join("+") || "unknown"}`);
              const summaryRequestCount = result.trace.filter(event => event.phase === "summary_usage").length;
              const acceptedSummaryCount = result.progress.filter(event => event.stage === "context_compaction" && event.status === "completed").length;
              process.stderr.write(`${label} finished status=${result.finalStatus ?? "error"} passed=${result.allPassed} failed_checks=${failedChecks.join(",") || "none"} errors=${errorKinds.join(",") || "none"} input_usage=${inputUsage.status}:${inputUsage.total ?? "unknown"}/${inputUsage.requestsWithUsage}/${inputUsage.requestCount} stress_turns=${result.contextStressTurnsCompleted}/${result.contextStressTurnsRequested} stress_failures=${stressFailures.join(",") || "none"} summaries=${summaryRequestCount}/${acceptedSummaryCount} elapsed_ms=${result.elapsedMs}\n`);
              return result;
            } catch (error) {
              const elapsedMs = Date.now() - startedAt;
              process.stderr.write(`${label} failed elapsed_ms=${elapsedMs} error=${error instanceof Error ? error.message : String(error)}\n`);
              throw error;
            } finally {
              clearInterval(heartbeat);
            }
          },
        })));
        const runsFor = Object.fromEntries(contextStrategies.map(strategy => [strategy.id, runsByArm[strategy.id]!]));
        const armById = new Map(contextStrategies.map(strategy => [
          strategy.id,
          summarizeContextManagementArm(strategy.id as "legacy" | "projection" | "evidence" | "unified" | "summarized", runsFor[strategy.id]!),
        ]));
        const arms = contextStrategies.map(strategy => armById.get(strategy.id)!);
        const summarizedArm = arms.find(arm => arm.id === "summarized")!;
        const acceptedSummaryRuns = summarizedArm.mechanismExercise.filter(mechanism => contextSummaryMechanismWasExercised({
          modelRequests: mechanism.summaryModelRequests,
          acceptedSummaries: mechanism.acceptedSummaries,
        })).length;
        const summaryMechanismExercised = acceptedSummaryRuns === runsPerScenario;
        const allArmsCompleted = arms.every(arm => arm.summary.runCount === runsPerScenario);
        const toolProtocolFailureCount = arms.flatMap(arm => arm.errors).flat().filter(error => (
          error.category === "tool_call_protocol"
          || error.category === "schema_validation" && error.plannerResponseDiagnostics?.failure === "schema_mismatch"
        )).length;
        const experimentInformative = allArmsCompleted && summaryMechanismExercised && toolProtocolFailureCount === 0;
        baselinePassRates.push(armById.get("unified")!.summary.passRate);
        ablationPassRates.push(Math.min(...arms.map(arm => arm.summary.passRate)));
        const strategyPairs = contextStrategies.flatMap((left, index) => contextStrategies.slice(index + 1).map(right => [left, right] as const));
        outputs.push({
          id: scenario.id,
          preflightStatus: preflightSummary.status,
          preflight: preflightSummary,
          experimentInformative,
          experimentStatus: experimentInformative ? "informative" : "inconclusive",
          experimentStatusReason: experimentInformative
            ? null
            : !allArmsCompleted
              ? "Not every planned run produced an observable arm result."
              : !summaryMechanismExercised
                ? "The summarized arm did not generate and accept a verified summary in every paired run."
                : `${toolProtocolFailureCount} run(s) ended on a Planner/tool protocol or structured-output mismatch; context effects cannot be separated from protocol failures.`,
          protocolConfounderGate: {
            toolProtocolFailureCount,
            passed: toolProtocolFailureCount === 0,
          },
          mechanismExerciseGate: {
            summaryStrategyRuns: runsPerScenario,
            acceptedSummaryRuns,
            passed: summaryMechanismExercised,
            reason: summaryMechanismExercised ? null : "The summarized arm must create and accept a verified summary in every paired run.",
          },
          comparison: {
            arms: contextStrategies.map(({ id, change }) => ({ id, change })),
            causalComparisons: [
              { comparison: "projection_vs_legacy", isolates: "历史投影的单独效果" },
              { comparison: "evidence_vs_legacy", isolates: "案件证据读取的单独效果" },
              { comparison: "unified_vs_projection", isolates: "证据读取加入历史投影后的增量效果" },
              { comparison: "unified_vs_evidence", isolates: "历史投影加入证据读取后的增量效果" },
              { comparison: "summarized_vs_unified", isolates: "带原话校验的导航摘要的增量效果" },
            ],
            controls: ["同一登记场景与固定候选数据快照", "同一模型、提示词工具、Reviewer、本地知识库和预算；禁用实时 Web Search", "同一首轮需求及 20 条范围保持压力消息；每条将核心提醒重复 18 次以产生足够历史，只有实际完成全部消息的运行计为通过", "五臂轮换起始顺序，单机串行执行"],
            progressMetric: "每次运行从 Harness 启动时计时；记录首个可见进度事件，以及首个非 started 状态的有用进度事件（时间、阶段、状态）。",
            order: "五种策略每轮轮换起始顺序；五轮中每种策略各处于每个执行位置一次。每轮创建独立 LangGraph thread。",
            stressScript: "每轮在场景完成后附加 20 个相同的范围保持消息，每条将核心提醒重复 18 次，以使按需摘要有机会越过输入预算门槛；这是上下文压力测试，不代表自然用户对话分布。",
            caveat: "比较的是固定场景中的对话正确性、报告一致性、实际模型用量、摘要调用与延迟。没有球探排序金标，不据此声称推荐质量提升；少于五对或未实际运行模型时不作效果结论。",
          },
          arms,
          pairedRuns: runsFor.unified!.map((_unifiedRun, index) => ({
            run: index + 1,
            strategies: Object.fromEntries(contextStrategies.map(strategy => [
              strategy.id,
              summarizeInvestigationPlanningRun(runsFor[strategy.id]![index]!),
            ])),
            pairwise: Object.fromEntries(strategyPairs.map(([left, right]) => {
              const leftRun = runsFor[left.id]![index]!;
              const rightRun = runsFor[right.id]![index]!;
              return [`${left.id}_vs_${right.id}`, {
                recommendationOrderSame: sameRecommendationOrder(leftRun, rightRun),
                recommendationEvidenceOrderSame: sameRecommendationEvidenceOrder(leftRun, rightRun),
              }];
            })),
          })),
        });
        continue;
      }
      if (comparison === "tool_protocol") {
        process.stderr.write("[harness] 开始配对比较旧版结构化 action 分发与 LangGraph 原生具名工具 + ToolNode。\n");
        const preflight = await runScenarioOnce(scenario, 0, knowledgeBase, {
          plannerProtocol: "native_tools",
          suppressTraceOutput: true,
          suppressProgressOutput: true,
        });
        const preflightErrors = "errors" in preflight && Array.isArray(preflight.errors)
          ? preflight.errors as Array<{
            name: string;
            category: string;
            code?: string;
            status?: number;
            stage?: string;
            plannerResponseDiagnostics?: unknown;
          }>
          : [];
        const preflightSummary = {
          finalStatus: preflight.finalStatus,
          reportGenerated: Boolean("report" in preflight && preflight.report),
          plannerRequestAttempts: preflight.plannerRequestAttempts,
          toolCallCount: preflight.toolCallCount,
          modelUsage: preflight.modelUsage,
          failedChecks: Object.entries(preflight.checks)
            .filter(([, passed]) => !passed)
            .map(([check]) => check),
          errors: preflightErrors.map(({ name, category, code, status, stage, plannerResponseDiagnostics }) => ({
            name,
            category,
            ...(code ? { code } : {}),
            ...(status ? { status } : {}),
            ...(stage ? { stage } : {}),
            ...(plannerResponseDiagnostics ? { plannerResponseDiagnostics } : {}),
          })),
          elapsedMs: preflight.elapsedMs,
        };
        const preflightReady = preflight.plannerRequestAttempts > 0
          && preflight.toolCallCount > 0
          && preflight.finalStatus === "completed"
          && preflightSummary.reportGenerated
          && preflightErrors.length === 0;
        process.stderr.write(`[harness] tool-protocol preflight ${preflightReady ? "ready" : "blocked"} planner_requests=${preflight.plannerRequestAttempts} tool_calls=${preflight.toolCallCount} report=${preflightSummary.reportGenerated} status=${preflight.finalStatus ?? "error"}\n`);
        if (!preflightReady) {
          baselinePassRates.push(0);
          ablationPassRates.push(0);
          outputs.push({
            id: scenario.id,
            preflightProtocol: "native_tools",
            preflightStatus: "blocked",
            preflight: preflightSummary,
            experimentInformative: false,
            armsRun: 0,
            reason: "The native product protocol did not complete a Planner-backed report after data-tool execution; paired protocol runs were not started.",
          });
          continue;
        }
        const { baseline: legacyRuns, control: nativeRuns } = await runCounterbalancedPairs(runsPerScenario,
          (runNumber) => runScenarioOnce(scenario, runNumber, knowledgeBase, {
            plannerProtocol: "legacy_action",
            suppressTraceOutput: true,
            suppressProgressOutput: true,
          }),
          (runNumber) => runScenarioOnce(scenario, runNumber, knowledgeBase, {
            plannerProtocol: "native_tools",
            suppressTraceOutput: true,
            suppressProgressOutput: true,
          }),
        );
        const legacyArm = summarizeToolProtocolArm("legacy_action", legacyRuns);
        const nativeArm = summarizeToolProtocolArm("native_tools", nativeRuns);
        const allRunsCompleted = [...legacyRuns, ...nativeRuns].every(run => (
          run.finalStatus === "completed" && Boolean("report" in run && run.report)
        ));
        baselinePassRates.push(nativeArm.summary.passRate);
        ablationPassRates.push(legacyArm.summary.passRate);
        outputs.push({
          id: scenario.id,
          datasetSnapshotSha256,
          preflightProtocol: "native_tools",
          preflightStatus: "ready",
          preflight: preflightSummary,
          experimentInformative: allRunsCompleted,
          ...(!allRunsCompleted ? {
            experimentStatus: "inconclusive",
            experimentStatusReason: "At least one paired run failed before completing a report; retain per-run tool/token/latency measurements as diagnostics, not as evidence of a quality or efficiency win.",
          } : { experimentStatus: "completed" }),
          comparison: {
            arms: [
              { id: "legacy_action", change: "旧版 JSON action 结构化输出 + 按 action 手动分发；使用相同业务工具实现。" },
              { id: "native_tools", change: "模型 bindTools() 输出单个具名工具；控制动作由图路由；数据动作由 LangGraph ToolNode 执行。" },
            ],
            controls: ["相同登记场景和固定补答", "同一 curated 数据快照、知识库、模型、提示词约束、Reviewer 和工具预算", "两臂都运行完整 LangGraph 案件状态与报告链路；禁用实时 Web Search", "每组交错执行顺序，分别创建独立 thread"],
            changedFactor: "模型调用协议与数据动作分发机制整体切换；两个臂调用相同的领域动作处理函数。",
            order: "每组配对轮换 legacy-first 与 native-first 顺序。",
            caveat: "实验比较完整协议迁移组合的运行结果；模型适配层收到的格式不同，因此 provider token 与延迟反映端到端差异，不单独证明 ToolNode 或 bindTools 的因果贡献。Harness 检查不是球探推荐金标；少于三对或模型调用失败时不作优劣结论。",
          },
          arms: [legacyArm, nativeArm],
          pairedRuns: legacyRuns.map((legacyRun, index) => summarizeToolProtocolPair(legacyRun, nativeRuns[index]!)),
        });
        continue;
      }
      if (comparison === "evidence_evaluator") {

        const { baseline: enabledRuns, control: withheldRuns } = await runCounterbalancedPairs(runsPerScenario,
          (runNumber) => runScenarioOnce(scenario, runNumber, knowledgeBase, {
            evidenceEvaluatorMode: "enabled",
            suppressTraceOutput: true,
            suppressProgressOutput: true,
          }),
          (runNumber) => runScenarioOnce(scenario, runNumber, knowledgeBase, {
            evidenceEvaluatorMode: "withheld",
            suppressTraceOutput: true,
            suppressProgressOutput: true,
          }),
        );
        const enabledArm = summarizeEvidenceEvaluatorArm(scenario, enabledRuns, "enabled");
        const withheldArm = summarizeEvidenceEvaluatorArm(scenario, withheldRuns, "withheld");
        const pairedRuns = enabledRuns.map((enabledRun, index) => summarizeEvidenceEvaluatorPair(
          scenario,
          enabledRun,
          withheldRuns[index]!,
        ));
        const withheldContractPassRate = withheldArm.withheldContractPassRate ?? 0;
        baselinePassRates.push(enabledArm.harness.passRate);
        ablationPassRates.push(withheldContractPassRate);
        outputs.push({
          id: scenario.id,
          comparison: {
            controls: ["same complete LangGraph", "same model configuration and registered request/answers", "same curated dataset snapshot", "same knowledge base", "same Planner, Reviewer, policies, tools, and budgets"],
            changedFactor: "The enabled arm returns source-backed capability evidence; the control arm retains candidate identity but explicitly withholds all evaluator metrics and comparisons.",
            order: "Execution order alternates enabled-first and withheld-first across paired repetitions.",
            caveat: "This is an exploratory mechanism check for frozen male-football scenarios. It does not measure shortlist quality, ranking accuracy, current transfer suitability, or general reliability.",
            harnessPassSemantics: "The enabled arm reports the ordinary Harness result. The withheld arm's ordinary Harness checks are descriptive; withheldContractPassRate checks that evidence was explicitly absent and no unsupported recommendation was delivered.",
          },
          arms: [enabledArm, withheldArm],
          pairedRuns,
          experimentInformative: enabledArm.informativeEvidenceRunCount === enabledRuns.length,
        });
        continue;
      }
      if (comparison === "historical_archive") {

        const { baseline: enabledRuns, control: disabledRuns } = await runCounterbalancedPairs(runsPerScenario,
          (runNumber) => runScenarioOnce(scenario, runNumber, knowledgeBase, { historicalArchiveMode: "enabled", suppressTraceOutput: true }),
          (runNumber) => runScenarioOnce(scenario, runNumber, knowledgeBase, { historicalArchiveMode: "disabled", suppressTraceOutput: true }),
        );
        const pairs = enabledRuns.map((enabledRun, index) => historicalArchivePair(enabledRun, disabledRuns[index]!));
        const enabledSummary = summarizeEvaluationRuns(enabledRuns.map((run) => ({ checks: run.checks, elapsedMs: run.elapsedMs })));
        const disabledSummary = summarizeEvaluationRuns(disabledRuns.map((run) => ({ checks: run.checks, elapsedMs: run.elapsedMs })));
        const comparablePairs = pairs.filter((pair) => pair.differences.length === 0).length;
        baselinePassRates.push(enabledSummary.passRate);
        ablationPassRates.push(pairs.length ? comparablePairs / pairs.length : 0);
        outputs.push({
          id: scenario.id,
          dataScope: {
            mode: getDataRepository().mode,
            source: getDataRepository().sourceName,
            datasetScope: enabledRuns.find((run) => run.report?.datasetScope)?.report?.datasetScope ?? null,
          },
          archivePreflight: historicalArchivePreflight?.status === "ready" ? {
            reepReleaseStamp: historicalArchivePreflight.releaseStamp,
            archivePlayerSeasonRecords: historicalArchivePreflight.archivePlayerRecords,
          } : null,
          comparison: {
            controls: ["same registered request and answer script", "same model and local endpoint", "same Understat or mosaic repository", "same knowledge base", "same LangGraph and tool budgets"],
            changedFactor: "The enabled arm appends exact Reep-linked Wyscout history after Reviewer and Planner synthesis; the disabled arm suppresses only report display during graph construction.",
            order: "Pair order alternates enabled-first and disabled-first across repetitions.",
            caveat: "Historical samples are report-only context. This experiment does not evaluate current ability, ranking accuracy, transfer suitability, or general reliability.",
          },
          arms: [
            { mode: "enabled", summary: enabledSummary },
            { mode: "disabled", summary: disabledSummary },
          ],
          pairs,
        });
        continue;
      }
      if (comparison === "reviewer") {

        const { baseline: enabledRuns, control: bypassedRuns } = await runCounterbalancedPairs(runsPerScenario,
          (runNumber) => runScenarioOnce(scenario, runNumber, knowledgeBase, { reviewerMode: "enabled" }),
          (runNumber) => runScenarioOnce(scenario, runNumber, knowledgeBase, { reviewerMode: "bypassed" }),
        );
        const arms = [
          summarizeAblationArm("enabled", enabledRuns),
          summarizeAblationArm("bypassed", bypassedRuns),
        ];
        baselinePassRates.push(arms[0]!.summary.passRate);
        ablationPassRates.push(arms[1]!.summary.passRate);
        outputs.push({
          id: scenario.id,
          comparison: {
            controls: ["model configuration", "registered scenario and answers", "curated repository", "knowledge base", "tool budgets"],
            caveat: "Paired by input and data snapshot with counterbalanced execution order; each run uses an independent graph thread and the model endpoint does not guarantee a shared random seed.",
          },
          arms,
          pairedRuns: enabledRuns.map((enabledRun, index) => ({
            enabled: summarizeAblationRun(enabledRun),
            bypassed: summarizeAblationRun(bypassedRuns[index]!),
          })),
        });
        continue;
      }

      if (comparison === "interaction") {

        const { baseline: scriptedRuns, control: withheldRuns } = await runCounterbalancedPairs(runsPerScenario,
          (runNumber) => runScenarioOnce(scenario, runNumber, knowledgeBase, { answerMode: "scripted" }),
          (runNumber) => runScenarioOnce(scenario, runNumber, knowledgeBase, { answerMode: "withheld" }),
        );
        const scriptedArm = summarizeInteractionArm("scripted", scriptedRuns);
        const withheldArm = summarizeInteractionArm("withheld", withheldRuns);
        baselinePassRates.push(scriptedArm.summary.passRate);
        ablationPassRates.push(withheldArm.summary.passRate);
        outputs.push({
          id: scenario.id,
          comparison: {
            controls: ["model configuration", "registered initial request and curated answer script", "curated repository snapshot", "knowledge base", "planner/reviewer policies", "tool budgets"],
            changedFactor: "The withheld arm stops at the first user-visible LangGraph interrupt and does not receive the registered answers.",
            order: "Execution order is counterbalanced across paired repetitions.",
            caveat: "This isolates answer availability and same-case continuation; it is not a -ask_user policy ablation, framework comparison, recommendation-quality evaluation, or reliability estimate.",
          },
          arms: [scriptedArm, withheldArm],
          pairedRuns: scriptedRuns.map((scriptedRun, index) => ({
            scripted: summarizeInteractionRun(scriptedRun),
            withheld: summarizeInteractionRun(withheldRuns[index]!),
          })),
        });
        continue;
      }

      if (comparison === "ask_policy") {

        const { baseline: enabledRuns, control: disabledRuns } = await runCounterbalancedPairs(runsPerScenario,
          (runNumber) => runScenarioOnce(scenario, runNumber, knowledgeBase, { askUserMode: "enabled" }),
          (runNumber) => runScenarioOnce(scenario, runNumber, knowledgeBase, { askUserMode: "disabled" }),
        );
        const enabledArm = summarizeAskPolicyArm("enabled", enabledRuns);
        const disabledArm = summarizeAskPolicyArm("disabled", disabledRuns);
        baselinePassRates.push(enabledArm.summary.passRate);
        ablationPassRates.push(disabledArm.summary.passRate);
        outputs.push({
          id: scenario.id,
          comparison: {
            controls: ["model configuration", "registered request and curated answer script", "curated repository snapshot", "knowledge base", "reviewer policy", "tool budgets"],
            changedFactor: "The disabled arm suppresses user-facing ask_user actions from both deterministic LangGraph policy gates and the Planner; it exposes only a fixed unresolved-needs pause and receives no scripted answers.",
            order: "Execution order is counterbalanced across paired repetitions.",
            caveat: "This estimates behavior in the frozen scenario when clarification is unavailable; it does not isolate answer value, recommendation quality, framework superiority, or general reliability.",
          },
          arms: [enabledArm, disabledArm],
          pairedRuns: enabledRuns.map((enabledRun, index) => ({
            enabled: summarizeAskPolicyRun(enabledRun),
            disabled: summarizeAskPolicyRun(disabledRuns[index]!),
          })),
        });
        continue;
      }

      if (comparison === "methodology_rag") {
        const suppressedKnowledgeBase = suppressMethodologyCorpus(knowledgeBase);
        const { baseline: enabledRuns, control: suppressedRuns } = await runCounterbalancedPairs(runsPerScenario,
          (runNumber) => runScenarioOnce(scenario, runNumber, knowledgeBase),
          (runNumber) => runScenarioOnce(scenario, runNumber, suppressedKnowledgeBase),
        );
        const enabledArm = summarizeMethodologyRagArm("enabled", enabledRuns);
        const suppressedArm = summarizeMethodologyRagArm("suppressed", suppressedRuns);
        baselinePassRates.push(enabledArm.summary.passRate);
        ablationPassRates.push(suppressedArm.summary.passRate);
        outputs.push({
          id: scenario.id,
          comparison: {
            controls: ["model configuration", "registered request and curated answer script", "curated repository snapshot", "LangGraph graph and policies", "Reviewer", "tool budgets", "player-report corpus and all non-methodology tools"],
            changedFactor: "The suppressed arm returns no results only for KnowledgeRepository searches whose corpus is methodology; all other corpus searches pass through unchanged.",
            order: "Execution order is counterbalanced across paired repetitions.",
            caveat: "This estimates corpus availability effects in one frozen local-model scenario. It does not establish answer correctness, recommendation quality, framework superiority, or general RAG effectiveness.",
          },
          arms: [enabledArm, suppressedArm],
          pairedRuns: enabledRuns.map((enabledRun, index) => ({
            enabled: summarizeMethodologyRagRun(enabledRun),
            suppressed: summarizeMethodologyRagRun(suppressedRuns[index]!),
          })),
        });
        continue;
      }

      if (comparison === "investigation_planning") {

        const { baseline: adaptiveRuns, control: singlePassRuns } = await runCounterbalancedPairs(runsPerScenario,
          (runNumber) => runScenarioOnce(scenario, runNumber, knowledgeBase, { investigationPlanningMode: "adaptive" }),
          (runNumber) => runScenarioOnce(scenario, runNumber, knowledgeBase, { investigationPlanningMode: "single_pass" }),
        );
        const adaptiveArm = summarizeInvestigationPlanningArm("adaptive", adaptiveRuns);
        const singlePassArm = summarizeInvestigationPlanningArm("single_pass", singlePassRuns);
        baselinePassRates.push(adaptiveArm.summary.passRate);
        ablationPassRates.push(singlePassArm.summary.passRate);
        outputs.push({
          id: scenario.id,
          comparison: {
            controls: ["same LangGraph and graph policies", "model and conclusion synthesis", "registered request and clarification answers", "curated repository snapshot", "knowledge base", "tool implementations and limits", "Reviewer"],
            changedFactor: "Adaptive Planner investigation choices versus a frozen generic methodology lookup and one candidate page; both arms retain the same model for conclusion synthesis.",
            order: "Execution order is counterbalanced across paired repetitions.",
            caveat: "Exploratory mechanism check for the frozen case only. Token totals are provider-reported Planner usage; any metric with incomplete request coverage is unknown, and token counts are not monetary cost or a guarantee of matched cost. Results do not establish recommendation quality, general planning quality, or framework superiority.",
          },
          arms: [adaptiveArm, singlePassArm],
          pairedRuns: adaptiveRuns.map((adaptiveRun, index) => ({
            adaptive: summarizeInvestigationPlanningRun(adaptiveRun),
            singlePass: summarizeInvestigationPlanningRun(singlePassRuns[index]!),
          })),
        });
        continue;
      }

      if (comparison === "expansion_sufficiency") {

        const { baseline: enabledRuns, control: bypassedRuns } = await runCounterbalancedPairs(runsPerScenario,
          (runNumber) => runScenarioOnce(scenario, runNumber, knowledgeBase, {
            expansionSufficiencyMode: "enabled",
            suppressTraceOutput: true,
            suppressProgressOutput: true,
          }),
          (runNumber) => runScenarioOnce(scenario, runNumber, knowledgeBase, {
            expansionSufficiencyMode: "bypassed",
            suppressTraceOutput: true,
            suppressProgressOutput: true,
          }),
        );
        const enabledArm = summarizeExpansionSufficiencyArm("enabled", enabledRuns);
        const bypassedArm = summarizeExpansionSufficiencyArm("bypassed", bypassedRuns);
        baselinePassRates.push(enabledArm.summary.passRate);
        ablationPassRates.push(bypassedArm.summary.passRate);
        outputs.push({
          id: scenario.id,
          comparison: {
            controls: ["same complete LangGraph", "same registered request and answer script", "same model configuration and data repository", "same knowledge base", "same Planner, Reviewer, policies, tools, and budgets"],
            changedFactor: "The enabled arm deterministically finishes ordinary expansion once three independent candidates jointly cover every measurable requested capability. The bypassed arm sends the same state to the expansion Planner and preserves the Planner decision when valid.",
            order: "Execution order alternates enabled-first and bypassed-first across paired repetitions.",
            caveat: "This isolates Planner-call elimination for a fixed scenario. It does not establish recommendation quality, transfer suitability, general reliability, or that every expansion should be skipped.",
          },
          arms: [enabledArm, bypassedArm],
          pairedRuns: enabledRuns.map((enabledRun, index) => ({
            enabled: summarizeExpansionSufficiencyRun(enabledRun),
            bypassed: summarizeExpansionSufficiencyRun(bypassedRuns[index]!),
            recommendationIdentityOrderSame: sameRecommendationOrder(enabledRun, bypassedRuns[index]!),
            recommendationEvidenceOrderSame: sameRecommendationEvidenceOrder(enabledRun, bypassedRuns[index]!),
          })),
        });
        continue;
      }

      const runs = [];
      for (let runNumber = 1; runNumber <= runsPerScenario; runNumber += 1) {
        runs.push(await runScenarioOnce(scenario, runNumber, knowledgeBase, summaryOutputPath
          ? { suppressTraceOutput: true, suppressProgressOutput: true }
          : {}));
      }
      const summary = summarizeEvaluationRuns(runs.map((run) => ({
        checks: run.checks,
        elapsedMs: run.elapsedMs,
        operationLatencySamples: operationLatencySamplesFromTrace(run.trace),
      })));
      baselinePassRates.push(summary.passRate);
      outputs.push({
        id: scenario.id,
        summary,
        runs,
      });
    }

    const output = {
      datasetVersion: (comparison === "tool_protocol") ? 15 : (comparison === "context_management") ? 14 : (comparison === "understat_research") ? 13 : (comparison === "expansion_sufficiency") ? 12 : (comparison === "evidence_evaluator") ? 10 : (comparison === "historical_archive") ? 9 : (comparison === "investigation_planning") ? 8 : (comparison === "methodology_rag") ? 7 : (comparison === "ask_policy") ? 6 : (comparison === "interaction") ? 5 : (comparison === "reviewer") ? 4 : 3,
      model: process.env.OPENAI_MODEL ?? null,
      endpoint: safeEndpoint(process.env.OPENAI_BASE_URL),
      apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
      repository: { mode: getDataRepository().mode, source: getDataRepository().sourceName },
      datasetSnapshotSha256: understatResearchSnapshot?.snapshotSha256 ?? datasetSnapshotSha256,
      ...(understatResearchSnapshot ? { understatResearchSnapshot } : {}),
      repeatsPerScenario: runsPerScenario,
      experiment: contextManagementPreflightOnly ? "context-management-preflight" : (comparison === "tool_protocol") ? "langgraph-tool-protocol-ablation" : (comparison === "context_management") ? "context-management-ablation" : (comparison === "understat_research") ? "understat-research-strategy-ablation" : (comparison === "expansion_sufficiency") ? "expansion-sufficiency-ablation"
        : (comparison === "evidence_evaluator") ? "recruitment-evidence-evaluator-ablation"
        : (comparison === "historical_archive") ? "historical-archive-report-sidecar-ablation"
          : (comparison === "investigation_planning") ? "dynamic-investigation-planning-ablation"
            : (comparison === "methodology_rag") ? "methodology-rag-agent-ablation"
              : (comparison === "ask_policy") ? "ask-user-policy-ablation"
                : (comparison === "interaction") ? "user-answer-interaction-ablation"
                  : (comparison === "reviewer") ? "evidence-reviewer-ablation" : null,
      scenarios: outputs,
      claims: {
        recommendationRankingAccuracy: "not evaluated: no trusted scout ranking labels",
        ragRelevance: "separate author-labeled regressions are available: immutable v2 covers 34 fixed queries and two sources; v3 covers 10 fixed queries and three sources including role-aware methodology. Online-query generalization and answer faithfulness are not validated",
      },
      allPassed: baselinePassRates.every((passRate) => passRate === 1),
      ablationAllPassed: comparison && !contextManagementPreflightOnly && !contextPreflightFailed
        ? ablationPassRates.every((passRate) => passRate === 1)
        : null,
    };
    if (summaryOutputPath) {
      const summary = createIdentityFreeHarnessSummary(output);
      await writeIdentityFreeHarnessSummary(summaryOutputPath, summary);
      process.stdout.write(`已写入不含候选身份的 Harness 聚合摘要：${path.relative(process.cwd(), summaryOutputPath)}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    }
    if (!output.allPassed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Invalid evaluation options."}\n${usage}\n`);
    process.exitCode = 2;
  }
}
