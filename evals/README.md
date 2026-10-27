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

Formal runs repeat each selected case three times. Add `--judge` to run the 32-anchor calibration before semantic scoring. The estimate includes 32 calibration calls and one judge call per trial. The judge defaults to the configured agent model; set `TACTISCOUT_EVAL_JUDGE_MODEL` to choose a separate model through the same gateway.

Run the development split against locally prepared evidence with an explicit budget:

```sh
pnpm eval:run --mode development --judge --evidence-directory .data/evals/evidence --max-model-requests <N>
```

Held-out cases require an explicit freeze ID after the agent and scoring rules are fixed:

```sh
pnpm eval:preview --mode held_out --judge --freeze-id <freeze-id> --evidence-directory .data/evals/evidence
pnpm eval:run --mode held_out --judge --freeze-id <freeze-id> --evidence-directory .data/evals/evidence --max-model-requests <N>
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

## Capture API-Football snapshots

The repository has no real API-Football squad snapshot yet. Team evaluation currently has four explicitly synthetic cases. To prepare real cases, capture two exact teams and their squads with a bounded source allowance:

```sh
pnpm eval:capture-team-snapshots --team <team-a> --team <team-b> --max-api-requests 4 --output .data/evals/team-source-captures/teams.json
```

The capture command requires `API_FOOTBALL_KEY`, writes the raw API response bodies locally with restrictive file permissions, and stops at the specified physical request cap. It does not upload the responses. Once the snapshots and their FM/Reep mappings are inspected, pass the capture file to `eval:prepare-evidence` when generating real team bundles.

The current case inventory is 40/48. The remaining eight team cases require those real snapshots; `pnpm eval:validate` reports the missing coverage rather than filling it with synthetic records.

## Quality gates

Routine Vitest validates the runner, fixtures, scoring contracts, and tool behavior offline. It does not call a real gateway or API-Football. The actual development baseline and held-out run require prepared evidence, a manually selected whole-run model-request allowance, and a qualified judge; do not treat synthetic fixtures as real-source evidence.
