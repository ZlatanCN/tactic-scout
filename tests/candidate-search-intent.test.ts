import assert from "node:assert/strict";
import test from "node:test";
import { resolveCandidateSearchIntent } from "../src/agent/candidate-search-intent.js";

test("reference clubs and players do not become candidate filters", () => {
  const intent = resolveCandidateSearchIntent({
    userMessages: ["为拜仁寻找凯恩的替代者"],
    confirmedPosition: null,
  });

  assert.equal(intent.position, null);
  assert.equal(intent.maxAge, null);
  assert.equal(intent.competition, null);
  assert.equal(intent.season, null);
  assert.equal(intent.replacementRequest, true);
});

test("explicit filters accumulate across clarification turns", () => {
  const intent = resolveCandidateSearchIntent({
    userMessages: [
      "为拜仁寻找凯恩的替代者",
      "找 23 岁以下的前锋，至少 900 分钟，只考虑英超，2025/26 赛季",
    ],
    confirmedPosition: null,
  });

  assert.equal(intent.position, "ATT");
  assert.equal(intent.maxAge, 23);
  assert.equal(intent.minimumMinutes, 900);
  assert.equal(intent.competition, "英超");
  assert.equal(intent.season, "2025/26");
});

test("latest explicit answer can change position and preserve an earlier age filter", () => {
  const intent = resolveCandidateSearchIntent({
    userMessages: ["找 23 岁以下的中锋", "扩大到其他前锋位置"],
    confirmedPosition: "ST",
    latestMessage: "扩大到其他前锋位置",
  });

  assert.deepEqual(intent.latestPositionChange, { changed: true, position: "ATT" });
  assert.equal(intent.position, "ATT");
  assert.equal(intent.maxAge, 23);
});

test("declining a broadened position keeps the current position", () => {
  const intent = resolveCandidateSearchIntent({
    userMessages: ["只找中锋", "不需要扩大到其他位置"],
    confirmedPosition: "ST",
    latestMessage: "不需要扩大到其他位置",
  });

  assert.deepEqual(intent.latestPositionChange, { changed: false });
  assert.equal(intent.position, "ST");
  assert.equal(intent.declinedPositionBroadening, true);
});

test("an explicit any-position answer clears the position filter", () => {
  const intent = resolveCandidateSearchIntent({
    userMessages: ["找中锋", "位置不限"],
    confirmedPosition: "ST",
    latestMessage: "位置不限",
  });

  assert.deepEqual(intent.latestPositionChange, { changed: true, position: null });
  assert.equal(intent.position, null);
  assert.equal(intent.allowsAnyPosition, true);
});

test("a negated competition mention is not applied as a filter", () => {
  const intent = resolveCandidateSearchIntent({
    userMessages: ["不限于英超，其他联赛也可以"],
    confirmedPosition: null,
  });

  assert.equal(intent.competition, null);
  assert.equal(intent.competitionMentioned, true);
});

test("negated requests to remove an age constraint keep the prior limit", () => {
  for (const message of ["不想取消年龄限制", "不愿取消年龄限制"]) {
    const intent = resolveCandidateSearchIntent({
      userMessages: ["找 23 岁以下的中锋", message],
      confirmedPosition: "ST",
    });

    assert.equal(intent.maxAge, 23, message);
  }
});
