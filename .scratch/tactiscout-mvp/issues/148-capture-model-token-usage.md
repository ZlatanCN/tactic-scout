# Capture reported model token usage in Harness runs

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Make LangGraph Planner context/output usage observable in local full-graph evaluations so matched ablations can report measured token counts alongside action counts and elapsed time.

## First-principles boundary

- Count only usage the configured model endpoint actually reports. Do not estimate from characters, tokenizer guesses, or provider-specific timing fields.
- Distinguish reported zero from missing usage; incomplete coverage must stay explicit and prevent an arm total from being presented as complete.
- Record aggregate token counts and call phase only. Never retain prompts, generated content, reasoning, credentials, or candidate identity in the usage event.
- Token counts are not a monetary cost estimate and do not make stochastic arms cost-matched.
- This Harness starts at `conversation.turn()` with a registered user message; it does not call the separate `/requirements/parse` brief-parser endpoint. Report the measurement as LangGraph Planner usage, not as the full browser flow's model consumption.
- Existing runs without instrumentation remain `not recorded`; do not backfill or infer usage.

## Scope

- Normalize token usage exposed by the existing OpenAI-compatible LangChain model adapter, including Ollama when it returns usage metadata.
- Carry one privacy-safe usage event per actual Planner model request through the recruitment trace and local Harness output; mark unreported or failed requests explicitly.
- Summarize input, output, and total counts per run and per ablation arm, including measurement coverage.
- Update evaluation docs and record a new matched investigation-planning ablation run using the instrumented adapter. Keep the existing `/showcase` layout untouched while issue 144 awaits manual 390px review.

## Proposed verification interfaces

- Pure normalization seam: `normalizeModelTokenUsage(response)`.
- Full behavior seam: `createRecruitmentConversation` trace through local Harness run output.
- Live verification: real Ollama paired investigation-planning runs for the registered Barcelona and Bayern cases, with all usage metadata and completion checks accounted for.

## Design constraints

- Reuse the raw `AIMessage` already returned by `withStructuredOutput(..., { includeRaw: true })`; normalize `response_metadata.usage` first so explicit zero counts survive, then fall back to `usage_metadata`. Do not enable the internal full `__raw_response` field, add model tracing infrastructure, or introduce a second provider adapter for one metric.
- Normalize the provider fields `prompt_tokens`, `completion_tokens`, and `total_tokens`; the LangChain fallback fields are `input_tokens`, `output_tokens`, and `total_tokens`. Resolve each metric independently, treating a valid reported zero as present. Accept only non-negative safe integers; never derive `total_tokens` by adding input and output counts.
- Aggregate coverage independently for input, output, and total tokens. A field sum is complete only when every invocation attempt in that run/arm reported a valid value for that field; otherwise expose the field as incomplete/unknown, not as a complete total. Keep attempts with no response and responses with no usable counts in the coverage denominator.
- Keep the adapter responsible for normalizing usage and the graph responsible for trace collection: pass a narrow optional per-call usage observer through `RecruitmentPlanner.decide`, then adapt its normalized event to the existing recruitment trace observer. This avoids importing graph trace types into the model adapter or adding mutable/global tracing. The single-pass planner forwards the observer only when it delegates conclusion work to the model; fixed actions emit no model-usage event. Keep the `decide()` action result unchanged.
- The current adapter sets `maxRetries: 0` and each structured Planner decision makes one model invocation. If either assumption changes, request counts must be revisited rather than inferred from decision counts.

Confirmed test seams: `normalizeModelTokenUsage(response)` and the full LangGraph/Harness output chain. Keep tests at these public interfaces.

## Acceptance criteria

- [x] Normalizer accepts supported provider metadata shapes, rejects invalid/negative/non-safe-integer counts, and does not infer missing fields as zero.
- [x] Each production Planner invocation attempt yields exactly one privacy-safe event; request failures are marked failed with unknown usage, while a response that later fails structured parsing retains its response usage event when available.
- [x] For each Harness run, usage event count equals actual structured-model invocation attempts; failed and unreported usage remains in the coverage denominator. Graph decisions stay separate: fixed single-pass actions bypass the model.
- [x] Harness run and arm summaries separately report input/output/total tokens, request count, and complete/partial/unavailable coverage; incomplete arms do not present full sums.
- [x] Usage trace records contain only phase, outcome, and normalized counts; no prompt, completion, reasoning, API key, player name, or ID is included.
- [x] Real local Ollama runs report usage for every observed request; no token estimates are used.
- [x] Fresh results and caveats are recorded in `docs/evaluation.md`; historical runs remain explicitly unmeasured.
- [x] API/Web production builds and the confirmed TDD-interface tests pass.

