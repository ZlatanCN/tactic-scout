# Agent evaluation v1: fixed evidence and truthful execution

Status: open
Labels: ready-for-agent

## Problem Statement

TactiScout can look up players, compare players, recommend FM profiles, and recommend players for a selected team and position. Its existing Vitest suite verifies many deterministic behaviors with controlled model responses, but it does not establish how the real gateway model performs on a repeatable set of scouting tasks.

The maintainer needs to detect incorrect task understanding, mistaken identities, lost conditions, unsupported answers, and misleading statements about actions. An answer can contain the correct player facts while falsely claiming a fresh search, a successful provider response, or a filter that never ran. A low factual-error rate can also conceal an agent that refuses every question, a judge that cannot recognize errors, or a report that excludes unfinished trials without showing its coverage.

The maintainer wants a reproducible local baseline for improving prompts, models, and workflow behavior, together with concrete evidence that can be discussed in an interview. The baseline must distinguish errors in the agent from invalid fixtures, unavailable infrastructure, incomplete adjudication, and an unqualified model judge. The existing FM recommendation rules provide a testable computation contract, but there are no independent scouting relevance labels from which to claim real-world recruitment accuracy.

## Solution

Provide a local TypeScript evaluation capability that runs the actual compiled scouting agent against versioned fixed evidence using a real model through the existing gateway. It exercises request understanding, identity resolution, source readers, actual comparison and recommendation algorithms, scripted conversations, and native interrupt/resume behavior.

Begin with 48 Scouting evaluation cases covering the four workflows, with 32 development cases and 16 held-out cases. Formal evaluation retains three state-isolated Scouting evaluation trials per case. Expected behavior and facts are explicit contracts supported independently by source evidence and business definitions, rather than one required natural-language answer.

Combine deterministic checks with one calibrated semantic judge. Report factual contradictions, unsupported factual additions, and false Scouting execution claims separately. A confirmed critical violation fails the complete trial; inconclusive judgments, runtime errors, and unfinished work remain explicit. Validate the judge with a separate 32-example anchor suite, including 16 reserved validation anchors that must all be judged correctly before semantic scores are valid.

Produce local per-trial JSON artifacts and readable Markdown reports containing quality, adjudication coverage, stability, provenance, latency, and request usage. Real-model evaluation is manually triggered with an explicit whole-run physical-request allowance. Establish the development baseline before agreeing aggregate quality thresholds and freezing a version for held-out evaluation.

## User Stories

