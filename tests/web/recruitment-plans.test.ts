import assert from "node:assert/strict";
import test from "node:test";
import {
  createFreshReanalysisMessage,
  createFreshReanalysisTurn,
  loadRecruitmentPlans,
  removeRecruitmentPlan,
  saveRecruitmentPlans,
  upsertRecruitmentPlan,
  type SavedRecruitmentPlan,
} from "../../web/src/features/recruitment/lib/plans.js";
import { type ScoutResponse } from "../../src/domain/assessment.js";
import { createEmptyExternalSignalCoverage } from "../../src/domain/external-evidence.js";
import { type RecruitmentReport } from "../../src/domain/reports.js";

const originalReport: RecruitmentReport = {
  targetTeam: "Bayern Munich",
  needSummary: "寻找能承担中锋终结任务的凯恩接班人。",
  capabilityProfile: ["禁区终结", "前场压迫"],
  referenceProfiles: [],
  referenceNameSource: null,
  requestedCapabilityCoverage: [],
  evidenceCoverage: { evaluatedCandidateCount: 0, evaluatedSourceRecordCount: 0, availableMetricValues: 0, expectedMetricValues: 0, lowSampleCandidates: 0, limitedPeerGroupCandidates: 0 },
  candidateIdentityCoverage: {
    registryAvailable: false,
    releaseStamp: null,
    sourceRecordCount: 0,
    resolvedIdentityCount: 0,
    resolvedSourceRecordCount: 0,
    unresolvedSourceRecordCount: 0,
    resolutionStatusCounts: [],
  },
  externalSignalCoverage: createEmptyExternalSignalCoverage(),
  historicalArchiveCoverage: { status: "not_run", disabledReason: null, checkedCandidates: 0, mappedCandidates: 0, matchedCandidates: 0, failedCandidates: 0 },
  historicalArchiveCandidates: [],
  understatMatchResearch: [],
  knowledgeCoverage: { methodologyChunksRetrieved: 0, methodologyOutcome: "not_triggered", methodologySearchFailed: false, methodologySources: [], playerReportSearchPerformed: false, playerReportOutcome: "not_triggered", playerReportSearchFailed: false, playerReportChunksRetrieved: 0 },
  searchScopes: [],
  recommendations: [],
  limitations: ["历史数据不能核实当前阵容。"],
  dataSource: "StatsBomb Open Data",
  datasetMode: "statsbomb",
};

const savedPlan: SavedRecruitmentPlan = {
  id: "plan-1",
  name: "Bayern striker",
  threadId: "case-1",
  originalBrief: "为拜仁寻找凯恩的替代者",
  messages: [
    { id: "message-1", role: "user", content: "为拜仁寻找凯恩的替代者", teamContext: "Bayern Munich" },
    { id: "message-2", role: "assistant", content: "你更看重即战力还是培养空间？", questionReason: "会改变年龄与样本取舍。" },
  ],
  lastReport: originalReport,
  lastReportedAt: "2026-09-01T10:00:00.000Z",
  hasConversationState: true,
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

test("fresh reanalysis replays user requests and clarifications without old report conclusions", () => {
  const message = createFreshReanalysisMessage({
    originalBrief: "为巴萨找一名能推进的中场。",
    messages: [
      { id: "u1", role: "user", content: "为巴萨找一名能推进的中场。", teamContext: "Barcelona" },
      { id: "a1", role: "assistant", content: "你希望优先看推进还是压迫？", questionReason: "两项能力的数据覆盖不同。" },
      { id: "u2", role: "user", content: "优先推进，不需要压迫。" },
      { id: "a2", role: "assistant", content: "旧报告推荐 Player Z，基于进球和对抗。" },
      { id: "u3", role: "user", content: "重新分析当前招募需求并刷新报告。", isReanalysisAction: true },
    ],
  });

  assert.match(message, /为巴萨找一名能推进的中场/);
  assert.match(message, /目标球队：Barcelona/);
  assert.match(message, /你希望优先看推进还是压迫/);
  assert.match(message, /优先推进，不需要压迫/);
  assert.match(message, /全新调查/);
  assert.doesNotMatch(message, /Player Z/);
  assert.doesNotMatch(message, /重新分析当前招募需求/);
});

test("fresh reanalysis starts a new case without loading an existing LangGraph checkpoint", () => {
  assert.deepEqual(createFreshReanalysisTurn({ caseId: "new-case-id", message: "全新调查请求" }), {
    caseId: "new-case-id",
    message: "全新调查请求",
    expectsExistingState: false,
  });
});

test("saving a follow-up turn keeps the previous report until the next report is complete", () => {
  const nextMessages = [...savedPlan.messages, { id: "message-3", role: "user" as const, content: "更看重培养空间。" }];
  const result = upsertRecruitmentPlan([savedPlan], {
    id: savedPlan.id,
    name: savedPlan.name,
    threadId: savedPlan.threadId,
    originalBrief: savedPlan.originalBrief,
    messages: nextMessages,
    currentReport: null,
    currentReportedAt: null,
    hasConversationState: true,
    now: "2026-09-02T10:00:00.000Z",
  });

  assert.equal(result.plan.lastReport, originalReport);
  assert.equal(result.plan.lastReportedAt, savedPlan.lastReportedAt);
  assert.equal(result.plan.messages.at(-1)?.content, "更看重培养空间。");
});

test("a completed investigation replaces the saved report snapshot", () => {
  const nextReport = { ...originalReport, needSummary: "寻找能承担串联和终结任务的中锋。" };
  const result = upsertRecruitmentPlan([savedPlan], {
    id: savedPlan.id,
    name: "Bayern striker refresh",
    threadId: savedPlan.threadId,
    originalBrief: savedPlan.originalBrief,
    messages: savedPlan.messages,
    currentReport: nextReport,
    currentReportedAt: "2026-09-03T10:00:00.000Z",
    hasConversationState: true,
    now: "2026-09-03T10:00:00.000Z",
  });

  assert.equal(result.plan.lastReport, nextReport);
  assert.equal(result.plan.lastReportedAt, "2026-09-03T10:00:00.000Z");
  assert.equal(result.plan.name, "Bayern striker refresh");
});

test("local plans can round-trip through a storage adapter", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };

  saveRecruitmentPlans([savedPlan], storage);

  assert.deepEqual(loadRecruitmentPlans(storage), [{
    ...savedPlan,
    lastReport: { ...originalReport, methodologyClaims: [] },
  }]);
});

