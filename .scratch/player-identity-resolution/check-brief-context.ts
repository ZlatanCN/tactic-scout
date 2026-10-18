import "dotenv/config";
import { open } from "node:fs/promises";
import { RecruitmentBriefSchema } from "../../src/domain/recruitment-brief.js";
import { createRecruitmentBriefInterpreter } from "../../src/recruitment/brief-interpreter.js";

const output = await open("/tmp/tactiscout-identity-brief-context-v1.json", "wx", 0o600);
const previous = RecruitmentBriefSchema.parse({ task: "similarity", targetTeam: null, referencePlayer: { value: "奥利赛", basis: "explicit", quote: "奥利赛" },
  positions: [], allowsAnyPosition: false, filters: { maxAge: null, minimumMinutes: 0, competition: null, season: null }, priorities: [], constraints: [], unresolved: [] });
const cases = [
  { message: "都不是，重新查找", previous, reject: true },
  { message: "请重新核实这个人", previous, reject: false },
  { message: "为拜仁找罗德里的替代者", previous: null },
  { message: "推荐类似巴西的罗纳尔多的球员", previous: null },
];
const rows: unknown[] = [];
try {
  for (const item of cases) {
    const usage: unknown[] = [];
    try {
      const brief = await createRecruitmentBriefInterpreter().interpret({ message: item.message, previous: item.previous,
        recentMessages: item.previous ? ["推荐类似奥利赛的球员"] : [], signal: AbortSignal.timeout(90000),
        clarificationQuestion: item.previous ? "奥利赛是下面哪位球员？" : undefined, onUsage: event => usage.push(event) });
      rows.push({ message: item.message, brief, usage });
    } catch (error) { rows.push({ message: item.message, error: error instanceof Error ? error.name : "unknown", usage }); }
    await output.truncate(0); await output.write(JSON.stringify({ rows }, null, 2), 0, "utf8"); await output.sync();
    console.log(`Completed ${rows.length}/4`);
  }
} finally { await output.close(); }
