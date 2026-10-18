import "dotenv/config";
import { parseArgs } from "node:util";
import { importFmProfiles } from "./import.js";

const { values } = parseArgs({ options: {
  csv: { type: "string" }, output: { type: "string", default: ".data/fm/profiles.sqlite" },
  "in-game-date": { type: "string" }, "game-build": { type: "string" },
  "database-version": { type: "string" }, "parser-version": { type: "string" },
  "male-only-confirmed": { type: "boolean", default: false },
} });
if (!values.csv || !values["in-game-date"] || !values["game-build"] || !values["database-version"] || !values["parser-version"]) {
  throw new Error("Usage: pnpm dataset:import:fm --csv <path> --in-game-date YYYY-MM-DD --game-build <version> --database-version <version> --parser-version <version> [--output <path>]");
}
const manifest = await importFmProfiles({
  csvPath: values.csv, outputPath: values.output!, inGameDate: values["in-game-date"],
  gameBuild: values["game-build"], databaseVersion: values["database-version"], parserVersion: values["parser-version"],
  maleOnlyConfirmed: values["male-only-confirmed"],
});
console.log(JSON.stringify({ outputPath: values.output, ...manifest }, null, 2));
