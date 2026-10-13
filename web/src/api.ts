import {
  DatasetStatusSchema,
  ConversationTurnResponseSchema,
  RecruitmentProgressSchema,
  RecruitmentTurnCancellationResponseSchema,
  type DatasetStatus,
  type ConversationTurnResponse,
  type RecruitmentProgress,
  type RecruitmentTurnCancellationResponse,
} from "../../src/domain/schemas.js";
import {
  PlayerObservationInputSchema,
  PlayerObservationListSchema,
  PlayerObservationSchema,
  type PlayerObservation,
  type PlayerObservationInput,
} from "../../src/observations/schemas.js";

async function readError(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  return `Request failed (${response.status})`;
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(await readError(response));
  try {
    return await response.json() as unknown;
  } catch (error) {
    throw new Error("服务端返回的 JSON 无法读取。", { cause: error });
  }
}

export class ApiContractError extends Error {
  constructor(subject: string, cause: unknown) {
    super(`服务端返回的数据格式不符合当前${subject}契约。`, { cause });
    this.name = "ApiContractError";
  }
}

export class ApiServiceUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("本地球探服务没有正常响应。", { cause });
    this.name = "ApiServiceUnavailableError";
  }
}

function parseContract<T>(schema: { parse: (data: unknown) => T }, value: unknown, subject = "招募"): T {
  try {
    return schema.parse(value);
  } catch (error) {
    throw new ApiContractError(subject, error);
  }
}

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
  return parseContract(DatasetStatusSchema, await readResponse(response));
}

export async function turnRecruitmentCase(caseId: string, message: string, expectsExistingState = false, requestId?: string): Promise<ConversationTurnResponse> {
  const response = await fetch(`/api/v1/recruitment/cases/${encodeURIComponent(caseId)}/turns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...(requestId ? { requestId } : {}), message, expectsExistingState }),
  });
  return parseContract(ConversationTurnResponseSchema, await readResponse(response));
}

export async function getRecruitmentProgress(caseId: string, requestId?: string): Promise<RecruitmentProgress> {
  const requestQuery = requestId ? `?requestId=${encodeURIComponent(requestId)}` : "";
  const response = await fetch(`/api/v1/recruitment/cases/${encodeURIComponent(caseId)}/progress${requestQuery}`);
  return parseContract(RecruitmentProgressSchema, await readResponse(response));
}

export async function cancelRecruitmentTurn(caseId: string, requestId: string): Promise<RecruitmentTurnCancellationResponse> {
  const response = await fetch(`/api/v1/recruitment/cases/${encodeURIComponent(caseId)}/turns/${encodeURIComponent(requestId)}/cancel`, {
    method: "POST",
  });
  return parseContract(RecruitmentTurnCancellationResponseSchema, await readResponse(response));
}

export async function getPlayerObservations(): Promise<PlayerObservation[]> {
  const response = await fetch("/api/v1/player-observations");
  return parseContract(PlayerObservationListSchema, await readResponse(response), "球探观察");
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
  return parseContract(PlayerObservationSchema, await readResponse(response), "球探观察");
}

export async function deletePlayerObservation(id: string): Promise<void> {
  const response = await fetch(`/api/v1/player-observations/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await readError(response));
}
