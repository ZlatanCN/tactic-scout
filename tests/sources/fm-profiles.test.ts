import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { FmRetainedFields } from "../../src/sources/fm/profile.js";
import { importFmProfiles } from "../../src/sources/fm/import.js";
import { FmProfileRepository } from "../../src/sources/fm/repository.js";

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
function fixture(records: Record<string, string>[]): string {
  const headers = [...FmRetainedFields, "contract_wage", "club_name"];
  return "\uFEFF" + [headers, ...records.map((record) => headers.map((key) => record[key] ?? ""))]
    .map((row) => row.map(quote).join(",")).join("\r\n") + "\r\n";
}

test("FM import preserves the approved profile, indexes ambiguous aliases and publishes without overwrite", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "fm-profiles-"));
  const csvPath = path.join(directory, "players.csv"), outputPath = path.join(directory, "profiles.sqlite");
  try {
    assert.equal(FmRetainedFields.length, 156);
    await writeFile(csvPath, fixture([
      { uid: "1", unique_id: "101", name: 'Álex, "A"', full_name: "Alex\nOne", last_name: "Shared", birth_date: "2000-02-29", positions_mc: "20", raw_attributes_passing: "87", attributes_passing: "17", contract_wage: "999", club_name: "Private Club" },
      { uid: "2", unique_id: "102", name: "Other", last_name: "Shared", positions_mc: "15", raw_attributes_passing: "0" },
    ]));
    const options = { csvPath, outputPath, inGameDate: "2025-11-23", gameBuild: "26.3.2", databaseVersion: "26.2.0", parserVersion: "0.5.10", maleOnlyConfirmed: true };
    const manifest = await importFmProfiles(options);
    assert.equal(manifest.playerCount, 2);
    assert.equal(manifest.genderScope, "male_confirmed");
    assert.equal(manifest.scopeAttestation, "dataset_owner");
    assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
    const repository = new FmProfileRepository(outputPath);
    try {
      const first = repository.lookupName('Alex, "A"')[0]!;
      assert.equal(first.name, 'Álex, "A"');
      assert.equal(first.attributes.passing.raw, 87);
      assert.equal(first.attributes.passing.display, 17);
      assert.equal(first.aliases.includes("Alex\nOne"), true);
      assert.equal("club_name" in first.retainedFields, false);
      assert.equal("contract_wage" in first.retainedFields, false);
      assert.equal(repository.lookupName("Shared").length, 2);
      assert.equal(repository.getByRecordId("2")!.attributes.passing.raw, null);
      const page = repository.search({ position: "mc", limit: 1 });
      assert.equal(page.total, 2);
      assert.equal(page.nextOffset, 1);
      assert.equal(repository.search({ position: "mc", offset: 1, limit: 1 }).nextOffset, null);
      const referencePage = repository.searchCatalog({ positions: ["mc"], referenceRoles: { playmaker: 50 }, offset: 0, limit: 2 });
      assert.equal(referencePage.total, 2);
      assert.equal(new Set(referencePage.players.map(player => player.recordId)).size, 2);
      assert.equal(repository.getByRecordId("missing"), null);
      const controller = new AbortController(); controller.abort();
      assert.throws(() => repository.lookupName("Shared", controller.signal));
    } finally { repository.close(); }
    const before = await readFile(outputPath);
    await assert.rejects(importFmProfiles(options), /Refusing to overwrite/);
    assert.deepEqual(await readFile(outputPath), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("FM import rejects corrupt ratings and incomplete exports without publishing a database", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "fm-invalid-"));
  try {
    const csvPath = path.join(directory, "players.csv"), outputPath = path.join(directory, "profiles.sqlite");
    const options = { csvPath, outputPath, inGameDate: "2025-11-23", gameBuild: "26.3.2", databaseVersion: "26.2.0", parserVersion: "0.5.10" };
    await writeFile(csvPath, fixture([{ uid: "1", name: "Invalid", raw_attributes_passing: "101" }]));
    await assert.rejects(importFmProfiles(options), /Invalid FM rating/);
    await assert.rejects(readFile(outputPath), { code: "ENOENT" });
    await writeFile(csvPath, "uid,name\n1,Player\n");
    await assert.rejects(importFmProfiles(options), /Missing FM fields/);
    await assert.rejects(readFile(outputPath), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
