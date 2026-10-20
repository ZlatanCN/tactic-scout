import "dotenv/config";
import path from "node:path";
import { createLocalKnowledgeBase } from "../knowledge/index.js";
import { createWebSearchKnowledgeRepository } from "../knowledge/web-player-report-search.js";
import { summarizeEvaluationRuns } from "./harness-run-summary.js";
import { createIdentityFreeHarnessSummary, writeIdentityFreeHarnessSummary } from "./harness-summary-export.js";
import { historicalArchivePair, sameRecommendationEvidenceOrder, sameRecommendationOrder, summarizeAblationArm, summarizeAblationRun, summarizeAskPolicyArm, summarizeAskPolicyRun, summarizeEvidenceEvaluatorArm, summarizeEvidenceEvaluatorPair, summarizeExpansionSufficiencyArm, summarizeExpansionSufficiencyRun, summarizeInteractionArm, summarizeInteractionRun, summarizeInvestigationPlanningArm, summarizeInvestigationPlanningRun, summarizeMethodologyRagArm, summarizeMethodologyRagRun, summarizeUnderstatResearchArm, suppressMethodologyCorpus } from "./local-agent-comparisons.js";
import { curatedDatasetSha256, getDataRepository, prepareUnderstatResearchSnapshot, safeEndpoint } from "./local-agent-environment.js";
import { parseLocalAgentOptions, usage } from "./local-agent-options.js";
import { operationLatencySamplesFromTrace, runScenarioOnce } from "./local-agent-run.js";
import { runCounterbalancedArms, runCounterbalancedPairs, runCounterbalancedTriples } from "./paired-runs.js";

if (process.argv.includes("--help")) {
  process.stdout.write(`${usage}\n`);
} else {
  try {
    const { scenarios, runsPerScenario, summaryOutputPath, comparison, historicalArchivePreflight } = await parseLocalAgentOptions();
    if (comparison === "understat_research") process.stderr.write("[harness] 正在加载 Understat 五大联赛目录，并为本场景首轮 12 名同位置候选预热资料快照。\n");
    const understatResearchSnapshot = comparison === "understat_research"
      ? await prepareUnderstatResearchSnapshot()
      : null;
    const datasetSnapshotSha256 = await curatedDatasetSha256();
    const localKnowledgeBase = createLocalKnowledgeBase();
    const knowledgeBase = createWebSearchKnowledgeRepository(localKnowledgeBase);
    const outputs: Array<Record<string, unknown>> = [];
    const baselinePassRates: number[] = [];
    const ablationPassRates: number[] = [];

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
      datasetVersion: (comparison === "understat_research") ? 13 : (comparison === "expansion_sufficiency") ? 12 : (comparison === "evidence_evaluator") ? 10 : (comparison === "historical_archive") ? 9 : (comparison === "investigation_planning") ? 8 : (comparison === "methodology_rag") ? 7 : (comparison === "ask_policy") ? 6 : (comparison === "interaction") ? 5 : (comparison === "reviewer") ? 4 : 3,
      model: process.env.OPENAI_MODEL ?? null,
      endpoint: safeEndpoint(process.env.OPENAI_BASE_URL),
      apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
      repository: { mode: getDataRepository().mode, source: getDataRepository().sourceName },
      datasetSnapshotSha256: understatResearchSnapshot?.snapshotSha256 ?? datasetSnapshotSha256,
      ...(understatResearchSnapshot ? { understatResearchSnapshot } : {}),
      repeatsPerScenario: runsPerScenario,
      experiment: (comparison === "understat_research") ? "understat-research-strategy-ablation" : (comparison === "expansion_sufficiency") ? "expansion-sufficiency-ablation"
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
      ablationAllPassed: comparison
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
