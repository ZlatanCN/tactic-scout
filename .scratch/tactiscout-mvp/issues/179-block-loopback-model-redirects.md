# Prevent loopback model requests from following redirects

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Keep model requests for loopback-configured endpoints on the configured HTTP destination. The existing Understat, ASA, mosaic, and StatsBomb turn gate checks that `OPENAI_BASE_URL` is loopback, but the model HTTP client can follow a redirect returned by that endpoint.

## Accepted verification seam

- `createChatModel().invoke()` using the configured LangChain model and two ephemeral HTTP servers bound to `127.0.0.1`.
- The configured server returns a real HTTP 302 to the second server. Assert invocation fails and the redirect target receives no request body.
- A normal JSON chat completion from a direct loopback server still returns its assistant response.

## Acceptance criteria

- [x] Requests sent to a loopback-configured model endpoint do not automatically follow any 3xx response.
- [x] A redirect response is surfaced as a model request failure and its body is not forwarded to the redirect destination.
- [x] A successful non-redirecting loopback response still works through the existing LangChain model.
- [x] Non-loopback OpenAI-compatible endpoint behavior is unchanged; the manual redirect option is added only when the shared loopback predicate matches.
- [x] The turn gate and transport protection use one loopback-host policy so the two checks cannot drift.
- [x] Documentation states the limit precisely: this prevents HTTP redirect forwarding; it cannot determine whether a local proxy itself relays requests remotely.

## Evidence

- `src/agent/conversation.ts` uses the shared loopback predicate before checkpoint/player access.
- `src/agent/chat-model.ts` uses the same predicate and configures the OpenAI SDK with `fetchOptions.redirect: "manual"` only for loopback endpoints.
- Installed `@langchain/openai` accepts the OpenAI SDK `ClientOptions` under `configuration`.
- The official OpenAI Node SDK documents custom `fetch` and demonstrates `redirect: "manual"` to avoid automatically following redirects to another host: <https://github.com/openai/openai-node/blob/main/examples/mtls/README.md>.

## Comments

- 2026-10-13: Adversarial review found a possible transport-level bypass of the loopback-only source-processing gate. The initial regression simulated a 307 at the Fetch seam because the default sandbox denied local HTTP listeners.
- 2026-10-13: After the user approved a real `createChatModel().invoke()` HTTP test, local network permission was granted for two ephemeral `127.0.0.1` servers. The regression now sends a real request to a local endpoint that returns 302 and verifies the second server receives no request; a direct local chat completion also succeeds. No internet or scouting data is involved.

## Answer

The loopback-only model-processing gate and the LangChain transport share `isLoopbackModelEndpoint`. For loopback URLs, the OpenAI SDK receives `fetchOptions.redirect: "manual"`. A real HTTP 302 from one local test server is surfaced as a model failure, and the second local server receives no request; a direct local chat completion still returns successfully. Other endpoints do not receive the manual redirect option. The source documentation notes that this blocks HTTP redirect forwarding but cannot inspect forwarding performed by a local proxy itself.

Verification: the `tests/app-composition.test.ts` regression passed with actual local HTTP listeners, alongside the full test suite, `pnpm build`, `pnpm build:web`, and `git diff --check`. This verifies the HTTP client's redirect behavior on loopback; it cannot determine whether a local proxy itself relays requests remotely.