test("version 2 local reports without capability coverage remain readable", () => {
  const { requestedCapabilityCoverage: _coverage, historicalArchiveCandidates: _archiveCandidates, methodologySources: _methodologySources, ...olderReport } = originalReport;
  const storedPlan = { ...savedPlan, lastReport: olderReport };
  const storage = {
    getItem: () => JSON.stringify({ version: 2, plans: [storedPlan] }),
    setItem() {},
  };

  const [loaded] = loadRecruitmentPlans(storage);

  assert.deepEqual(loaded.lastReport?.requestedCapabilityCoverage, []);
  assert.deepEqual(loaded.lastReport?.historicalArchiveCandidates, []);
});

test("version 1 one-shot plans migrate while keeping the prior analysis as a history snapshot", () => {
  const legacyAnalysis: ScoutResponse = {
    targetTeam: "Bayern Munich",
    requirements: {
      targetTeam: "Bayern Munich",
      position: "ST",
      inPossessionRoles: ["creation"],
      outOfPossessionRoles: ["pressing"],
      topK: 3,
      includeUnknownAge: false,
    },
    dataSource: "Demo data",
    datasetMode: "demo",
    candidates: [],
    review: { evidenceCompleteness: 1, evidenceCoverage: 1, findings: [], retryRecommended: false },
    caveats: ["虚构演示数据。"],
  };
  const values = new Map([[
    "tactiscout.recruitment-plans",
    JSON.stringify({ version: 1, plans: [{
      id: "old-plan",
      name: "Bayern striker",
      input: legacyAnalysis.requirements,
      originalBrief: "为拜仁寻找凯恩的替代者",
      lastAnalysis: legacyAnalysis,
      lastAnalyzedAt: "2026-09-01T10:00:00.000Z",
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    }] }),
  ]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };

  const [migrated] = loadRecruitmentPlans(storage);

  assert.equal(migrated.id, "old-plan");
  assert.equal(migrated.lastReport?.needSummary, "为拜仁寻找凯恩的替代者");
  assert.equal(migrated.lastReport?.limitations.some((item) => item.includes("历史快照")), true);
  assert.equal(migrated.hasConversationState, false);
  assert.equal(migrated.messages[0].content, "为拜仁寻找凯恩的替代者");
  assert.equal(JSON.parse(values.get("tactiscout.recruitment-plans") ?? "{}").version, 2);
  assert.deepEqual(JSON.parse(values.get("tactiscout.recruitment-plans") ?? "{}").plans[0], migrated);
});

test("a plan can be removed without affecting other saved plans", () => {
  assert.deepEqual(removeRecruitmentPlan([savedPlan], savedPlan.id), []);
});

test("corrupt local data is rejected without overwriting the original browser value", () => {
  const stored = JSON.stringify({ version: 2, plans: [{ id: "broken" }] });
  const values = new Map([["tactiscout.recruitment-plans", stored]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };

  assert.throws(() => loadRecruitmentPlans(storage), /本地招募计划无法读取/);
  assert.equal(storage.getItem("tactiscout.recruitment-plans"), stored);
});
