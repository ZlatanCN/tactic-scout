# Accepted agent evaluation plan

Status: resolved
Labels: ready-for-agent

Confirmed by the user in Q19 on 2026-10-27. Architecture decision: [ADR-0009](../../docs/adr/0009-fixed-evidence-agent-evaluation.md).

Implementation specification: [Agent evaluation v1](spec.md). The user separately confirmed its primary test seam: the public evaluation entry shared with the CLI drives the real graph and Command resume, with fake gateway HTTP and fixed small databases/provider responses for Vitest; reports, actual action records, and physical HTTP counts are the observations, including judge-anchor validation through the same entry.

## Accepted decisions

- Q1: Evaluate all four workflows: player lookup, player comparison, player recommendation, and team-directed recommendation. Cover the complete graph behavior and report unsupported factual claims separately.
- Q2: Invoke the model configured through the existing gateway while keeping evaluation evidence fixed and versioned across runs. FM profiles, Understat records, and API-Football squad evidence retain their provider identities and source dates.
- Q3: Use real snapshot subsets as the main evidence, supplemented by explicitly labeled synthetic boundary cases for stable ambiguity, missing-field, and conflicting-scope scenarios.
- Q4: Include single-turn cases, scripted multi-turn conversations, and native interrupt/Command resume interactions.
- Q5: Record expected workflow behavior, selected identities/source IDs, required facts, and prohibited claims as explicit case contracts. Do not require one exact reference wording.
- Q6: Report contradictions with allowed evidence separately from unsupported factual additions. Documented business definitions, such as the meaning of PA, are permitted evidence. Additionally evaluate scouting execution claims: actual attempts, valid completed tool results, and saved-result reuse are distinct; a model-requested call is not proof of execution. Claims of nonexistent or failed searches, wrong-source coverage, unapplied filtering, or a fresh query when only saved context was used are execution-claim failures.
- Q7: Use deterministic validators for execution, identities, numeric results, and constraints, plus one semantic model judge. Calibrate the judge with known-correct answers and deliberate evidence/action-claim mutations; unresolved judgments remain explicitly inconclusive.
- Q8: A confirmed critical identity, unsupported/contradicted factual claim, execution-claim, or hard-constraint violation fails the case. Preserve all individual metric results instead of allowing weighted averages to hide critical failures.
- Q9: Use an independent local TypeScript evaluation command with per-case JSON and readable Markdown comparison reports.
- Q10: Begin with 48 cases, 12 per workflow: 32 development cases and 16 held-out cases. Keep paraphrases and cases sharing the same evidence/scenario family in the same split. Use held-out cases only after freezing the version under evaluation.
- Q11: Route the semantic judge through the existing gateway with an independently configurable model name. Using the same model as the evaluated agent is allowed; record both model identities and require judge calibration rather than treating it as human ground truth.
- Q12: Formal reports run each case three times with isolated fresh threads; a development mode may run once. Keep every trial, including failures, rather than replacing a failure with a later successful rerun.
- Q13: Validate workflow invariants rather than exact node/tool sequence snapshots. Permit legitimate alternative paths, including saved-result reuse, while checking identity prerequisites, source IDs, hard conditions, required clarification, and execution bounds.
- Q14: Establish a development-set baseline before setting overall acceptance thresholds. Keep per-case verdicts and separate quality, reliability, inconclusive, and error statistics; freeze the version before held-out evaluation.
- Q15: Require an explicit whole-run physical model-request limit for real evaluation. Include the agent's retries, judge calls, and judge calibration; display estimated work before dispatch. On exhaustion, stop and preserve a partial report with unfinished work clearly marked. Choose numeric budgets after fixture and call-count estimates are available.
- Q16: Trigger real-model evaluations manually through an explicit command. Routine CI validates schemas, fixtures, scoring, and deterministic rules offline; recurring real-model runs or quality gates can follow a stable baseline.
- Q17: Compute the primary unsupported-fact, contradiction, and execution-claim error rates per complete case trial. Retain claim-level evidence and details for diagnosis. Inconclusive or unfinished work is never counted as hallucination-free.
- Q18: Create a separate judge anchor suite with 32 examples: eight correct paraphrases, eight factual contradictions, eight unsupported additions, and eight execution-claim errors. Split each category equally into development and validation, yielding 16 anchors in each split. Require all 16 validation anchors to match their expected verdict and category labels, with no false error on correct paraphrases, before formal semantic scores are considered valid; retain collected agent outputs and code checks when calibration fails. Anchor calls count against the whole-run limit.

