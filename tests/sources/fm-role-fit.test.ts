import { test } from "node:test";
import assert from "node:assert/strict";
import { FmAttributeKeys, parseFmPlayer } from "../../src/sources/fm/profile.js";
import { assessFmRole, combineRoleEvidence } from "../../src/sources/fm/role-fit.js";

function player(overrides: Record<string, string> = {}) {
  return parseFmPlayer({ uid: "1", name: "Player", positions_stc: "20",
    ...Object.fromEntries(FmAttributeKeys.flatMap((key) => [[`raw_attributes_${key}`, "80"], [`attributes_${key}`, "16"]])), ...overrides });
}

test("role assessment uses one scale, explicit position competence and complete required attributes", () => {
  assert.equal(assessFmRole(player(), "link_forward").fit, 80);
  assert.equal(assessFmRole(player({ attributes_passing: "1" }), "link_forward").fit, 80);
  const missing = assessFmRole(player({ raw_attributes_passing: "", attributes_passing: "" }), "link_forward");
  assert.equal(missing.fit, null);
  assert.ok(missing.attributeCoverage < 1);
  assert.ok(missing.searchPriority < 80);
  assert.equal(assessFmRole(player(), "sweeper_keeper").positionCompatible, false);
  assert.equal(assessFmRole(player({ positions_gk: "20" }), "sweeper_keeper").positionCompatible, true);
});

test("fusion keeps missing sources unknown, retains fixed weights and accepts explicit zero", () => {
  const complete = combineRoleEvidence({ value: 80, coverage: 1 }, { value: 70, coverage: 1 });
  assert.equal(complete.combinedFit, 76.5);
  const abilityOnly = combineRoleEvidence({ value: 80, coverage: 1 }, { value: null, coverage: 0 });
  assert.equal(abilityOnly.performanceFit, null);
  assert.equal(abilityOnly.combinedFit, null);
  assert.equal(abilityOnly.searchPriority, 69.5);
  assert.equal(combineRoleEvidence({ value: null, coverage: 0 }, { value: null, coverage: 0 }).searchPriority, null);
  assert.equal(combineRoleEvidence({ value: 0, coverage: 1 }, { value: 0, coverage: 1 }).combinedFit, 0);
  assert.throws(() => combineRoleEvidence({ value: 120, coverage: 1 }, { value: null, coverage: 0 }));
});
