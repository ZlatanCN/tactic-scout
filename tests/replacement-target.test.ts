import assert from "node:assert/strict";
import test from "node:test";
import { isReplacementTarget, replacementTargetNames } from "../src/agent/replacement-target.js";

test("Chinese replacement reference resolves to the exact English name, not surname similarity", () => {
  const targets = replacementTargetNames(["为拜仁寻找凯恩的替代者，重点看能接应、做球和终结的前锋"]);
  assert.equal(isReplacementTarget("Harry Kane", targets), true);
  assert.equal(isReplacementTarget("Other Kane", targets), false);
});

test("replacement reference survives clarifications and supports other exact names", () => {
  const targets = replacementTargetNames(["Find a replacement for Jonas Vale, strong finishing", "No age limit"]);
  assert.equal(isReplacementTarget("Jonas Vale", targets), true);
  assert.equal(isReplacementTarget("Jonas Stone", targets), false);
  assert.deepEqual(replacementTargetNames(["比较凯恩和其他前锋"]), []);
});

test("a Chinese reference name resolves its canonical source name for role lookup and exclusion", () => {
  const targets = replacementTargetNames(["为拜仁寻找诺伊尔的替代者"]);
  assert.equal(isReplacementTarget("Manuel Neuer", targets), true);
  assert.equal(isReplacementTarget("Neuer Sample", targets), false);
});