## Verified current state

- The project has seven Vitest test files covering the four workflows, clarifications, aliases, exact source IDs, inherited constraints, thread isolation, and fault tolerance. Model behavior is primarily simulated; ChatOpenAI transport checks use fake HTTP rather than a live gateway.
- There is no independent evaluation command or dataset-based evaluation of real-model answer grounding. Historical FM formula experiments do not call an LLM and lack independent recommendation relevance labels.
- `createAgent` supports model, identity, team-data, tool, and checkpointer injection. A whole-agent evaluation must retain the real request extractor. Recommendation cases must run the actual ranking logic over frozen profiles rather than substitute a prerecorded ranking result.
- Recommendation evaluation can establish rule/constraint compliance, computation correctness, and explanation grounding. The current FM formula experiments do not provide independent scouting relevance labels, so this evaluation must not claim real-world recruitment or tactical-fit accuracy.
- Existing FM, Understat, and Reep path settings can target small frozen SQLite fixtures. Preserve default extraction, identity, source readers, tools, and ranking; inject the real model and a case-local API-Football client over recorded HTTP payloads. Per-case process isolation can contain environment variables, module initialization, and roster caches without adding production graph nodes. A multi-turn case remains within its own process/thread.
- A reusable real API-Football team/squad snapshot has not yet been confirmed locally. Fixture preparation may require a one-time bounded capture with an explicitly estimated source-request budget; formal evaluation begins only after those responses are frozen. Never fabricate real-source provenance or fall back to live API calls during a trial.
- Freeze the FM payloads, positions, aliases, manifest; Understat raw snapshots; Reep release stamp and bridges; roster/team IDs and retrieval dates; candidate pool; position-feature-map version and fixture hashes. Results describe the frozen candidate pool.
- LangChain callbacks propagate to direct tool invocations and ToolNode, but they are insufficient as the sole execution oracle: schema failures can precede tool-start events, and domain-unavailable results can produce tool-end events. Evaluation-local observation of real tool invocation and parsed outcomes must distinguish requested, attempted, returned, business-successful, failed, blocked, and saved-result-reuse states without replacing actual tool algorithms.

## Framework research

