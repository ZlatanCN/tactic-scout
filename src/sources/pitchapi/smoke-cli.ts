import "dotenv/config";
import { PitchApiSmokeError, runPitchApiSmoke } from "./smoke.js";

try {
  const result = await runPitchApiSmoke({
    apiKey: process.env.PITCHAPI_API_KEY ?? "",
    leagueName: process.env.TACTISCOUT_PITCHAPI_LEAGUE_NAME ?? "Premier League",
    countryCode: process.env.TACTISCOUT_PITCHAPI_COUNTRY_CODE ?? "ENG",
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (error instanceof PitchApiSmokeError) {
    console.error(`PitchAPI smoke stopped: ${error.message}`);
  } else {
    console.error("PitchAPI smoke stopped unexpectedly; no response data was printed.");
  }
  process.exitCode = 1;
}