## Comments

- 2026-10-11: Started from issue 143's explicit limitation that the model adapter did not expose dependable aggregate token usage. First-party adapter behavior is under investigation before implementation.
- 2026-10-11: Research of the installed `@langchain/openai` 1.6.0 converter found that `AIMessage.response_metadata.usage` preserves the provider's standard usage object, including zero values; only the parallel `usage_metadata` mapping uses truthy checks and can omit zeros. The existing Planner's `includeRaw: true` exposes the former without enabling internal `__raw_response`. A real Ollama graph run is still needed to verify end-to-end availability. See [local model token usage research](../research/local-model-token-usage-2026-10.md). No tests or code have been written while the proposed TDD seams await confirmation.
- 2026-10-11: A real, project-data-free structured-output request to local `qwen3.5:9b` succeeded through `ChatOpenAI` 1.6.0. The parsed result was valid and both `raw.response_metadata.usage` and `raw.usage_metadata` reported 27 input, 182 output, and 209 total tokens; full `__raw_response` capture remained off. This confirms the adapter path only; the LangGraph/Harness run and its aggregate semantics remain unverified. A first probe capped at 64 output tokens hit the artificial length limit; the 1,024-token retry completed. Full details are in [local model token usage research](../research/local-model-token-usage-2026-10.md).
- 2026-10-11: Scope audit confirmed the registered Harness calls `conversation.turn()` directly. It did not exercise the then-existing `/requirements/parse` route, so the results are historical Planner usage, not total model consumption of a browser flow. Issue 156 later retired that unused route; current product messages enter the LangGraph case directly.
- 2026-10-11: Corrected the counter-boundary audit after tracing `runScenarioOnce`: `plannerRequestAttempts` increments only inside the wrapper around the model Planner. The single-pass methodology/search actions return before calling that wrapper, so fixed actions are not included; the final conclusion still delegates to the wrapped model Planner. This counter is nevertheless recorded before `OpenAIRecruitmentPlanner.decide()` reaches `actionModel.invoke()`, so it is not an authoritative provider-invocation ledger when setup fails before invocation. Instrument usage at the existing `invoke()` boundary, and preserve graph decision counts as a separate measure.
- 2026-10-11: User confirmed the normalizer and full LangGraph/Harness chain as the test seams. Implementation and verification are now authorized at those interfaces.
- 2026-10-11: Implemented the per-field normalizer and invocation-boundary observer using the existing structured-output raw AIMessage; usage travels through LangGraph's privacy-safe trace and is aggregated per Harness run/arm with per-field completeness. No raw prompt or response is retained.
- 2026-10-11: Instrumented Qwen 3.5 9B/Wyscout 2017/18 curated reruns completed for Barcelona and Bayern, three paired repetitions per case. All 12 reports passed Harness (Barcelona 31/31 per run; Bayern 29/29); all 36 actual Planner requests returned input/output/total usage, with 0 failed invocations and complete coverage. Barcelona totals: adaptive 26,118/1,515/27,633 across 9 calls; single-pass 2,139/1,206/3,345 across 3. Bayern totals: adaptive 34,812/1,977/36,789 across 15 calls; single-pass 18,450/1,578/20,028 across 9. Values are input/output/total tokens, not money or a token-matched comparison. A first Bayern diagnostic exposed a separate 30 source-record vs 29 candidate-group coverage denominator mismatch; it was corrected and all fresh paired runs pass. See [evaluation results](../../../docs/evaluation.md#动态调查规划消融) and [adapter research](../research/local-model-token-usage-2026-10.md).
- 2026-10-11: Verification after the coverage correction: 134 targeted tests passed, `pnpm build` and `pnpm build:web` passed, and the six-run Bayern plus six-run Barcelona live Harness artifacts report complete usage coverage. Raw run artifacts stay under ignored `.data/evaluations/`.
