import assert from "node:assert/strict";
import test from "node:test";
import {
  expansionInstructions,
  methodologySearchInstructions,
  normalizeModelTokenUsage,
  RecruitmentPlannerOutputError,
} from "../../src/recruitment/recruitment-planner.js";

const invalidOutput = {
  failure: "invalid_json" as const,
  contentKind: "blocks" as const,
  contentLength: 5_437,
  hasReasoningContent: false,
  toolCallCount: 0,
};

test("normalizes reported token usage per field and preserves explicit zero", () => {
  const response = {
    raw: {
      response_metadata: {
        usage: { prompt_tokens: 0, completion_tokens: -1, total_tokens: 209 },
      },
      usage_metadata: { input_tokens: 27, output_tokens: 182, total_tokens: 208 },
    },
  };

  assert.deepEqual(normalizeModelTokenUsage(response), {
    inputTokens: 0,
    outputTokens: 182,
    totalTokens: 209,
  });
  assert.deepEqual(normalizeModelTokenUsage({ raw: { response_metadata: { usage: {} } } }), {});
  assert.deepEqual(normalizeModelTokenUsage({ raw: {
    response_metadata: { usage: {
      prompt_tokens: 1.5,
      completion_tokens: Number.MAX_SAFE_INTEGER + 1,
      total_tokens: "209",
    } },
    usage_metadata: { input_tokens: -1, output_tokens: Infinity, total_tokens: null },
  } }), {});
});

test("a length-truncated planner response tells the user how to recover", () => {
  const error = new RecruitmentPlannerOutputError({ ...invalidOutput, finishReason: "length" });

  assert.match(error.message, /输出达到本次生成长度上限/);
  assert.match(error.message, /OPENAI_MAX_OUTPUT_TOKENS/);
});

test("a length-truncated expansion decision reports its stage-specific recovery setting", () => {
  const error = new RecruitmentPlannerOutputError({ ...invalidOutput, finishReason: "length" }, "expand");

  assert.match(error.message, /OPENAI_EXPANSION_MAX_OUTPUT_TOKENS/);
  assert.doesNotMatch(error.message, /OPENAI_MAX_OUTPUT_TOKENS 后重试/);
});

test("other structured planner output failures keep the compatibility guidance", () => {
  const error = new RecruitmentPlannerOutputError(invalidOutput);

  assert.match(error.message, /检查模型兼容性设置/);
});

test("expansion instructions preserve a confirmed broadened-position permission", () => {
  const instructions = expansionInstructions({ positionBroadeningApproved: true });

  assert.match(instructions, /用户已经同意扩大位置范围/);
  assert.match(instructions, /不得再次询问是否扩大/);
  assert.match(instructions, /只有出现其他此前未提及/);
  assert.match(instructions, /只能选择 search_candidates、ask_user 或 finish/);
});

test("expansion instructions stay compact and leave provider rules to the source policy", () => {
  const instructions = expansionInstructions();

  assert.ok(instructions.length < 2_500, `expected a stage-specific prompt under 2,500 characters; got ${instructions.length}`);
  assert.doesNotMatch(instructions, /若数据模式为/);
});

test("methodology search asks an evaluation question instead of a transfer decision", () => {
  const instructions = methodologySearchInstructions;

  assert.match(instructions, /方法论文能回答/);
  assert.match(instructions, /已确认的位置、角色、能力/);
  assert.match(instructions, /俱乐部名、参考球员名/);
  assert.match(instructions, /替代者、接班人/);
  assert.match(instructions, /这些不是方法来源能回答的问题/);
});

test("methodology search does not invent missing detail or bypass fail-closed retrieval", () => {
  const instructions = methodologySearchInstructions;

  assert.match(instructions, /不猜测具体职责或指标/);
  assert.match(instructions, /没有方法来源通过 gate/);
  assert.match(instructions, /不要改写成更泛或与需求无关的问题/);
});

test("investigation and reorientation carry only the active provider's rules", async () => {
  const { investigationInstructions, reorientationInstructions } = await import("../../src/recruitment/recruitment-planner.js");
  const understat = investigationInstructions("understat");
  assert.match(understat, /Understat 只覆盖/);
  assert.doesNotMatch(understat, /若数据模式为 (?:ASA|FBref|Wyscout Open Data|SkillCorner Open Data|StatsBomb Open Data|Premier League Pulselive)/);
  const asa = investigationInstructions("asa");
  assert.match(asa, /若数据模式为 ASA/);
  assert.doesNotMatch(asa, /若数据模式为 Wyscout Open Data/);
  const mosaic = investigationInstructions("mosaic");
  assert.match(mosaic, /若数据模式为 ASA/);
  assert.match(mosaic, /mosaic 的候选计数/);
  const reorient = reorientationInstructions("understat");
  assert.match(reorient, /Understat 只覆盖/);
  assert.match(reorient, /不得请求已耗尽的报告检索/);
  assert.match(understat, /候选筛选条件必须来自用户明确要求/);
});

test("conclusion source rules preserve evidence boundaries without reopening investigation tools", async () => {
  const { conclusionInstructions, investigationInstructions } = await import("../../src/recruitment/recruitment-planner.js");
  const final = conclusionInstructions("understat");
  assert.doesNotMatch(final, /inspect_candidate_group|inspect_match|nextOffset/);
  assert.match(investigationInstructions("understat"), /inspect_candidate_group/);
  for (const rule of [/未知年龄/, /相邻不能/, /Sub不作/, /直接标签/, /history/, /recent/, /xG\/npxG/, /minMaxPlayerStats/, /同赛事、同赛季、同位置组/, /抓取时间不代表来源更新/]) assert.match(final, rule);
});
