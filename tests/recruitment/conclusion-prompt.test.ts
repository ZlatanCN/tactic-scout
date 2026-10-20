import assert from "node:assert/strict";
import test from "node:test";
import { conclusionInstructions, expansionInstructions, investigationInstructions } from "../../src/recruitment/conversation.js";
import { abilityProfileInstructions } from "../../src/recruitment/recruitment-planner.js";

test("the Understat investigation prompt sends the Agent to internal research tools without asking permission", () => {
  const prompt = investigationInstructions("understat");

  assert.match(prompt, /inspect_candidate_group/);
  assert.match(prompt, /inspect_match/);
  assert.match(prompt, /当前阶段可用 action 会随结构化上下文传入/);
  assert.match(prompt, /禁止询问用户是否要调用某个工具/);
  assert.match(prompt, /用户明确要求.*或目录证据缺口.*调用 inspect_candidate_group/);
  assert.match(prompt, /当前赛季来源确认属于该队的球员不能作为引援候选/);
  assert.doesNotMatch(prompt, /默认读取 positions\/history\/recent\/shotProfile/);
});

test("the final decision prompt is short while retaining evidence and historical-data constraints", () => {
  const prompt = conclusionInstructions("wyscout");

  assert.ok(prompt.length < 1_000);
  assert.match(prompt, /evaluate_candidates/);
  assert.match(prompt, /evidence key/);
  assert.match(prompt, /2017\/18 历史样本/);
  assert.match(prompt, /CC BY 4\.0/);
  assert.match(prompt, /现役俱乐部/);
  assert.match(prompt, /目标队现役球员已由候选规则排除/);
  assert.match(prompt, /参考球员不可推荐/);
  assert.doesNotMatch(prompt, /referenceProfiles|candidateComparison/);
  assert.match(prompt, /只调用一个数据工具/);
  assert.match(prompt, /字段文字精炼/);
  assert.doesNotMatch(prompt, /search_methodology|最多 10 步/);
});

test("the final decision prompt preserves the FPL current-player-pool and metric boundaries", () => {
  const prompt = conclusionInstructions("fpl");

  assert.match(prompt, /只覆盖英超游戏目录/);
  assert.match(prompt, /不能据此声称完整阵容或细角色/);
  assert.match(prompt, /合并解围\/封堵\/拦截不可拆项/);
  assert.match(prompt, /身价、合同、预算、伤病/);
});

test("the final decision prompt uses the supported ASA scope and discloses cross-league limits", () => {
  const prompt = conclusionInstructions("asa");

  assert.match(prompt, /只覆盖 MLS、USL Championship 与 USL League One/);
  assert.doesNotMatch(prompt, /NWSL|USL Super League|USLS|女足|women/);
  assert.match(prompt, /不能将跨赛事原始数值直接横比/);
  assert.match(prompt, /不是完整注册名单/);
  assert.match(prompt, /至少一名供球探后续核验的候选线索/);
  assert.match(prompt, /不代表客观能力排名/);
});

test("the expansion prompt uses candidate coverage without searching for structurally unavailable metrics", () => {
  const prompt = expansionInstructions();

  assert.match(prompt, /requestedCapabilityCoverage/);
  assert.match(prompt, /requestedMetricKeys 为空/);
  assert.match(prompt, /不能仅为该项要求扩样/);
  assert.match(prompt, /nextOffset/);
});

test("FM CA and PA remain explicit decision factors with snapshot and certainty limits", () => {
  const prompt = abilityProfileInstructions(true);

  assert.match(prompt, /currentAbility \(CA\)/);
  assert.match(prompt, /potentialAbility \(PA\)/);
  assert.match(prompt, /重要决策维度/);
  assert.match(prompt, /快照日期/);
  assert.match(prompt, /不保证真实未来发展/);
});
