# Prepare an evidence-matched shortlist review sample

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: 70, 119, 120, 121

## Goal

Prepare a real, locally retained human-review packet for one role whose named ability has direct, source-defined evidence in the frozen Wyscout dataset. Avoid using a request that combines measured and structurally missing abilities as if one aggregate judgment could validate them all.

## Scope

- Use the registered Barcelona under-23 forward attacking one-on-one Harness scenario and the current Wyscout v2 snapshot.
- Re-run the current full LangGraph Harness once and export from its actual evaluated candidate pool and report ranking using the existing review-request builder and CLI.
- Freeze the review brief to the historical attacking ground-duel role and request only the two directly mapped duel metrics.
- Keep the reviewer packet and answer key as separate, local-only files with restrictive permissions. Do not add either artifact to Git.
- Do not enter reviewer scores, produce labels, calculate nDCG, or claim ranking quality. State that independent human ratings and adjudication remain required.

## Acceptance criteria

- [x] The current Wyscout event documentation and dataset citation/license are reviewed and cited in a focused research note.
- [x] One current schema Harness run completes with all checks passing against the frozen Wyscout v2 snapshot.
- [x] The review request uses the actual evaluated candidate pool and actual report order; candidates without a report rank stay unranked.
- [x] The fixed brief names only the historical attacking one-on-one role, and both metric keys map directly to that role's documented event evidence.
- [x] The exported blind packet contains source-backed cards and the shared rating anchors, with no candidate identity, team identity, model identity, or ranking; the answer key is separate.
- [x] Reviewer packet and answer key are ignored by Git, mode 0600, and reject overwrite through the existing CLI.
- [x] Documentation and the map record sample size, snapshot identity, scope, and limitations without creating or implying human labels.

## Research

- [Wyscout attacking duel event evidence](../research/attacking-one-on-one-evaluation-evidence-2026-10.md)
- [Attacking one-on-one Harness scenario](70-harness-attacking-one-on-one-scenario.md)
- [Blinded packet exporter](120-export-blinded-shortlist-review-packets.md)

## Comments

- 2026-10-10: Claimed after auditing the existing Kane packet. That 29-card packet asks reviewers to judge receiving, chance creation, and finishing together, while its historical source provides only partial evidence; a single fit grade would be difficult to interpret. This task prepares a separate, narrower case before asking humans to rate it.
- 2026-10-10: Resolved with a real Barcelona U23 attacking-ground-duel Harness run (31/31 checks; 20 evaluated candidates; 3 candidates actually ranked) and a 20-card de-identified packet. All cards show duel frequency; 18 show classified explicit-win share and 2 preserve it as unknown. The packet and separate answer key are local-only, both mode 0600; overwrite refusal was verified through the existing CLI. No human ratings or quality metric were created.

## Answer

The focused source review is recorded in [attacking one-on-one evaluation evidence](../research/attacking-one-on-one-evaluation-evidence-2026-10.md). The official event table defines event 1/subevent 11 as `Duel – Ground attacking duel` and labels 701/702/703 as lost/neutral/won. The sample uses a project-derived `703 / (701 + 702 + 703)` share, not Wyscout's separate `Successful` statistic or a dribble-success rate. The paper and Figshare source document identify this as 2017/18-era historical data and state the released dataset's CC BY 4.0 terms; the snapshot cannot establish current roster, contract, or transfer status.

The full Qwen 3.5 9B + LangGraph run completed against the frozen v2 snapshot: 31/31 Harness checks, 7 decisions, 6 tool calls, 29 progress events, zero Planner fallbacks, 20 evaluated candidates, and 3 candidates in the actual report ranking. The packet was built from the observed candidate pool and report; unranked evaluated candidates remain unranked. Snapshot SHA-256: `6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f`.

The local blind packet has 20 anonymous cards and 20 source performance rows. Duel frequency is available on 20/20 cards; explicit-win share is available on 18/20, with two `unknown` values where no classified outcome exists. A structural check confirmed the packet has no player/team identity, model identity, or rank fields; the separate answer key contains 20 identity records and only the 3 actual report ranks. Both output files are Git-ignored and mode 0600. The existing CLI's no-overwrite behavior was exercised against the existing outputs; it refused and left both files unchanged.

The fixed, non-sensitive context fixture and reproducible run/export instructions are in [evaluation docs](../../../docs/evaluation.md#巴萨-u23-前锋历史进攻地面对抗样本); the root [CONTEXT.md](../../../CONTEXT.md) now defines the source-specific metrics and their limits. No reviewer score, adjudication, or nDCG was created. Independent human reviews and adjudication remain necessary before any shortlist-quality result is evaluable.
