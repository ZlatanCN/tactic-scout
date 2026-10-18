import "dotenv/config";
import { RecruitmentBriefSchema } from "../../src/domain/recruitment-brief.js";
import { createRecruitmentBriefInterpreter } from "../../src/recruitment/brief-interpreter.js";

const previous = RecruitmentBriefSchema.parse({ task: "similarity", targetTeam: null, referencePlayer: { value: "奥利赛", basis: "explicit", quote: "奥利赛" },
  positions: [], allowsAnyPosition: false, filters: { maxAge: null, minimumMinutes: 0, competition: null, season: null }, priorities: [], constraints: [], unresolved: [] });
try {
  await createRecruitmentBriefInterpreter().interpret({ message: "都不是，重新查找", previous,
    recentMessages: ["推荐类似奥利赛的球员"], clarificationQuestion: "奥利赛是下面哪位球员？" });
  console.log("Model invocation succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const safe = message.replace(/(api[-_ ]?key|authorization|bearer)(\s*[:=]?\s*)[^\s,;]+/gi, "$1$2[REDACTED]").slice(0, 500);
  console.log(JSON.stringify({ errorName: error instanceof Error ? error.name : "unknown", message: safe }));
  process.exitCode = 1;
}
