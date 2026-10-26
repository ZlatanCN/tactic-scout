# ADR-0008: Use bounded, status-aware fault tolerance

Status: accepted

Apply LangGraph retry, timeout, and error-handler policies per external boundary rather than globally. Retry network and server failures up to three total attempts per node; give API calls a 15-second and model calls a 60-second per-attempt timeout. A short 429 rate limit may retry once only when the provider gives a retry delay and daily quota remains, counting within the same attempt budget; exhausted quota, configuration/authentication errors, malformed responses, and domain outcomes do not retry. Structured request output may receive one validation-guided repair, included in a maximum of three total model requests; the lookup model/tool loop is limited to three search calls per user turn.

Only tagged transient failures are thrown into LangGraph retry policies; permanent provider failures remain structured results. This is necessary because LangGraph retries exceptions, not ordinary State outcomes.

After retries are exhausted, known external failures become explicit State outcomes and preserve the last successful conversation context. Unexpected programming errors propagate; `interrupt()` remains normal control flow and bypasses retry/error handling. The API and FM operations are read-only, so no Saga compensation is needed. Keep `MemorySaver` for the local/private version; process-restart recovery is out of scope. Emit structured local logs with node/run/thread, attempt, error category, and duration, but never log prompts or raw roster data.
