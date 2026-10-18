import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const run = promisify(execFile);
const cli = "src/evaluation/fm-fusion-cli.ts";
test("FM fusion CLI documents frozen inputs and three named scenarios", async () => {
  const result = await run(process.execPath, ["--import", "tsx", cli, "--help"]);
  assert.match(result.stdout, /--snapshot/);
  assert.match(result.stdout, /--profiles/);
  assert.match(result.stdout, /sweeper-keeper/);
});
test("FM fusion CLI refuses existing output before reading inputs or contacting the model", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "fm-cli-"));
  try {
    const output = path.join(directory, "existing.json");
    await writeFile(output, "keep-me");
    await assert.rejects(run(process.execPath, ["--import", "tsx", cli, "--snapshot", "/missing/snapshot", "--profiles", "/missing/profiles", "--identity", "/missing/identity", "--output", output]), (error: unknown) => {
      assert.match(String((error as { stderr: string }).stderr), /EEXIST/);
      return true;
    });
    assert.equal(await readFile(output, "utf8"), "keep-me");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
