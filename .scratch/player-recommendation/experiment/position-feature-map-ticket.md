# Freeze the position-specific FM feature map

Status: resolved
Labels: ready-for-agent

## Goal

Create the versioned `position-feature-map` needed before full-position formula comparison. The map covers all 14 FM positions with profiles at numeric rating `>=15`; do not invent a populated `SW` pool.

## Work

- Use the 52 complete `raw_attributes_*` fields audited in `../data-audit.md`.
- For every position, define feature names, interpretable attribute groups, and a short reason for each group.
- Keep position score, CA, PA, age, and identity fields out of the current-attribute distance vector; they remain filters or separately displayed values.
- Mirror left/right lists may share fields when their football meaning is the same, but record and evaluate each exact position separately.
- Do not use `role_scores`; their formula is not auditable. Do not claim tactical-role suitability because requests have no role input.
- Record source links and distinguish official documentation from the project's own domain hypothesis. Where the source does not give a full raw-attribute mapping, label the remaining choices as hypotheses.
- Verify all listed raw fields exist and are complete in the exact FM manifest. Freeze the mapping and its hash before examining formula comparison results.

## Acceptance

- One entry for each populated position: `gk`, `dl`, `dc`, `dr`, `wbl`, `dm`, `wbr`, `ml`, `mc`, `mr`, `aml`, `amc`, `amr`, `stc`.
- Each entry includes selected features, functional groups, rationale, and source/assumption notes.
- No unsupported feature, implicit score weighting, or undocumented `role_scores` dependency.
- `SW` is recorded as unavailable because it has no eligible local profiles.
- A frozen manifest hash and reproducible coverage summary are attached to the artifact.

Completed: [frozen map](../position-feature-map.json), SHA256 `de7880a59a29e34fb28f93957af614552697bf125e40a95edc5b64703f408c88`.
