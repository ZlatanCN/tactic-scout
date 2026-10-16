import { createFootballDataRoster } from "./data/football-data-roster.js";
import "dotenv/config";
import { createApp } from "./app.js";
import { createTheSportsDbRosterEnrichment } from "./data/thesportsdb-roster.js";

const thesportsdbEnabled = process.env.TACTISCOUT_THESPORTSDB_ENABLED === "true";
const app = createApp({
  ...(process.env.TACTISCOUT_FOOTBALL_DATA_API_KEY ? {
    teamRosterEnrichment: createFootballDataRoster({ apiKey: process.env.TACTISCOUT_FOOTBALL_DATA_API_KEY }),
  } : thesportsdbEnabled ? {
    teamRosterEnrichment: createTheSportsDbRosterEnrichment({
      apiKey: process.env.TACTISCOUT_THESPORTSDB_API_KEY ?? "",
      fetchEnabled: true,
      paidUseAllowed: process.env.TACTISCOUT_THESPORTSDB_PAID_USE_ALLOWED === "true",
    }),
  } : {}),
});
const port = Number(process.env.PORT ?? 8000);
const host = process.env.HOST ?? "127.0.0.1";

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
