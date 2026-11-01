# 55 · Record per-turn model failures for evaluation

**What to build:** Include a minimal structured per-turn node-failure observation in eval judge input so the judge can verify user-visible explanations of model failure without receiving raw prompts or provider error bodies.

**Blocked by:** None.

**Status:** resolved

## Evidence

V16 baseline lookup trial `lookup-identity-clarification-v1` trial 3 answered “请求理解模型暂时不可用”. The final trial report did not include the `understand_request` failure node/category for that turn, so the judge could not distinguish a real caught failure from an invented reason. A single final `failureCategory` cannot reliably explain earlier turns.

## Acceptance

- Each turn records only the failed node and normalized failure category when present.
- The observation is passed into the semantic judge and included in the rendered local report.
- Raw prompts, credentials, and provider response bodies are not added to judge input.
- Tests distinguish a recorded node failure from a turn with no failure in judge input.

## Result

Each turn now carries only `{node, category}` when a graph node failure was caught. The semantic judge receives this observation with instructions to keep claims within that evidence; the local Markdown report shows the same normalized fields. The Responses body, prompt, and credentials remain outside the observation. A fake-graph judge-input regression confirms per-turn failure evidence stays attached to its turn.
