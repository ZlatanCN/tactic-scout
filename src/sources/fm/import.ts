import { createReadStream } from "node:fs";
import { access, link, mkdir, rm } from "node:fs/promises";
import { createHash, randomUUID, type Hash } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deflateRawSync } from "node:zlib";
import { FmPositionKeys, FmRetainedFields, normalizeFmName, parseFmPlayer, type FmSnapshotManifest } from "./profile.js";
import { assessFmRole, FmRoleTemplates, type FmRoleId } from "./role-fit.js";

// Streaming CSV state machine: quoted commas, escaped quotes and multiline cells survive chunk boundaries.
async function* csvRows(inputPath: string, hash: Hash): AsyncGenerator<string[]> {
  const input = createReadStream(inputPath);
  const decoder = new TextDecoder("utf8", { fatal: true });
  let row: string[] = [], cell = "", state: "plain" | "quoted" | "closed" = "plain";
  let first = true, skipLf = false;
  for await (const chunk of input) {
    hash.update(chunk);
    for (const char of decoder.decode(chunk, { stream: true })) {
      if (first) { first = false; if (char === "\uFEFF") continue; }
      if (skipLf) { skipLf = false; if (char === "\n") continue; }
      if (state === "quoted") {
        if (char === '"') state = "closed"; else cell += char;
        continue;
      }
      if (state === "closed" && char === '"') { cell += '"'; state = "quoted"; continue; }
      if (char === ",") { row.push(cell); cell = ""; state = "plain"; continue; }
      if (char === "\n" || char === "\r") {
        row.push(cell); yield row; row = []; cell = ""; state = "plain"; skipLf = char === "\r"; continue;
      }
      if (state === "closed") throw new Error("Unexpected character after closing CSV quote.");
      if (char === '"') {
        if (cell) throw new Error("Unexpected quote in unquoted CSV cell.");
        state = "quoted";
      } else cell += char;
    }
  }
  decoder.decode();
  if (state === "quoted") throw new Error("Unclosed CSV quoted cell.");
  if (cell || row.length || state === "closed") { row.push(cell); yield row; }
}

export interface ImportFmOptions {
  csvPath: string;
  outputPath: string;
  inGameDate: string;
  gameBuild: string;
  databaseVersion: string;
  parserVersion: string;
  maleOnlyConfirmed?: boolean;
}

export async function importFmProfiles(options: ImportFmOptions): Promise<FmSnapshotManifest> {
  const { csvPath, outputPath, inGameDate, gameBuild, databaseVersion, parserVersion } = options;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inGameDate) || !Number.isFinite(Date.parse(inGameDate))
      || new Date(inGameDate).toISOString().slice(0, 10) !== inGameDate) throw new Error("A valid in-game date is required.");
  if (![gameBuild, databaseVersion, parserVersion].every((value) => value.trim())) throw new Error("Game, database and parser versions are required.");
  try { await access(outputPath); throw new Error(`Refusing to overwrite ${outputPath}`); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  const database = new DatabaseSync(temporaryPath);
  try {
    database.exec(`
      PRAGMA journal_mode=DELETE;
      CREATE TABLE manifest (id INTEGER PRIMARY KEY CHECK (id=1), payload TEXT NOT NULL);
      CREATE TABLE players (record_id TEXT PRIMARY KEY, unique_id TEXT, name TEXT NOT NULL, birth_date TEXT, payload BLOB NOT NULL);
      CREATE TABLE aliases (name TEXT NOT NULL, record_id TEXT NOT NULL, PRIMARY KEY(name, record_id));
      CREATE TABLE positions (position TEXT NOT NULL, rating INTEGER NOT NULL, record_id TEXT NOT NULL, PRIMARY KEY(position, record_id));
      CREATE TABLE role_scores (role TEXT NOT NULL, record_id TEXT NOT NULL, priority REAL NOT NULL, PRIMARY KEY(role, record_id));
      CREATE INDEX role_priority ON role_scores(role, priority DESC);
      CREATE INDEX player_unique_id ON players(unique_id);
      CREATE INDEX player_birth_date ON players(birth_date);
      CREATE INDEX position_rating ON positions(position, rating DESC);
      BEGIN;
    `);
    const insert = database.prepare("INSERT INTO players VALUES (?, ?, ?, ?, ?)");
    const alias = database.prepare("INSERT OR IGNORE INTO aliases VALUES (?, ?)");
    const position = database.prepare("INSERT INTO positions VALUES (?, ?, ?)");
    const roleScore = database.prepare("INSERT INTO role_scores VALUES (?, ?, ?)");
    let headers: string[] | undefined, playerCount = 0;
    const hash = createHash("sha256");
    for await (const cells of csvRows(csvPath, hash)) {
      if (!headers) {
        if (cells.some((value) => !value) || new Set(cells).size !== cells.length) throw new Error("Empty or duplicate CSV header.");
        const missing = FmRetainedFields.filter((field) => !cells.includes(field));
        if (missing.length) throw new Error(`Missing FM fields: ${missing.join(", ")}`);
        headers = cells; continue;
      }
      if (cells.length !== headers.length) throw new Error(`FM record ${playerCount + 1} has ${cells.length} cells, expected ${headers.length}.`);
      const player = parseFmPlayer(Object.fromEntries(headers.map((header, index) => [header, cells[index]!])));
      insert.run(player.recordId, player.uniqueId, player.name, player.birthDate, deflateRawSync(JSON.stringify(player.retainedFields)));
      for (const name of player.aliases) {
        const normalized = normalizeFmName(name);
        if (normalized) alias.run(normalized, player.recordId);
      }
      for (const key of FmPositionKeys) {
        const value = player.positions[key];
        if (value !== null) position.run(key, value, player.recordId);
      }
      for (const role of Object.keys(FmRoleTemplates) as FmRoleId[]) {
        const assessment = assessFmRole(player, role);
        if (assessment.positionCompatible) roleScore.run(role, player.recordId, assessment.searchPriority);
      }
      playerCount++;
    }
    if (!headers || playerCount === 0) throw new Error("FM export contains no players.");
    const manifest: FmSnapshotManifest = {
      schemaVersion: 2, sha256: hash.digest("hex"), importedAt: new Date().toISOString(),
      inGameDate, gameBuild, databaseVersion, parserVersion, playerCount,
      retainedFieldCount: FmRetainedFields.length,
      genderScope: options.maleOnlyConfirmed ? "male_confirmed" : "unverified",
      scopeAttestation: options.maleOnlyConfirmed ? "dataset_owner" : null,
    };
    database.prepare("INSERT INTO manifest VALUES (1, ?)").run(JSON.stringify(manifest));
    database.exec("COMMIT; PRAGMA optimize;");
    database.close();
    // Atomic no-clobber publication; a concurrent importer cannot overwrite a completed snapshot.
    await link(temporaryPath, outputPath);
    return manifest;
  } finally {
    if (database.isOpen) database.close();
    await rm(temporaryPath, { force: true });
  }
}
