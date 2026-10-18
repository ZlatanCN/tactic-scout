import "dotenv/config";
import { open, readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { z } from "zod/v4";
import { PlayerProfileSchema } from "../domain/players.js";
import { searchLoadedPlayers } from "../players/search.js";
import { createConfiguredPlayerNameResolver, createTavilyBackedPlayerNameResolver, createWikidataPlayerNameResolver } from "../players/identity/name-resolver.js";
import { ReepIdentityRegistry } from "../players/identity/reep-registry.js";
import { FmProfileRepository } from "../sources/fm/repository.js";
import { FusedPlayerRepository } from "../sources/fm/fused-repository.js";
import { briefInterpretationInstructions, createRecruitmentBriefInterpreter } from "../recruitment/brief-interpreter.js";
import { createRecruitmentConversation, type RecruitmentTraceEvent } from "../recruitment/conversation.js";
import { createRecruitmentPlanner } from "../recruitment/recruitment-planner.js";
import { createSinglePassInvestigationPlanner } from "./fixed-investigation-planner.js";

const { values } = parseArgs({ options: { output: { type: "string" }, snapshot: { type: "string" }, mode: { type: "string", default: "graph" }, arm: { type: "string" }, help: { type: "boolean" } } });
if (values.help) { console.log("pnpm eval:recruitment-mechanisms --mode identity|graph --output <new-private.json> [--snapshot frozen-players.json] [--arm full|reference-off|fixed-investigation|clarification|clarification-off]"); process.exit(0); }
if (!values.output) throw new Error("需要 --output，且文件必须尚不存在。");
if (!["graph", "identity"].includes(values.mode)) throw new Error("mode 必须为 graph 或 identity。");
if (values.mode === "graph" && !values.snapshot) throw new Error("graph 模式需要冻结的 --snapshot。");
const arms = ["full", "reference-off", "fixed-investigation", "clarification", "clarification-off"] as const;
if (values.arm && !arms.includes(values.arm as typeof arms[number])) throw new Error("未知实验臂。");
const output = await open(values.output, "wx", 0o600);
const runs: Array<Record<string, unknown>> = [];
const protocol: Record<string, unknown> = { version: "recruitment-mechanisms-v1", mode: values.mode, model: process.env.OPENAI_MODEL,
  briefPromptSha256: createHash("sha256").update(briefInterpretationInstructions).digest("hex"),
  requestSettings: { temperature: 0, presencePenalty: 0, frequencyPenalty: 0, reasoningEffort: process.env.OPENAI_REASONING_EFFORT ?? null },
  limitations: "Small paired behavioral study. No expert labels, identity ground truth beyond listed cases, general accuracy estimate, or demonstrated shortlist-quality gain. No hidden answer is supplied to a no-ask arm." };
const persist = async () => { const data = JSON.stringify({ ...protocol, runs }, null, 2); await output.truncate(0); await output.write(data, 0, "utf8"); await output.sync(); };
try {
  protocol.workflowSha256 = createHash("sha256").update((await Promise.all([
    "src/recruitment/conversation.ts", "src/recruitment/brief.ts", "src/recruitment/brief-interpreter.ts", "src/recruitment/candidate-search-intent.ts",
    "src/recruitment/conversation/required-investigation.ts", "src/recruitment/conversation/understanding-node.ts", "src/recruitment/conversation/planning-node.ts",
    "src/recruitment/reference-similarity.ts", "src/sources/fm/fused-repository.ts", "src/sources/fm/repository.ts",
  ].map(file => readFile(file, "utf8")))).join("\n")).digest("hex");
  await persist();
  if (values.mode === "identity") {
    const primary = createWikidataPlayerNameResolver();
    const apiKey = process.env.TAVILY_API_KEY?.trim();
    const fallbackEnabled = process.env.TACTISCOUT_TAVILY_IDENTITY_SEARCH_ENABLED === "true" && Boolean(apiKey);
    const fallback = fallbackEnabled ? createTavilyBackedPlayerNameResolver({ apiKey: apiKey!, primaryResolver: primary }) : primary;
    protocol.fallbackEnabled = fallbackEnabled;
    for (const [mention, expected] of [["切尔基", "Q64736321"], ["Rayan Cherki", "Q64736321"]]) {
      for (const [arm, resolver] of [["wikidata-only", primary], ["configured-fallback", fallback]] as const) {
        const started = performance.now();
        const result = await resolver(mention!, AbortSignal.timeout(45000));
        runs.push({ mention, arm, elapsedMs: performance.now() - started, result,
          resolvedCorrectly: result.status === "resolved" && result.player.entityId === expected,
          wrongIdentity: result.status === "resolved" && result.player.entityId !== expected });
        await persist();
      }
    }
  } else {
    const raw = await readFile(values.snapshot!, "utf8");
    const players = z.array(PlayerProfileSchema).parse(JSON.parse(raw));
    protocol.snapshotSha256 = createHash("sha256").update(raw).digest("hex");
    protocol.frozenToday = new Date().toISOString().slice(0, 10);
    const resolver = createConfiguredPlayerNameResolver();
    const identity = await resolver("切尔基", AbortSignal.timeout(45000));
    protocol.frozenReferenceResolution = identity;
    await persist();
    for (const arm of values.arm ? [values.arm as typeof arms[number]] : arms) {
      const profiles = new FmProfileRepository(process.env.TACTISCOUT_FM_PROFILES_PATH ?? ".data/fm/profiles-v2.sqlite");
      protocol.profileSha256 = profiles.manifest.sha256;
      const registry = process.env.TACTISCOUT_REEP_IDENTITY_DB_PATH ? new ReepIdentityRegistry(process.env.TACTISCOUT_REEP_IDENTITY_DB_PATH) : undefined;
      const repository = new FusedPlayerRepository({ mode: "understat", sourceName: "Frozen performance catalog",
        async loadPlayers() { return players; }, async searchCandidates(query) { return searchLoadedPlayers(players, query); } }, profiles, registry, "combined", () => String(protocol.frozenToday));
      const trace: RecruitmentTraceEvent[] = [];
      const model = createRecruitmentPlanner();
      const conversation = createRecruitmentConversation({ repository, briefInterpreter: createRecruitmentBriefInterpreter(),
        referenceNameResolver: async () => identity,
        planner: arm === "fixed-investigation" ? createSinglePassInvestigationPlanner(model) : model,
        experimentalReferenceComparisonMode: arm === "reference-off" ? "bypassed" : "enabled",
        experimentalAskUserMode: arm === "clarification-off" ? "disabled" : "enabled",
        experimentalDeterministicSearchMode: "enabled", experimentalRetrievalMode: "on_demand",
        knowledgeBase: { async search() { return []; } }, observer: event => { trace.push(event);
          if (event.phase === "decision") process.stdout.write(`${arm}: ${event.action}\n`);
          if (event.phase === "brief_failure") process.stdout.write(`${arm}: brief failure ${event.failureKind}\n`);
        },
      });
      const started = performance.now(), threadId = randomUUID();
      const clarification = arm.startsWith("clarification");
      const message = clarification ? "想找一位新球员补强，但还没确定补强哪个位置。" : "推荐类似切尔基的球员";
      let result: unknown;
      let errorName: string | undefined;
      try {
        const signal = AbortSignal.timeout(300000);
        let response = await conversation.turn({ threadId, message, signal });
        if (arm === "clarification" && response.status === "needs_input") response = await conversation.turn({ threadId,
          message: "补强中前卫 CM，优先组织传球与持球推进；年龄和联赛不限。", expectsExistingState: true, signal });
        result = response;
      } catch (error) { errorName = error instanceof Error ? error.name : "unknown"; }
      finally { repository.close(); }
      const usage = trace.filter(event => event.phase === "model_usage" || event.phase === "brief_usage" || event.phase === "identity_usage");
      const tokens = (key: "inputTokens" | "outputTokens" | "totalTokens") => usage.length && usage.every(event => event[key] !== undefined)
        ? usage.reduce((sum, event) => sum + event[key]!, 0) : null;
      runs.push({ arm, message, elapsedMs: performance.now() - started, result, errorName, trace,
        plannerDecisions: trace.filter(event => event.phase === "decision" && event.decisionSource === "planner").length,
        modelCalls: usage.length, inputTokens: tokens("inputTokens"), outputTokens: tokens("outputTokens"), totalTokens: tokens("totalTokens"),
        candidateSearches: trace.filter(event => event.phase === "tool" && event.toolName === "search_candidates" && event.ok).length,
        evaluations: trace.filter(event => event.phase === "tool" && event.toolName === "evaluate_candidates" && event.ok).length,
        allowedQuestions: trace.filter(event => event.phase === "decision" && event.askPolicyOutcome === "allowed").length,
        suppressedQuestions: trace.filter(event => event.phase === "decision" && event.askPolicyOutcome === "suppressed").length });
      await persist();
      process.stdout.write(`Completed ${arm}\n`);
    }
  }
} finally { await output.close(); }