- LangSmith JS evaluation supports asynchronous targets, datasets, evaluators, and concurrency, but its documented SDK mode for avoiding result uploads is Python-only. The accepted v1 choice is a local TypeScript runner over the existing agent seam.
- Official references: [agent evaluation](https://docs.langchain.com/langsmith/evaluate-llm-application), [local evaluation mode](https://docs.langchain.com/langsmith/local), [multi-turn simulation](https://docs.langchain.com/langsmith/multi-turn-simulation).

## Existing preferences

- Continue the user's earlier preference for automated review rather than requiring per-case human grading. Automated judgments must be described as automated review, not human review.
- The design discussion is complete and confirmed. This accepted plan is input to the next implementation-spec step.

## Accepted delivery plan

### Coverage

Each workflow has 12 cases: four ordinary single-turn requests, four boundary/adversarial requests, and four multi-turn conversations. Within each workflow, development uses three ordinary, three boundary, and two multi-turn cases; held-out evaluation uses one ordinary, one boundary, and two multi-turn cases. Evidence/scenario families remain grouped when assigning the splits.

| Workflow | Development / held-out | Representative checks |
| --- | --- | --- |
| Player lookup | 8 / 4 | Exact source identity; Chinese names and aliases; ambiguous names; missing fields; saved-result follow-ups; fresh-query claims versus actual reuse |
| Player comparison | 8 / 4 | Two or more players; duplicate identity; cross-season/competition limits; participant additions; condition inheritance; unavailable source outcomes |
| Player recommendation | 8 / 4 | Position eligibility; age/CA/PA conditions; ambiguous youth request; reference/exclusion identity; actual RMSE and PA ordering; PA interpretation |
| Team recommendation | 8 / 4 | Team selection; roster/FM mapping; confirmations; team-member exclusion; missing position reference; source-date mismatch; refinements |

Target 32 cases based on unchanged real snapshot evidence and 16 cases based on deliberately constructed boundary evidence. Mark any altered real evidence as synthetic/mixed rather than silently presenting it as an original source record. Sampling does not represent production traffic prevalence.

### Evaluation boundary and evidence

- Run the real compiled graph, real request extractor, real identity/source readers, and actual comparison/recommendation algorithms. Use small local SQLite snapshots and recorded API-Football HTTP responses; never silently fall back to a live roster API or full local corpus when a fixture is missing.
- Separate invalid fixture preparation from intentional fault cases: undeclared absence/corruption or a hash mismatch stops before gateway dispatch; a declared synthetic missing/corrupt-data case validates its recorded defect and then exercises the actual graph/readers and unavailable behavior.
- Keep each trial in a fresh process with a fresh MemorySaver/thread and API client. All turns in that trial share their own thread. Keep production graph nodes and State free of evaluator-specific behavior or bulk trace logs.
- Script user turns and clarification information in advance. Select the declared identity from actual interrupt candidates; if the expected candidate is absent, or an unexpected clarification occurs, record the behavior mismatch instead of inventing a helpful new answer that repairs the evaluated agent.
- The agent receives only its ordinary user messages and permitted source evidence. Expected contracts and hidden validation labels are available only to evaluators.
- Derive source facts and identities from fixed source fields and bridges before evaluating the candidate version. Verify expected arithmetic/order using independent arithmetic or a preverified frozen answer, never by calling the production ranking function to generate its own gold. Generated questions may assist case authoring, but cannot certify their own labels.
- Keep real-source extracts, prepared databases, transcripts, and run reports under ignored `.data/evals/`. Version case definitions, synthetic evidence, extraction recipes, manifests/hashes, and scoring rules in the repository. Honor the existing source-processing settings and local/private use scope.

### Scoring and verdicts

- Code checks expected task/outcomes, identity/source IDs, applicable constraints, actual tool invocation and parsed business results, clarification behavior, and relevant source arithmetic/ranking contracts.
- A versioned judge prompt checks quoted factual and execution claims against the allowed evidence, business definitions, and observed actions. Give it no agent model/version label. Require answer quotes and evidence/action references for its findings and validate those references in code.
- A normal answerable task must complete its required behavior and required answer facts; universal refusal cannot obtain a passing task score merely by avoiding invented facts. Correct abstention is expected only for the cases whose evidence/contracts require it.
- Any confirmed critical violation fails the complete trial, even if a later infrastructure error occurs; preserve that later error as additional metadata rather than allowing it to hide the known violation. If there is no confirmed failure but necessary evidence or a judge decision is inconclusive, mark the trial inconclusive. Infrastructure errors, invalid fixture coverage, calibration failure, and exhausted budgets have explicit statuses; none are silently converted into passes or clean factuality scores.
- Primary error rates state the evaluated case-trial denominator separately for each metric, with explicit counts for planned, attempted, completed, adjudicated, inconclusive, errored, and unfinished trials. If a metric has no adjudicated trial, report `N/A`, not zero errors. Show per-workflow results and the number of cases passing all three trials; preserve every trial instead of selecting the best one. Do not treat three repetitions as three independently sampled questions. Version comparisons show adjudication coverage alongside rates and do not silently drop failed or unscored work.
- Report task completion, contradiction cases, unsupported-fact cases, execution-claim failures, required-fact omissions, stable three-trial passes, judge uncertainty, infrastructure errors, latency, and model-request/token usage. Overlapping error categories may apply to one trial.

### Judge validation and execution policy

- Judge anchors are explicitly labeled, data/rule-derived examples rather than claimed human annotations. Include plausible correct paraphrases and subtle critical errors, not only obvious mutations. Keep anchor development and validation families separate from one another and from the 48 agent cases.
- A formal evaluation validates the selected judge/rubric on all 16 reserved anchors. All must pass; otherwise semantic scoring remains invalid. Report the observed anchor results without claiming general 100% judge accuracy. If validation findings are used to tune the judge, retire those anchors from the untouched-validation role and version replacements.
- Use bounded provider recovery and structured-output handling for individual model requests; record all physical requests. Do not automatically rerun an entire failed agent trial or repeatedly ask judges until a passing verdict appears. Judge uncertainty remains inconclusive.
- Estimate work before dispatch and require a user-specified global physical-request allowance. Include agent extraction/explanation retries, judge calls/repairs, and anchor validation. Start with serial trials; stop dispatch on exhaustion and persist an incomplete report.
- Record dataset/fixture hashes, source and feature-map versions, code/prompt/judge versions, actual available model identifiers and settings, and trial timing. Report unavailable provider version/usage metadata explicitly.
- First validate the harness and fixed-data rules offline, then run a small smoke subset, then collect the 32-case development baseline. Choose aggregate thresholds only after examining that baseline. Freeze the evaluated version and scoring rules before the 16-case held-out run. Record case provenance, prior prompt/code-tuning use, and the version from which each case was held out. Historical failure cases are held out for this evaluation cycle rather than claimed to have been completely unseen by the system. Once held-out findings are used for tuning, disclose that reuse and version the evaluation accordingly.

### Concrete examples

These are illustrative contracts, not assertions about any real player's present abilities.

| Input / evidence | Required behavior | Critical failure example |
| --- | --- | --- |
| A synthetic FM profile has CA 130 and PA 190; the user asks whether reaching 190 is guaranteed. | Explain the distinction using the fixed PA definition. | Claim the player will certainly reach CA 190. |
| A later turn asks about a saved lookup; no new search occurred. | Use the saved evidence and accurately describe that reuse. | Say “I just searched both providers again.” |
| A comparison addition follows a previously confirmed season. | Add the identity while preserving that season unless explicitly changed. | Drop the season or compare incompatible source scopes as equivalent. |
| A team roster includes one candidate's exact FM ID. | Exclude that ID while running actual ranking over the frozen pool. | Recommend the existing roster member or claim a filter was applied when it was not. |

### Delivery sequence

1. Prepare and verify fixed evidence, provenance/hashes, 48 case contracts, and 32 judge anchors. Derive golden expectations independently of the candidate's output.
2. Build a local evaluation driver, execution observer, deterministic validators, calibrated semantic judge, and JSON/Markdown reports over the existing `createAgent` seam. Validate fixture integrity and scoring behavior offline.
3. Produce a request-count estimate and run a small explicitly budgeted smoke subset. Require explicit agent/judge model configuration and a physical-request limit for each live command.
4. Collect and archive the 32-case development baseline with three trials per case. Report all quality, coverage, stability, and runtime results; this stage establishes the initial baseline rather than an invented aggregate acceptance label.
5. Agree aggregate thresholds from that baseline, freeze the evaluated version and judge/scoring rules, and then run the 16 held-out cases with three trials per case. Retain the same case/evidence versions for subsequent paired comparisons unless a dataset change is explicitly versioned.

## Design review

- Evaluation-validity and code-feasibility reviews found no additional user decisions needed. They confirmed that the independent golden arithmetic, metric adjudication coverage, prior tuning provenance, and pre-dispatch physical-request accounting must be explicit in the implementation spec.
- Actual source-capture request counts and numeric model budgets remain scheduled preparation outputs, not guessed constants or silent unlimited allowances.

## Planning outcome

- Q19: The user confirmed that the complete proposal captures the shared plan. The discussion is resolved and ready for `to-spec`.
- Numeric model/source request limits are intentionally chosen after preparation estimates; aggregate quality thresholds are intentionally chosen after the development baseline. These are scheduled later-stage decisions rather than defaults to invent before evidence exists.
