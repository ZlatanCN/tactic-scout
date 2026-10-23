import { type RecruitmentAction, type RecruitmentPlanner } from "../../src/recruitment/conversation.js";
import { createApp } from "../../src/app.js";
import type { RecruitmentBrief } from "../../src/domain/recruitment-brief.js";
import type { PlayerRepository } from "../../src/sources/registry.js";
import { type PlayerProfile } from "../../src/domain/players.js";
import { createKnowledgeEvidence } from "../../src/knowledge/evidence.js";
import type { EvidenceEmbedder } from "../../src/knowledge/evidence-index.js";
import type { AppKnowledgeBase } from "../../src/app/types.js";

const mode = process.argv[2];
const databasePath = process.argv[3];
const threadId = "restart-recovery-case";

if ((mode !== "pause" && mode !== "resume") || !databasePath) {
  throw new Error("Expected mode (pause|resume) and a checkpoint database path.");
}

const player: PlayerProfile = {
  playerId: "striker-a",
  name: "Jonas Vale",
  team: "Harbor City",
  age: 23,
  position: "ST",
  competition: "Open League",
  season: "2024/25",
  minutes: 2100,
  stats: {
    goals: 12,
    assists: 4,
    passesAttempted: 420,
    passesCompleted: 315,
    longPasses: 8,
    carries: 33,
    pressures: 160,
    tackles: 4,
    interceptions: 2,
    shotAssists: 18,
  },
  source: "Fixture data",
};

const repository: PlayerRepository = {
  mode: "demo",
  sourceName: "Checkpoint recovery fixture",
  async loadPlayers() { return [player]; },
};

const finishAction = {
  action: "finish",
  targetTeam: "Bayern Munich",
  needSummary: "为拜仁寻找中锋接班人。",
  capabilityProfile: ["禁区终结"],
  recommendations: [{ playerId: player.playerId, evidenceKeys: ["goals"] }],
  limitationKeys: [],
} satisfies RecruitmentAction;

const actions: RecruitmentAction[] = mode === "pause" ? [] : [
      { action: "evaluate_candidates", playerIds: [player.playerId] },
      finishAction,
    ];

const planner: RecruitmentPlanner = {
  requiresGatewayDispatch() { return false; },
  async decide() {
    return actions.shift() ?? finishAction;
  },
};

const initialBrief: RecruitmentBrief = {
  task: "reinforcement",
  targetTeam: { value: "拜仁", basis: "explicit", quote: "拜仁" },
  referencePlayer: null,
  referenceClues: [],
  referenceRecheck: null,
  selectedCandidateId: null,
  criteria: [],
  unresolved: [{
    topic: "preference",
    question: "更倾向即战力，还是未来两三年的接班人？",
    impact: "这会影响样本与培养周期的取舍。",
  }],
};

const evidenceEmbedder: EvidenceEmbedder = {
  modelId: "checkpoint-recovery-fixture",
  async embedMany(texts) { return texts.map(() => [1, 0]); },
  async countTokens(text) { return text.trim().split(/\s+/u).length; },
};
const knowledgeEvidence = createKnowledgeEvidence({
  catalogPath: `${databasePath}.knowledge.sqlite`,
  indexPath: `${databasePath}.knowledge-index`,
  embedder: evidenceEmbedder,
  reranker: null,
});
const knowledgeBase: AppKnowledgeBase = {
  async search() { return []; },
  async ingest() { return { documentId: "checkpoint-fixture", chunkCount: 0 }; },
  async removeDocument() { return 0; },
  async status() {
    return {
      indexedChunks: 0,
      methodologyChunks: 0,
      playerReportChunks: 0,
      registeredSources: 0,
      methodologySourceIds: [],
      ingestiblePlayerReportSources: 0,
      embeddingModel: "checkpoint-recovery-fixture",
      indexPath: "checkpoint-recovery-fixture",
    };
  },
};

const app = createApp({
  playerRepository: repository,
  recruitmentPlanner: planner,
  knowledgeBase,
  knowledgeEvidence,
  briefInterpreter: {
    async interpret({ previous }) {
      if (!previous) return initialBrief;
      return {
        ...previous,
        criteria: [{
          field: "position",
          operator: "in",
          value: ["ST"],
          unit: null,
          attributeKey: null,
          strength: "required",
          basis: "explicit",
          quote: "中锋",
        }],
        unresolved: [],
      };
    },
  },
  checkpointPath: databasePath,
});

try {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/recruitment/cases/${threadId}/turns`,
    payload: mode === "pause"
      ? { message: "为拜仁寻找凯恩的替代者" }
      : { message: "按中锋职责，未来两三年接班，希望有主力潜质。", expectsExistingState: true },
  });
  console.log(`RESULT:${JSON.stringify({ statusCode: response.statusCode, body: response.json() })}`);
} finally {
  await app.close();
}