1. As the maintainer, I want to evaluate the real gateway model, so that I can observe behavior that deterministic model mocks cannot establish.
2. As the maintainer, I want all four scouting workflows represented, so that a lookup-only score does not describe the whole agent.
3. As the maintainer, I want realistic cases drawn from fixed source snapshots, so that evaluation reflects the project's actual data contracts.
4. As the maintainer, I want clearly labeled synthetic boundary evidence, so that ambiguity and missing-data failures can be triggered reliably.
5. As the maintainer, I want source identities, dates, and missing fields preserved, so that evaluation does not silently change the meaning of evidence.
6. As the maintainer, I want a declared development/held-out split, so that prompt changes can be checked on cases reserved for the current evaluation cycle.
7. As the maintainer, I want related evidence and paraphrases grouped together, so that near-duplicate cases do not leak between splits.
8. As the maintainer, I want historical tuning exposure recorded, so that a previously used bug scenario is not presented as universally unseen.
9. As the maintainer, I want ordinary single-turn cases, so that basic task fulfillment remains measurable.
10. As the maintainer, I want scripted multi-turn cases, so that aliases, references, participant additions, and inherited conditions are evaluated.
11. As the maintainer, I want native interrupt and Command resume interactions, so that clarification behavior is part of the measured workflow.
12. As the maintainer, I want independent trial state with continuity inside each conversation, so that unrelated runs do not contaminate one another.
13. As the maintainer, I want the real request extractor and identity resolver exercised, so that evaluation does not inject the answers to those steps.
14. As the maintainer, I want real comparison, RMSE ranking, PA ordering, and roster exclusion, so that prerecorded recommendation results cannot hide defects.
15. As the maintainer, I want golden expectations established independently of the evaluated output, so that the agent cannot certify its own correctness.
16. As a scout, I want Chinese names, aliases, and ambiguous identities handled correctly, so that my request uses the intended source records.
17. As a scout, I want source scope, position, age, CA, PA, and other supported hard conditions retained, so that recommendations answer my actual request.
18. As a scout, I want cross-season and cross-competition limits respected, so that incomparable performance records are not presented as equivalent evidence.
19. As a scout, I want PA explained as a potential ceiling signal, so that it is not represented as a guaranteed future CA.
20. As a scout, I want missing fields and unavailable evidence acknowledged, so that the agent does not invent contracts, current registration, fees, or transfer feasibility.
21. As the maintainer, I want appropriate abstention distinguished from unnecessary refusal, so that refusing every answerable task cannot pass the benchmark.
22. As the maintainer, I want factual contradictions scored separately, so that answers that disagree with evidence are directly visible.
23. As the maintainer, I want unsupported additions scored separately, so that accidentally true background knowledge does not count as evidence-grounded generation.
24. As the maintainer, I want execution claims evaluated, so that an invented claim of searching, filtering, comparing, or fetching is detected.
25. As the maintainer, I want requested actions distinguished from actual attempts, so that a model tool request is not proof of execution.
26. As the maintainer, I want returned tools distinguished from business success, so that an unavailable response is not reported as a successful lookup.
27. As a scout, I want saved-result reuse described honestly, so that an answer based on earlier evidence is not called a fresh query.
28. As the maintainer, I want direct business-node tool invocations observed, so that comparison and recommendation are not invisible merely because they lack model-generated tool calls.
29. As the maintainer, I want answer grounding checked against evidence actually delivered or lawfully reused, so that hidden fixture facts cannot rescue an unsupported response.
30. As the maintainer, I want deterministic checks for verifiable behavior, so that clear identity, execution, numeric, and condition errors do not depend entirely on a model judge.
31. As the maintainer, I want a semantic judge for natural-language claims, so that correct paraphrases can pass without exact string matching.
32. As the maintainer, I want judge evidence references checked in code, so that fabricated citations or nonexistent action references do not become passing scores.
33. As the maintainer, I want critical errors to fail the whole trial, so that unrelated strengths do not average away a wrong identity or invented fact.
34. As the maintainer, I want necessary but unresolved judgments marked inconclusive, so that uncertainty does not silently become a clean answer.
35. As the maintainer, I want an established violation retained after a later runtime error, so that infrastructure failure cannot hide an already observed defect.
36. As the maintainer, I want separate errors for fixture, provider, budget, and judge failures, so that I know which component prevented a valid evaluation.
37. As the maintainer, I want explicit per-metric denominators and adjudication coverage, so that percentages cannot hide unscored trials.
38. As the maintainer, I want per-workflow results, so that success on one workflow does not obscure a weak workflow.
39. As the maintainer, I want all three formal repetitions retained, so that the report reveals variability instead of selecting the best run.
40. As the maintainer, I want the number of cases passing all three trials, so that repeatable success is visible.
41. As the maintainer, I want the judge model independently configurable through the existing gateway, so that I can compare judge configurations without changing the agent.
42. As the maintainer, I want same-model judging explicitly identified, so that its results are not presented as independent human ground truth.
43. As the maintainer, I want correct and deliberately incorrect judge anchors, so that judge behavior is checked before its scores are trusted.
44. As the maintainer, I want all reserved validation anchors to pass, so that known judgment errors prevent a misleading formal semantic score.
45. As the maintainer, I want outputs and code findings retained when calibration fails, so that collected work remains inspectable.
46. As the maintainer, I want anchor development and validation exposure recorded, so that judge tuning does not quietly reuse its validation answers.
47. As the maintainer, I want local structured artifacts and a readable report, so that failures can be traced back to their evidence and execution.
48. As the maintainer, I want comparable reports across versions, so that model or prompt changes can be assessed on matched cases.
49. As the maintainer, I want data, prompt, code, scoring, and model identities recorded, so that I can explain what changed between experiments.
50. As the maintainer, I want latency, request counts, and available token usage, so that quality can be considered alongside runtime cost.
51. As the maintainer, I want a whole-run physical-request cap, so that retries, judge calls, and calibration cannot silently multiply gateway usage.
52. As the maintainer, I want dispatch stopped before the cap is exceeded, so that the configured allowance is enforced rather than reported after overspending.
53. As the maintainer, I want partial reports on cancellation, exhaustion, or interruption, so that unfinished work is not discarded or counted as passed.
54. As the maintainer, I want a preview and small smoke subset before a full run, so that preparation defects can be found with a bounded allowance.
55. As the maintainer, I want fixed roster responses prepared once with a bounded source allowance, so that ordinary trials do not consume live API-Football quota.
56. As the maintainer, I want missing or mismatched fixtures rejected explicitly, so that the runner cannot fall back to live APIs or the full corpus.
57. As the maintainer, I want private source extracts and run traces kept local, so that evaluation does not introduce an unintended data-upload dependency.
58. As the maintainer, I want routine CI to validate the evaluator offline, so that ordinary commits do not require live model credentials or quota.
59. As the maintainer, I want a development baseline before aggregate thresholds, so that the first report is not judged against invented quality targets.
60. As the maintainer, I want held-out execution only after a version and scoring rules are frozen, so that the reserved evaluation has a clear meaning.
61. As the maintainer, I want truthful clarification scripts, so that the harness does not dynamically repair the agent or reveal hidden expected answers.
62. As the maintainer, I want evaluation driven outside the production graph, so that benchmarking does not add evaluator-specific nodes or bulk trace fields to business state.
63. As the maintainer, I want all observations called automated review, so that the project never misrepresents model judgments as human annotations.
64. As the maintainer, I want implementation completion separated from model quality, so that a valid baseline containing agent failures remains a useful deliverable.

