import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createRecruitmentConversation, type RecruitmentTraceEvent } from '../../../src/agent/conversation.js';
import { createRecruitmentPlanner } from '../../../src/agent/recruitment-planner.js';
import { searchLoadedPlayers } from '../../../src/data/player-search.js';
import type { PlayerProfile } from '../../../src/domain/schemas.js';

const raw = await readFile('.data/evaluations/agent-optimization/understat-snapshot.json', 'utf8');
const players = JSON.parse(raw) as PlayerProfile[];
const snapshotHash = createHash('sha256').update(raw).digest('hex');
const query = '为拜仁找前锋，重点看进球产出和创造机会，年龄不限。';
// The old production Understat adapter already interleaved leagues before slicing.
// Preserve that behavior in the control; raw snapshot order would be an unfair baseline.
function legacyLeagueOrder(records: PlayerProfile[]): PlayerProfile[] {
  const leagues = new Map<string, PlayerProfile[]>();
  for (const player of records) { const group = leagues.get(player.competition) ?? []; group.push(player); leagues.set(player.competition, group); }
  const groups = [...leagues.values()];
  const result: PlayerProfile[] = [];
  for (let index = 0; groups.some(group => index < group.length); index++) {
    for (const group of groups) if (group[index]) result.push(group[index]!);
  }
  return result;
}
const outputName = process.argv.find(value => value.startsWith('--output='))?.slice(9) ?? 'live-discovery-final.json';
if (!/^[a-zA-Z0-9_-]+\.json$/.test(outputName)) throw new Error('Output must be a JSON filename');
const output = new URL('../../../.data/evaluations/football-first-principles/' + outputName, import.meta.url);
const runs: unknown[] = [];
await writeFile(output, JSON.stringify({ snapshotHash, query, runs }), { flag: 'wx' });
for (const [round, arms] of [[0, ['source-order', 'discovery']], [1, ['discovery', 'source-order']]] as const) {
  for (const arm of arms) {
    const trace: RecruitmentTraceEvent[] = [];
    const start = Date.now();
    console.log(JSON.stringify({ event: 'started', round, arm }));
    const conversation = createRecruitmentConversation({
      repository: { mode: 'understat', sourceName: 'Frozen Understat snapshot', async loadPlayers() { return players; },
        async searchCandidates(q) { return arm === 'source-order'
          ? searchLoadedPlayers(legacyLeagueOrder(players), { ...q, discoveryMetricGroups: undefined })
          : searchLoadedPlayers(players, q); } },
      planner: createRecruitmentPlanner(), knowledgeBase: { async search() { return []; } },
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
    await writeFile(output, JSON.stringify({ snapshotHash, query, control: 'Legacy Understat league interleaving, source order within each league, same filters and page size.', limitations: 'Two paired repetitions, one frozen query, real local model, empty knowledge fixture. Measures observed behavior and cost, not football quality.', runs }, null, 2));
  }
}
