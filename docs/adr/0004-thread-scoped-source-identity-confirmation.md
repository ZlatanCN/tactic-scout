# ADR-0004: Thread-scoped confirmation of source identity groups

Status: accepted

## Context

The identity resolver can return separate candidates for records from different providers when the Reep registry has not linked their source IDs. Selecting a candidate by its display name currently resolves only that provider candidate. A person may have valid records under different names in Football Manager and Understat, while two different people may also share a display name.

## Decision

- Records linked to the same canonical Reep ID form one person candidate automatically.
- Similar, unlinked records from different providers may be presented as a tentative person candidate only when the match is strong and unambiguous. Selecting that group confirms the relationship for the current thread.
- Exact same-name records without a shared canonical Reep ID remain separate candidates. If they map to different canonical Reep IDs, they cannot be merged.
- A user may choose one provider's record or explicitly select multiple candidates as one person. The resolved thread candidate retains the exact source record IDs and each record's Reep-link status.
- Thread confirmation does not modify the shared Reep registry. Downstream retrieval uses the selected source IDs; answers keep each provider's data separate.

## Consequences

- The identity interrupt represents person candidates, which may contain several provider records.
- A thread-confirmed group may have no canonical Reep ID even when one of its records is linked. It must not be described as globally verified across providers.
- Duplicate names require a candidate number or additional context instead of first-match selection.
- In-memory thread confirmation is lost when the process restarts.