## Implementation Decisions

### Evaluation boundary

1. Follow ADR-0009 and the accepted evaluation plan. Build a cohesive evaluation capability comprising evidence preparation, case loading, trial driving, execution observation, deterministic validation, semantic judging, and report generation.
2. Provide one public evaluation entry shared by the local command and integration tests. Prefer the existing createAgent seam for the evaluated application; introduce no evaluator-specific production node or alternate business algorithm.
3. Real evaluation uses a real gateway model and the normal request extractor, identity resolution, source readers, tools, comparison, and recommendation computations. Evaluation-local observation may wrap the actual dependencies but must not replace them with golden answers.
4. Use process isolation because source paths and module initialization depend on process environment and provider clients maintain in-process caches. Each trial gets a fresh process, MemorySaver/thread, and API client; turns and clarification resumes within that trial retain their shared state.
5. Start with serial trial execution. All real gateway traffic from agent, judge, and calibration is subject to the same whole-run allowance. A future concurrency implementation must preserve exact pre-dispatch accounting and state isolation.
6. Keep evaluator traces and large artifacts outside production State. Preserve the application's existing local/private source-processing requirements.

### Cases, scripts, and independent expectations

7. Version 48 cases: 12 each for player lookup, player comparison, player recommendation, and team-directed recommendation. Each workflow contributes four ordinary single-turn cases, four boundary/adversarial cases, and four multi-turn conversations.
8. For each workflow, assign three ordinary, three boundary, and two multi-turn cases to development; assign one ordinary, one boundary, and two multi-turn cases to held-out evaluation. This produces 32 development and 16 held-out cases.
9. Target 32 cases based on unchanged real snapshot evidence and 16 based on constructed boundary evidence. Preserve and display provenance. Any modified real evidence is marked synthetic/mixed; subsetting a source must preserve the original values and disclose the reduced coverage.
10. Case definitions declare stable identity/version, workflow, split, scenario family, evidence bundle/hash, origin, prior prompt/code-tuning exposure, scripted turns, permitted clarification kinds/answers, execution bounds, expected task/outcomes, identity/source records, effective conditions, required facts, prohibited claims, and evidence/business-rule references.
11. Keep related evidence/scenario families and paraphrases in one split. Record the evaluation-cycle version from which a case was reserved. Historical failure cases may be held out for this cycle but cannot be represented as completely unknown to the application.
12. User scripts provide only predeclared user information. Clarifications may occur in any order explicitly allowed by the case contract; choose declared identities from actual candidates. Missing expected candidates, undeclared clarification types, or exhausted scripted bounds produce behavior findings rather than improvised helpful responses.
13. Validate behavior invariants rather than one exact node sequence. Enforce identity prerequisites, selected source IDs, applicable hard conditions, required clarifications, completion/abstention expectations, and lookup bounds while permitting legitimate alternative paths and saved-result reuse.
14. Facts and canonical identity expectations come from fixed source fields, recorded bridges, and permitted business definitions. Golden arithmetic/order uses independent arithmetic or a preverified frozen result; the production ranking function and candidate output must not generate their own oracle.
15. Expected contracts are evaluator inputs only. The agent receives normal user messages, its ordinary prompts, and evidence obtained through its genuine workflow. It never receives golden outputs, hidden answer labels, judge anchors, or corrective hints from the harness.
16. Evaluate the existing recommendation contract: position eligibility, equal-weight reference profiles, RMSE order, separate PA order, applicable filters, source dates, and exact roster exclusions. These cases do not establish independent scouting relevance, transfer feasibility, or future CA accuracy.

