# Enforce men's soccer scope in TheSportsDB roster context

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Ensure the optional TheSportsDB sidecar displays only records the provider explicitly identifies as men's soccer, matching the project's product scope.

## Evidence

- The official [TheSportsDB team-search example](https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=Arsenal) includes `strSport` and `strGender` on the team record.
- The official [team-player response example](https://www.thesportsdb.com/api/v1/json/123/lookup_all_players.php?id=133604) includes `strSport` and `strGender` on player records too.
- The project's [domain context](../../../CONTEXT.md#产品范围) limits candidates and displayed football data to men's competitions, players, and performance.

## Accepted verification seam

- `createTheSportsDbRosterEnrichment(...).lookupTeamRosterSample()` using mocked official response shapes.
- Verify eligible men's-soccer records display and female, non-soccer, or missing-scope records do not.

## Acceptance criteria

- [x] Team matches are eligible only when `strSport` is `Soccer` and `strGender` is `Male`.
- [x] Displayed player rows independently require `strSport=Soccer` and `strGender=Male`; missing values fail closed.
- [x] An ineligible exact-name match cannot shadow or make a valid men's-soccer match ambiguous.
- [x] Mixed/unverifiable roster responses never expose out-of-scope names; returned counts and notices describe only displayed records.
- [x] The adapter seam tests and API/Web builds pass.

## Context

- [TheSportsDB source issue](114-thesportsdb-roster-enrichment.md)
- [TheSportsDB isolation decision](../../../docs/adr/0007-thesportsdb-team-context.md)
- [Men's-football product scope](../../../CONTEXT.md#产品范围)
- [Current-source official scope recheck](../research/source-scope-recheck-2026-10-13.md)

## Answer

Updated the provider schemas to retain each record's sport and gender metadata, then fail closed unless both equal `Soccer` and `Male`. Team search filters before exact-match ambiguity checks, so a women's or other-sport team with the same name cannot shadow an eligible men's team. Player rows are independently filtered; the displayed count now counts only verified records. If an exact-name team lacks scope metadata, the adapter does not fetch its roster and explains that it could not verify men's-soccer scope. The report labels the displayed rows as verified men's-soccer records.

Verification: adapter regressions cover a mixed same-name team search, mixed player records including missing scope, and an exact-name team without gender metadata (one request only, no roster lookup). All 434 tests pass; API and Web production builds and `git diff --check` pass. No live request was made.
