import assert from "node:assert/strict";
import test from "node:test";
import { createRecruitmentPlanner } from "../../src/recruitment/recruitment-planner.js";
import { createRecruitmentBriefInterpreter } from "../../src/recruitment/brief-interpreter.js";
import { RecruitmentContextCapacityError } from "../../src/recruitment/context.js";

test("Planner applies a safe conclusion-history fallback before sending an over-soft-budget request", async () => {
  const originalFetch = globalThis.fetch;
  const keys = [
    "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "OPENAI_STRUCTURED_OUTPUT_METHOD", "OPENAI_MAX_OUTPUT_TOKENS",
    "TACTISCOUT_CONTEXT_WINDOW_TOKENS", "TACTISCOUT_CONTEXT_SOFT_INPUT_TOKENS", "TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS",
  ] as const;
  const previousEnvironment = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let requestBody: { messages?: Array<{ role?: string; content?: string }> } | undefined;
  let observedManifest: Record<string, unknown> | undefined;
  process.env.OPENAI_API_KEY = "fixture-key";
  process.env.OPENAI_MODEL = "fixture";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
  process.env.OPENAI_STRUCTURED_OUTPUT_METHOD = "jsonSchema";
  process.env.OPENAI_MAX_OUTPUT_TOKENS = "256";
  process.env.TACTISCOUT_CONTEXT_WINDOW_TOKENS = "4096";
  process.env.TACTISCOUT_CONTEXT_SOFT_INPUT_TOKENS = "1024";
  process.env.TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS = "0";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as typeof requestBody;
    return Response.json({
      id: "fixture", object: "chat.completion", created: 1, model: "fixture",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
        action: "finish", targetTeam: "Bayern", needSummary: "已完成比较。", capabilityProfile: [],
        recommendations: [{ playerId: "candidate-a", evidenceKeys: ["goals"] }], limitationKeys: [], reportObservations: [],
      }) } }],
      usage: { prompt_tokens: 500, completion_tokens: 30, total_tokens: 530 },
    });
  }) as typeof fetch;

  try {
    const history = [
      ...Array.from({ length: 8 }, (_, index) => ({ role: "user" as const, content: `旧用户消息 ${index}：${"历史对话内容".repeat(100)}` })),
      { role: "tool" as const, toolName: "search_candidates", content: "REPLAYABLE_ROSTER_LOG ".repeat(500) },
      { role: "tool" as const, toolName: "evaluate_candidates", content: "REPLAYABLE_EVALUATION_LOG ".repeat(500) },
      { role: "assistant" as const, content: JSON.stringify({ action: "ask_user", question: "是否限制年龄？" }) },
      { role: "user" as const, content: "不设年龄限制，继续比较" },
    ];
    await createRecruitmentPlanner().decide({
      history,
      dataMode: "demo",
      dataSource: "Fixture",
      targetTeam: "Bayern",
      decisionMode: "conclude",
      confirmedPosition: "ATT",
      constraints: {
        targetTeam: "Bayern",
        evaluatedCandidates: [{ playerId: "candidate-a", evidenceKeys: ["goals"] }],
        reportObservations: [],
        requestedCapabilityCoverage: [{ name: "进球", requestedMetricKeys: ["goals"], observedMetricKeys: ["goals"], evaluatedCandidateCount: 1, candidatesWithEvidenceCount: 1, status: "observed" }],
      },
      caseProgress: {
        candidateEvidence: { candidateCount: 1, candidates: [{ playerId: "candidate-a", metrics: [{ key: "goals", value: 0.8 }] }] },
        omittedHistoryEntries: 0,
      },
      onTokenUsage: usage => { observedManifest = usage.contextManifest as unknown as Record<string, unknown>; },
    });

    const userMessage = requestBody?.messages?.find(message => message.role === "user")?.content ?? "";
    assert.ok(requestBody);
    assert.match(userMessage, /不设年龄限制，继续比较/);
    assert.match(userMessage, /candidate-a/);
    assert.doesNotMatch(userMessage, /REPLAYABLE_(?:ROSTER|EVALUATION)_LOG/);
    assert.equal(observedManifest?.budgetStrategy, "conclusion_history_reduced");
    assert.equal(observedManifest?.omittedHistoryEntries, history.length - 2);
    assert.equal(observedManifest?.actualTokenUsage && (observedManifest.actualTokenUsage as { inputTokens: number }).inputTokens, 500);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previousEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnvironment[key];
    }
  }
});

