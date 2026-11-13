import { setImmediate as yieldNow } from "node:timers/promises";

import { ChatOpenAI } from "@langchain/openai";

import { createAgent } from "../../src/agent.js";
import type { ReferenceIdentityLookup } from "../../src/player-data/resolve-reference.js";
import type { ReferenceCandidate } from "../../src/state.js";

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

const harryKaneCandidate = {
  candidateId: "reep:kane",
  canonicalIdentityId: "canonical:kane",
  exactNameMatch: true,
  identityBasis: "reep_registry",
  identityVerified: true,
  name: "Harry Kane",
  records: [
    {
      canonicalIdentityId: "canonical:kane",
      competition: null,
      identityVerified: true,
      name: "Harry Kane",
      provider: "fm",
      season: null,
      sourceId: "fm-kane",
      team: null,
    },
  ],
} satisfies ReferenceCandidate;

const resolveHarryKane: ReferenceIdentityLookup = (mention) => ({
  candidateCount: 1,
  candidates: [harryKaneCandidate],
  candidatesTruncated: false,
  canonicalIdentityId: harryKaneCandidate.canonicalIdentityId,
  clarificationMessage: null,
  mention,
  selectedCandidateId: harryKaneCandidate.candidateId,
  selectedName: harryKaneCandidate.name,
  status: "resolved",
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
  playerIdentityLookup: resolveHarryKane,
});

export { agent };