### Fixed evidence preparation

17. Prepare small FM, Understat, and Reep databases compatible with the actual readers, plus recorded API-Football team/squad HTTP responses. Freeze relevant provider IDs, canonical links, aliases, positions, manifests, raw source fields, source dates, and roster retrieval dates.
18. Version the extraction recipe, evidence manifest, content hashes, position-feature-map identity/hash, candidate pool, synthetic alterations, and expected-contract provenance. Report recommendation scope as the frozen candidate pool.
19. Reusable real API-Football snapshots are not yet confirmed locally. If preparation needs a one-time capture, estimate and explicitly bound its source requests, respect provider failures/limits, and store its provenance. Missing credentials or unavailable source evidence must remain preparation failures rather than fabricated real records.
20. Validate evidence integrity and declared synthetic fault conditions before model dispatch. An undeclared missing/inaccessible asset, accidental corruption, or hash mismatch is an invalid fixture and stops preflight with no gateway request. An explicitly declared data-fault case may intentionally contain an absent database, malformed payload, or corrupt row; verify the recorded defect/expected absence and then run it through the real readers and graph instead of precomputing an unavailable outcome. Trial execution replays only prepared provider responses through the real API adapter. Requests outside declared evidence coverage stop explicitly at runtime, and no missing or faulty resource may cause fallback to a live API or the full local corpus.
21. Distinguish invalid fixture coverage from an agent request that violates the case's allowed identities or source scope. Preserve both the attempted request and the reason it could not be served; never turn an out-of-scope request into a fabricated successful or empty response.
22. Keep source extracts, prepared private databases, transcripts, and run outputs in an ignored local evaluation-data area. Version case definitions, synthetic evidence, recipes, manifests, and scoring rules with the repository; keep credentials out of all artifacts.

### Execution and delivered-evidence observation

23. Observe actual model, tool, identity, and team-data boundaries while retaining the real implementation. Do not rely solely on model tool_calls or solely on LangChain tool-end callbacks.
24. Distinguish model-requested operations, attempted invocations, dispatch prevented by a guard, schema rejection, returned results, successful business outcomes, explicit unavailable/not-found/empty business outcomes, thrown failures, cache hits, and saved-result reuse. Requested calls prove intent, not execution; a returned value or tool-end event alone does not prove business success.
25. Include comparison and recommendation tools called directly by nodes. An identity candidate search is not automatically equivalent to a completed profile lookup, and a roster mapping is not a live roster refresh.
26. Correlate observations with run, case, trial, turn, operation/tool call, selected identity/source, normalized effective conditions, result/evidence references, outcome category, timestamps, and duration. Keep raw permitted evidence and answers in local artifacts rather than application logs or State.
27. Ground semantic judgments in the evidence actually supplied to the agent for that answer or legitimately reused from saved context, plus business definitions supplied to the agent. The full fixture corpus may establish expected behavior but must not rescue a fact absent from the agent's delivered evidence.
28. Preserve enough event and outcome evidence to check action statements such as a new search, source coverage, applied conditions, completed ranking, and successful retrieval. When evidence is incomplete, mark the relevant judgment inconclusive rather than inventing either an execution or its absence.
29. Correlate model request attempts with roles for agent, judge, and anchors, including retries/repairs and available response model/token metadata. Record provider metadata as unavailable when absent instead of estimating it as fact.

### Scoring contracts and trial outcomes

