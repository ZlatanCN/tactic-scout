import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type {
  ModelContextConfiguration,
  ModelContextProfileInput,
  ModelOutputLimitAdapter,
} from "../../src/model-context.js";

const testModelContextProfile: ModelContextProfileInput = {
  maxInputTokens: 100_000,
  maxOutputTokens: 2048,
};

const testModelOutputLimitAdapter: ModelOutputLimitAdapter = (
  model: BaseChatModel,
  maxOutputTokens: number
) => Object.assign(model, { maxTokens: maxOutputTokens });

const testModelContextConfiguration: ModelContextConfiguration = {
  outputLimitAdapter: testModelOutputLimitAdapter,
  profile: testModelContextProfile,
};

export {
  testModelContextConfiguration,
  testModelContextProfile,
  testModelOutputLimitAdapter,
};
