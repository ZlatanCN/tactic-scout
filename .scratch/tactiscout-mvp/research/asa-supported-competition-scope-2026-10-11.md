# ASA supported competition scope

Checked: 2026-10-11. This note records the supported ASA boundary used by the repository and the multi-source candidate pool.

## Supported scope

The product allowlist is MLS (`mls`), USL Championship (`uslc`), and USL League One (`usl1`). The generic `USL` query covers only `uslc` and `usl1`.

The allowlist is applied consistently to default searches, full-catalog reads, age-filtered ASA searches, mosaic composition, dataset-scope descriptions, Planner instructions, and final reports. An exact unsupported competition query fails before network access. Mosaic filters ASA records by competition ID before they can be searched or reported.

## Verification boundary

Issue [149](../issues/149-separate-usl-super-league-from-mens-candidate-pool.md) records public-interface regressions for ASA search and catalog reads, mosaic filtering, and a deterministic LangGraph data-to-report path. Tests also verify that unsupported queries do not issue network requests. The ASA source-coverage research and observed endpoint limits are recorded in [issue 76](../issues/76-asa-current-north-america-coverage.md).

This allowlist describes the product's configured data scope. It does not imply complete rosters, a complete transfer market, or uniform metric coverage across competitions.
