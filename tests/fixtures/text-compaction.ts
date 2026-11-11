import { setImmediate as yieldNow } from "node:timers/promises";

import type { fakeModel } from "@langchain/core/testing";
import { vi } from "vitest";
import { z } from "zod/v4";

import type { AgentState } from "../../src/state.js";

type AgentStateType = ReturnType<typeof AgentState.parse>;

type ContextProcessingState = AgentStateType["contextProcessing"];

type ReferenceCandidate =
  AgentStateType["conversationContext"]["playerAliases"][number]["reference"]["candidate"];

type ModelTokenCountInput = Parameters<
  ReturnType<typeof fakeModel>["getNumTokens"]
>[0];

vi.stubEnv("OPENAI_API_KEY", "vitest-placeholder");

vi.stubEnv("OPENAI_MODEL", "vitest-placeholder");

vi.stubEnv("OPENAI_BASE_URL", "");

const { createAgent } = await import("../../src/agent.js");

const modelContextProfile = {
  countingMarginTokens: 64,
  maxInputTokens: 8500,
  maxOutputTokens: 256,
  softTriggerFraction: 0.8,
  targetFraction: 0.6,
};

const anchorAt = (source: string, text: string) => {
  const start = source.indexOf(text);

  return { end: start + text.length, start, text };
};

const codePointCount = (value: string): number => {
  let count = 0;
  let index = 0;

  while (index < value.length) {
    const codePoint = value.codePointAt(index);
    index += codePoint !== undefined && codePoint > 0xff_ff ? 2 : 1;
    count += 1;
  }

  return count;
};

const chunkEndFromInput = (input: ModelTokenCountInput): number | null => {
  if (Array.isArray(input)) {
    return null;
  }

  let serializedRequest: unknown;

  try {
    serializedRequest = JSON.parse(input);
  } catch {
    return null;
  }

  const request = z
    .looseObject({
      messages: z.array(
        z.looseObject({ content: z.unknown(), role: z.string() })
      ),
    })
    .safeParse(serializedRequest);

  if (!request.success) {
    return null;
  }

  const humanMessage = request.data.messages.find(
    ({ role }) => role === "human"
  );

  const humanContent = z.string().safeParse(humanMessage?.content);

  if (!humanContent.success) {
    return null;
  }

  let parsedContent: unknown;

  try {
    parsedContent = JSON.parse(humanContent.data);
  } catch {
    return null;
  }

  const payload = z
    .looseObject({
      operation: z.string().optional(),
      range: z.object({ end: z.number() }).optional(),
    })
    .safeParse(parsedContent);

  return payload.success && payload.data.operation === "extract_text_chunk"
    ? (payload.data.range?.end ?? null)
    : null;
};

const mockDeterministicTokenCount = (model: ReturnType<typeof fakeModel>) =>
  vi.spyOn(model, "getNumTokens").mockImplementation(async (input) => {
    const serializedInput = Array.isArray(input)
      ? (JSON.stringify(input) ?? "")
      : input;

    await yieldNow();

    return Math.ceil(serializedInput.length / 4);
  });

const knownKaneCandidate = {
  candidateId: "reep:kane",
  canonicalIdentityId: "canonical-kane",
  exactNameMatch: true,
  identityBasis: "reep_registry",
  identityVerified: true,
  name: "Harry Kane",
  records: [
    {
      canonicalIdentityId: "canonical-kane",
      competition: null,
      identityVerified: true,
      name: "Harry Kane",
      provider: "fm",
      season: null,
      sourceId: "kane-fm",
      team: null,
    },
  ],
} satisfies ReferenceCandidate;

const textCompactionTest = {
  anchorAt,
  chunkEndFromInput,
  codePointCount,
  createAgent,
  knownKaneCandidate,
  mockDeterministicTokenCount,
  modelContextProfile,
};

export { textCompactionTest };

export type {
  AgentStateType,
  ContextProcessingState,
  ModelTokenCountInput,
  ReferenceCandidate,
};
