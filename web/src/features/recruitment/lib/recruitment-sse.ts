import {
  ConversationTurnResponseSchema,
  RecruitmentSseEventSchema,
  type ConversationTurnResponse,
  type RecruitmentCandidatePreview,
  type RecruitmentProgress,
} from "../../../../../src/domain/conversation.js";
import {
  ApiContractError,
  ApiHttpError,
  ApiStreamError,
  parseApiContract,
  readApiError,
} from "./api-contract";

const incompatibleStreamStatuses = new Set([404, 405, 415, 501]);

/**
 * A stream response is safe to replay as JSON only when it was rejected before
 * the server could execute the turn. Once a stream has started, retrying would
 * turn a display failure into a duplicate business request.
 */
export function shouldFallbackRecruitmentStreamToJson(
  error: unknown,
  options: { started?: boolean } = {},
): boolean {
  if (options.started) return false;
  return (error instanceof ApiHttpError && incompatibleStreamStatuses.has(error.statusCode))
    || (error instanceof ApiStreamError && error.kind === "missing_body");
}

/** Parses one POST Server-Sent Events response and validates every application event. */
export async function readRecruitmentEventStream(
  response: Response,
  options: {
    onProgress: (progress: RecruitmentProgress) => void;
    onCandidates?: (candidates: RecruitmentCandidatePreview[], completedSteps: number) => void;
  },
): Promise<ConversationTurnResponse> {
  if (!response.ok) {
    throw new ApiHttpError(response.status, await readApiError(response));
  }
  if (!response.body) throw new ApiStreamError("流式调查连接没有响应内容。", "missing_body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: ConversationTurnResponse | undefined;

  const consumeBlock = (block: string): void => {
    const lines = block.split(/\r?\n/);
    const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
    const data = lines.filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!eventName || !data) return;
    let payload: unknown;
    try {
      payload = JSON.parse(data) as unknown;
    } catch (error) {
      throw new ApiContractError("流式调查", error);
    }
    const event = parseApiContract(RecruitmentSseEventSchema, payload, "流式调查");
    if (event.type === "progress") {
      options.onProgress(event.progress);
    } else if (event.type === "candidates") {
      options.onCandidates?.(event.candidates, event.completedSteps);
    } else if (event.type === "result") {
      if (completed) throw new ApiContractError("流式调查", new Error("收到重复的最终结果。"));
      completed = parseApiContract(ConversationTurnResponseSchema, event.response, "流式调查");
    } else {
      throw new ApiHttpError(event.statusCode, event.message);
    }
  };

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let boundary = buffer.search(/\r?\n\r?\n/);
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? "\n\n";
      buffer = buffer.slice(boundary + separator.length);
      if (block.trim()) consumeBlock(block);
      boundary = buffer.search(/\r?\n\r?\n/);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeBlock(buffer);
  if (!completed) throw new ApiStreamError("流式调查连接提前结束，本轮结果尚未确认。", "interrupted");
  return completed;
}
