# V33 held-out replacement pack

Status: exposed; do not use for acceptance.

The pack contains 16 cases across all four workflows: 12 fixed-source cases and 4 synthetic team-roster cases. It uses new case IDs, scenario families, player mentions, canonical Reep identities, provider IDs, and synthetic team data compared with V1–V32. Each case pins `ageAsOfDate` to `2026-11-04`.

V33 run `090c0264-3023-466e-944e-9d7780e7cb08` made 218 model requests before stopping: 35 trials passed, 3 failed, and 10 were not assessed. All three failures were in the add-reference case: its expected candidate list came from a different reference set than the one requested in that turn. The pack was corrected after the run, so the run cannot validate the corrected pack. V33 is exposed and must not be reused for acceptance.

The fixed evidence and case contracts were regenerated after the run. A new independent pack is required for a clean held-out acceptance run.
