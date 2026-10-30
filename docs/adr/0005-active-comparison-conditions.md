# ADR-0005: Persist participants and conditions as one active comparison

Status: accepted

## Context

A follow-up such as "also add Haaland" changes the participant list of a previous comparison. Keeping only player references loses an explicitly requested season and silently selects the latest local snapshot.

## Decision

Store `conversationContext.activeComparison` as one object with `players`, `constraints`, and the validated `resultJson`. The comparison node commits the result and its participants and conditions together after a successful comparison tool response, including a completed response with no comparable data. Identity clarification and failed tool calls preserve the previous completed comparison.

For an `add` request, inherit participants and merge previous conditions with conditions explicitly stated in the new message. For a condition-only `refine`, inherit participants and merge only the explicitly stated conditions. Treat `season` and `赛季` condition names as the same key so the current season overrides the previous one. For a `replace` request, use only the current message's participants and conditions. An omitted season in a replacement comparison therefore selects the latest snapshot.

The extractor describes only current-turn conditions. Request understanding owns inheritance; the model does not reconstruct old conditions. Historical comparison recovery reads the successful tool call's `seasonStartYear` argument together with its participant identities. Source-record seasons are observations and do not establish a requested season.

An explicitly requested Understat league is stored as the `competition` scope and passed to the comparison tool. The tool filters Understat rows to that league before finding shared scopes. Metric names such as FM ability and xG describe what to compare; they are not hard filters. Comparison additions inherit an existing competition scope unless the user explicitly changes it.

## Consequences

- Player focus, aliases, and active comparison remain separate thread-level concepts.
- Season and competition scopes are stored with the active comparison and inherited by `add` and `refine` requests; the comparator keeps FM ability profiles separate from filtered Understat performance.
- The existing graph nodes own the same execution stages; no additional orchestration node is needed.
- Whole-graph regressions assert the actual season passed to data search across additions, overrides, new comparisons, and historical recovery.
