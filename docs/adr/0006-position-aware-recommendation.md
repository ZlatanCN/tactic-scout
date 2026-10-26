# ADR-0006: Position-aware FM recommendations with a separate potential path

Status: accepted

## Context

The local FM snapshot has player abilities, CA, PA, position ratings, and a complete set of raw attributes. It does not provide current transfer availability, a future attribute projection, or independent labels that say which profile is a good real-world replacement. A single score that mixes current attributes and PA would hide that evidence gap and change the meaning of “similar”. A shared attribute list across goalkeepers, defenders, midfielders, and forwards would also make the ranking difficult to interpret.

The accepted behavior and work plan are detailed in [the player-recommendation plan](../../.scratch/player-recommendation/plan.md) and [data audit](../../.scratch/player-recommendation/data-audit.md).

## Decision

1. Recommend by local FM profile only. Describe the result as position-level ability similarity, not transfer availability, real match performance, or tactical-role fit.
2. Use the user's explicit target position. If omitted, infer it only when the intersection of the reference set's `natural_positions` contains exactly one position; otherwise ask. Every reference and candidate must have a numeric target-position rating of at least 15. `SW` is unsupported while the snapshot has no eligible profiles.
3. Support one or more identity-resolved reference players. Deduplicate repeated identities, average each selected position-specific raw attribute equally, and rank candidates against that synthetic mean profile. Exclude every reference identity from results.
4. Give every populated exact position its own versioned, documented feature set and ablation groups. Freeze these sets before formula experiments; do not infer them from undocumented `role_scores`.
5. Select one global current-attribute distance formula by equal-position macro evaluation. The completed all-position experiment selected RMSE as `fm-position-global-rmse-v1-provisional`; the previous `rmse18` remains an STC-only historical result. Without independent relevance labels, describe RMSE as an engineering default, not proven recommendation quality.
6. Keep a current-attribute similarity list as the normal result. When the request asks for youth or potential, add a separate list sorted by PA descending, with current attributes and CA shown as context. Do not mix PA into the current-distance score or predict future CA. A vague “young” request asks for an age ceiling; no implicit age or PA thresholds are applied.
7. Apply explicit age, CA, and PA conditions only. Report the FM snapshot date and return the per-position rating separately from the ability-distance score.
8. Resolve every player mention before data execution. Lookup keeps the bounded ReAct tool loop and pins reads to its selected source IDs. Comparison and recommendation use separate deterministic graph nodes that directly invoke their data tools. One clarification node resumes the pending request; a shared answer node explains completed results. Only successful complete outcomes update active comparison or recommendation context.

## Rationale

- A selected position narrows the candidate pool and makes each feature list interpretable.
- An equal-weight mean gives multiple references a simple, explicit meaning without making one arbitrarily more important.
- One global formula keeps runtime behavior and explanation consistent; equal position weights prevent large roles from dominating evaluation.
- PA describes a different question from present attribute similarity. A separate list makes the trade-off visible and avoids presenting an invented future profile.
- Numeric position and age/ability filters are inspectable and reproducible; hidden defaults would silently alter the request.

## Consequences

- The position feature map and multi-position offline experiment are frozen; a later source snapshot or feature-map edit requires a new experiment and version. The old STC result remains historical evidence only.
- The current and potential lists have different ranking semantics and must be labeled separately.
- A reference set with no unique shared natural position requires an interrupt. A reference with target-position rating below 15 cannot be used for that target.
- A failed, unsupported, or interrupted request does not replace the last successful recommendation context. An empty but completed result can be refined in the same thread.
- Recommendation refinements inherit omitted fields; an explicit null clears an optional condition. Unsupported hard conditions stop execution rather than disappear from the effective request.
- The thread checkpointer is the only persistence mechanism in this branch. No LangGraph Store or history-message reconstruction is used.
- The system cannot claim the candidates are purchasable, active, tactically suitable for a specific role, or likely to reach their PA.
- No Understat retrieval, RAG, frontend, or application database is part of this decision.