test("an oversized conclusion compares every candidate in balanced bounded batches", async () => {
  const originalFetch = globalThis.fetch;
  const keys = [
    "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "OPENAI_STRUCTURED_OUTPUT_METHOD", "OPENAI_MAX_OUTPUT_TOKENS",
    "OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS", "TACTISCOUT_CONTEXT_WINDOW_TOKENS", "TACTISCOUT_CONTEXT_SOFT_INPUT_TOKENS",
    "TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS",
  ] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const requests: Array<{ candidateIds: string[]; maxTokens?: number }> = [];
  const allIds = Array.from({ length: 60 }, (_, index) => `candidate-${index}`);
  process.env.OPENAI_API_KEY = "fixture";
  process.env.OPENAI_MODEL = "fixture";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
  process.env.OPENAI_STRUCTURED_OUTPUT_METHOD = "jsonSchema";
  process.env.OPENAI_MAX_OUTPUT_TOKENS = "4096";
  process.env.OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS = "1024";
  process.env.TACTISCOUT_CONTEXT_WINDOW_TOKENS = "16384";
  process.env.TACTISCOUT_CONTEXT_SOFT_INPUT_TOKENS = "131072";
  process.env.TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS = "1024";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: string }>; max_tokens?: number };
    const message = body.messages?.[1]?.content ?? "";
    const payloadStart = message.indexOf("\n");
    const payload = JSON.parse(message.slice(payloadStart + 1)) as { caseProgress?: { candidateEvidence?: { candidates?: Array<{ playerId: string }> } } };
    const candidateIds = payload.caseProgress?.candidateEvidence?.candidates?.map(candidate => candidate.playerId) ?? [];
    requests.push({ candidateIds, maxTokens: body.max_tokens });
    const firstId = candidateIds[0];
    const action = {
      action: "finish", targetTeam: "Fixture", needSummary: "本批已有直接指标支持的考察线索。", capabilityProfile: [],
      recommendations: firstId ? [{ playerId: firstId, evidenceKeys: ["goals"] }] : [],
      limitationKeys: [], reportObservations: [],
    };
    return Response.json({
      id: "fixture", object: "chat.completion", created: 1, model: "fixture",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(action) } }],
      usage: { prompt_tokens: 2_000, completion_tokens: 100, total_tokens: 2_100 },
    });
  }) as typeof fetch;
  const candidates = allIds.map((playerId, index) => ({
    playerId,
    name: `Candidate ${index} with a deliberately long name for context pressure`,
    position: "CM", age: 22, competition: `League ${index % 4}`, season: "2026/27", minutes: 1_200, source: "Fixture",
    metrics: ["goals", "assists", "shotAssists", "keyPasses", "carries", "longPasses", "passCompletionPct", "pressures"].map((key, metricIndex) => ({
      key,
      value: index + metricIndex / 10, unit: "per90", peerPercentile: 50, peerGroupSize: 20,
      basis: "match_per90", sampleMinutes: 1_200, explanatoryText: "A retained metric definition and sample note.".repeat(2),
    })),
  }));
  const evidenceKeys = ["goals", "assists", "keyPasses", "progressivePasses", "progressiveCarries", "pressures"] as const;
  try {
    const result = await createRecruitmentPlanner().decide({
      history: [], dataMode: "demo", dataSource: "Fixture", targetTeam: "Fixture", decisionMode: "conclude", confirmedPosition: "CM",
      availableActions: ["finish"],
      constraints: {
        targetTeam: "Fixture",
        evaluatedCandidates: allIds.map(playerId => ({ playerId, evidenceKeys: [...evidenceKeys] })),
        reportObservations: [], requestedCapabilityCoverage: [],
      },
      caseProgress: { candidateEvidence: { candidateCount: candidates.length, metricDefinitions: evidenceKeys.map(key => ({ key, label: key, unit: "per90" })), candidates } },
      candidateEvidenceForBatching: { candidateCount: candidates.length, metricDefinitions: evidenceKeys.map(key => ({ key, label: key, unit: "per90" })), candidates },
    });
    assert.equal(result.action, "finish");
    if (result.action !== "finish") return;
    assert.equal(requests.length, 5, "overflow should be processed through at most five balanced calls");
    const comparedIds = requests.flatMap(request => request.candidateIds);
    assert.equal(new Set(comparedIds).size, comparedIds.length, "candidate batches must not compare a candidate twice");
    assert.deepEqual([...new Set(comparedIds)].sort(), [...allIds].sort(),
      "every assessed candidate must appear in exactly one comparison batch");
    assert.ok(requests.every(request => request.candidateIds.length > 0 && request.candidateIds.length <= 12));
    assert.equal(result.recommendations.length, 5);
    assert.match(result.needSummary, /60 名已评估候选分成 5 批/);
    assert.match(result.needSummary, /第 1 批 12 人（有直接证据线索）/);
    assert.match(result.needSummary, /第 5 批 12 人（有直接证据线索）/);
    assert.match(result.needSummary, /没有做统一排序，不代表全池排名/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("candidate batching does not hide an oversized non-candidate request", async () => {
  const originalFetch = globalThis.fetch;
  const keys = [
    "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "OPENAI_STRUCTURED_OUTPUT_METHOD", "OPENAI_MAX_OUTPUT_TOKENS",
    "OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS", "TACTISCOUT_CONTEXT_WINDOW_TOKENS", "TACTISCOUT_CONTEXT_SOFT_INPUT_TOKENS",
    "TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS",
  ] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let requestCount = 0;
  process.env.OPENAI_API_KEY = "fixture";
  process.env.OPENAI_MODEL = "fixture";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
  process.env.OPENAI_STRUCTURED_OUTPUT_METHOD = "jsonSchema";
  process.env.OPENAI_MAX_OUTPUT_TOKENS = "1024";
  process.env.OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS = "1024";
  process.env.TACTISCOUT_CONTEXT_WINDOW_TOKENS = "4096";
  process.env.TACTISCOUT_CONTEXT_SOFT_INPUT_TOKENS = "131072";
  process.env.TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS = "0";
  globalThis.fetch = (async () => {
    requestCount += 1;
    throw new Error("the oversized non-candidate request must be rejected before model invocation");
  }) as typeof fetch;
  const candidates = Array.from({ length: 20 }, (_, index) => ({
    playerId: `candidate-${index}`,
    name: `Candidate ${index}`,
    position: "CM",
    metrics: [{ key: "goals", value: index / 10, unit: "per90", basis: "match_per90", sampleMinutes: 1_200 }],
  }));
  try {
    await assert.rejects(createRecruitmentPlanner().decide({
      history: [{ role: "user", content: `这是与候选人无关的超长案件背景。${"用户提供的背景资料。".repeat(8_000)}` }],
      dataMode: "demo", dataSource: "Fixture", targetTeam: "Fixture", decisionMode: "conclude", confirmedPosition: "CM",
      constraints: {
        targetTeam: "Fixture",
        evaluatedCandidates: candidates.map(candidate => ({ playerId: candidate.playerId, evidenceKeys: ["goals"] })),
        reportObservations: [], requestedCapabilityCoverage: [],
      },
      caseProgress: { candidateEvidence: { candidateCount: candidates.length, candidates } },
      candidateEvidenceForBatching: { candidateCount: candidates.length, candidates },
    }), RecruitmentContextCapacityError);
    assert.equal(requestCount, 0, "candidate batching must not be used to mask an unrelated oversized context");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("candidate ID schema overflow uses candidate batches when each batch fits", async () => {
  const originalFetch = globalThis.fetch;
  const keys = [
    "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "OPENAI_STRUCTURED_OUTPUT_METHOD", "OPENAI_MAX_OUTPUT_TOKENS",
    "OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS", "TACTISCOUT_CONTEXT_WINDOW_TOKENS", "TACTISCOUT_CONTEXT_SOFT_INPUT_TOKENS",
    "TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS",
  ] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const requests: string[][] = [];
  const candidates = Array.from({ length: 60 }, (_, index) => ({
    playerId: `candidate-${index}-${"x".repeat(160)}`,
    name: `C${index}`,
    metrics: [{ key: "goals", value: index / 10 }],
  }));
  process.env.OPENAI_API_KEY = "fixture";
  process.env.OPENAI_MODEL = "fixture";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
  process.env.OPENAI_STRUCTURED_OUTPUT_METHOD = "jsonSchema";
  process.env.OPENAI_MAX_OUTPUT_TOKENS = "1024";
  process.env.OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS = "1024";
  process.env.TACTISCOUT_CONTEXT_WINDOW_TOKENS = "5524";
  process.env.TACTISCOUT_CONTEXT_SOFT_INPUT_TOKENS = "131072";
  process.env.TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS = "0";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages?: Array<{ role?: string; content?: string }> };
    const humanMessage = body.messages?.find(message => message.role === "user")?.content ?? "";
    const payload = JSON.parse(humanMessage.slice(humanMessage.indexOf("\n") + 1)) as {
      caseProgress?: { candidateEvidence?: { candidates?: Array<{ playerId: string }> } };
    };
    const candidateIds = payload.caseProgress?.candidateEvidence?.candidates?.map(candidate => candidate.playerId) ?? [];
    requests.push(candidateIds);
    const firstId = candidateIds[0];
    return Response.json({
      id: "fixture", object: "chat.completion", created: 1, model: "fixture",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
        action: "finish", targetTeam: "Fixture", needSummary: "本批已有直接证据支持的考察线索。", capabilityProfile: [],
        recommendations: firstId ? [{ playerId: firstId, evidenceKeys: ["goals"] }] : [],
        limitationKeys: [], reportObservations: [],
      }) } }],
      usage: { prompt_tokens: 2_000, completion_tokens: 100, total_tokens: 2_100 },
    });
  }) as typeof fetch;
  try {
    const result = await createRecruitmentPlanner().decide({
      history: [], dataMode: "demo", dataSource: "Fixture", targetTeam: "Fixture", decisionMode: "conclude", confirmedPosition: "CM",
      constraints: {
        targetTeam: "Fixture",
        evaluatedCandidates: candidates.map(candidate => ({ playerId: candidate.playerId, evidenceKeys: ["goals"] })),
        reportObservations: [],
        requestedCapabilityCoverage: [{ name: "进球", requestedMetricKeys: ["goals"], observedMetricKeys: ["goals"], evaluatedCandidateCount: candidates.length, candidatesWithEvidenceCount: candidates.length, status: "observed" }],
      },
      caseProgress: { candidateEvidence: { candidateCount: candidates.length, candidates } },
      candidateEvidenceForBatching: { candidateCount: candidates.length, metricDefinitions: [], candidates },
    });
    assert.equal(result.action, "finish");
    assert.equal(requests.length, 5, "the candidate-ID enum should be reduced to each batch's schema before invocation");
    const comparedIds = requests.flat();
    assert.equal(new Set(comparedIds).size, candidates.length);
    assert.deepEqual([...comparedIds].sort(), candidates.map(candidate => candidate.playerId).sort());
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("brief understanding keeps the configured general output cap", async () => {
  const originalFetch = globalThis.fetch;
  const keys = ["OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "OPENAI_STRUCTURED_OUTPUT_METHOD", "OPENAI_MAX_OUTPUT_TOKENS"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let requestBody: { max_tokens?: number } | undefined;
  let manifest: { outputBudgetTokens?: number } | undefined;
  process.env.OPENAI_API_KEY = "fixture";
  process.env.OPENAI_MODEL = "fixture";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
  process.env.OPENAI_STRUCTURED_OUTPUT_METHOD = "jsonSchema";
  process.env.OPENAI_MAX_OUTPUT_TOKENS = "8192";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as typeof requestBody;
    return Response.json({
      id: "fixture", object: "chat.completion", created: 1, model: "fixture",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
        task: "reinforcement", targetTeam: { value: "拜仁", basis: "explicit", quote: "拜仁" }, referencePlayer: null,
        referenceClues: [], referenceRecheck: null, selectedCandidateId: null, positions: ["CB"], allowsAnyPosition: false,
        filters: { maxAge: null, minimumMinutes: 0, competition: null, excludedCompetitions: [], season: null },
        priorities: [], constraints: [], unresolved: [],
      }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    });
  }) as typeof fetch;
  try {
    const brief = await createRecruitmentBriefInterpreter().interpret({
      message: "为拜仁找一个中卫", previous: null, recentMessages: [],
      onUsage: usage => { manifest = usage.contextManifest as unknown as typeof manifest; },
    });
    assert.equal(brief.targetTeam?.value, "拜仁");
    assert.equal(requestBody?.max_tokens, 8_192);
    assert.equal(manifest?.outputBudgetTokens, requestBody?.max_tokens);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("conclusion context reserves the same response cap that the Planner sends", async () => {
  const originalFetch = globalThis.fetch;
  const keys = [
    "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "OPENAI_STRUCTURED_OUTPUT_METHOD", "OPENAI_MAX_OUTPUT_TOKENS",
    "OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS", "TACTISCOUT_CONTEXT_WINDOW_TOKENS", "TACTISCOUT_CONTEXT_SOFT_INPUT_TOKENS",
    "TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS",
  ] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let requestBody: { max_tokens?: number } | undefined;
  let manifest: { outputBudgetTokens?: number; inputBudgetTokens?: number } | undefined;
  process.env.OPENAI_API_KEY = "fixture";
  process.env.OPENAI_MODEL = "fixture";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
  process.env.OPENAI_STRUCTURED_OUTPUT_METHOD = "jsonSchema";
  process.env.OPENAI_MAX_OUTPUT_TOKENS = "8192";
  process.env.OPENAI_CONCLUSION_MAX_OUTPUT_TOKENS = "2048";
  process.env.TACTISCOUT_CONTEXT_WINDOW_TOKENS = "16384";
  process.env.TACTISCOUT_CONTEXT_SOFT_INPUT_TOKENS = "131072";
  process.env.TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS = "1024";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as typeof requestBody;
    return Response.json({
      id: "fixture", object: "chat.completion", created: 1, model: "fixture",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
        action: "finish", targetTeam: "Bayern", needSummary: "完成比较。", capabilityProfile: [],
        recommendations: [{ playerId: "candidate", evidenceKeys: ["goals"] }], limitationKeys: [], reportObservations: [],
      }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    });
  }) as typeof fetch;
  try {
    await createRecruitmentPlanner().decide({
      history: [], dataMode: "demo", dataSource: "Fixture", targetTeam: "Bayern", decisionMode: "conclude", confirmedPosition: "ATT",
      constraints: { targetTeam: "Bayern", evaluatedCandidates: [{ playerId: "candidate", evidenceKeys: ["goals"] }], reportObservations: [], requestedCapabilityCoverage: [] },
      onTokenUsage: usage => { manifest = usage.contextManifest as unknown as typeof manifest; },
    });
    assert.equal(requestBody?.max_tokens, 2_048);
    assert.equal(manifest?.outputBudgetTokens, requestBody?.max_tokens);
    assert.equal(manifest?.inputBudgetTokens, 13_312, "the verified window reserves the sent response cap and safety margin");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("investigation context reserves the configured general response cap", async () => {
  const originalFetch = globalThis.fetch;
  const keys = [
    "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "OPENAI_STRUCTURED_OUTPUT_METHOD", "OPENAI_MAX_OUTPUT_TOKENS",
    "TACTISCOUT_CONTEXT_WINDOW_TOKENS", "TACTISCOUT_CONTEXT_SOFT_INPUT_TOKENS",
    "TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS",
  ] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let requestBody: { max_tokens?: number } | undefined;
  let manifest: { outputBudgetTokens?: number; inputBudgetTokens?: number } | undefined;
  process.env.OPENAI_API_KEY = "fixture";
  process.env.OPENAI_MODEL = "fixture";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
  process.env.OPENAI_STRUCTURED_OUTPUT_METHOD = "jsonSchema";
  process.env.OPENAI_MAX_OUTPUT_TOKENS = "8192";
  process.env.TACTISCOUT_CONTEXT_WINDOW_TOKENS = "24576";
  process.env.TACTISCOUT_CONTEXT_SOFT_INPUT_TOKENS = "131072";
  process.env.TACTISCOUT_CONTEXT_SAFETY_MARGIN_TOKENS = "1024";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as typeof requestBody;
    return Response.json({
      id: "fixture", object: "chat.completion", created: 1, model: "fixture",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
        action: "finish", targetTeam: "Barcelona", needSummary: "等待提供更多条件。", capabilityProfile: [],
        recommendations: [], limitationKeys: [], reportObservations: [],
      }) } }],
      usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
    });
  }) as typeof fetch;
  try {
    await createRecruitmentPlanner().decide({
      history: [], dataMode: "demo", dataSource: "Fixture", targetTeam: "Barcelona", decisionMode: "investigate",
      availableActions: [], confirmedPosition: null,
      onTokenUsage: usage => { manifest = usage.contextManifest as unknown as typeof manifest; },
    });
    assert.equal(requestBody?.max_tokens, 8_192);
    assert.equal(manifest?.outputBudgetTokens, requestBody?.max_tokens);
    assert.equal(manifest?.inputBudgetTokens, 15_360, "the verified window reserves the sent response cap and safety margin");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("expand requests preserve the assessed pool count while omitting metrics unrelated to the brief", async () => {
  const originalFetch = globalThis.fetch;
  const keys = ["OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "OPENAI_STRUCTURED_OUTPUT_METHOD"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let requestBody: { messages?: Array<{ role?: string; content?: string }> } | undefined;
  process.env.OPENAI_API_KEY = "fixture";
  process.env.OPENAI_MODEL = "fixture";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
  process.env.OPENAI_STRUCTURED_OUTPUT_METHOD = "jsonSchema";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as typeof requestBody;
    return Response.json({
      id: "fixture", object: "chat.completion", created: 1, model: "fixture",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
        action: "finish", targetTeam: "Barcelona", needSummary: "依据进球证据提供后续考察线索。", capabilityProfile: [],
        recommendations: [{ playerId: "candidate-0", evidenceKeys: ["goals"] }], limitationKeys: [], reportObservations: [],
      }) } }],
      usage: { prompt_tokens: 500, completion_tokens: 30, total_tokens: 530 },
    });
  }) as typeof fetch;
  try {
    const evaluatedCandidates = Array.from({ length: 40 }, (_, index) => ({
      playerId: `candidate-${index}`,
      evidenceKeys: ["goals", "assists", "pressures"] as const,
    }));
    await createRecruitmentPlanner().decide({
      history: [], dataMode: "demo", dataSource: "Fixture", targetTeam: "Barcelona", decisionMode: "expand", confirmedPosition: "MID",
      constraints: {
        targetTeam: "Barcelona", evaluatedCandidates, reportObservations: [],
        requestedCapabilityCoverage: [{ name: "进球", requestedMetricKeys: ["goals"], observedMetricKeys: ["goals"], evaluatedCandidateCount: 40, candidatesWithEvidenceCount: 40, status: "observed" }],
      },
      expansionConstraints: { targetTeam: "Barcelona", position: "MID", playerName: null, maxAge: null, minimumMinutes: 0, competition: null, season: null, nextOffset: 20 },
    });
    const userMessage = requestBody?.messages?.find(message => message.role === "user")?.content ?? "";
    const payload = JSON.parse(userMessage.slice(userMessage.indexOf("\n") + 1)) as {
      evaluatedCandidateEvidence?: { evaluatedCandidateCount?: number; candidates?: Array<{ playerId: string; evidenceKeys: string[] }> };
    };
    assert.equal(payload.evaluatedCandidateEvidence?.evaluatedCandidateCount, 40);
    assert.equal(payload.evaluatedCandidateEvidence?.candidates?.length, 40);
    assert.ok(payload.evaluatedCandidateEvidence?.candidates?.every(candidate => candidate.evidenceKeys.length === 1 && candidate.evidenceKeys[0] === "goals"));
    assert.doesNotMatch(userMessage, /pressures/);
    assert.doesNotMatch(userMessage, /assists/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("expand requests send stage-relevant progress instead of replaying unrelated evidence and quote indexes", async () => {
  const originalFetch = globalThis.fetch;
  const keys = ["OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "OPENAI_STRUCTURED_OUTPUT_METHOD"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let requestBody: { messages?: Array<{ role?: string; content?: string }> } | undefined;
  let manifest: { omittedHistoryEntries?: number } | undefined;
  process.env.OPENAI_API_KEY = "fixture";
  process.env.OPENAI_MODEL = "fixture";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1";
  process.env.OPENAI_STRUCTURED_OUTPUT_METHOD = "jsonSchema";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as typeof requestBody;
    return Response.json({
      id: "fixture", object: "chat.completion", created: 1, model: "fixture",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
        action: "finish", targetTeam: "Barcelona", needSummary: "依据现有证据整理考察线索。", capabilityProfile: [],
        recommendations: [{ playerId: "candidate-a", evidenceKeys: ["goals"] }], limitationKeys: [], reportObservations: [],
      }) } }],
      usage: { prompt_tokens: 500, completion_tokens: 30, total_tokens: 530 },
    });
  }) as typeof fetch;
  try {
    await createRecruitmentPlanner().decide({
      history: [{ role: "user", content: "为巴萨寻找中场" }], dataMode: "demo", dataSource: "Fixture", targetTeam: "Barcelona",
      decisionMode: "expand", confirmedPosition: "MID",
      constraints: {
        targetTeam: "Barcelona", evaluatedCandidates: [{ playerId: "candidate-a", evidenceKeys: ["goals"] }], reportObservations: [],
        requestedCapabilityCoverage: [{ name: "进球", requestedMetricKeys: ["goals"], observedMetricKeys: ["goals"], evaluatedCandidateCount: 1, candidatesWithEvidenceCount: 1, status: "observed" }],
      },
      expansionConstraints: { targetTeam: "Barcelona", position: "MID", playerName: null, maxAge: null, minimumMinutes: 0, competition: null, season: null, nextOffset: 40 },
      caseProgress: {
        toolUses: { search_candidates: 3 },
        currentTurnCandidatePages: [
          { offset: 0, nextOffset: 20, matchingRecordCount: 40, discoveredRecordCount: 20 },
          { offset: 20, nextOffset: 40, matchingRecordCount: 40, discoveredRecordCount: 20 },
        ],
        evaluatedCandidateCount: 1,
        discoveredCandidateCount: 40,
        protectedQuoteReferences: [{ quote: "MUST_NOT_BE_REPLAYED ".repeat(100) }],
        evidenceDirectory: [{ ref: "MUST_NOT_BE_REPLAYED_EVIDENCE_DIRECTORY" }],
        omittedHistoryEntries: 12,
      },
      onTokenUsage: usage => { manifest = usage.contextManifest as unknown as typeof manifest; },
    });
    const userMessage = requestBody?.messages?.find(message => message.role === "user")?.content ?? "";
    const payload = JSON.parse(userMessage.slice(userMessage.indexOf("\n") + 1)) as {
      caseProgress?: Record<string, unknown>;
      evaluatedCandidateEvidence?: { evaluatedCandidateCount?: number };
    };
    assert.equal(payload.evaluatedCandidateEvidence?.evaluatedCandidateCount, 1, "the evaluated pool size already has an authoritative field");
    assert.equal(payload.caseProgress?.discoveredCandidateCount, 40);
    assert.deepEqual(payload.caseProgress?.currentTurnCandidatePages, [
      { offset: 20, nextOffset: 40, matchingRecordCount: 40, discoveredRecordCount: 20 },
    ]);
    assert.equal("omittedHistoryEntries" in (payload.caseProgress ?? {}), false, "request bookkeeping belongs in the manifest, not the Planner prompt");
    assert.equal(manifest?.omittedHistoryEntries, 12);
    assert.equal("toolUses" in (payload.caseProgress ?? {}), false, "action availability already encodes the remaining tool budget");
    assert.equal("protectedQuoteReferences" in (payload.caseProgress ?? {}), false);
    assert.equal("evidenceDirectory" in (payload.caseProgress ?? {}), false);
    assert.doesNotMatch(userMessage, /MUST_NOT_BE_REPLAYED/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
