# Screen newly found authorized player-source leads

Type: research
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Question

Do any newly found current or recent player-data routes add useful TactiScout coverage while allowing supported access, local retention, local Ollama/RAG processing, and public portfolio display?

## Decision

No newly reviewed route passed all gates. NCAA's 2026 men's soccer individual statistics are a possible US college scouting lead, but published terms do not grant automated collection, persistent storage, local model/RAG processing, or public named-player reports. Football Web Pages documents player appearance and goalscorer endpoints, but its free API is limited to non-league clubs' own public/official websites and does not fit this standalone portfolio application. Neither source was queried or scraped.

Do not add a provider or collect player rows. The smallest next action is an owner-led written request to NCAA rights contacts for an official feed and explicit permissions covering automation, local retention, Ollama/RAG, public derived reports, and attribution. No outreach is sent by this issue.

## Evidence

- [Research report with primary-source citations](../research/new-authorized-player-source-route-2026-10-09.md)
- [NCAA 2026 men's soccer stats](https://www.ncaa.com/stats/soccer-men/d1/current/individual/573)
- [NCAA.com Terms of Service](https://www.ncaa.com/tos)
- [Football Web Pages API terms and endpoints](https://www.footballwebpages.co.uk/api)

## Acceptance criteria

- [x] Audit the existing source matrix and avoid repeating assessed candidates.
- [x] Assess access, retention, model/RAG use, public display, coverage, and freshness separately from primary sources.
- [x] Do not request data, scrape, retain player rows, or add a provider.
- [x] Record a concrete no-go decision and the minimum permission step that could change it.

## Answer

Research completed on 2026-10-09. Both candidates offer a limited coverage lead, but neither meets the use boundary required for a reproducible local Agent and public portfolio demo. The full evidence and links are in the research report above.
