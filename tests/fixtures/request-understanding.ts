import { fakeModel as createFakeModel } from "@langchain/core/testing";
import { vi } from "vitest";

import type { CreateAgentOptions } from "../../src/agent.js";
import { modelRequestTimeoutMs } from "../../src/fault-tolerance.js";
import {
  testModelContextProfile,
  testModelOutputLimitAdapter,
} from "./model-context.js";

const placeholder = "vitest-placeholder";

vi.stubEnv("OPENAI_API_KEY", placeholder);

vi.stubEnv("OPENAI_MODEL", placeholder);

vi.stubEnv("OPENAI_BASE_URL", "");

vi.stubEnv(
  "TACTISCOUT_MODEL_CONTEXT_PROFILE",
  JSON.stringify({
    baseURL: null,
    ...testModelContextProfile,
    model: placeholder,
  })
);

const { createAgent: createAgentWithRuntime } =
  await import("../../src/agent.js");

const fakeModel = () => {
  const model = createFakeModel();

  vi.spyOn(model, "getNumTokens").mockImplementation(async (text) => {
    await Promise.resolve();

    return Math.ceil(text.length / 4);
  });

  return model;
};

const createAgent = (options: CreateAgentOptions = {}) =>
  createAgentWithRuntime({
    modelContextProfile: testModelContextProfile,
    modelOutputLimitAdapter: testModelOutputLimitAdapter,
    ...options,
  });

const mockShortModelTimeout = () => {
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);

  return vi
    .spyOn(AbortSignal, "timeout")
    .mockImplementation((milliseconds) =>
      originalTimeout(milliseconds === modelRequestTimeoutMs ? 5 : milliseconds)
    );
};

const requestUnderstandingTest = {
  createAgent,
  createAgentWithRuntime,
  fakeModel,
  mockShortModelTimeout,
};

export { requestUnderstandingTest };
