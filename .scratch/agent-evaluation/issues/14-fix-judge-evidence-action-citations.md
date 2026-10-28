# 14: Keep judge evidence IDs separate from action IDs

**What to build:** Semantic judge findings cite delivered `evidenceIds` for factual support/contradiction and `actionIds` for execution claims; invalid references remain visible and never count as semantic passes.

**Blocked by:** 09: Measure and archive the development baseline. Run `ab3547a4-8cb7-4566-a837-eff62941357b` captures the invalid outputs.

**Status:** resolved
**Labels:** ready-for-agent

- [x] Clarify the judge's output contract with one concise example of a factual contradiction citing an `evidenceId` and a false execution claim citing an `actionId`.
- [x] Make action/evidence IDs easy to distinguish in the judge input, especially for roster workflows with many per-player events.
- [x] Add fake-gateway tests for missing contradiction evidence references, action IDs incorrectly placed in `evidenceIds`, and quotes absent from the response.
- [x] Preserve invalid judgments as `invalid`; do not retry a completed semantic judgment solely to obtain a pass.
- [x] Keep `required_evidence_not_delivered` results inconclusive rather than guessing from the full fixture corpus.

## Evidence

V5 calibration passed 16/16, but the development baseline still had seven invalid trial judgments for missing contradiction evidence references, one quote-not-found result, and invalid action/evidence references in the Real Madrid roster case. Nine additional trials were inconclusive because required evidence was not delivered.

## Resolution

The semantic judge prompt now says that `evidence:` IDs belong only in `evidenceIds`, while `action:` and `action-event:` IDs belong only in `actionIds`. The evaluation input adds those prefixes to every evidence, action, and event identifier so they are easy to distinguish in long roster traces. The prompt version is `scouting-semantic-judge-v4`.

Fake-gateway tests cover a contradiction with no evidence citation, an action ID incorrectly cited as evidence, and a quote absent from the response. Each invalid judgment stays `invalid` after one judge request. A separate fixed-evidence case confirms that a required fact not delivered to the agent remains `inconclusive`. No real model call was needed.
