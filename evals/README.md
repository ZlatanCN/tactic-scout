# Local agent evaluation

The evaluator drives the real compiled `createAgent` graph, request extractor, identity resolver, local source readers, recommendation algorithms, API-Football adapter, and native `Command` resumes. Tests use the public runner with a loopback fake gateway and versioned fixed evidence. Live model and provider runs remain manual.

## Preview and run

Preview case coverage and a conservative request estimate without dispatching model requests:

```sh
pnpm eval:preview --mode smoke --case lookup-smoke-v1
pnpm eval:preview --mode development --judge --evidence-directory .data/evals/evidence
```

Run one local smoke trial with an explicit whole-run allowance:

```sh
pnpm eval:run --mode smoke --case lookup-smoke-v1 --max-model-requests <N>
```

For a first live smoke across all four workflows, preview and run these development cases with the judge enabled. The current preview estimates 99 gateway requests, including anchor calibration; choose an explicit cap before dispatch:

```sh
pnpm eval:preview --mode smoke --judge --evidence-directory .data/evals/evidence --case lookup-saka-real-v1 --case compare-add-third-synthetic-v1 --case recommend-add-refine-synthetic-v1 --case team-real-madrid-refine-dev-v1
pnpm eval:run --mode smoke --judge --evidence-directory .data/evals/evidence --case lookup-saka-real-v1 --case compare-add-third-synthetic-v1 --case recommend-add-refine-synthetic-v1 --case team-real-madrid-refine-dev-v1 --max-model-requests <N>
```

Formal runs repeat each selected case three times. Add `--judge` to run the 32-anchor calibration before semantic scoring. The estimate includes 32 calibration calls and one judge call per trial. The judge defaults to the configured agent model; set `TACTISCOUT_EVAL_JUDGE_MODEL` to choose a separate model through the same gateway.

The active judge anchor pack is `evals/anchors/v3.json`. It replaces two v2 validation anchors whose labels omitted overlapping error categories and records the retired IDs and prior exposure. The v1 and v2 smoke reports remain historical with invalid semantic scores; v3 requires a fresh live calibration before semantic scoring can be trusted.

Run the development split against locally prepared evidence with an explicit budget:

```sh
pnpm eval:run --mode development --judge --evidence-directory .data/evals/evidence --max-model-requests <N>
```

Before using held-out results, freeze the evaluated code, evidence/case set, dependency lock, agent model, gateway, and judge configuration. Preview prints a `freezeFingerprint` derived from those inputs. Copy that exact fingerprint into `--freeze-id`; any change to the inputs invalidates it.

```sh
pnpm eval:preview --mode held_out --judge --evidence-directory .data/evals/evidence
pnpm eval:run --mode held_out --judge --freeze-id <copied-freezeFingerprint> --evidence-directory .data/evals/evidence --max-model-requests <N>
```

Reports are written to ignored `.data/evals/runs/` as per-trial JSON and a Markdown summary. Worker databases and inputs remain under ignored `.data/evals/work/`. The report records evidence hashes, model requests by role, source dates, local code and prompt hashes, trial checks, semantic findings, coverage, and incomplete work.

Compare two saved JSON reports over only cases with matching case, evidence, split, workflow, and trial identity:

```sh
pnpm eval:compare --baseline .data/evals/runs/<run-a>/report.json --candidate .data/evals/runs/<run-b>/report.json
```

Pass `--output <path>` to save the comparison as Markdown.

Check the benchmark's case counts, split grouping, provenance labels, and available evidence bundles:

```sh
pnpm eval:validate --evidence-directory .data/evals/evidence
```

It reports missing real-source preparation separately from invalid bundle hashes or an incomplete 48-case pack.

## Prepare real FM and Understat evidence

Evidence preparation reads local SQLite snapshots and performs no provider requests:

```sh
pnpm eval:prepare-evidence --case lookup-saka-real-v1 --case lookup-haaland-real-v1 --case recommend-haaland-real-v1
pnpm eval:preview --mode smoke --case lookup-saka-real-v1 --evidence-directory .data/evals/evidence
```

The evaluator rejects missing or mismatched bundles before model dispatch. A trial never falls back to the full local corpus or a live provider.

## API-Football roster snapshots

The local pack includes frozen Real Madrid (team 541) and Bayer Leverkusen (team 168) squads, captured with four API requests. The current FM snapshot maps 30/38 Real Madrid members and 25/30 Bayer Leverkusen members to local FM profiles. The real team cases verify that the agent stops safely when roster members have no local profile; successful ranking and exclusion remain covered by synthetic team fixtures and the real ranking implementation.

To capture another pair of squads, use a bounded source allowance:

```sh
pnpm eval:capture-team-snapshots --team <team-a> --team <team-b> --max-api-requests 4 --output .data/evals/team-source-captures/teams.json
```

The capture command requires `API_FOOTBALL_KEY`, writes raw API response bodies locally with restrictive file permissions, and stops at the specified physical request cap. It does not upload the responses. After inspecting the snapshots and FM/Reep mappings, pass the capture file to `eval:prepare-evidence` when generating team bundles.

The benchmark now has 48/48 cases: 32 real and 16 synthetic, with 12 cases per workflow. `pnpm eval:validate --evidence-directory .data/evals/evidence` checks the local evidence hashes and split/category counts.

## Quality gates

Routine Vitest validates the runner, fixtures, scoring contracts, and tool behavior offline. It does not call a real gateway or API-Football. The current 32-case development preview with the judge estimates up to 1,235 gateway requests. The actual baseline remains a manual run and requires an explicit whole-run allowance and a qualified judge; the preview estimate is not permission to dispatch that workload. Results describe the finite evidence and candidate pools, not general scouting accuracy.
