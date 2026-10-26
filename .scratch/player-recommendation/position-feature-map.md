# FM position feature map v1

Status: resolved
Labels: ready-for-agent

Map: [position-feature-map.json](position-feature-map.json)

Snapshot manifest SHA256: `431eecb0a892bf7be8e056832a6fd9e553f461d1b629fdd080ea31e847bd85eb`

Scope: all 14 exact positions with candidate profiles where `positions.rating >= 15`. `SW` has none and is unsupported.

## Method

Each position has functional attribute groups. Formula families use raw 1–100 fields only; ordinary MAE/RMSE use equal feature weights, and the preregistered weighted MAE gives each group equal total mass. Left/right mirrors share the same map because the data fields do not encode side-specific skill; results are still computed and reported separately per exact position.

CA, PA, age, position rating, identity, and height are excluded from the current-attribute vector. They may be displayed or applied as explicit filters. The numeric position threshold is a candidate/reference gate, never a distance component.

The groups are a documented starting hypothesis, not an official Football Manager scoring formula. FM26 describes role suitability as a combination of positional familiarity and role-key attributes; this project has no tactical-role input, so it deliberately models broad position-level profiles. Official documentation supports the distinction between positions and role attributes, but does not publish a full raw-attribute weight matrix for these 14 positions. We do not use the undocumented local `role_scores` values.

## Position groups and rationale

| Position | Attribute groups | Rationale |
| --- | --- | --- |
| GK | goalkeeping, judgment, mobility, distribution | Keep goalkeeper-specific handling, reflex, command and aerial skills distinct from decision, movement and distribution skills. |
| DC | defending, aerial/physical, distribution | Cover marking/tackling/positioning, aerial duels and basic buildup. |
| DL / DR | defending, wide attack, engine | Balance back-line defending with crossing/carrying and repeat running. |
| WBL / WBR | defending, wide attack, engine | Preserve defensive cover while emphasizing the wider attacking and running load. |
| DM | screening, circulation, work | Cover protecting the defense, passing out, and sustained work. |
| MC | circulation, movement, two-way | Cover possession, movement, and a two-way contribution without assuming a specific midfield role. |
| ML / MR | wide delivery, carrying, contribution | Cover delivery, dribbling/speed, and supporting work/movement. |
| AML / AMR | creation, threat, support | Cover wide chance creation and direct goal threat, plus work and support. |
| AMC | creation, progression, threat | Cover central creativity, carrying into dangerous spaces, and shooting/finishing. |
| STC | physical, finishing/movement, link | Preserve the existing STC 18-feature baseline groups for the historical comparison while measuring the same map under the global protocol. |

The feature-level names and exact group memberships are the frozen source of truth in the JSON map. Any later change requires a new map version and a new experiment; results from different map versions are not pooled.

## Official references

- [FM26 position and role suitability](https://www.footballmanager.com/fm26/features/possession-out-possession-fm26s-new-tactical-evolution)
- [FM26 striker attribute examples](https://www.footballmanager.com/the-dugout/dominate-with-dual-strikers-fm26)
- [FM24 position-rating labels](https://community.sports-interactive.com/sigames-manual/football-manager-2024/players-r4958/) — cited for terminology only; the local snapshot is FM26, so this map uses a numeric threshold and does not reuse FM24 labels.