30. Deterministic validators check workflow outcomes, exact identity/source bindings, hard constraints, required clarifications, tool execution/outcomes, source arithmetic/ranking contracts, and state continuity. The semantic judge evaluates whole visible responses for required facts and additional factual/execution claims.
31. Separately classify factual contradictions with delivered evidence, factual additions unsupported by that evidence, and false execution claims. Assign one most-specific category to each claim: process claims use `false_execution_claim`; factual claims directly disproved by delivered evidence use `factual_contradiction`; factual claims that are neither supported nor contradicted use `unsupported_fact`. Normalize equivalent value representations, such as ISO and natural-language dates, before deciding that evidence contradicts an answer. A cache-hit operation paired with a claim of a fresh request is an execution error, not a factual contradiction. Distinct claims in one response may produce different categories. An externally plausible fact remains unsupported if it lacks the permitted evidence. Permit correctly attributed quotations, explicit hypotheses, and documented business definitions; do not treat hedging as permission to invent specific unsupported player facts.
32. Provide the judge with the user interaction, applicable case contracts, delivered evidence, business definitions, observed actions, and per-turn available-result state. Use the state observations to assess claims that a result remains available; a prior successful action alone is insufficient. Use a versioned prompt and structured output; do not reveal the evaluated model/version label to the judge.
33. Judge findings contain the relevant answer quotation, claim category/verdict, evidence or action references where applicable, and a concise explanation. Code validates quotation locations, reference existence, and response schema. Supported and contradicted claims require valid support/contradiction references; an unsupported or nonexistent-action finding must identify its scope and missing basis without fabricating a reference.
34. Invalid judge structure, nonexistent quotations/references, missing necessary evidence, or an unresolved judgment cannot become a pass. Bounded request recovery may address a transient provider or parsing failure, but no repeated judging or vote collection is permitted merely to obtain a desired verdict.
35. A pass requires expected task behavior, required answer facts, and no critical identity, constraint, factual, or execution-claim violation. Appropriate refusal/clarification can pass when required by the case. Universal refusal on answerable cases fails completion or required-fact checks.
36. Any confirmed critical violation fails the complete trial. This takes precedence over a later infrastructure error; retain the later error as additional metadata. When no failure is confirmed but a necessary judgment is unresolved, the trial is inconclusive.
37. Distinguish agent behavior failure, inconclusive adjudication, infrastructure error, invalid fixtures, invalid judge calibration, and not-run/unfinished work. Preserve independent metric validity, so a known deterministic failure survives unavailable semantic scoring while unjudged semantic metrics remain invalid/inconclusive.
38. Error categories may overlap within a trial when distinct claims trigger different categories; do not assign multiple categories to the same claim. Do not add category percentages as if they formed disjoint portions of one total hallucination score, and do not use a weighted aggregate to cancel critical errors.

### Judge anchors and model configuration

39. Give the judge an independently configurable model identity through the existing gateway. It may explicitly use the same model as the agent; record that fact. Automated labels and model judgments must not be described as human annotations or expert scouting labels.
40. Create 32 anchors independent of the 48 agent cases: eight correct paraphrases, eight factual contradictions, eight unsupported additions, and eight execution-claim errors. Each category contributes four development and four validation anchors, yielding 16 in each split.
41. Derive anchor labels from evidence and explicit rules; include plausible correct variants and subtle mistakes involving values, identities, seasons, missing facts, failed/blocked calls, provider coverage, and saved-result reuse. Generated answers do not certify their own expected labels.
42. Keep anchor development and validation families separate, and preserve their separation from the agent dataset. Use development anchors for judge tuning; use all 16 reserved validation anchors to qualify the judge/rubric for formal semantic scoring.
43. All 16 validation anchors must match their expected pass/fail verdict and error-category label set; correct-paraphrase anchors must have no false error finding. Detecting an error but misclassifying an unsupported addition as a contradiction does not pass calibration. A failed or incomplete validation makes formal semantic scores invalid; preserve collected agent outputs and deterministic findings. Report the observed anchor results without claiming universal 100% judge accuracy.
44. Record calibration identity, anchor/rubric versions, model settings, and results in the report. If validation findings are used to tune the judge, record that exposure, retire the affected examples from untouched validation, and version replacements.

### Runs, request budgets, and reports

