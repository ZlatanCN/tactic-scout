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

For a first live smoke across all four workflows, preview and run these development cases with the judge enabled. The current conservative estimate is 171 gateway requests, covering up to three attempts per calibration anchor and per trial judge operation; choose an explicit cap before dispatch:

```sh
pnpm eval:preview --mode smoke --judge --evidence-directory .data/evals/evidence --case lookup-saka-real-v1 --case compare-add-third-synthetic-v1 --case recommend-add-refine-synthetic-v1 --case team-real-madrid-refine-dev-v1
pnpm eval:run --mode smoke --judge --evidence-directory .data/evals/evidence --case lookup-saka-real-v1 --case compare-add-third-synthetic-v1 --case recommend-add-refine-synthetic-v1 --case team-real-madrid-refine-dev-v1 --max-model-requests <N>
```

Formal runs repeat each selected case three times. Add `--judge` to run the 32-anchor calibration before semantic scoring. The request estimate reserves up to three model attempts for each calibration anchor and each trial judgment, including one validation-guided repair when needed. The judge defaults to the configured agent model; set `TACTISCOUT_EVAL_JUDGE_MODEL` to choose a separate model through the same gateway.

The active judge anchor pack is `evals/anchors/v8.json`. Rubric v3 assigns one most-specific category per claim; distinct claims may receive different categories. V8 clarifies retained-result state after a failed new operation and requires current-turn actions for comparison/filter claims. Its development anchors cover those cases. V8 passed live validation 16/16 in run `426f3ce3-1b71-41cd-b782-7259b48d52e1`; that smoke also exposed a same-identity alternate-profile candidate, which issue 20 fixed. The targeted post-fix recommendation smoke `c0d751ad-4aee-43cf-893a-2e7d86aed9f5` passed deterministic and semantic checks with v8 calibration 16/16. V1-v7 packs and reports remain historical.

Judge prompt v9 adds per-turn identity-resolver outcomes to the action evidence and constrains identity-failure claims to the exact mention. Prompt v10 added turn-specific participants and passed all 32 live anchors, including 16/16 reserved validation anchors. The v10 development report exposed a player-recommendation routing error and over-scoped empty Understat lookup answers. V11 added selected source records and stricter lookup bounds, then passed 32/32 live anchors. Its five-case smoke passed four cases; the remaining Mbappé finding showed the judge also needed exact tool inputs to assess filter claims. V13 added exact action inputs and distinguished requested from executed events; its five-case smoke still found that clarification resume state was missing from judge input. V14 adds resume answers and selected post-resume identity state and passed all 32 live anchors plus the five-case smoke.

The latest v9 development run `38e8d637-8ebc-47ad-878f-f9500cf7bef1` attempted all 96 trials using 398/1,500 requests (agent 271, calibration 32, judge 95). Calibration passed 16/16; there were no denied requests or network failures. Trial results were 86 passed and 10 failed; semantic results were 87 passed, 4 failed, 2 invalid, 2 inconclusive, and 1 not assessed. The run is `partial`; see its report at `.data/evals/runs/38e8d637-8ebc-47ad-878f-f9500cf7bef1/report.md`. Its saved report remains unchanged. New runs now normalize Responses and Chat Completions usage and report token usage and latency by role, including calibration. The 16-case held-out split remains untouched.

After the baseline, the request extractor preserves repeated team names and relative comparison seasons, recovers supported team-position codes, same-team refinement preserves saved filters, and request-repair feedback restates required fields (issues 29–31). Targeted smokes `3fb4072f-7858-44f9-9310-9282838b4295`, `6add9d7c-f27b-40d1-aa3d-d57335e5dd22`, `49b5aa6f-33ca-4821-ae9c-115cc40b9cba`, and `efdcaa7c-9a98-40be-ab99-c223e3b61550` passed deterministic checks in one trial each using 2/25, 3/20, 7/50, and 8/30 requests; semantic judging was disabled. Same-team saved-snapshot refinement is covered offline. The full development baseline has not been rerun after these changes.

**V10 development baseline:** run `d5ae61a1-4dc7-466b-bdab-11b045b96f9e` completed all 96 trials using 397/1,500 requests (Agent 269, Calibration 32, Judge 96). Calibration passed 32/32, including validation 16/16. The report recorded 90 passed and 6 failed trials; semantic review had 92 passes, 2 failures, and 2 inconclusive results. There were no denied requests or network failures. Per-role token and latency totals are in its report at `.data/evals/runs/d5ae61a1-4dc7-466b-bdab-11b045b96f9e/report.md`. The 16-case held-out split remains untouched.

