import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import path from "node:path";
import { z } from "zod/v4";
import { createFmFusionReviewPackets } from "./fm-fusion-review.js";
import { ReepIdentityRegistry } from "../players/identity/reep-registry.js";

const help = "pnpm export:fm-review --evaluation <fm-results.json> --identity <reep.sqlite> --output-dir <new-directory>";
const EvaluationSchema = z.object({
  protocol: z.literal("fm-fusion-v1"), snapshotSha256: z.string(), profileSha256: z.string(), frozenToday: z.string(),
  scenarios: z.array(z.object({ id: z.string(), query: z.string() })),
  runs: z.array(z.object({ scenario: z.string(), round: z.number().int().nonnegative(), arm: z.enum(["performance_only", "ability_only", "combined"]), status: z.string(), report: z.unknown() })),
});
async function main() {
  const args = process.argv.slice(2); if (args[0] === "--") args.shift();
  const { values } = parseArgs({ args, options: { evaluation: { type: "string" }, identity: { type: "string" }, "output-dir": { type: "string" }, help: { type: "boolean" } } });
  if (values.help) { console.log(help); return; }
  if (!values.evaluation || !values.identity || !values["output-dir"]) throw new Error(help);
  const evaluation = EvaluationSchema.parse(JSON.parse(await readFile(values.evaluation, "utf8")));
  const registry = new ReepIdentityRegistry(values.identity);
  try {
    const secret = randomBytes(32).toString("hex");
    const packets = evaluation.scenarios.map((scenario) => {
      if (!/^[a-z0-9-]+$/.test(scenario.id)) throw new Error("Invalid scenario filename");
      return { id: scenario.id, ...createFmFusionReviewPackets({ queryId: `fm-fusion:${scenario.id}`, roleBrief: scenario.query,
        runs: evaluation.runs.filter((run) => run.scenario === scenario.id), identityResolver: registry,
        performanceSha256: evaluation.snapshotSha256, profileSha256: evaluation.profileSha256, asOf: `${evaluation.frozenToday}T00:00:00.000Z`, blindingSecret: secret }) };
    });
    // Validate every packet before publishing any files; existing directories are never reused.
    await mkdir(values["output-dir"], { mode: 0o700 });
    for (const { id, reviewerPacket, answerKey } of packets) {
      await writeFile(path.join(values["output-dir"], `${id}-review.json`), JSON.stringify(reviewerPacket, null, 2), { flag: "wx", mode: 0o600 });
      await writeFile(path.join(values["output-dir"], `${id}-answer-key.json`), JSON.stringify(answerKey, null, 2), { flag: "wx", mode: 0o600 });
      console.log(JSON.stringify({ scenario: id, cards: reviewerPacket.cards.length }));
    }
  } finally { registry.close(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Review export failed"); process.exitCode = 1; });