45. Formal runs execute three fresh trials per selected case; a development/debug mode may explicitly use one. Development formal execution is 96 conversations; held-out formal execution is 48. A full cycle totals 144 conversations, not 144 model requests.
46. Require an explicit whole-run model-request allowance for every live evaluation. Preview selected cases, repetitions, anchor work, expected bounds, and missing prerequisites before dispatch. Select numeric model/source allowances after preparation estimates rather than embedding an arbitrary unlimited default.
47. Enforce the shared allowance immediately before each physical gateway HTTP dispatch, including agent extraction/explanation, judge, calibration, and their retries/repairs. Disable redundant uncounted SDK retries. Prevent request N+1 when the allowance is N; node-level retry budgets remain within that global cap.
48. Cancellation or allowance exhaustion stops further dispatch and persists completed observations and a partial report. Do not automatically rerun an entire failed trial or replace its result with a later successful one. Individual provider recovery remains bounded and every dispatch attempt is retained.
49. Produce structured per-trial results and readable aggregate reports. Include expected versus observed behavior, claimed facts/actions, evidence references, deterministic findings, judge results/validity, all error statuses, timing, and physical-request/available-token breakdowns for agent, judge, and calibration.
50. Primary contradiction, unsupported-fact, and execution-claim rates are case-trial rates: any confirmed relevant error in the scripted conversation makes that trial positive for the metric. Each metric states its own adjudicated denominator and coverage.
51. Always report planned, attempted, completed, adjudicated, inconclusive, errored, and unfinished work. Zero adjudicated trials for a metric yields N/A, not zero error. Already confirmed relevant errors remain visible when later work is interrupted.
52. Show per-workflow scores, task completion, required-fact omissions, and the number of cases whose three trials all pass. Retain all repetitions; do not present them as three statistically independent new questions.
53. Record case/evidence/split versions, source/feature-map hashes, code and working-tree identity, dependency identity, prompts, judge/rubric/anchor identities, model identifiers/settings, and run times. Comparisons match compatible cases and expose coverage and configuration differences alongside metric deltas.
54. Real runs are explicit manual operations. Routine CI validates evaluator behavior and artifact integrity without real provider credentials or quota. Keep actual baseline results and any source-data capture within the declared local/private scope.
55. Delivery first establishes the evidence/cases/anchors, public runner and offline validation, preview, bounded smoke run, and 32-case development baseline. Aggregate quality thresholds are decided from that baseline, then recorded with a frozen agent/scoring configuration before the 16-case held-out run.
56. A valid implementation may produce a poor model baseline. Report that baseline honestly; do not alter golden contracts, remove failures, rerun until success, or invent an aggregate accepted/not-accepted quality label to make implementation appear successful.

## Testing Decisions

1. The user confirmed one primary feature seam: the public evaluation entry shared with the CLI. It drives the real compiled createAgent graph, invoke, and Command resume. Tests observe public results, local artifacts, execution records, process outcomes, and actual HTTP dispatch counts.
2. Vitest tests of the evaluator use a controlled local gateway HTTP service, small real-format SQLite fixtures, and recorded API HTTP responses. Keep the actual ChatOpenAI transport/structured extractor, identity/source readers, comparison, and ranking behavior; do not substitute extracted requests, resolved identities, or prerecorded rankings for whole-agent evaluation tests.
3. Use the same public entry for judge-anchor validation and scoring/report behavior. A thin CLI smoke check may verify argument/environment handling and exit/report behavior without creating a second business testing API.
4. Test all four workflows with small distinguishing fixtures whose identities, values, and exact arithmetic expectations can be independently checked. Verify that changing a relevant fixed source value changes the actual computed result appropriately.
5. Test dataset cardinalities, workflow/category counts, development/held-out assignments, origin labels, grouped evidence/paraphrases, prior tuning provenance, fixture hashes, extraction metadata, feature-map identity, and independently established expected contracts.
6. Test undeclared missing/corrupt/mismatched fixtures and invalid run configuration before gateway dispatch: assert preparation errors, zero model requests, and no fallback to live data/full corpus. Separately test explicitly declared synthetic missing/corrupt-data cases whose recorded condition passes preparation and reaches the real graph/readers, yielding the expected unavailable outcome, preserved context, and truthful execution claims.
7. Test multi-turn alias reuse, references, comparison additions, recommendation refinements, expected interrupts, legal alternative clarification order, Command resumes, and unexpected/absent candidates. Verify scripted bounds and that the harness never improvises hidden corrective answers.
8. Test fresh process/environment/thread/provider-cache isolation across trials and repetitions, with continuity inside one scripted conversation.
9. Test execution evidence for requested-but-blocked calls, schema rejection, tool failure, returned data-unavailable results, valid not-found/empty results, business success, direct comparison/recommendation calls, roster cache hits, and saved-result reuse.
10. Test misleading action statements against those observations, including claiming a new search on reused data, claiming both providers when only one supplied records, or claiming successful filtering/retrieval after rejection or failure.
11. Test grounded paraphrases, contradicted values/identities/seasons, unsupported contracts/current-registration assertions, PA guarantees, simple valid derived facts, misleading quotations, and unsupported additions beyond the required facts. Hidden but undelivered fixture facts cannot count as grounding.
12. Test exact judge schema/quotation/reference validation, uncertainty, parser/provider failures, bounded repairs, and zero-success handling. Incomplete or invalid judging must not yield semantic passes.
13. Test all four anchor groups, their development/validation separation, and 16-of-16 matching of both verdicts and expected category labels, including no false error on a correct paraphrase. Cover calibration failure, tuning provenance invalidation, and retention of existing code findings/raw outputs.
14. Test trial-verdict precedence: a confirmed critical violation remains a failure after a later error; otherwise necessary unresolved judgments prevent a pass. Correct abstention can pass, while blanket refusal on an answerable case fails.
15. Test per-metric denominators, adjudication coverage, overlapping error categories, N/A for zero adjudicated items, per-workflow aggregation, required-fact omissions, and three-trial stable passes.
16. Test that all three formal repetitions survive in artifacts and reports, and that failures are neither replaced by retries nor hidden when comparing versions with different coverage.
17. Test the shared physical HTTP cap across agent steps, judge scoring, calibration, retries, and repairs using the fake gateway's own request count. The N+1 request must not arrive; no process, retry path, or alternate role may bypass accounting.
18. Test cancellation/exhaustion at relevant boundaries, partial artifact persistence, explicit unfinished statuses, and request/token-role breakdowns without credentials in artifacts.
19. Test preview/smoke/development/held-out selection, formal versus single-run mode, freeze metadata requirements, report compatibility checks, and manual live triggering distinct from offline CI validation.
20. Existing graph workflow tests provide prior art for source-ID pinning, aliases, context inheritance, isolated MemorySaver, interrupts/resume, and failure preservation. Existing API-client tests provide fake-HTTP/cancellation/cache examples; existing local-source tests provide temporary SQLite fixtures and unavailable-versus-empty behavior.
21. Tests validate external contracts and meaningful failures, rather than private counters, catch helpers, exact node-array snapshots, or duplicated production implementations. Live evaluation supplies measured model-quality evidence separately from deterministic Vitest correctness.
22. No paid/live gateway or source-provider call is required to run routine tests. Real source capture, smoke runs, development baselines, and held-out evaluation execute explicitly with their own declared prerequisites and allowances.

