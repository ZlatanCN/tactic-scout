import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
for (const cli of ["recruitment-understanding", "recruitment-mechanisms", "player-identity"]) {
  test(`${cli} CLI documents its experiment and refuses existing output before model access`, async () => {
    const entry = `src/evaluation/${cli}-cli.ts`;
    const help = await run(process.execPath, ["--import", "tsx", entry, "--help"]);
    assert.match(help.stdout, /--output/);
    assert.match(help.stdout, cli === "recruitment-understanding" ? /heldout\|followup/ : cli === "player-identity" ? /context-off/ : /reference-off/);
    const directory = await mkdtemp(path.join(tmpdir(), "recruitment-cli-"));
    try {
      const output = path.join(directory, "existing.json");
      await writeFile(output, "keep-existing-result");
      const experimentArguments = cli === "recruitment-mechanisms" ? ["--mode", "graph", "--snapshot", "/missing/frozen-snapshot.json"] : [];
      await assert.rejects(run(process.execPath, ["--import", "tsx", entry, ...experimentArguments, "--output", output], {
        env: { ...process.env, OPENAI_API_KEY: "", OPENAI_MODEL: "", OPENAI_BASE_URL: "http://127.0.0.1:1/v1" },
      }), error => error instanceof Error && "stderr" in error && String(error.stderr).includes("EEXIST"));
      assert.equal(await readFile(output, "utf8"), "keep-existing-result");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}
