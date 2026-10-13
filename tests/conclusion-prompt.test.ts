import assert from "node:assert/strict";
import test from "node:test";
import { conclusionInstructions, expansionInstructions } from "../src/agent/conversation.js";

test("the final decision prompt is short while retaining evidence and historical-data constraints", () => {
  const prompt = conclusionInstructions("wyscout");

  assert.ok(prompt.length < 1_000);
  assert.match(prompt, /evaluate_candidates/);
  assert.match(prompt, /evidence key/);
  assert.match(prompt, /2017\/18 历史样本/);
  assert.match(prompt, /CC BY 4\.0/);
  assert.match(prompt, /现役俱乐部/);
  assert.match(prompt, /只输出 schema 要求的一个 JSON action/);
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
