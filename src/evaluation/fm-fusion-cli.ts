import "dotenv/config";
import { open, readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { z } from "zod/v4";
import { PlayerProfileSchema } from "../domain/players.js";
import { FusedPlayerRepository, type ProfileEvidenceMode } from "../sources/fm/fused-repository.js";
import { FmProfileRepository } from "../sources/fm/repository.js";
import { ReepIdentityRegistry } from "../players/identity/reep-registry.js";
import { groupCandidatesByExactIdentity } from "../players/identity/candidate-groups.js";
import { createRecruitmentConversation, type RecruitmentTraceEvent } from "../recruitment/conversation.js";
import { createRecruitmentPlanner } from "../recruitment/recruitment-planner.js";

const scenarios = [
  { id: "link-forward", query: "为拜仁寻找中锋 ST，重点看接应做球和终结，年龄不限，联赛不限。", answer: "只看中锋 ST，接应做球和终结优先，年龄和联赛不限，请继续推荐。" },
  { id: "playmaker", query: "为巴萨寻找中前卫 CM，重点看组织、传球和持球推进，年龄不限，联赛不限。", answer: "只看中前卫 CM，组织传球与持球推进优先，年龄和联赛不限，请继续推荐。" },
  { id: "sweeper-keeper", query: "为拜仁寻找门将 GK，重点看出击、出球和门线扑救，年龄不限，联赛不限。", answer: "只看门将 GK，出击出球和扑救优先，年龄和联赛不限，请继续推荐。" },
] as const;
const help = "pnpm eval:fm-fusion --snapshot <frozen-players.json> --profiles <profiles.sqlite> --identity <reep.sqlite> --output <new-results.json> [--scenario link-forward|playmaker|sweeper-keeper] [--rounds 1]";

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const { values } = parseArgs({ args, options: {
    snapshot: { type: "string" }, profiles: { type: "string" }, identity: { type: "string" }, output: { type: "string" },
    scenario: { type: "string" }, rounds: { type: "string", default: "1" }, help: { type: "boolean" },
  } });
  if (values.help) { console.log(help); return; }
  if (!values.snapshot || !values.profiles || !values.identity || !values.output) throw new Error(help);
  const rounds = Number(values.rounds);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5) throw new Error("rounds must be 1–5");
  const selected = scenarios.filter((scenario) => !values.scenario || scenario.id === values.scenario);
  if (!selected.length) throw new Error("Unknown scenario");
  // Reserve before touching repositories or invoking the model. Never overwrite an earlier experiment.
  const output = await open(values.output, "wx", 0o600);
  try {
    const raw = await readFile(values.snapshot, "utf8");
    const players = z.array(PlayerProfileSchema).parse(JSON.parse(raw));
    const snapshotSha256 = createHash("sha256").update(raw).digest("hex");
    const frozenToday = new Date().toISOString().slice(0, 10);
    const runs: Array<Record<string, unknown>> = [];
    let profileSha256: string | undefined;
    const persist = async () => {
      const text = JSON.stringify({ protocol: "fm-fusion-v1", snapshotSha256, profileSha256, frozenToday,
        model: process.env.OPENAI_MODEL, rounds, retrieval: "on_demand with an empty frozen knowledge repository in every arm", researchMode: "catalog_only", scenarios: selected,
        limitation: "Behavior and evidence coverage only. No human labels or demonstrated recommendation-quality gain. Ability-only players have no current-team or match claims.", runs }, null, 2);
      await output.truncate(0); await output.write(text, 0, "utf8"); await output.sync();
    };
    for (let round = 0; round < rounds; round++) for (const scenario of selected) {
      const arms: ProfileEvidenceMode[] = ["performance_only", "ability_only", "combined"];
      for (const arm of round % 2 ? arms.reverse() : arms) {
        const profiles = new FmProfileRepository(values.profiles);
        profileSha256 = profiles.manifest.sha256;
        const registry = new ReepIdentityRegistry(values.identity);
        const repository = new FusedPlayerRepository({ mode: "understat", sourceName: "Frozen performance snapshot", loadPlayers: async () => players }, profiles, registry, arm, () => frozenToday);
        const trace: RecruitmentTraceEvent[] = [];
        const started = Date.now();
        console.log(JSON.stringify({ event: "started", round, scenario: scenario.id, arm }));
        try {
          const modelPlanner = createRecruitmentPlanner();
          const conversation = createRecruitmentConversation({ repository, planner: { decide: async (input) => {
            console.log(JSON.stringify({ event: "planning", round, scenario: scenario.id, arm, decisionMode: input.decisionMode,
              historyCharacters: input.history.reduce((sum, entry) => sum + entry.content.length, 0), eligibleCandidates: input.constraints?.evaluatedCandidates.length ?? null }));
            return modelPlanner.decide(input);
          } },
            experimentalUnderstatResearchMode: "catalog_only",
            experimentalRetrievalMode: "on_demand",
            experimentalDeterministicSearchMode: "enabled",
            knowledgeBase: { search: async () => [] }, candidateIdentityGrouper: (records) => groupCandidatesByExactIdentity(records, registry),
            observer: (event) => {
              trace.push(event);
              if (event.phase === "tool" || event.phase === "model_usage") console.log(JSON.stringify({ event: "trace", round, scenario: scenario.id, arm, ...event }));
            },
          });
          const threadId = randomUUID(), signal = AbortSignal.timeout(240_000);
          let result = await conversation.turn({ threadId, message: scenario.query, signal });
          for (let followup = 0; result.status === "needs_input" && followup < 2; followup++) {
            result = await conversation.turn({ threadId, message: scenario.answer, expectsExistingState: true, signal });
          }
          runs.push({ round, scenario: scenario.id, arm, status: result.status, elapsedMs: Date.now() - started,
            report: result.report ?? null });
        } catch (error) {
          runs.push({ round, scenario: scenario.id, arm, status: "failed", elapsedMs: Date.now() - started, error: error instanceof Error ? error.name : "UnknownError" });
        } finally { repository.close(); }
        const usage = trace.filter((event) => event.phase === "model_usage");
        const total = (key: "inputTokens" | "outputTokens" | "totalTokens") => usage.length > 0 && usage.every((event) => event[key] !== undefined)
          ? usage.reduce((sum, event) => sum + event[key]!, 0) : null;
        Object.assign(runs.at(-1)!, { plannerCalls: usage.length, inputTokens: total("inputTokens"), outputTokens: total("outputTokens"), totalTokens: total("totalTokens"),
          tools: trace.filter((event) => event.phase === "tool").map((event) => event.toolName) });
        await persist();
        console.log(JSON.stringify({ event: "completed", round, scenario: scenario.id, arm, status: runs.at(-1)?.status, elapsedMs: runs.at(-1)?.elapsedMs }));
      }
    }
  } finally { await output.close(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Experiment failed"); process.exitCode = 1; });
