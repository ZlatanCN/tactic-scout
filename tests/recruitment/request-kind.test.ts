import assert from "node:assert/strict";
import test from "node:test";
import { isKnowledgeQuestion } from "../../src/recruitment/conversation/request-kind.js";

test("clear source questions route to knowledge Q&A", () => {
  assert.equal(isKnowledgeQuestion("论文用了哪个赛季，主要方法是什么？"), true);
  assert.equal(isKnowledgeQuestion("According to the study, how many folds were used?"), true);
  assert.equal(isKnowledgeQuestion("请解释 10.1371/journal.pone.0282295 的样本范围。"), true);
  assert.equal(isKnowledgeQuestion("这份报告讲了什么？"), true);
  assert.equal(isKnowledgeQuestion("报告的核心结论是什么？"), true);
  assert.equal(isKnowledgeQuestion("What does the paper conclude about the sample?"), true);
});

test("recruitment requests remain on the recruitment path", () => {
  assert.equal(isKnowledgeQuestion("为拜仁寻找凯恩的替代者"), false);
  assert.equal(isKnowledgeQuestion("为 Sample Club 找一名后卫"), false);
  assert.equal(isKnowledgeQuestion("推荐几名中场候选，并附上球探报告"), false);
  assert.equal(isKnowledgeQuestion("解释一下为什么这名候选适合引援"), false);
  assert.equal(isKnowledgeQuestion("检查拜仁的球队样本"), false);
  assert.equal(isKnowledgeQuestion("How many minutes did the candidate play?"), false);
  assert.equal(isKnowledgeQuestion("Use DOI 10.1371/journal.pone.0282295 to find a striker"), false);
});
