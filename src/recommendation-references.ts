import { selectedReferenceCandidate } from "./player-data/contracts.js";
import type {
  ConversationPlayerReference,
  RequestPlayerState,
} from "./state.js";

const conversationReferenceFromPlayer = (
  player: RequestPlayerState
): ConversationPlayerReference | null => {
  const candidate = selectedReferenceCandidate(player.resolution);

  return candidate === null
    ? null
    : {
        candidate,
        referenceId: candidate.canonicalIdentityId ?? candidate.candidateId,
      };
};

export { conversationReferenceFromPlayer };
