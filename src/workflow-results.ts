import type { z } from "zod/v4";

import type { AgentStateType } from "./state.js";

const decodeResultJson = <Schema extends z.ZodType>(
  resultJson: string,
  schema: Schema
) => {
  const value: unknown = JSON.parse(resultJson);
  const data = schema.parse(value);

  return { data, resultJson: JSON.stringify(data) };
};

const executedLookupOutcome = (state: AgentStateType) => {
  const { outcome } = state;

  return outcome?.kind === "player_lookup" &&
    "source" in outcome &&
    outcome.source === "executed"
    ? outcome
    : null;
};

export { decodeResultJson, executedLookupOutcome };
