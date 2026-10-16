import "dotenv/config";
import { runSoccersApiSmoke, SoccersApiSmokeError } from "./smoke.js";

try {
  const result = await runSoccersApiSmoke({
    apiKey: process.env.SOCCERSAPI_API_KEY ?? "",
    leagueName: process.env.TACTISCOUT_SOCCERSAPI_LEAGUE_NAME ?? "Premier League",
    countryCode: process.env.TACTISCOUT_SOCCERSAPI_COUNTRY_CODE ?? "ENG",
    teamName: process.env.TACTISCOUT_SOCCERSAPI_TEAM_NAME || undefined,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (error instanceof SoccersApiSmokeError) {
    console.error(`SoccersAPI smoke stopped: ${error.message}`);
  } else {
    console.error("SoccersAPI smoke stopped unexpectedly; no response data was printed.");
  }
  process.exitCode = 1;
}
