import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { InMemoryStore } from "@langchain/langgraph";
import { createApp } from "../../src/app.js";
import { buildPlanningSnapshot } from "../../src/recruitment/conversation/planning-snapshot.js";
import { SQLiteBaseStore } from "../../src/recruitment/preferences/sqlite-base-store.js";
import { RecruitmentPreferencesService } from "../../src/recruitment/preferences/service.js";
import type { State } from "../../src/recruitment/conversation/state.js";
import { emptyToolUseCounts } from "../../src/recruitment/recruitment-actions.js";
import { RecruitmentGraphNodeFailureError } from "../../src/recruitment/conversation-turn-runtime.js";
import { createRecruitmentConversation } from "../../src/recruitment/conversation.js";

test("SQLite BaseStore preferences persist across close/reopen and stay isolated by owner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tactiscout-preferences-"));
  const databasePath = join(directory, "preferences.sqlite");
  const firstOwner = randomUUID();
  const secondOwner = randomUUID();
  try {
    const firstStore = new SQLiteBaseStore(databasePath);
    const first = new RecruitmentPreferencesService(firstStore);
    await assert.rejects(firstStore.put(["cases", randomUUID()], "report", { recommendations: ["candidate"] }));
    await first.save(firstOwner, { key: "analysis_focus", value: "duels", explicitlyApproved: true });
    await first.save(firstOwner, { key: "preferred_competition", value: "La Liga", explicitlyApproved: true });
    await first.save(secondOwner, { key: "analysis_focus", value: "progression", explicitlyApproved: true });
    await firstStore.stop();

    const reopenedStore = new SQLiteBaseStore(databasePath);
    const reopened = new RecruitmentPreferencesService(reopenedStore);
    assert.deepEqual((await reopened.list(firstOwner)).map(({ key, value }) => [key, value]), [
      ["analysis_focus", "duels"],
      ["preferred_competition", "La Liga"],
    ]);
    assert.deepEqual((await reopened.list(secondOwner)).map(({ key, value }) => [key, value]), [["analysis_focus", "progression"]]);
    assert.equal(await reopened.delete(firstOwner, "analysis_focus"), true);
    await reopened.clear(secondOwner);
    assert.deepEqual(await reopened.list(secondOwner), []);
    await reopenedStore.stop();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("preference API requires explicit approval and supports edit, delete, and clear", async () => {
  const app = createApp({ preferenceStore: new InMemoryStore() });
  const owner = randomUUID();
  const url = `/api/v1/users/${owner}/preferences`;
  try {
    assert.deepEqual((await app.inject({ method: "GET", url })).json(), []);
    assert.equal((await app.inject({ method: "PUT", url, payload: { key: "analysis_focus", value: "duels" } })).statusCode, 400);
    assert.equal((await app.inject({ method: "PUT", url, payload: { key: "analysis_focus", value: "player facts", explicitlyApproved: true } })).statusCode, 400);

    const first = await app.inject({ method: "PUT", url, payload: { key: "analysis_focus", value: "duels", explicitlyApproved: true } });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().source, "explicit_user_confirmation");
    const edit = await app.inject({ method: "PUT", url, payload: { key: "analysis_focus", value: "progression", explicitlyApproved: true } });
    assert.equal(edit.statusCode, 200);
    assert.equal(edit.json().value, "progression");
    assert.equal((await app.inject({ method: "DELETE", url: `${url}/analysis_focus` })).statusCode, 204);

    await app.inject({ method: "PUT", url, payload: { key: "analysis_focus", value: "duels", explicitlyApproved: true } });
    await app.inject({ method: "PUT", url, payload: { key: "preferred_competition", value: "Serie A", explicitlyApproved: true } });
    assert.equal((await app.inject({ method: "DELETE", url })).statusCode, 204);
    assert.deepEqual((await app.inject({ method: "GET", url })).json(), []);
  } finally {
    await app.close();
  }
});

