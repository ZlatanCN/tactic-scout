import { type PlayerIdentityAnswer, type PositionSelectionAnswer, type SelectablePosition } from "../../../../../src/domain/position-contracts.js";
import { ConversationTurnResponseSchema, RecruitmentProgressSchema, RecruitmentTurnCancellationResponseSchema, type ConversationTurnResponse, type RecruitmentCandidatePreview, type RecruitmentProgress, type RecruitmentTurnCancellationResponse } from "../../../../../src/domain/conversation.js";
import { DatasetStatusSchema, type DatasetStatus } from "../../../../../src/domain/datasets.js";
import { readRecruitmentEventStream } from "./recruitment-sse";
import {
  ApiServiceUnavailableError,
  parseApiContract,
  readApiError,
  readApiResponse,
} from "./api-contract";
export { ApiServiceUnavailableError } from "./api-contract";
import {
  PlayerObservationInputSchema,
  PlayerObservationListSchema,
  PlayerObservationSchema,
  type PlayerObservation,
  type PlayerObservationInput,
} from "../../../../../src/observations/schemas.js";

export async function getDatasetStatus(): Promise<DatasetStatus> {
  const response = await fetch("/api/v1/dataset");
  if (response.status >= 500) {
    let health: Response;
    try {
      health = await fetch("/health");
    } catch (cause) {
      throw new ApiServiceUnavailableError(cause);
    }
    if (!health.ok) throw new ApiServiceUnavailableError();
    const healthBody: unknown = await health.json().catch(() => null);
    if (!healthBody || typeof healthBody !== "object"
      || !("service" in healthBody) || healthBody.service !== "tactiscout-api"
      || !("status" in healthBody) || healthBody.status !== "ok") {
      throw new ApiServiceUnavailableError();
    }
  }
  return parseApiContract(DatasetStatusSchema, await readApiResponse(response));
}

export async function turnRecruitmentCase(caseId: string, message: string, expectsExistingState = false, requestId?: string, positionAnswer?: PositionSelectionAnswer, positionUpdate?: SelectablePosition[], playerIdentityAnswer?: PlayerIdentityAnswer): Promise<ConversationTurnResponse> {
  const response = await fetch(`/api/v1/recruitment/cases/${encodeURIComponent(caseId)}/turns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...(requestId ? { requestId } : {}), message, expectsExistingState, ...(positionAnswer ? { positionAnswer } : {}), ...(positionUpdate ? { positionUpdate } : {}), ...(playerIdentityAnswer ? { playerIdentityAnswer } : {}) }),
  });
  return parseApiContract(ConversationTurnResponseSchema, await readApiResponse(response));
}

export async function turnRecruitmentCaseStream(
  caseId: string,
  message: string,
  expectsExistingState = false,
  requestId?: string,
  positionAnswer?: PositionSelectionAnswer,
  positionUpdate?: SelectablePosition[],
  playerIdentityAnswer?: PlayerIdentityAnswer,
  options: {
    onProgress: (progress: RecruitmentProgress) => void;
    onCandidates?: (candidates: RecruitmentCandidatePreview[], completedSteps: number) => void;
    onHeaders?: () => void;
    signal?: AbortSignal;
  } = { onProgress: () => undefined },
): Promise<ConversationTurnResponse> {
  const response = await fetch(`/api/v1/recruitment/cases/${encodeURIComponent(caseId)}/turns/stream`, {
    method: "POST",
    headers: {
      accept: "text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({ ...(requestId ? { requestId } : {}), message, expectsExistingState, ...(positionAnswer ? { positionAnswer } : {}), ...(positionUpdate ? { positionUpdate } : {}), ...(playerIdentityAnswer ? { playerIdentityAnswer } : {}) }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (response.ok && response.body) options.onHeaders?.();
  return readRecruitmentEventStream(response, { onProgress: options.onProgress, ...(options.onCandidates ? { onCandidates: options.onCandidates } : {}) });
}

export async function getRecruitmentProgress(caseId: string, requestId?: string): Promise<RecruitmentProgress> {
  const requestQuery = requestId ? `?requestId=${encodeURIComponent(requestId)}` : "";
  const response = await fetch(`/api/v1/recruitment/cases/${encodeURIComponent(caseId)}/progress${requestQuery}`);
  return parseApiContract(RecruitmentProgressSchema, await readApiResponse(response));
}

export async function cancelRecruitmentTurn(caseId: string, requestId: string): Promise<RecruitmentTurnCancellationResponse> {
  const response = await fetch(`/api/v1/recruitment/cases/${encodeURIComponent(caseId)}/turns/${encodeURIComponent(requestId)}/cancel`, {
    method: "POST",
  });
  return parseApiContract(RecruitmentTurnCancellationResponseSchema, await readApiResponse(response));
}

export async function getPlayerObservations(): Promise<PlayerObservation[]> {
  const response = await fetch("/api/v1/player-observations");
  return parseApiContract(PlayerObservationListSchema, await readApiResponse(response), "球探观察");
}

export async function savePlayerObservation(id: string | null, input: PlayerObservationInput): Promise<PlayerObservation> {
  const parsedInput = PlayerObservationInputSchema.parse(input);
  const response = await fetch(id === null
    ? "/api/v1/player-observations"
    : `/api/v1/player-observations/${encodeURIComponent(id)}`, {
    method: id === null ? "POST" : "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(parsedInput),
  });
  return parseApiContract(PlayerObservationSchema, await readApiResponse(response), "球探观察");
}

export async function deletePlayerObservation(id: string): Promise<void> {
  const response = await fetch(`/api/v1/player-observations/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await readApiError(response));
}
