import { setImmediate as yieldNow } from "node:timers/promises";

import { ChatOpenAI } from "@langchain/openai";

import { createAgent } from "../../src/agent.js";

const modelName = process.env.OPENAI_MODEL ?? "persistence-test-model";
const apiKey = process.env.OPENAI_API_KEY ?? "persistence-test-key";
const baseURL = process.env.OPENAI_BASE_URL?.trim();

const modelOptions: ConstructorParameters<typeof ChatOpenAI>[0] = {
  apiKey,
  maxRetries: 0,
  model: modelName,
  temperature: 0,
};

if (baseURL !== undefined && baseURL.length > 0) {
  modelOptions.configuration = { baseURL };
}

const model = new ChatOpenAI(modelOptions);

Object.assign(model, {
  getNumTokens: async (input: string) => {
    await yieldNow();

    return Math.ceil(input.length / 4);
  },
});

const agent = createAgent({
  model,
  modelContextProfile: {
    countingMarginTokens: 64,
    maxInputTokens: 8500,
    maxOutputTokens: 256,
    softTriggerFraction: 0.8,
    targetFraction: 0.6,
  },
});

export { agent };
