# Map ASA chance-creation requests to observed evidence

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Keep final recommendation review aligned with goal-scoring and chance-creation requests when ASA or FPL exposes relevant, source-defined measures.

## Context

The 2026 ASA multi-league LangGraph run completed its investigation and report, but the Reviewer returned no recommendations because the request asked for chance creation while the deterministic evidence map did not recognize ASA xA. That was an evaluator vocabulary gap, not evidence that the candidates had no attacking data.

## Acceptance criteria

- [x] Explicit goal-scoring requests map to observed goals only; xG must not be represented as scored goals or finishing skill.
- [x] Chance-creation requests recognize assists, shot assists, key passes, ASA xA and FPL xA while preserving the source metric definitions.
- [x] Existing evidence review still requires recommendations to cite relevant observed metrics and does not accept unrelated statistics as substitutes.
- [x] Deterministic tests cover the Chinese request, English goal-scoring phrasing, xG non-confusion, and requested-capability coverage keys.

## Comments

- 2026-10-06: The post-change ASA live-model rerun hit a bounded upstream timeout before candidate discovery, so it did not verify that Qwen will now recommend a player. The earlier successful ASA workflow generated a report but no recommendation. This issue verifies deterministic evidence mapping only; do not claim recommendation ranking quality or a successful post-change local-model recommendation.

## Answer

The requested-capability map now treats `goals` as goal output and never conflates xG with goals. Chance creation accepts measured assists, shot assists, key passes, and expected assists from ASA/FPL. Metric definitions continue to disclose that xA is an expected-assist estimate rather than a complete creativity assessment. The 22 focused ASA/conclusion tests pass.
