import type {
  ActiveComparison,
  ConversationContext,
  ConversationPlayerReference,
  RequestConstraint,
  RequestPlayerState,
  RequestState,
} from "./state.js";

const seasonConstraintNamePattern = /season|赛季/iu;

const comparisonConstraintKey = (name: string): string =>
  seasonConstraintNamePattern.test(name)
    ? "season"
    : name.normalize("NFKC").trim().toLocaleLowerCase();

const mergeComparisonConstraints = (
  previous: RequestConstraint[],
  current: RequestConstraint[]
): RequestConstraint[] => {
  const constraints = new Map<string, RequestConstraint>();

  for (const constraint of [...previous, ...current]) {
    const key = comparisonConstraintKey(constraint.name);

    constraints.set(key, {
      name: key === "season" ? "season" : constraint.name,
      value: constraint.value,
    });
  }

  return [...constraints.values()];
};

const uniqueReferences = (
  references: ConversationPlayerReference[]
): ConversationPlayerReference[] => {
  const seen = new Set<string>();

  return references.filter((reference) => {
    if (seen.has(reference.referenceId)) {
      return false;
    }

    seen.add(reference.referenceId);

    return true;
  });
};

const activeComparisonContext = (
  context: ConversationContext
): ActiveComparison => ({
  constraints: mergeComparisonConstraints(
    [],
    context.activeComparison.constraints
  ),
  players: uniqueReferences(context.activeComparison.players),
});

const requestPlayerFromReference = (
  reference: ConversationPlayerReference
): RequestPlayerState => {
  const { candidate } = reference;

  return {
    attempts: 0,
    lookupName: null,
    mention: candidate.name,
    recommendationRole: "reference",
    referenceScope: "explicit",
    referenceTargetMention: null,
    resolution: {
      candidateCount: 1,
      candidates: [candidate],
      candidatesTruncated: false,
      canonicalIdentityId: candidate.canonicalIdentityId,
      clarificationMessage: null,
      mention: candidate.name,
      selectedCandidateId: candidate.candidateId,
      selectedName: candidate.name,
      status: "resolved",
    },
  };
};

const comparisonContextFromRequest = (
  request: RequestState
): ActiveComparison => ({
  constraints: mergeComparisonConstraints([], request.constraints),
  players: uniqueReferences(
    request.players.flatMap((player) => {
      const { resolution } = player;

      if (resolution?.status !== "resolved") {
        return [];
      }

      const candidate = resolution.candidates.find(
        (item) => item.candidateId === resolution.selectedCandidateId
      );

      return candidate === undefined
        ? []
        : [
            {
              candidate,
              referenceId:
                candidate.canonicalIdentityId ?? candidate.candidateId,
            },
          ];
    })
  ),
});

export {
  activeComparisonContext,
  comparisonContextFromRequest,
  mergeComparisonConstraints,
  requestPlayerFromReference,
};
