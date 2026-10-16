import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createRecruitmentConversation, type RecruitmentTraceEvent } from "../recruitment/conversation.js";
import { createRecruitmentPlanner } from "../recruitment/recruitment-planner.js";
import { UnderstatPlayerRepository } from "../sources/understat/provider.js";
import { searchLoadedPlayers } from "../players/search.js";
import { createLocalKnowledgeBase } from "../knowledge/index.js";
import { type PlayerProfile } from "../domain/players.js";

// One bounded experiment, not a new evaluation platform. Freeze before invoking any model.
const directory = ".data/evaluations/agent-optimization";
await mkdir(directory, { recursive: true });
const snapshotPath = `${directory}/understat-snapshot.json`;
let raw: string;
try { raw = await readFile(snapshotPath, "utf8"); }
catch {
  const players = await new UnderstatPlayerRepository().loadPlayers();
  raw = JSON.stringify(players);
  await writeFile(snapshotPath, raw, { flag: "wx", mode: 0o600 });
}
const players = JSON.parse(raw) as PlayerProfile[];
const snapshotHash = createHash("sha256").update(raw).digest("hex");
const repository = { mode: "understat" as const, sourceName: "Frozen Understat snapshot", loadPlayers: async () => players,
  searchCandidates: async (query: Parameters<typeof searchLoadedPlayers>[1]) => searchLoadedPlayers(players, query) };
const knowledgeBase = createLocalKnowledgeBase();
const allArms = ["baseline", "reference-off", "comparison-off", "direct-search", "on-demand-rag", "reviewer-off"] as const;
const option = (name: string) => process.argv.slice(2).find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const requestedArms = option("arms")?.split(",");
const arms = requestedArms?.length
  ? requestedArms.map(arm => {
    if (!allArms.includes(arm as typeof allArms[number])) throw new Error(`Unknown optimization arm: ${arm}`);
    return arm as typeof allArms[number];
  })
  : allArms;
const outputName = option("output") ?? "results-v3.json";
if (outputName.includes("/") || outputName.includes("..")) throw new Error("Output must be a filename inside the evaluation directory");
const query = "为拜仁寻找凯恩的替代者，找前锋，重点看进球产出和创造机会，只考虑德甲，年龄不限。";
const answer = "延续前锋职责，细分位置不限；重点仍是进球产出和创造机会，年龄不限，只考虑德甲。";
const outputPath = `${directory}/${outputName}`;
let results: Array<Record<string, unknown>> = [];
try { results = JSON.parse(await readFile(outputPath, "utf8")).runs; } catch { /* First run. */ }
for (const round of [0, 1]) {
  for (const arm of round === 0 ? arms : [...arms].reverse()) {
    if (results.some(result => result.round === round && result.arm === arm && result.snapshotHash === snapshotHash)) continue;
    const trace: RecruitmentTraceEvent[] = [];
    const model = createRecruitmentPlanner();
    const planner = { decide: (input: Parameters<typeof model.decide>[0]) => model.decide(input) };
    const conversation = createRecruitmentConversation({ repository, planner, knowledgeBase,
      experimentalDeterministicSearchMode: arm === "direct-search" ? "bypassed" : "enabled",
      experimentalRetrievalMode: arm === "on-demand-rag" ? "on_demand" : "fixed",
      experimentalReferenceProfileMode: arm === "reference-off" ? "bypassed" : "enabled",
      experimentalCandidateComparisonMode: arm === "comparison-off" ? "bypassed" : "enabled",
      experimentalReviewerMode: arm === "reviewer-off" ? "bypassed" : "enabled",
      observer: event => trace.push(event),
    });
    const started = Date.now();
    const signal = AbortSignal.timeout(360000);
    let outcome: Record<string, unknown>;
    console.log(JSON.stringify({ event: "started", round, arm, snapshotHash }));
    try {
      const threadId = randomUUID();
      let result = await conversation.turn({ threadId, message: query, signal });
      for (let followup = 0; result.status === "needs_input" && followup < 2; followup++) result = await conversation.turn({ threadId, message: answer, expectsExistingState: true, signal });
      outcome = { status: result.status, validInvestigation: trace.some(event => event.phase === "tool" && event.toolName === "search_candidates") && trace.some(event => event.phase === "tool" && event.toolName === "evaluate_candidates"), report: result.report ?? null };
    } catch (error) { outcome = { status: "failed", errorName: error instanceof Error ? error.name : "UnknownError" }; }
    const usage = trace.filter(event => event.phase === "model_usage");
    const tokenField = (key: "inputTokens" | "outputTokens" | "totalTokens") => usage.length > 0 && usage.every(event => event[key] !== undefined) ? usage.reduce((sum, event) => sum + event[key]!, 0) : null;
    const record = { protocol: "v3-visible-reference-and-comparison-ablation", round, arm, snapshotHash, elapsedMs: Date.now() - started, model: process.env.OPENAI_MODEL,
      plannerCalls: usage.length, inputTokens: tokenField("inputTokens"), outputTokens: tokenField("outputTokens"), totalTokens: tokenField("totalTokens"),
      tools: trace.filter(event => event.phase === "tool").map(event => event.toolName), trace, ...outcome };
    results.push(record);
    await writeFile(outputPath, JSON.stringify({ query, answer, snapshotHash, limitations: "Two paired repetitions of one frozen scenario. Candidate inclusion and evidence validity measure behavior, not scouting accuracy. Reference profiles and candidate comparisons are deterministic report evidence; disabling them should not change planner judgment. Missing token usage remains null.", runs: results }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ event: "completed", round, arm, status: outcome.status, elapsedMs: record.elapsedMs, plannerCalls: record.plannerCalls, totalTokens: record.totalTokens }));
  }
}
