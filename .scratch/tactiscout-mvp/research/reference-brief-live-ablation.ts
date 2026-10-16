import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createRecruitmentConversation, type RecruitmentTraceEvent } from '../../../src/agent/conversation.js';
import { createRecruitmentPlanner } from '../../../src/agent/recruitment-planner.js';
import { searchLoadedPlayers } from '../../../src/data/player-search.js';
import { createReferencePlayerProfiles } from '../../../src/agent/recruitment-comparison.js';
import { requestedCapabilityEvidenceAreas } from '../../../src/domain/recruitment-capabilities.js';
import type { PlayerProfile } from '../../../src/domain/schemas.js';

const raw = await readFile('.data/evaluations/agent-optimization/understat-snapshot.json', 'utf8');
const players = JSON.parse(raw) as PlayerProfile[];
const snapshotHash = createHash('sha256').update(raw).digest('hex');
const query = '为拜仁寻找凯恩的替代者，重点看能接应、做球和终结的前锋';
const outputName = process.argv.find(value => value.startsWith('--output='))?.slice(9) ?? 'live-role-brief.json';
if (!/^[a-zA-Z0-9_-]+\.json$/.test(outputName)) throw new Error('Output must be a JSON filename');
const output = new URL('../../../.data/evaluations/football-first-principles/' + outputName, import.meta.url);
const runs: unknown[] = [];
await writeFile(output, JSON.stringify({ snapshotHash, query, runs }), { flag: 'wx' });
for (const [round, arms] of [[0, ['baseline', 'reference-brief']], [1, ['reference-brief', 'baseline']]] as const) {
  for (const arm of arms) {
    const trace: RecruitmentTraceEvent[] = [];
    const start = Date.now();
    console.log(JSON.stringify({ event: 'started', round, arm }));
    const model = createRecruitmentPlanner();
    const conversation = createRecruitmentConversation({
      repository: { mode: 'understat', sourceName: 'Frozen Understat snapshot', async loadPlayers() { return players; },
        async searchCandidates(q) { return searchLoadedPlayers(players, q); } },
      planner: { async decide(input) {
        if (arm === 'baseline') return model.decide(input);
        const brief = { purpose: 'Experimental observed-reference summary; not an ability score, tactical template, or hard threshold. Missing abilities remain unknown.', position: input.confirmedPosition, requestedAbilities: requestedCapabilityEvidenceAreas([query]), referenceObservations: createReferencePlayerProfiles(players, [query]) };
        return model.decide({ ...input, history: [...input.history, { role: 'tool', toolName: 'experimental_reference_brief', content: JSON.stringify(brief) }] });
      } }, knowledgeBase: { async search() { return []; } },
      experimentalDeterministicSearchMode: 'enabled', experimentalRetrievalMode: 'on_demand',
      observer: event => trace.push(event),
    });
    try {
      const result = await conversation.turn({ threadId: randomUUID(), message: query, signal: AbortSignal.timeout(240_000) });
      runs.push({ round, arm, elapsedMs: Date.now()-start, model: process.env.OPENAI_MODEL,
        status: result.status, message: result.message, question: result.question, report: result.report, trace });
      console.log(JSON.stringify({ event: 'finished', round, arm, status: result.status, elapsedMs: Date.now()-start,
        candidates: result.report?.recommendations.map(r => r.player.name), usage: trace.filter(e => e.phase === 'model_usage') }));
    } catch (error) {
      runs.push({ round, arm, elapsedMs: Date.now()-start, error: error instanceof Error ? error.message : String(error), trace });
      console.log(JSON.stringify({ event: 'failed', round, arm, error: error instanceof Error ? error.name : 'UnknownError' }));
    }
    await writeFile(output, JSON.stringify({ snapshotHash, query, limitations: 'Two paired repetitions: observed reference brief versus identical graph without the extra summary. Same snapshot, query, tools and empty knowledge fixture. Candidate changes are not quality gains.', runs }, null, 2));
  }
}
