# ASA 2026 current North American competition coverage

Research date: 2026-10-06. Scope: first-party ASA documentation and bounded, anonymous reads of its public API. The audit printed only counts, competition IDs, season labels, and position groups; it did not print or save individual names or performance values.

## First-party scope and attribution

ASA's own Shiny app lists MLS, NWSL, USL Championship, USL League One, USL Super League, MLS Next Pro, and historical NASL as supported competitions. Its JavaScript client describes access to advanced analytics for MLS, NWSL, and USL players/teams and shows competition selection through the `leagues` parameter. ASA's Python package documents a public API that does not require authentication, the league codes, and xGoals, xPass, and Goals Added methods. The ASA app README asks users of its publicly available data to credit and link to ASA; this is an attribution request, not a separate explicit data license.

Sources: [ASA data app and attribution](https://github.com/American-Soccer-Analysis/asa-shiny-app) · [ASA JavaScript API client](https://github.com/American-Soccer-Analysis/itscalledsoccer-js) · [ASA Python API client and league codes](https://github.com/American-Soccer-Analysis/itscalledsoccer) · [ASA API reference](https://american-soccer-analysis.github.io/itscalledsoccer/reference/).

## Live current-season coverage

For each competition, the audit requested `/api/v1/{league}/players/{xgoals,xpass,goals-added}` with `season_name=2026`, `split_by_seasons=true`, `split_by_teams=true`, and `minimum_minutes=0`. Every request used HTTPS GET, an explicit timeout, and redirect rejection. All five admitted competitions returned HTTP 200, only season `2026`, and the API-supported general-position groups `AM`, `CB`, `CM`, `DM`, `FB`, `GK`, `ST`, and `W`.

| ASA code | Competition | xGoals rows | xPass rows | Goals Added rows | xGoals teams |
|---|---|---:|---:|---:|---:|
| `mls` | Major League Soccer | 889 | 889 | 833 | 30 |
| `nwsl` | National Women's Soccer League | 410 | 410 | 378 | 16 |
| `uslc` | USL Championship | 666 | 666 | 610 | 25 |
| `usl1` | USL League One | 458 | 457 | 418 | 17 |
| `usls` | USL Super League | 156 | 156 | 146 | 8 |
| `mlsnp` | MLS Next Pro | **1,097** | not admitted | not admitted | 30 |

MLS Next Pro's xGoals response alone exceeds TactiScout's 1,000-row completeness guard. It is excluded rather than silently treating a potentially incomplete response as a full candidate scope. Historical NASL is also excluded from a current-season pool.

Direct endpoints: [MLS xGoals 2026](https://app.americansocceranalysis.com/api/v1/mls/players/xgoals?season_name=2026&split_by_seasons=true&split_by_teams=true&minimum_minutes=0) · [NWSL xGoals 2026](https://app.americansocceranalysis.com/api/v1/nwsl/players/xgoals?season_name=2026&split_by_seasons=true&split_by_teams=true&minimum_minutes=0) · [USLC xGoals 2026](https://app.americansocceranalysis.com/api/v1/uslc/players/xgoals?season_name=2026&split_by_seasons=true&split_by_teams=true&minimum_minutes=0) · [USL1 xGoals 2026](https://app.americansocceranalysis.com/api/v1/usl1/players/xgoals?season_name=2026&split_by_seasons=true&split_by_teams=true&minimum_minutes=0) · [USLS xGoals 2026](https://app.americansocceranalysis.com/api/v1/usls/players/xgoals?season_name=2026&split_by_seasons=true&split_by_teams=true&minimum_minutes=0) · [MLS Next Pro xGoals 2026](https://app.americansocceranalysis.com/api/v1/mlsnp/players/xgoals?season_name=2026&split_by_seasons=true&split_by_teams=true&minimum_minutes=0).

The differing xGoals/xPass/g+ row totals confirm that an absent metric family must remain unavailable. The accepted implementation retains ASA's original field names and per-metric minutes. Profiles use `(competition_id, player_id, team_id, season_name)` as the statistical-row identity, and directory lookups stay inside the same competition path.

## Design boundary

- This expands the current ASA evidence pool to five North American competitions. It does not create a worldwide transfer market, a complete registered-roster source, contract/valuation/injury data, or proof that a player is available to sign.
- Percentiles remain partitioned by exact competition, season, and position group. A shared API/vendor does not make raw values across competitions directly comparable.
- NWSL is a women's competition and must remain explicitly labeled in result and report context; do not merge its reference group with men's competitions.
- Retrieval time is TactiScout's observation time. ASA's public interfaces do not provide the record-level update SLA needed to call that timestamp “last updated”.
- ASA's app requests attribution. No separate data license covering arbitrary public redistribution, LLM processing, or RAG use was verified in this research. Keep ASA attribution visible and do not describe the dataset as rights-cleared for those uses.

## Implementation decision

Use the existing ASA provider and LangGraph tools rather than creating one provider per league. Admit only the five live-verified competitions below the current response ceiling, put the league code in the stable TactiScout identity, retain explicit supported-league aliases, and fail closed on unsupported scope or over-limit responses. Validate once with fixtures and once through the configured local model; the latter checks orchestration and evidence contracts, not the truth of a recommendation ranking.
