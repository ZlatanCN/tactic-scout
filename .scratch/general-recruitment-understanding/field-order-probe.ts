import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { z } from "zod/v4";
import { createChatModel, structuredOutputMethod } from "../../src/recruitment/chat-model.js";
import { RecruitmentBriefSchema, validateRecruitmentBrief } from "../../src/recruitment/brief.js";
import { briefInterpretationInstructions } from "../../src/recruitment/brief-interpreter.js";
import { normalizeModelTokenUsage } from "../../src/recruitment/recruitment-planner.js";

const { task, referencePlayer, ...rest } = RecruitmentBriefSchema.shape;
const schemas = { taskFirst: RecruitmentBriefSchema, referenceFirst: z.object({ referencePlayer, ...rest, task }) };
const runs: unknown[] = [];
for (const [message, expected] of [["我想为巴萨找一个新的后卫", "reinforcement"], ["找一个能拿球推进的中前卫", "reinforcement"], ["推荐类似切尔基的球员", "similarity"]]) {
  for (const [order, schema] of Object.entries(schemas)) {
    const model = createChatModel(process.env.OPENAI_API_KEY!, process.env.OPENAI_MODEL!, { maxOutputTokens: 2048 }).withStructuredOutput(schema,
      { method: structuredOutputMethod(), includeRaw: true, name: "recruitment_brief" });
    const start = performance.now();
    const response = await model.invoke([["system", briefInterpretationInstructions], ["human", JSON.stringify({ previous: null, recentMessages: [], visibleCandidates: [], message })]], { signal: AbortSignal.timeout(90000) });
    let validation: string | undefined;
    try { validateRecruitmentBrief(response.parsed, [message!]); } catch (error) { validation = error instanceof Error ? error.message : "unknown"; }
    runs.push({ message, expected, order, elapsedMs: performance.now() - start, parsed: response.parsed, validation,
      ...normalizeModelTokenUsage(response), finishReason: response.raw.response_metadata.finish_reason });
    await writeFile("/tmp/tactiscout-field-order-v1.json", JSON.stringify({ model: process.env.OPENAI_MODEL, runs }, null, 2), { mode: 0o600 });
    console.log(`${runs.length}/6`);
  }
}
