import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type PlayerProfile } from "../domain/schemas.js";
import { type PlayerRepository } from "./player-repository.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const demoFile = path.join(projectRoot, "data", "demo-players.json");

interface DemoDataset {
  source: string;
  players: Array<Omit<PlayerProfile, "source">>;
}

export class DemoPlayerRepository implements PlayerRepository {
  readonly mode = "demo" as const;
  readonly sourceName = "Fictional TactiScout demo data";
  private cached?: Promise<PlayerProfile[]>;

  loadPlayers(refresh = false): Promise<PlayerProfile[]> {
    if (refresh) this.cached = undefined;
    this.cached ??= readJson<DemoDataset>(demoFile).then((dataset) => dataset.players.map((player) => ({ ...player, source: dataset.source })));
    return this.cached;
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}
