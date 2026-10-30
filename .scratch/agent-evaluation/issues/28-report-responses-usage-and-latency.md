# 28 · Report Responses token usage and request latency

**What to build:** Evaluation reports accurately show available Responses API token usage and request latency by role, including calibration calls, while marking metadata unavailable only when it was not returned or retained.

**Blocked by:** None.

**Status:** open
**Label:** ready-for-agent

## Evidence

Development run `38e8d637-8ebc-47ad-878f-f9500cf7bef1` recorded 398 physical requests. Its Agent and judge response bodies contain `usage.input_tokens` and `usage.output_tokens`, but the normalized `tokenUsageByRole` reports zero responses with usage because the gateway proxy only parses `prompt_tokens` and `completion_tokens`. The same report stores `durationMs` for Agent and judge gateway exchanges, but the Markdown summary does not aggregate them. Calibration requests are counted, but their response bodies and per-call durations are not retained, so their usage cannot be recovered from this run.

## Acceptance

- Parse and aggregate both Responses API usage fields and any supported Chat Completions usage fields without guessing absent values.
- Retain calibration request usage and latency in run-local report data without storing prompts or answers in application State.
- Report physical request counts, token usage when returned, and latency by role; distinguish unavailable metadata from zero usage.
- Add fake-gateway tests for Responses usage parsing, Chat Completions usage parsing, missing usage, and calibration-role accounting.
- Keep raw request/response payloads local and preserve the existing whole-run request cap.
