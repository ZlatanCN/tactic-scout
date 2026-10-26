# Compare formulas and ablate attributes across populated FM positions

Status: resolved
Labels: ready-for-agent

## Goal

Choose one provisional current-attribute formula for all supported positions using the frozen position feature map and an identity-isolated offline experiment. The existing STC runner and selection remain unchanged historical artifacts.

## Work

- Create a new versioned config and runner; do not overwrite the STC protocol or `.data` run output.
- Evaluate each registered formula family separately for all 14 exact positions, for single-reference and equal-mean multi-reference queries.
- Split stable FM IDs once across fit, development, and test; prevent cross-position identity leakage. Fit normalization/covariance on fit IDs only.
- Hold candidate sets, position threshold (`>=15`), filters, and query sets constant across formulas.
- Run the registered feature-group ablations per position without changing candidate eligibility.
- Select one global formula on development using equal-position macro metrics. Freeze it before a single test confirmation; report per-position metrics and clustered uncertainty.
- Add negative controls, a separate PA-order correctness check, and an independent verifier for all raw rankings and constraints.
- Keep all bulk splits and rankings under a new ignored `.data/recommendation-experiments/<run-id>/` directory.

## Acceptance

- All numerical formulas pass hand-computed checks; all position, identity, age/CA/PA, self-exclusion, stable-tie, and finite-score checks pass.
- Report both macro-average and every exact position; no test-set retuning.
- The report calls the result `provisional` or `inconclusive`; it does not claim real football relevance without independent labels.
- The high-potential list ranks by PA separately and is never used as a current-distance formula candidate.

Completed: [all-position report](../multi-position-report.md), global provisional default RMSE; independent verifier passed 120,960 rankings, 10,080 potential rows, and 10,320 ablation rows.
