import type { GraphNode } from "@langchain/langgraph";

import { waitForRetryDelay } from "../fault-tolerance.js";
import type { AgentState } from "../state.js";

const createWaitForApiRateLimitNode =
  (): GraphNode<typeof AgentState> => async (state, runtime) => {
    const wait = state.faultTolerance.apiRetryAfterMs;

    if (wait === null) {
      return {};
    }

    await waitForRetryDelay(wait, runtime.signal);

    return {
      faultTolerance: {
        ...state.faultTolerance,
        apiRetryAfterMs: null,
      },
    };
  };

export { createWaitForApiRateLimitNode };
