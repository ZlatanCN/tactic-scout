import type { PlayerIdentityAnswer, PositionSelectionAnswer, SelectablePosition } from "../../src/domain/schemas";
export interface PendingTurnRequest {
  requestId: string;
  caseId: string;
  message: string;
  positionAnswer?: PositionSelectionAnswer;
  playerIdentityAnswer?: PlayerIdentityAnswer;
  positionUpdate?: SelectablePosition[];
  expectsExistingState: boolean;
  isReanalysis: boolean;
  outcomeUnknown: boolean;
  displayText: string;
  displayTeamContext?: string;
}

export interface RequestedTurn {
  caseId: string;
  message: string;
  positionAnswer?: PositionSelectionAnswer;
  playerIdentityAnswer?: PlayerIdentityAnswer;
  positionUpdate?: SelectablePosition[];
  expectsExistingState: boolean;
  isReanalysis: boolean;
  displayText: string;
  displayTeamContext?: string;
}

export function isTurnUnresolved(loading: boolean, pending: PendingTurnRequest | null): boolean {
  return loading || pending?.outcomeUnknown === true;
}

export function resolveTurnRequest(input: {
  requested: RequestedTurn;
  pending: PendingTurnRequest | null;
  createRequestId: () => string;
}): { request: PendingTurnRequest | null; blockedByUnknownOutcome: boolean } {
  const { requested, pending } = input;
  if (pending?.outcomeUnknown) {
    const isSameTurn = pending.message === requested.message
      && JSON.stringify(pending.positionAnswer) === JSON.stringify(requested.positionAnswer)
      && JSON.stringify(pending.playerIdentityAnswer) === JSON.stringify(requested.playerIdentityAnswer)
      && JSON.stringify(pending.positionUpdate) === JSON.stringify(requested.positionUpdate)
      && pending.expectsExistingState === requested.expectsExistingState
      && pending.isReanalysis === requested.isReanalysis;
    return isSameTurn
      ? { request: { ...pending, outcomeUnknown: false }, blockedByUnknownOutcome: false }
      : { request: null, blockedByUnknownOutcome: true };
  }

  return {
    request: {
      ...requested,
      requestId: input.createRequestId(),
      outcomeUnknown: false,
    },
    blockedByUnknownOutcome: false,
  };
}
