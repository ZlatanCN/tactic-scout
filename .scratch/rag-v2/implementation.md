# RAG v2 implementation and operator guide

Status: RAG v2 code and the frozen v5 evaluation completed under the user-authorized 1,300-call ceiling. The final acceptance record is `not_accepted`; this is a completed negative evaluation, not a production qualification. The post-evaluation hardening below has not yet been requalified by a new full gateway run.

## What the system does

RAG v2 extends the existing recruitment Agent rather than adding a standalone knowledge chatbot. The LangGraph planner can request a bounded evidence investigation; the retrieval layer searches authorized source revisions, and the report layer retains source intervals and validates citations before delivery. A SQLite investigation ledger records query reservations, completed work and stable evidence references so a completed query can be reused after a resume.

The workflow has two retrieval rounds at most. Round one supports up to three subqueries. One gap check can schedule a follow-up round of up to two subqueries. Both rounds share a 30-second deadline and a four-dispatch gateway cap; citations are revalidated before report projection. No-evidence and partial-evidence cases remain explicit instead of being converted to unsupported claims.

Clear source questions now use a separate structured `knowledgeAnswer` delivery path inside the same LangGraph. It returns claim-level citations and an explicit `answered`, `partial`, or `abstained` state with `report: null`; recruitment-only copy and dataset scope are suppressed. Ambiguous wording stays on the recruitment path, and evaluation requests can still opt into knowledge Q&A deterministically. JSON and SSE expose the same structured result.

Evaluation application requests use a shared pre-dispatch gateway budget across understanding, identity, Planner and any model-backed tool work. A denied Planner retry returns a safe finish action with the current evidence and missing facts. Per-question and whole-pipeline counters are checked separately; an exhausted or incomplete request cannot be treated as a completed validation result.

## Ingestion and source permissions

The evidence catalog accepts structured PLOS/JATS, Markdown and plain-text sources. It stores source policy, article attribution, section and paragraph locators, normalized revisions and acquisition hashes. Markdown headings/lists/paragraphs and plain-text paragraphs are retained as structure. A batch is staged, indexed and activated as one generation; a failed batch leaves the previous active generation intact. Duplicate normalized content and metadata are idempotent.

Before evaluation text reaches the configured model gateway, the source must allow AI processing and that destination. Benchmark generation also requires display permission because questions are derived from displayed passages. Reader authorization is applied before candidate generation; source revocation and citation revalidation are checked again before report delivery. Project-authored methodology summaries remain retrievable as supporting material but are excluded as independent paper sources for the frozen methodology benchmark.

The local pilot now includes six independently attributed PLOS full-text article identities across the methodology and player-report corpora. The La Liga PlayeRank curation is limited to the authors' passage and the paper's documented 2017/18 sample context. Cited Wyscout, Transfermarkt/Kaggle, FBref and ClubElo datasets are not imported as project evidence.

## Frozen question pack v5

The v5 pack contains 102 questions, 48 fact groups, six independent full-article identities, 57 development questions and 45 frozen validation questions. It covers both corpora and includes cross-source questions. It was built by verifying and rebasing 94 seed questions against current full-source revisions, then generating and independently checking questions for the uncovered full-text source sections. Every supporting and scope interval is checked against the immutable source text and hash. The question pack is non-indexable.

All benchmark labels and semantic judgments are automatic estimates. The same configured gateway model serves isolated generation, verification, answer-evaluation and scope-evaluation roles. Agreement is required for a pass; disagreement and uncertainty remain unresolved. Deterministic checks reject invalid evidence IDs, out-of-scope citations, unsupported answer numbers or dates, and answered responses without citations before semantic agreement can pass. This is not human review or domain ground truth.

## Retrieval and bounded investigation

Dense and sparse retrieval run together and merge candidates with reciprocal-rank fusion. Evaluation-only ablations compare full-text-only, dense-vector-only and hybrid retrieval; online requests cannot select the pure modes. A separate ranker comparison uses the configured-gateway reranker and one local BGE cross-encoder on hybrid candidates. The evaluation reports interval coverage, fact-level Recall/Hit@k, MRR, retrieval and rerank latency, memory and actual gateway attempts. The local cross-encoder's score is a ranking logit, not calibrated confidence; inputs that exceed the pair budget are rejected without silent truncation.

Each investigation can issue up to three first-round subqueries, one gap check and up to two follow-up subqueries. A persistent SQLite ledger stores stable investigation/query identities, reservations, completion state and exact evidence references. Completed work is reused; a call with unknown completion status is not automatically retried. Planner and gateway reranking dispatches share the four-attempt cap and 30-second deadline. If the investigation ends early, the answer keeps available evidence and reports remaining gaps.

Report claims can depend on multiple source intervals. Each citation binds an immutable revision, locator, interval and text hash. If a required citation becomes invalid, revoked or unauthorized, the dependent claim is suppressed. JSON and SSE application paths are checked for consistent report, citation and status projection.

## Evaluation workflow and current status

The v5 question pack and 24 positive/negative control cases are source- and hash-pinned. The full text imports and runtime build are complete. The 12-question ranker comparison is recorded at `data/knowledge/evaluation/runs/rag-v2-ranking-comparison-dev.v5.json`; the zero-gateway 57-question retrieval ablation is recorded at `data/knowledge/evaluation/runs/rag-v2-retrieval-strategy-comparison-dev.v5.json`.

The first full Agent candidate attempt stopped on the 19th application request because application setup plus Planner calls exceeded the original per-question estimate. It did not persist a partial run artifact. Three constrained reruns then returned HTTP 502 on their first application request. A shared pre-dispatch budget and safe budget-exhaustion finish path were added, but no completed run verifies that final fallback.

