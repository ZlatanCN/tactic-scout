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

The long-input compaction fixture is kept outside the fixed development and held-out packs. Preview and run it as a dedicated smoke case:

```sh
pnpm eval:preview --mode smoke --case-directory evals/smoke-cases --case lookup-compaction-long-input-synthetic-v1 --evidence-directory .data/evals/evidence
pnpm eval:run --mode smoke --case-directory evals/smoke-cases --case lookup-compaction-long-input-synthetic-v1 --evidence-directory .data/evals/evidence --max-model-requests <N>
```

The multi-turn continuation fixture is also kept outside the fixed packs. Its long synthetic input needs a constrained profile to exhaust the default six-call context-processing grant. The profile below uses an 8,436-token effective input budget while retaining the local gateway's advertised 128,000-token output limit; it is a stress profile, not the gateway's advertised 872,000-token input capacity.

```sh
env TACTISCOUT_MODEL_CONTEXT_PROFILE='{"model":"codex/gpt-6-luna","baseURL":"http://127.0.0.1:3425/v1","maxInputTokens":10500,"maxOutputTokens":128000,"countingMarginTokens":2064}' pnpm eval:preview --mode smoke --judge --case-directory evals/smoke-cases --case lookup-compaction-continuation-multiturn-synthetic-v1 --evidence-directory .data/evals/evidence
env TACTISCOUT_MODEL_CONTEXT_PROFILE='{"model":"codex/gpt-6-luna","baseURL":"http://127.0.0.1:3425/v1","maxInputTokens":10500,"maxOutputTokens":128000,"countingMarginTokens":2064}' pnpm eval:run --mode smoke --judge --case-directory evals/smoke-cases --case lookup-compaction-continuation-multiturn-synthetic-v1 --evidence-directory .data/evals/evidence --max-model-requests 129
```

Run `a6c419f9-0fa7-41a5-bcb6-e6d65dc3884b` completed using 46/129 requests (agent 12, calibration 32, judge 2). Calibration passed 32/32 anchors. The first turn stopped at context-processing allowance exhaustion; after the explicit continuation, the task kind, Elias Demo identity, and Understat 2024/25 season constraint were preserved. The trial failed: the model repeated the same successful `search_player_records` call three times, then hit the existing per-turn search limit without delivering an answer. The semantic result is `invalid`, not a pass: the judge marked the incomplete-answer claim as contradictory to the found actions but supplied no required evidence reference, and could not verify the first-turn allowance-exhaustion claim because the evaluator does not expose context-processing events to the judge. Full report: `.data/evals/runs/a6c419f9-0fa7-41a5-bcb6-e6d65dc3884b/report.md`.

Follow-up run `e4cd7281-18aa-45c0-a540-e7ac33e77cd8` passed the same case using 43/129 requests (agent 10, calibration 32, judge 1). Calibration passed all 32 anchors; code and semantic checks passed, with all three required facts covered and no semantic findings, denied requests, or network failures. The continuation preserved the source, all six completed chunks, the resolved Elias Demo identity, and the explicit 2024/25 scope. The graph executed one lookup, reused its result when the model repeated the same tool request, then delivered the FM and Understat evidence and a complete answer. The evaluator now records context-processing state for judge grounding and excludes those snapshots from business tool-action checks. Full report: `.data/evals/runs/e4cd7281-18aa-45c0-a540-e7ac33e77cd8/report.md`.

Final follow-up run `910d0c7c-caea-4adb-9dc7-e20bf8c52bf0` repeated the semantic case after adding paired ToolMessages for reused calls and compacted-question matching for evidence continuation. It passed with the same request totals: 43/129, calibration 32/32, all eight code checks, and semantic review; all three required facts were covered with no findings, denials, or network failures. The reused result remains a complete AI/tool-call pair, and the evaluator can grant continuation if evidence explanation itself exhausts its allowance. Full report: `.data/evals/runs/910d0c7c-caea-4adb-9dc7-e20bf8c52bf0/report.md`.

Final post-review run `4eedfbd9-4896-4142-bb86-797c31b26e31` passed after adding compiled-graph coverage for evidence exhaustion and compacted-question reuse. It used 43/129 requests (agent 10, calibration 32, judge 1); calibration passed 32/32, all eight code checks passed, all three required facts were covered, and semantic review had no findings. The original source/progress remained intact, the 2024/25 scope and resolved identity survived continuation, and the saved records were explained without another provider search. Final verification: `pnpm typecheck`, `ultracite check src tests evals CONTEXT.md`, and `pnpm exec vitest run --maxWorkers=4` passed (146 files / 544 tests). Full report: `.data/evals/runs/4eedfbd9-4896-4142-bb86-797c31b26e31/report.md`.

