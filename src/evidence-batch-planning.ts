import { z } from "zod/v4";

import type { LookupEvidenceBatch } from "./context-processing-state.js";

type EvidenceBatchPlanEntry = { size: number };

const allEvidenceBatchAnswersAreReady = (
  batches: readonly Pick<LookupEvidenceBatch, "answer" | "status">[]
): boolean =>
  batches.every(({ answer, status }) => status === "ready" && answer !== null);

const splitEvidenceBatchPlan = <Batch extends EvidenceBatchPlanEntry>(
  batches: readonly Batch[],
  batchIndex: number
): Batch[] | null => {
  const batch = batches[batchIndex];

  if (batch === undefined || batch.size < 2) {
    return null;
  }

  const firstBatchSize = Math.floor(batch.size / 2);

  return [
    ...batches.slice(0, batchIndex),
    { ...batch, size: firstBatchSize },
    { ...batch, size: batch.size - firstBatchSize },
    ...batches.slice(batchIndex + 1),
  ];
};

const splitEvidenceBatchProjections = <
  Batch extends EvidenceBatchPlanEntry,
  Projection,
>(input: {
  batchIndex: number;
  batchPlan: Batch[] | null;
  projectBatchPlan: (plan: Batch[]) => Projection[] | null;
}): Projection[] | null => {
  if (input.batchPlan === null) {
    return null;
  }

  const splitPlan = splitEvidenceBatchPlan(input.batchPlan, input.batchIndex);

  if (splitPlan === null) {
    return null;
  }

  return input.projectBatchPlan(splitPlan);
};

const evidenceBatchReferenceCount = (
  projectionJson: string,
  referenceKey: string
): number => {
  let value: unknown;

  try {
    value = JSON.parse(projectionJson);
  } catch {
    return 0;
  }

  const parsed = z
    .looseObject({ batch: z.record(z.string(), z.unknown()) })
    .safeParse(value);

  if (!parsed.success) {
    return 0;
  }

  const references = z
    .array(z.string())
    .safeParse(parsed.data.batch[referenceKey]);

  return references.success ? references.data.length : 0;
};

export {
  allEvidenceBatchAnswersAreReady,
  evidenceBatchReferenceCount,
  splitEvidenceBatchPlan,
  splitEvidenceBatchProjections,
};