function snapshotState(userMessage: string, competition: string | null = null): State {
  return {
    userMessage,
    history: [{ role: "user", content: userMessage }],
    brief: competition ? {
      task: "reinforcement", targetTeam: { value: "Arsenal", basis: "explicit", quote: "Arsenal" }, referencePlayer: null, referenceClues: [],
      criteria: [
        { field: "position", operator: "in", value: ["CM"], unit: null, attributeKey: null, strength: "required", basis: "explicit", quote: "midfielder" },
        { field: "competition", operator: "in", value: [competition], unit: null, attributeKey: null, strength: "required", basis: "explicit", quote: competition },
      ],
      unresolved: [],
    } : null,
    targetTeam: "Arsenal", confirmedPosition: "CM", confirmedPositions: ["CM"], positionBroadeningApproved: false,
    confirmedPositionSearchObservationIndex: null, pendingQuestion: null, discoveredPlayers: {}, evaluatedPlayers: {},
    candidateIdentityGroups: [], retrievedKnowledge: {}, searchedReportPlayerNames: [], hasSearchedPlayerReports: false,
    hasSearchedMethodology: false, policyBlocked: false, policyBlockedRepeatCount: 0, toolUses: emptyToolUseCounts(),
    candidateSearchTurnStartIndex: 0, candidateSearchObservations: [],
  } as unknown as State;
}

test("approved preferences are advisory snapshot input and explicit request fields take priority", () => {
  const preferences = [
    { key: "preferred_competition" as const, value: "Premier League" as const, confirmedAt: new Date().toISOString(), source: "explicit_user_confirmation" as const, appliesWhen: "Only if unspecified" },
    { key: "analysis_focus" as const, value: "duels" as const, confirmedAt: new Date().toISOString(), source: "explicit_user_confirmation" as const, appliesWhen: "Only if unspecified" },
  ];
  const build = (state: State) => buildPlanningSnapshot({
    state,
    repository: { mode: "demo", sourceName: "fixture", async loadPlayers() { return []; } },
    decisionMode: "investigate",
    availableActions: ["search_candidates"],
    eligibleEvaluatedPlayers: {},
    groupCandidateRecords: () => [],
    userPreferences: preferences,
  });
  assert.equal(build(snapshotState("Find a midfielder")).userPreferences.length, 2);
  assert.deepEqual(build(snapshotState("Find a midfielder in La Liga", "La Liga")).userPreferences.map(({ key }) => key), ["analysis_focus"]);
  assert.deepEqual(build(snapshotState("Find a midfielder and focus on duels")).userPreferences.map(({ key }) => key), ["preferred_competition"]);
});

test("partial Runtime.context preferences reach the Planner but never enter checkpoint state", async () => {
  const owner = randomUUID();
  const store = new InMemoryStore();
  const preferences = new RecruitmentPreferencesService(store);
  const approved = await preferences.save(owner, { key: "analysis_focus", value: "duels", explicitlyApproved: true });
  let plannerSnapshot: unknown;
  const conversation = createRecruitmentConversation({
    repository: { mode: "demo", sourceName: "fixture", async loadPlayers() { return []; } },
    knowledgeBase: { async search() { return []; } },
    planner: { async decide(input) { plannerSnapshot = input.decisionSnapshot; throw new Error("stop after proving runtime context delivery"); } },
  });

  await assert.rejects(conversation.turn({
    threadId: "preference-runtime-context",
    message: "Find a midfielder for Barcelona",
    runtimeContext: { userPreferences: [approved] },
  }), RecruitmentGraphNodeFailureError);
  assert.deepEqual((plannerSnapshot as { userPreferences: unknown[] }).userPreferences, [{
    key: "analysis_focus", value: "duels", guidance: approved.appliesWhen, source: "explicit_user_confirmation",
  }]);
  const inspection = await conversation.inspectCaseRun!({ threadId: "preference-runtime-context", limit: 100 });
  assert.doesNotMatch(JSON.stringify(inspection), /analysis_focus|defensive_actions|preferred_competition/);
});