For a first live smoke across all four workflows, preview and run these development cases with the judge enabled. The current conservative estimate is 171 gateway requests, covering up to three attempts per calibration anchor and per trial judge operation; choose an explicit cap before dispatch:

```sh
pnpm eval:preview --mode smoke --judge --evidence-directory .data/evals/evidence --case lookup-saka-real-v1 --case compare-add-third-synthetic-v1 --case recommend-add-refine-synthetic-v1 --case team-real-madrid-refine-dev-v1
pnpm eval:run --mode smoke --judge --evidence-directory .data/evals/evidence --case lookup-saka-real-v1 --case compare-add-third-synthetic-v1 --case recommend-add-refine-synthetic-v1 --case team-real-madrid-refine-dev-v1 --max-model-requests <N>
```

Formal runs repeat each selected case three times. Add `--judge` to run the 32-anchor calibration before semantic scoring. The request estimate reserves up to three model attempts for each calibration anchor and each trial judgment, including one validation-guided repair when needed. The judge defaults to the configured agent model; set `TACTISCOUT_EVAL_JUDGE_MODEL` to choose a separate model through the same gateway.

The active judge anchor pack is `evals/anchors/v9.json`. Rubric v3 assigns one most-specific category per claim; distinct claims may receive different categories. V9 preserves V8's retained-result and current-turn-action rules, and adds an explicit FM snapshot policy plus anchors distinguishing the general fixed-date snapshot from a specific date claim. V1–V8 packs and reports remain historical.

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

## Exposed V25 held-out attempt

Run `e5dde68f-5ae0-4ab8-8ae7-ea6ba6b05d2a` was stopped at 17/48 trials after 55 requests because two cases declared Bundesliga Understat rows in the La Liga scope. V25 is exposed and diagnostic only. The preview now validates that every required Understat row exists for the declared competition and season.

## V26 replacement held-out candidate

V26 has 16 independent cases (12 real-source, 4 synthetic team-roster) and new source IDs. The source rules are explicit: Understat supplies season performance; FM supplies the fixed ability snapshot. The saved xA follow-up covers a provider name in user text, and the new preflight check prevents missing or mis-scoped Understat evidence from reaching the model. Preview reports 16/16 ready and estimates 834 requests. Run v26 after committing and freezing the final code and evidence.

## Exposed V34 held-out attempt

Run `7d7c2273-7fd3-43bf-aac9-6e86076d8df4` completed 48 trials using 225 model requests. Judge calibration passed 32/32, including validation 16/16, but the quality gate failed: 44/48 trials passed. Three identity-continuity failures came from an unresolved pronoun in a saved xA follow-up even though the result was correctly reused. One semantic review missed visible Eric Martel CA/PA values (140/150) because answer text blocks were passed to the judge as escaped JSON. Two transient network failures were recovered and none were denied. V34 is exposed. The judge now receives decoded text blocks; acceptance requires a new independent V35 pack.

## V35 replacement held-out candidate

V35 contains 16 new cases and fresh source identities compared with V1–V34. Its fixed evidence preview reports 16/16 bundles ready and estimates 798 requests for the complete three-trial run and judge calibration. The 900-request limit is already authorized. V35 is exposed; see the run below.

## Exposed V35 held-out attempt

Run `23c127d1-645b-4cd8-bef9-7bf1007c9746` is partial and exposed. It used 72 requests before stopping at 24 trial records: two failures and 22 unfinished. Both failures were the Janik Haberer lookup: the extracted mention included the English possessive suffix and failed exact identity resolution. No judge or calibration request ran; there were no network failures or budget denials. The request normalizer now strips a terminal possessive suffix before identity resolution; V36 is the independent replacement.

## Exposed V36 held-out attempt

Run `b39c7477-6e47-432a-8953-c93e805c4039` completed 48 trials in 222 model requests. Calibration passed 32/32, including validation 16/16, but only 45/48 trials passed. One multi-turn saved xA trial omitted no facts in its visible answers, but the semantic judge failed to carry earlier-turn facts into its coverage result. One team response misstated the roster retrieval date; another team refinement was missing earlier-turn candidate CA/PA coverage. A transient network failure was recovered; no requests were denied. V36 is exposed.

The evaluator now requires matching delivered source values before crediting visible facts, links candidate names to tool-result source IDs, and checks tables and labeled prose across the conversation. The team answer corrector uses the exact roster retrieval date from provider data. V37 is the independent replacement.

## Exposed V37 held-out attempt

V37 run `4e55b236-4cfc-4477-9d01-51d0961da245` completed 48 trials in 215 requests. Judge calibration passed 32/32 and 47/48 trials passed. One answer falsely said the team reference profile included five squad members when the tool result listed two. A deterministic correction for that claim was changed while the run was active, so V37 did not use one frozen code version and cannot be accepted. There were no network failures or budget denials.

## Exposed V38 held-out attempt

