import assert from "node:assert/strict";
import test from "node:test";
import { candidateMatchesSearchIntent, resolveCandidateSearchIntent } from "../../src/recruitment/candidate-search-intent.js";

test("accepted broad source positions take precedence over the specific role left for verification", () => {
  const answer = "同意按前锋大类继续检索，中锋职责标为待核实。保持五大联赛、年龄不限，继续生成候选名单。";
  const intent = resolveCandidateSearchIntent({ userMessages: ["延续凯恩的中锋角色", answer], confirmedPosition: "ST", latestMessage: answer });
  assert.equal(intent.position, "ATT");
  assert.deepEqual(intent.latestPositionChange, { changed: true, position: "ATT" });
  assert.equal(intent.declinedPositionBroadening, false);
});

test("rejecting a source-position broadening does not silently change the specific position", () => {
  for (const answer of ["不同意按前锋大类继续", "不愿按前锋大类继续", "按前锋大类继续，但保留中锋要求"]) {
    const intent = resolveCandidateSearchIntent({ userMessages: ["寻找中锋", answer], confirmedPosition: "ST", latestMessage: answer });
    assert.equal(intent.position, "ST", answer);
  }
});

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

test("replacement requests inherit the reference player's observed position by default", () => {
  const intent = resolveCandidateSearchIntent({
    userMessages: ["Find Bayern a replacement for Alex Keeper"],
    confirmedPosition: null,
    replacementReferencePosition: "GK",
  });

  assert.equal(intent.position, "GK");
  assert.equal(intent.replacementRequest, true);
});

test("English fine-position requests preserve their explicit position", () => {
  for (const [message, expected] of [
    ["Please find a left-back who can carry the ball forward.", "LB"],
    ["Please find a left back.", "LB"],
    ["We need a right-back.", "RB"],
    ["Find a fullback.", "FB"],
  ] as const) {
    const intent = resolveCandidateSearchIntent({ userMessages: [message], confirmedPosition: null });
    assert.equal(intent.position, expected, message);
  }
});

test("a confirmed Wikidata identity excludes only its uniquely matched provider record, never same-name records from other providers", () => {
  const intent = resolveCandidateSearchIntent({
    userMessages: ["为拜仁寻找基米希的替代者，限定中前卫"],
    confirmedPosition: "CM",
    referenceNames: ["Joshua Kimmich", "基米希"],
    referenceIdentityResolved: true,
    referenceSourceIdentityKeys: [JSON.stringify(["source_identity", "understat", "kimmich-1"])],
  });
  const sourceRecord = (provider: string, playerId: string) => ({
    playerId, name: "Joshua Kimmich", team: "Bayern Munich", age: 31, position: "CM" as const,
    competition: "Bundesliga", season: "2025/26", minutes: 1000, source: provider,
    sourceIdentity: { provider, playerId, retrievedAt: "2026-10-16T00:00:00.000Z" },
    stats: { goals: 1, assists: 1, passesAttempted: 1, passesCompleted: 1, longPasses: 0, carries: 0,
      pressures: 0, tackles: 0, interceptions: 0, shotAssists: 0, keyPasses: 0 },
  });
  assert.equal(candidateMatchesSearchIntent(sourceRecord("understat", "kimmich-1"), intent), false);
  assert.equal(candidateMatchesSearchIntent(sourceRecord("fbref", "kimmich-9"), intent), true,
    "without a provider ID crosswalk, a name match in another source stays an independent record");
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

test("a broad replacement role overrides the previously confirmed forward role", () => {
  for (const message of ["改成帮拜仁找后卫", "改为后卫", "现在找中场"]) {
    const expected = message.includes("中场") ? "MID" : "DEF";
    const intent = resolveCandidateSearchIntent({
      userMessages: ["找前锋", message], confirmedPosition: "ATT", latestMessage: message,
    });
    assert.equal(intent.position, expected);
    assert.deepEqual(intent.latestPositionChange, { changed: true, position: expected });
  }
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