V10 exposed four deterministic failures where “根据 <player> 推荐 stc 球员” was routed to team recommendation without a team, plus two unsupported competition-scope judgments for an empty Mbappé lookup. Issues 37–39 fixed those v10 findings. V11 smoke `57d3f600-a776-49eb-8ec9-d84372ef6f81` used 55/120 requests; four cases passed and the remaining finding was traced to missing tool inputs. V13 smoke `a449eed8-4bfe-4a1a-b459-fc0596ebaaa4` used 51/120 requests; four cases passed and the Mbappé semantic failure was traced to missing clarification/post-resume state. V14 smoke `da1ad1a3-8b39-46d5-8a40-ddd2c65f4928` used 52/120 requests and passed all five cases with 32/32 anchors passing.

The full V14 development baseline `0b187e75-be68-490f-bd0b-a6f2835c70c4` completed all 96 trials using 402/1,500 requests (Agent 274, Calibration 32, Judge 96). Calibration passed 32/32, including validation 16/16. The report recorded 90 passed and 6 failed trials, with 90 semantic passes, 5 failures, and 1 invalid judge output. There were two network failures and no budget denials. Issues 44–48 address the same-identity alias omission, default-season wording, FM attribute labels, result-limit wording, and empty-lookup scope.

V15 smoke `ae7fe94a-2597-4474-9822-0c2c57511aa7` used 53/130 requests: Agent 16, Calibration 32, and Judge 5. All 16 reserved validation anchors passed, all five deterministic checks passed, and four semantic reviews passed. The remaining failure was a missing-fact false negative: the judge did not map “当前能力 139” to `currentAbility=139`. Judge v16 added that display-label mapping.

V16 smoke `b95369ba-89a3-4399-8720-b8045bb8492e` also used 53/130 requests: Agent 16, Calibration 32, and Judge 5. All 16 reserved validation anchors and all five deterministic and semantic case reviews passed; there were zero network failures and budget denials. Issue 52 tracks the full v16 development baseline and requires a new explicit whole-run allowance. Held-out cases remain untouched.

Formal run `ab3547a4-8cb7-4566-a837-eff62941357b` executed all 96 development trials and used 358/1,326 requests. Its report is `partial`: 44 semantic passes, 33 failures, 9 inconclusive, 7 invalid judge outputs, and 3 trials without a visible answer. The three claim metrics use the 77 adjudicated trials: factual contradictions 3/77, unsupported additions 13/77, and false execution claims 8/77. See the local report at `.data/evals/runs/ab3547a4-8cb7-4566-a837-eff62941357b/report.md`; an earlier runtime-error partial attempt is preserved separately.

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

After Issue 10, real-model smoke `84a220c3-6229-425c-b9db-7feface802fd` used 6/30 agent requests across the three real player-comparison cases. All three extracted the requested season and EPL scope, called the comparison tool, and passed deterministic checks. This smoke disabled semantic judging and does not replace the development baseline.

## Quality gates

Routine Vitest validates the runner, fixtures, scoring contracts, and tool behavior offline. It does not call a real gateway or API-Football. Full baselines are manually triggered and require an explicit whole-run request allowance; a preview estimate is not permission to dispatch. Results describe the finite evidence and candidate pools, not general scouting accuracy.

Historical attempt `fa75f1c4-fad2-4945-b409-092b782cb058` attempted all 96 trials but ended partial after a gateway DNS failure; no semantic trial was adjudicated because v8 anchor calibration could not complete. Preserve it as an infrastructure-limited attempt, not as a quality baseline.

## Current development baseline

Historical v19 development baseline `24eb3bcf-ad26-43ad-a740-56e756994430` completed all 96 development trials using 410/1,500 requests. Calibration passed 32/32, including 16/16 validation anchors. All 96 trials and all 32 cases passed; there were zero network failures and budget denials. The 16 held-out Agent cases were untouched. Full findings are in `.scratch/agent-evaluation/baseline-analysis.md` and the ignored local report.