## Out of Scope

- A RAG pipeline, embedding/vector database, frontend, or new scouting workflow.
- Evaluator-specific production graph nodes, bulk transcript/log fields in production State, persistent checkpointers, or a new application database.
- Replacing the current comparison/recommendation formulas, inferring tactical fit, or claiming external scouting relevance, recruitment success, transfer feasibility, or future CA prediction.
- Live API-Football traffic during formal trials or silent fallback from incomplete fixtures to another corpus/provider.
- Human grading requirements, representing model review as human review, or a multi-judge consensus system in v1.
- LLM-generated user behavior during a trial; user turns and permitted clarification information are scripted.
- Exact prose snapshots or an exact required node/tool sequence where multiple behaviors meet the contract.
- A hosted evaluation platform, automatic remote artifact uploads, unbounded model calls, or live-model evaluation on every CI run.
- Automatically tuning prompts or application code while collecting a supposedly frozen baseline.
- Aggregate quality thresholds chosen before the development baseline, automatic production release decisions, or guarantees of universal judge accuracy.
- Expanding independent test seams across individual nodes/helpers or rewriting the existing test suite.

## Further Notes

- The source of truth for the agreed choices is the [accepted evaluation plan](plan.md), confirmed by the user in Q19. The architectural boundary is recorded in [ADR-0009](../../docs/adr/0009-fixed-evidence-agent-evaluation.md).
- The to-spec test-seam check was explicitly confirmed by the user: the public evaluation entry runs the real graph and Command resume, using controlled HTTP and fixed evidence for Vitest, with report/action/request-count assertions.
- Physical model-request allowances and any one-time source-capture allowance are selected from preparation estimates. Overall quality thresholds are selected after the first development baseline. These are scheduled evidence-dependent decisions, not missing default numbers to invent.
- The current workspace contains pre-existing dependency and CI edits. Spec publication is documentation work; later implementation must inspect and preserve those changes instead of assuming a clean checkout.
- The spec describes the evaluation capability and its staged runs. Tickets should deliver observable end-to-end slices, retain the single primary test seam, and distinguish implementation correctness from the measured quality of the selected model.
