export const minimumMinutesForPercentileComparison = 900;

export type PercentileUnavailableReason = "candidate_low_sample" | "candidate_sample_unknown" | "insufficient_peer_group";

export function getPeerPercentileUnavailableReason(input: {
  minutes: number | null;
  recordedReason?: PercentileUnavailableReason;
}): PercentileUnavailableReason | undefined {
  if (input.minutes === null || !Number.isFinite(input.minutes) || input.recordedReason === "candidate_sample_unknown") {
    return "candidate_sample_unknown";
  }
  if (input.minutes < minimumMinutesForPercentileComparison || input.recordedReason === "candidate_low_sample") {
    return "candidate_low_sample";
  }
  return input.recordedReason;
}

export interface MetricSample {
  value: number;
  minutes: number | null;
}

export interface PeerPercentileResult {
  peerPercentile: number | null;
  peerGroupSize: number;
  peerPercentileUnavailableReason?: PercentileUnavailableReason;
}

/**
 * Compare per-90 values only when the candidate and reference samples meet the
 * project's existing 900-minute reporting boundary. This does not filter
 * candidates from discovery or hide their observed value.
 */
export function comparePeerPercentile(
  value: number,
  candidateMinutes: number | null,
  peerSamples: readonly MetricSample[],
): PeerPercentileResult {
  const eligiblePeerValues = peerSamples
    .filter((sample) => Number.isFinite(sample.value)
      && typeof sample.minutes === "number"
      && Number.isFinite(sample.minutes)
      && sample.minutes >= minimumMinutesForPercentileComparison)
    .map((sample) => sample.value);

  const candidateReason = getPeerPercentileUnavailableReason({ minutes: candidateMinutes });
  if (candidateReason === "candidate_sample_unknown") {
    return {
      peerPercentile: null,
      peerGroupSize: eligiblePeerValues.length,
      peerPercentileUnavailableReason: candidateReason,
    };
  }
  if (candidateReason === "candidate_low_sample") {
    return {
      peerPercentile: null,
      peerGroupSize: eligiblePeerValues.length,
      peerPercentileUnavailableReason: candidateReason,
    };
  }
  if (eligiblePeerValues.length < 5) {
    return {
      peerPercentile: null,
      peerGroupSize: eligiblePeerValues.length,
      peerPercentileUnavailableReason: "insufficient_peer_group",
    };
  }
  return {
    peerPercentile: Math.round(eligiblePeerValues.filter((peerValue) => peerValue <= value).length / eligiblePeerValues.length * 100),
    peerGroupSize: eligiblePeerValues.length,
  };
}