The v19 evaluator had judge-input and prompt changes for per-turn failures, player-linked required facts, displayed rounding, search filters, squad references, and contradiction consistency. V19 smoke `66c7f76e-e76e-45bc-b828-9cfd9cc845a4` used 49/90 requests; calibration passed 32/32 and all five focused cases passed code and semantic checks. There were no network failures or budget denials. The full v19 development baseline completed all 96 trials; the subsequent frozen held-out run is recorded below.

### Latest development run

Run `615ed820-7097-465a-b35d-6ef74c71d5f5` completed the repaired 32-case development split: 96/96 trials passed code checks and semantic review. Calibration passed 32/32 (including validation 16/16). Required-fact omissions, factual contradictions, unsupported facts, and false execution claims were all zero. It used 402 requests (269 Agent, 32 calibration, 101 judge); two transient network failures were recovered and no requests were denied. The run's working tree was dirty, so it is a development repair baseline, not the frozen held-out gate.

## Exposed V22 held-out attempt

Run `060b307e-a485-40dc-a438-fe31fb785024` is exposed and not an acceptance gate. It completed 48 trials with 23 passing and 25 failing code contracts; semantic review reported one unsupported fact. Calibration passed 32/32. The failures exposed stale identity/tool expectations and the natural-position wording issue. V22 must not be reused for tuning or final acceptance; see `evals/replacements/v22/README.md` for its exposure status. V23 is the independent replacement pack.

## Exposed V23 held-out attempt

Run `37a11cd1-a26a-4737-9be4-1252f29c8236` was stopped at 34/48 trials after 119 requests because the pack had already exposed case-contract mistakes in La Liga inputs and saved-result identity reuse. It also surfaced the recommendation reference ordering defect, now fixed with a graph-level regression. V23 is diagnostic only; v24 is the new independent replacement pack.

## Exposed V24 held-out attempt

Run `e3e727f6-d532-4cc0-97d0-0015cbf72a6f` was stopped at 27/48 trials after 97 requests because a saved xA follow-up occasionally treated “Understat” as a player. V24 is exposed and diagnostic only. V25 is the independent replacement after filtering source names and matching metric follow-ups to saved lookups.

## V25 replacement held-out candidate

V25 contains 16 cases (12 real-source, 4 synthetic team-roster) with new player/source IDs and a new synthetic fixture. Evidence is prepared locally and the preview reports 16/16 ready, with an 834-request estimate. The exact Understat xA follow-up is included. Run v25 after committing and freezing this code and pack; it is the next final acceptance gate.

## V19 held-out result

Run `ccc52335-f8ec-4ae1-8c44-96eec0afe682` completed all 48 trials and passed judge calibration 32/32. It used 251 requests (Agent 171, calibration 32, judge 48), with 3 network failures and no budget denials. The quality gate did not pass: 38/48 trials passed both checks, 10 failed code contracts, semantic review had 40 pass, 2 fail, 5 inconclusive, and 1 invalid, and 12/16 cases passed all three repetitions. The judge reported one factual contradiction and four required-fact omissions across 42 valid judgments; it reported no confirmed unsupported-fact or false-execution claims. See [the failure analysis](../.scratch/agent-evaluation/baseline-analysis.md) and the ignored local report at `.data/evals/runs/ccc52335-f8ec-4ae1-8c44-96eec0afe682/report.md`.

The initial incomplete attempt `263adf91-fea6-454a-9cba-2fd7f72363ad` used 195 requests and stopped at anchor 29/32; a proxy startup failure used zero requests. Total dispatched requests stayed within the approved 900. The held-out split is now exposed and must not be reused for tuning. Use development cases for diagnosis and reserve a replacement held-out set for changed code or judge rules.

Issue 63 classified the failures against the v19 development run: the Raphinha expectation conflicts with its explicit Bundesliga scope; the Kane script omitted a resume answer for an unavailable final-turn identity; and the Isak filter failure was an evaluation-contract mismatch because the tool received PA 154 and result limit 20. The similar development cases passed 3/3. One 447-minutes/appearances contradiction and one required-fact omission were not reproduced in development. No Agent or judge source code changed during triage.

Issue 64 prepared a new, independent 16-case v20 held-out pack. It has 12 real cases from unused local FM/Understat IDs and four synthetic team-roster cases. Evidence is locally prepared and ready; no live model run has been dispatched. See `evals/replacements/v20/README.md` for evidence preparation and preview commands.