The pure retrieval ablation is reproducible without gateway calls:

```sh
pnpm eval:rag-v2 -- --mode compare --packet data/knowledge/evaluation/rag-v2-question-pack.v5.json --split development --ranking-modes full_text,dense_vector,hybrid --max-calls 0 --out data/knowledge/evaluation/runs/rag-v2-retrieval-strategy-comparison-dev.v5.json
```

The prior stop plan `data/knowledge/evaluation/rag-v2-pipeline-preflight.v5-budget-exhausted.json` preserves the former 1,001/1,000 budget stop. The user authorized a 1,300-call full-pipeline cap. Subsequent preflights charge failed gateway probes and completed runs. The first candidate run's report looked poor, but inspection found that question-only case IDs reused investigation ledgers from prior runs; SQLite snapshots for different questions showed exhausted states and roughly 45 million milliseconds elapsed. `ragV2EvaluationCaseId` now includes the evaluation run ID. The old candidate artifact is not a valid quality estimate. A corrected run then received a gateway EOF after 11 questions; conservatively charging the maximum 55 calls for those 11 started questions, plus previous work, yielded a 1,284-attempt full-pipeline plan. The final plan is `data/knowledge/evaluation/rag-v2-pipeline-preflight.v5-authorized-1300.json`; unreliable judge controls can be reused as-is, and their unresolved state still blocks qualification.

The final candidate, fixed baseline and one-question Oracle runs completed with 246, 135 and 3 calls. The ranker comparison used 7 calls. The budget manifest accounts for 1,257/1,300 attempts, including conservative prior charges. The final record is `data/knowledge/evaluation/runs/rag-v2-acceptance-v5-authorized-1300-reconciled.json`. Candidate estimates were 0.250 support rate, 0.429 required-fact macro coverage, 0.231 refusal handling, 11 unresolved questions and 25 deterministic violations. The fixed baseline scored 0.786, 0.946 and 0.462 respectively, with 14 unresolved questions and no deterministic violations. Controls had 12/12 positive passes and no false passes, but 5 unresolved cases, so the automatic judge was unreliable. The candidate regressed against baseline, the baseline missed its support/refusal targets, and the acceptance result is `not_accepted`.

All question labels and any future semantic scores remain AI automatic estimates. The separate 57-question retrieval ablation had: full-text coverage 0.935 and MRR 0.886 (7 ms median, 14 ms p95); dense-vector coverage 0.806 and MRR 0.783 (22 ms median, 55 ms p95); hybrid coverage 0.968 and MRR 0.857 (24 ms median, 52 ms p95). Hybrid had the highest evidence coverage; full-text ranked hits earlier on average and was faster. This supports hybrid as the retrieval baseline for further evaluation, not as a production qualification.

On the different 12-question reranker sample, hybrid measured 1.00 coverage/MRR at 27 ms median; local cross-encoder measured 1.00 coverage, about 0.905 MRR and 3.1 s median; gateway reranking measured about 0.714 coverage and 4.8 s median on applicable cases. The two artifacts use different question sets; do not compare their absolute metrics across samples. They are development diagnostics only.

To run the workflow for a new approved budget, first keep the frozen v5 packet and controls unchanged, create a new preflight that includes all previously charged calls, and require `withinCap: true` before dispatch. Compare artifacts from a completed earlier plan only by explicitly supplying that signed plan through `--comparison-preflight`. The acceptance command requires full validation coverage, matching source/control/plan pins, reliable controls, zero deterministic violations, and the fixed quality thresholds. A failed or incomplete run must not produce an acceptance record.

The configured gateway model is read from `OPENAI_MODEL`; the local `.env` is currently set to `codex/gpt-6-luna`. Model routing is no longer inferred from a `codex/` prefix; structured output uses `OPENAI_STRUCTURED_OUTPUT_METHOD`, the configured endpoint, or the shared auto policy.

## Post-evaluation hardening

The shared model gateway transport now lives under `src/platform/`; recruitment and knowledge code depend on that boundary, with recruitment compatibility exports retained. Planner dispatch and final report generation have separate trace timings. Final citation resolution uses a distinct bounded operation phase, so a source revoked after retrieval removes dependent evidence and claims instead of leaving stale citations in state.

Knowledge Q&A has its own Planner action boundary: only `search_methodology` and `finish` are available, with an investigate-only decision mode. Its review and completion progress copy is knowledge-specific. Real `createApp` tests use the normal JSON and SSE case endpoints to cover a first retrieval plus one follow-up, a partial cross-source answer, a no-evidence abstention, and a final citation revoked after retrieval. A cancellation/resume case confirms the persistent investigation ledger blocks redispatch of a query whose completion is unknown and the Agent safely abstains. Request routing keeps explicit team/roster sample inspection and English candidate-performance questions on the recruitment path.

These changes have deterministic code coverage. They have not been qualified in a new full RAG quality run; the historical v5 acceptance remains `not_accepted` and is not an acceptance result for the post-evaluation hardening.

## Development comparison snapshot

The 12-question development ranking comparison completed. Hybrid produced 1.00 interval/fact coverage at six and MRR 1.00, with 27 ms median retrieval latency. Local cross-encoder retained 1.00 coverage, with MRR about 0.905 and 3.1 s median retrieval latency. Gateway reranking measured about 0.714 coverage and 4.8 s median latency in the applicable sample. This is a small development diagnostic, not proof of validation-set superiority; the local reranker is not presumed to be the production default.

The completed v5 retrieval comparisons are development diagnostics. The frozen validation Agent quality gate remains unevaluated; no pass/fail quality claim is available.