Run `a7a72e78-5fad-4828-a52b-0864f8b2bb83` was stopped after 16/48 trials and 44 model requests. One saved-result case accidentally asked “What was his xA for that record?” while its contract expected pronoun-free saved-result reuse; it failed identity checks. The other 15 trials were unassessed. Judge calibration had not started. There were no network failures or budget denials. V38 is exposed and cannot be reused.

## Exposed V39 held-out attempt

Run `9b99f1ab-3444-479b-919d-9a2636cd1f53` was stopped after 12/48 trials and 30 Agent requests. Three trials failed the same deterministic contract because an EPL question inherited an expected Bundesliga scope from its source template; nine trials were unassessed. Calibration had not started. There were no network failures or request denials. V39 is exposed and cannot be reused.

## Exposed V40 held-out attempt

Run `ec24f5ed-5552-4b48-8f89-691802a4ca52` was stopped after 24/48 trials and 68 Agent requests. Three trials failed because the runtime could not match accentless `Jorgen` to source spelling `Jørgen`; 21 trials were unassessed. Judge calibration had not started. There were no network failures or request denials. The search normalizer now handles non-decomposing Latin variants such as `ø`/`o`, while Reep IDs still control identity grouping. V40 is exposed.

## Exposed V41 held-out attempt

Run `ebaaec2f-9fcb-4ce1-8436-b163d5906c6e` completed 48 trials in 219 requests. Judge calibration passed 32/32 (validation 16/16), but 44/48 trials passed. Three Gauthier Hein trials failed required-fact coverage because the prompt asked for appearances while the case contract still expected assists. One Aljoscha Kemlein answer called FM values a fixed-date snapshot and the judge flagged the statement unsupported. There was one recovered network failure and no request denial. V41 is exposed.

## Exposed V42 held-out attempt

Run `ed7b544a-c400-4ddb-8529-197ecf9eba9f` stopped after 36/48 trials and 105 Agent requests. One recommendation trial omitted an explicit `resultLimit: 3` for “up to three players”; the default candidate pool happened to contain three players. The other 35 trials were unassessed. Calibration and semantic judging had not started. There were no network failures or request denials. V42 is exposed.

## Passed V43 held-out quality gate

Run `81a665f6-61e2-44b0-9ab1-1b46a84a781d` completed all 48 trials in 218 model requests (138 Agent, 32 calibration, 48 judge). Judge calibration passed 32/32, including validation 16/16. All 48/48 trials passed, all 16 cases passed 3/3 repetitions, and required-fact omissions, factual contradictions, unsupported facts, and false execution claims were zero. There were no inconclusive, invalid, errored, unfinished, or denied trials. Three transient network failures were recovered. The run used freeze fingerprint `scouting-eval-v1-75bab6be6e8778af6d8441be2624debaad21673d677f9edfc94320edee3e208a` from commit `0234e8cb`; the 900-request cap was not approached.

## V19 held-out result

Run `ccc52335-f8ec-4ae1-8c44-96eec0afe682` completed all 48 trials and passed judge calibration 32/32. It used 251 requests (Agent 171, calibration 32, judge 48), with 3 network failures and no budget denials. The quality gate did not pass: 38/48 trials passed both checks, 10 failed code contracts, semantic review had 40 pass, 2 fail, 5 inconclusive, and 1 invalid, and 12/16 cases passed all three repetitions. The judge reported one factual contradiction and four required-fact omissions across 42 valid judgments; it reported no confirmed unsupported-fact or false-execution claims. See [the failure analysis](../.scratch/agent-evaluation/baseline-analysis.md) and the ignored local report at `.data/evals/runs/ccc52335-f8ec-4ae1-8c44-96eec0afe682/report.md`.

The initial incomplete attempt `263adf91-fea6-454a-9cba-2fd7f72363ad` used 195 requests and stopped at anchor 29/32; a proxy startup failure used zero requests. Total dispatched requests stayed within the approved 900. The held-out split is now exposed and must not be reused for tuning. Use development cases for diagnosis and reserve a replacement held-out set for changed code or judge rules.

Issue 63 classified the failures against the v19 development run: the Raphinha expectation conflicts with its explicit Bundesliga scope; the Kane script omitted a resume answer for an unavailable final-turn identity; and the Isak filter failure was an evaluation-contract mismatch because the tool received PA 154 and result limit 20. The similar development cases passed 3/3. One 447-minutes/appearances contradiction and one required-fact omission were not reproduced in development. No Agent or judge source code changed during triage.

Issue 64 prepared a new, independent 16-case v20 held-out pack. It has 12 real cases from unused local FM/Understat IDs and four synthetic team-roster cases. Evidence is locally prepared and ready; no live model run has been dispatched. See `evals/replacements/v20/README.md` for evidence preparation and preview commands.
