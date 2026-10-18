import "dotenv/config";
import { open } from "node:fs/promises";
import { parseArgs } from "node:util";
import { runPlayerIdentityAblation } from "./player-identity-ablation.js";

const { values } = parseArgs({ options: { output: { type: "string" }, mode: { type: "string", default: "frozen" }, help: { type: "boolean" } } });
if (values.help) { console.log("pnpm eval:player-identity --mode frozen|live --output <new-private.json>\nfrozen: full/local-off/model-off/context-off/web-off; live: configured local catalog, identity services and actual model leads."); process.exit(0); }
if (!values.output || !["frozen", "live"].includes(values.mode)) throw new Error("需要 --mode frozen|live 和尚不存在的 --output。");
const output = await open(values.output, "wx", 0o600);
try {
  if (values.mode === "frozen") await output.writeFile(JSON.stringify(await runPlayerIdentityAblation(), null, 2));
  else {
    const { createRepository } = await import("../sources/registry.js");
    const { createConfiguredPlayerNameResolver } = await import("../players/identity/name-resolver.js");
    const { createPlayerNameVariantGenerator } = await import("../recruitment/player-name-variants.js");
    const repository = createRepository();
    try {
      const rows: unknown[] = [];
      const persist = async () => { await output.truncate(0); await output.write(JSON.stringify({ protocol: "player-identity-live-v1", model: process.env.OPENAI_MODEL, rows }, null, 2), 0, "utf8"); await output.sync(); };
      await persist();
      for (const mention of ["切尔基", "切耳基", "魔笛", "Rayan Cherki"]) {
        const usage: unknown[] = [];
        const leads: string[][] = [];
        const generator = createPlayerNameVariantGenerator(event => usage.push(event));
        const resolver = createConfiguredPlayerNameResolver(process.env, { repository, variants: generator ? async (mention, context, signal) => {
          const names = await generator(mention, context, signal); leads.push(names); return names;
        } : undefined });
        const started = performance.now();
        try {
          const result = await resolver(mention, AbortSignal.timeout(120_000), { scopeId: `live:${mention}` });
          rows.push({ mention, elapsedMs: performance.now() - started, result, usage, leads });
        } catch (error) { rows.push({ mention, elapsedMs: performance.now() - started, error: error instanceof Error ? error.name : "unknown", usage }); }
        await persist(); console.log(`Completed ${rows.length}/4`);
      }
    } finally { repository.close?.(); }
  }
} finally { await output.close(); }
