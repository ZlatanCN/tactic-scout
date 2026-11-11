import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";

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

const testModelWithDeterministicTokenCount = (
  model: BaseChatModel
): BaseChatModel => {
  if (model instanceof ChatOpenAI || Object.hasOwn(model, "getNumTokens")) {
    return model;
  }

  return Object.assign(model, {
    getNumTokens: async (text: string) => {
      await Promise.resolve();

      return Math.ceil(text.length / 4);
    },
  });
};

const testModelContextConfiguration: ModelContextConfiguration = {
  outputLimitAdapter: testModelOutputLimitAdapter,
  profile: testModelContextProfile,
};

export {
  testModelContextConfiguration,
  testModelContextProfile,
  testModelOutputLimitAdapter,
  testModelWithDeterministicTokenCount,
};
