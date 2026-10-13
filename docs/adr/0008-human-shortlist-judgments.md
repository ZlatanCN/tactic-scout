# Keep human shortlist judgments separate from Agent output

The project will evaluate candidate ordering only against judgments made independently for a frozen query and candidate pool. Each candidate needs at least two independent 0–3/`unknown` ratings and an adjudicated grade; unjudged or unknown candidates are never treated as irrelevant. This prevents the Agent from supplying its own quality labels and keeps incomplete evidence visibly `not_evaluable`.

## Rating anchors

The 0–3 scale describes a reviewer’s evidence-backed fit judgment for one frozen role brief. It is not an absolute player ability scale, a calibrated industry measure, or a direct transformation of raw statistics:

- **0 — Clearly does not fit:** sufficient, direct evidence shows a mismatch with the frozen role or a violation of an explicit hard constraint. Missing or unobserved evidence alone is not a zero.
- **1 — Weak or partial fit:** evidence is weak or supports only part of the role.
- **2 — Reasonable support:** source evidence reasonably supports the requested capability or role, but does not meet the strongest anchor.
- **3 — Strong fit evidence:** source evidence directly and strongly supports the named capability or role.
- **`unknown` — Not assessable:** missing fields, a small sample, a metric unrelated to the requested capability, or ambiguous evidence prevents a judgment. It is neither a negative rating nor a zero.

These anchors are operational conventions for collecting project data and have not been calibrated. Reviewers must not convert a statistic mechanically into a grade. The evaluator’s `2^grade − 1` gain mapping assigns exponentially increasing utility to grades; any nDCG result must disclose that assumption and remains specific to the frozen query, candidate pool, evidence snapshot, and adjudication.

Independent ratings are collected through the local blind-review workbench at `/review`. It accepts only the reviewer-facing schema-v2 packet, stores drafts in the current browser profile, and exports packet-scoped anonymous card ratings. Reviewers must keep their submissions independent; identity/rank lookup and adjudication happen only after ratings are locked. The workbench does not merge ratings, verify reviewer independence, or calculate nDCG.

After all independent submissions are complete, a separate local `/adjudicate` flow presents anonymous evidence and original ratings to an adjudicator. The adjudicator selects one grade per card without averaging the original ratings. The answer key is loaded only after these grades are locked. Evaluation inputs use anonymous card IDs rather than player/team IDs; unmatched, unknown, or incomplete pools remain `not_evaluable`. Descriptive categorical agreement, numeric-grade agreement, and unknown-involving pairs are reported separately; none is presented as a reliability coefficient.
