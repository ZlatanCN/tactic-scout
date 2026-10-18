import "dotenv/config";
import { open } from "node:fs/promises";
import { RecruitmentBriefSchema } from "../../src/domain/recruitment-brief.js";
import { createRecruitmentBriefInterpreter } from "../../src/recruitment/brief-interpreter.js";

const outputPath = process.env.TACTISCOUT_IDENTITY_BRIEF_OUTPUT ?? "/tmp/tactiscout-identity-brief-context-v2.json";
const output = await open(outputPath, "wx", 0o600);
const previous = RecruitmentBriefSchema.parse({ task: "similarity", targetTeam: null, referencePlayer: { value: "奥利赛", basis: "explicit", quote: "奥利赛" },
  positions: [], allowsAnyPosition: false, filters: { maxAge: null, minimumMinutes: 0, competition: null, season: null }, priorities: [], constraints: [], unresolved: [] });
const cases = [
  { message: "都不是，重新查找", previous, check: (brief: Awaited<ReturnType<ReturnType<typeof createRecruitmentBriefInterpreter>["interpret"]>>) => brief.referenceRecheck?.reject === true && brief.referenceRecheck.quote.includes("都不是") },
  { message: "请重新核实这个人", previous, check: (brief: Awaited<ReturnType<ReturnType<typeof createRecruitmentBriefInterpreter>["interpret"]>>) => brief.referenceRecheck?.reject === false && brief.referenceRecheck.quote.includes("重新核实") },
  { message: "为拜仁找罗德里的替代者", previous: null, check: (brief: Awaited<ReturnType<ReturnType<typeof createRecruitmentBriefInterpreter>["interpret"]>>) => brief.referenceClues?.length === 0 && brief.positions.length === 0 },
  { message: "推荐类似巴西的罗纳尔多的球员", previous: null, check: (brief: Awaited<ReturnType<ReturnType<typeof createRecruitmentBriefInterpreter>["interpret"]>>) => brief.referenceClues?.some(clue => clue.kind === "nationality" && clue.quote.includes("巴西")) === true },
];
const rows: unknown[] = [];
const failures: string[] = [];
try {
  for (const [index, item] of cases.entries()) {
    const usage: unknown[] = [];
    try {
      const brief = await createRecruitmentBriefInterpreter().interpret({ message: item.message, previous: item.previous,
        recentMessages: item.previous ? ["推荐类似奥利赛的球员"] : [],
        clarificationQuestion: item.previous ? "奥利赛是下面哪位球员？" : undefined, onUsage: event => usage.push(event) });
      const passed = Array.isArray(brief.referenceClues) && (brief.referenceRecheck === null || typeof brief.referenceRecheck === "object") && item.check(brief);
      rows.push({ message: item.message, passed, brief, usage });
      if (!passed) failures.push(`case ${index + 1}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const safeDetail = detail.replace(/(api[-_ ]?key|authorization|bearer)(\s*[:=]?\s*)[^\s,;]+/gi, "$1$2[REDACTED]").slice(0, 240);
      rows.push({ message: item.message, passed: false, error: error instanceof Error ? error.name : "unknown", detail: safeDetail, usage });
      failures.push(`case ${index + 1}`);
    }
    await output.truncate(0); await output.write(JSON.stringify({ rows, failures }, null, 2), 0, "utf8"); await output.sync();
    console.log(`Completed ${rows.length}/4`);
  }
} finally { await output.close(); }
console.log(`Semantic checks: ${cases.length - failures.length}/4`);
if (failures.length) process.exitCode = 1;
