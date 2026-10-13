import "dotenv/config";
import { OpenScoresSmokeError, runOpenScoresSmoke } from "./openscores-mcp-smoke.js";

try {
  const result = await runOpenScoresSmoke({
    apiKey: process.env.OPENSCORES_API_KEY ?? "",
    teamName: process.env.TACTISCOUT_OPENSCORES_TEAM_NAME ?? "Arsenal",
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (error instanceof OpenScoresSmokeError) {
    console.error(`OpenScores smoke stopped: ${error.message}`);
  } else {
    console.error("OpenScores smoke stopped unexpectedly; no response data was printed.");
  }
  process.exitCode = 1;
}
