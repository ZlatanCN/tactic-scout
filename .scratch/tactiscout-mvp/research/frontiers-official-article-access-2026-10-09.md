# Official metadata and access route: Forcher et al. (2022)

Date: 2026-10-09. This is a metadata-only verification for issue 108. No article full-text, PDF, or full-text XML endpoint was requested; no article body was saved, ingested, or sent to a model.

## Verified identifiers and license flags

The official [Europe PMC REST search endpoint, in `lite` mode](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI%3A10.3389%2Ffpsyg.2022.813206&format=json&resultType=lite&pageSize=1) returned one record for DOI `10.3389/fpsyg.2022.813206`: PMID `35712183`, PMCID `PMC9197445`, and `isOpenAccess=Y`. The result is key bibliographic metadata, not article text; the Europe PMC API documents `lite` as key metadata and `core` as including an abstract and full-text links. Europe PMC's `lite` record did not expose the license URI.

The official PMC OAI-PMH `GetRecord` endpoint in `pmc_fm` format returned front-matter metadata for OAI identifier `oai:pubmedcentral.nih.gov:9197445`. Its identifiers include DOI `10.3389/fpsyg.2022.813206`, PMCID `PMC9197445` (version `PMC9197445.1`), and PMID `35712183`. Its metadata flags are `pmc-prop-open-access=yes` and `pmc-license-ref=CC BY`; the machine-readable license reference is `https://creativecommons.org/licenses/by/4.0/`. NCBI defines `pmc-prop-open-access` as indicating that full text is available for reuse under a Creative Commons or similar license. These are metadata flags, while the exact article license comes from the license URI.

## Official bounded route

PMC documents OAI-PMH as an approved automated retrieval service. For this exact record, the metadata-only `ListMetadataFormats` request returned `oai_dc`, `pmc_fm` (front-matter metadata), and `pmc` (JATS full-text format). This confirms a documented single-record route is available. **Only the metadata formats were queried; `pmc` full text was not requested.** The PMC OAI-PMH documentation says `set=pmc-open` identifies records whose full text can be retrieved and identifies `metadataPrefix=pmc` as its full-text format. The repository route is consistent with Frontiers Terms §14, which permits text/data mining of public content for enriching external collections of scientific literature, subject to the article's license and access limits.

Official route details:

- [PMC OAI-PMH documentation](https://pmc.ncbi.nlm.nih.gov/tools/oai/) defines `GetRecord` by OAI identifier and the `pmc_fm` metadata and `pmc` full-text formats; it also lists PMC OAI-PMH among the services permitted for automated PMC retrieval.
- [PMC OAI-PMH metadata-only request used](https://pmc.ncbi.nlm.nih.gov/api/oai/v1/mh/?verb=GetRecord&identifier=oai:pubmedcentral.nih.gov:9197445&metadataPrefix=pmc_fm).
- [Europe PMC REST documentation](https://europepmc.org/RestfulWebService) documents the DOI search endpoint and `lite` metadata mode. The endpoint above is the one-record DOI lookup.
- [Frontiers Terms §14](https://www.frontiersin.org/legal/terms-and-conditions) permits TDM of public content for this stated literature-enrichment purpose, but allows Frontiers to restrict activity that affects website performance and keeps downloaded material subject to its article license.

## Limits and remaining checks

- PMC OAI-PMH limits requests to 3 per second. If a script makes more than 100 requests, PMC asks that it run outside peak hours (Monday–Friday, 5:00 a.m.–9:00 p.m. U.S. Eastern) and says not to make concurrent requests, even off-peak. A single article is well within that envelope. The documentation recommends an `Accept-Encoding: gzip, deflate` header for efficient transfer.
- PMC OAI-PMH documentation does not specify an API key, email, or client-name parameter. The separate PMC ID Converter API requests `tool` and `email` parameters; this lookup did not use that service. Europe PMC's cited `lite` endpoint documentation does not give a numeric rate limit in the material reviewed, so use PMC OAI-PMH's documented cap for any later content request.
- The article's text carries a CC BY 4.0 marker, but this metadata check did not inspect article-level third-party credit lines. Keep figures, tables, supplements, and separately credited elements out of scope until their notices are checked. Underlying match data retain separate rights; the article license does not make those datasets reusable.
- Chinese-query retrieval quality remains untested. The exact source can proceed to a separate, single-article ingestion task only after that task explicitly checks third-party exclusions and retrieval quality; this report made no registry/index changes.

## Scope note

The PMC OAI requests used only `ListMetadataFormats` and `GetRecord` with `metadataPrefix=pmc_fm`; the Europe PMC query used `resultType=lite`. No `/full`, PDF, `metadataPrefix=pmc`, BioC, or other full-text route was opened or requested. Some official search results unexpectedly displayed abstract/body snippets; those pages were not opened, and the snippets were not copied, saved, or used in this note.
