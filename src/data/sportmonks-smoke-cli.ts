import "dotenv/config";
import { SportmonksProviderError, runSportmonksSmoke } from "./sportmonks-provider.js";

try {
  const result = await runSportmonksSmoke({
    token: process.env.SPORTMONKS_API_TOKEN ?? "",
    seasonId: process.env.TACTISCOUT_SPORTMONKS_SMOKE_SEASON_ID ?? "",
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (error instanceof SportmonksProviderError) {
    console.error(`Sportmonks smoke stopped (${error.code}): ${error.message}`);
  } else {
    console.error("Sportmonks smoke stopped unexpectedly; no response data was printed.");
  }
  process.exitCode = 1;
}
