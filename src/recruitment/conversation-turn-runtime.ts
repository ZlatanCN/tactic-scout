import {
  StreamChannel,
  isGraphDrained,
  type StreamTransformer,
} from "@langchain/langgraph";
import { RecruitmentTurnCancelledError } from "./turn-cancellation.js";
import { ConversationTurnResponseSchema, RecruitmentGraphCandidatesUpdateSchema, RecruitmentGraphProgressUpdateSchema, type ConversationTurnResponse, type RecruitmentGraphCandidatesUpdate, type RecruitmentGraphProgressUpdate, type RecruitmentProgress, type RecruitmentProgressEventStatus } from "../domain/conversation.js";
import { PlayerIdentityAnswerSchema, PositionSelectionAnswerSchema, type PlayerIdentityAnswer, type PositionSelectionAnswer, type SelectablePosition, type PositionSelectionQuestion, type PlayerIdentityQuestion } from "../domain/position-contracts.js";
import { type KnowledgeAnswer, type RecruitmentReport } from "../domain/reports.js";

export type RecruitmentTurnProgress = Pick<RecruitmentProgress, "stage" | "message" | "completedSteps"> & {
  status: RecruitmentProgressEventStatus;
};

export type RecruitmentTurnCandidates = Omit<RecruitmentGraphCandidatesUpdate, "type">;

export type RecruitmentTurnInput = {
  threadId: string;
  message: string;
  positionAnswer?: PositionSelectionAnswer;
  playerIdentityAnswer?: PlayerIdentityAnswer;
  positionUpdate?: SelectablePosition[];
  expectsExistingState?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: RecruitmentTurnProgress) => void;
  runtimeContext?: Partial<import("./conversation/runtime-context.js").RecruitmentRuntimeContext>;
  runControl?: import("@langchain/langgraph").RunControl;
};

export interface RecruitmentTurnState {
  retryMessage?: string;
  brief?: import("../domain/recruitment-brief.js").RecruitmentBrief | null;
  pendingQuestion: { question: string; reason: string; input?: PositionSelectionQuestion | PlayerIdentityQuestion } | null;
  responseMessage: string;
  report: RecruitmentReport | null;
  knowledgeAnswer?: KnowledgeAnswer | null;
  runtimeFailure?: import("./conversation/node-policies.js").RecruitmentRuntimeFailure | null;
}

export interface RecruitmentTurnCheckpoint {
  values: RecruitmentTurnState | undefined;
  tasks: Array<{ interrupts: unknown[] }>;
  next?: string[];
}

export interface RecruitmentTurnGraphRun {
  extensions: {
    recruitmentProgress: AsyncIterable<RecruitmentGraphProgressUpdate>;
    recruitmentCandidates?: AsyncIterable<RecruitmentGraphCandidatesUpdate>;
  };
  output: Promise<unknown>;
}

export interface RecruitmentTurnRuntimeEvents {
  onCandidates?: (candidates: RecruitmentTurnCandidates) => void;
}

export interface RecruitmentTurnGraph {
  getCheckpoint(threadId: string): Promise<RecruitmentTurnCheckpoint>;
  run(input: { threadId: string; message: string; positionAnswer?: PositionSelectionAnswer; playerIdentityAnswer?: PlayerIdentityAnswer; positionUpdate?: SelectablePosition[]; resume: boolean; resumeCheckpoint?: boolean; signal?: AbortSignal; runControl?: import("@langchain/langgraph").RunControl; context?: Partial<import("./conversation/runtime-context.js").RecruitmentRuntimeContext> }): Promise<RecruitmentTurnGraphRun>;
}

export class RecruitmentServiceDrainingError extends Error {
  constructor() {
    super("服务正在安全停止；本轮状态已写入 checkpoint，服务重启后可继续。用户主动停止仍会立即取消当前工作。");
    this.name = "RecruitmentServiceDrainingError";
  }
}

export class RecruitmentGraphNodeFailureError extends Error {
  readonly category: import("./conversation/node-policies.js").RecruitmentFailureCategory;

  constructor(failure: import("./conversation/node-policies.js").RecruitmentRuntimeFailure) {
    const phase = failure.node === "understand_request" ? "需求理解"
      : failure.node === "plan_decision" ? "调查规划"
        : failure.node === "execute_tool" ? "数据查询"
          : "证据复核";
    super(failure.category === "timeout"
      ? `${phase}超过运行时限，本轮未生成新报告；案件状态已保留，可以稍后重试。`
      : failure.category === "unavailable"
        ? `${phase}所需的模型或数据服务暂时不可用，有限自动重试已结束；本轮未生成新报告，案件状态已保留，可以稍后重试。`
        : `${phase}遇到运行时故障，本轮未生成新报告；案件状态已保留，可以稍后重试。`);
    this.name = "RecruitmentGraphNodeFailureError";
    this.category = failure.category;
  }
}

const threadTurnTails = new Map<string, Promise<void>>();

async function withThreadTurnLock<T>(threadId: string, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
  const previous = threadTurnTails.get(threadId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => gate);
  threadTurnTails.set(threadId, tail);
  let acquired = false;
  try {
    if (signal) {
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(new RecruitmentTurnCancelledError());
          return;
        }
        const abort = () => reject(new RecruitmentTurnCancelledError());
        signal.addEventListener("abort", abort, { once: true });
        void previous.then(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        });
      });
    } else {
      await previous;
    }
    acquired = true;
    return await operation();
  } finally {
    const unlock = () => {
      release();
      if (threadTurnTails.get(threadId) === tail) threadTurnTails.delete(threadId);
    };
    if (acquired) unlock();
    else void previous.then(unlock);
  }
}

export const recruitmentProgressTransformer = () => {
  const progress = StreamChannel.local<RecruitmentGraphProgressUpdate>();
  const candidates = StreamChannel.local<RecruitmentGraphCandidatesUpdate>();
  return {
    init: () => ({ recruitmentProgress: progress, recruitmentCandidates: candidates }),
    process(event) {
      if (event.method === "custom") {
        const customPayload = typeof event.params.data === "object"
          && event.params.data !== null
          && "payload" in event.params.data
          ? event.params.data.payload
          : event.params.data;
        const parsed = RecruitmentGraphProgressUpdateSchema.safeParse(customPayload);
        if (parsed.success) progress.push(parsed.data);
        const parsedCandidates = RecruitmentGraphCandidatesUpdateSchema.safeParse(customPayload);
        if (parsedCandidates.success) candidates.push(parsedCandidates.data);
      }
      return true;
    },
  } satisfies StreamTransformer<{
    recruitmentProgress: StreamChannel<RecruitmentGraphProgressUpdate>;
    recruitmentCandidates: StreamChannel<RecruitmentGraphCandidatesUpdate>;
  }>;
};

/**
 * Owns the application-facing lifecycle for one LangGraph thread turn.
 * The injected graph adapter keeps the compiled graph and its checkpoint state
 * authoritative while this module handles serialization, resume selection,
 * progress projection, and the public response.
 */
export function createRecruitmentTurnRuntime(input: {
  graph: RecruitmentTurnGraph;
  assertTurnAllowed: (context: Partial<import("./conversation/runtime-context.js").RecruitmentRuntimeContext> | undefined) => void;
  createExpiredStateError: () => Error;
}): (turn: RecruitmentTurnInput) => Promise<ConversationTurnResponse> {
  return async ({ threadId, message, positionAnswer, playerIdentityAnswer, positionUpdate, expectsExistingState = false, signal, runControl, onProgress, onCandidates, runtimeContext }: RecruitmentTurnInput & RecruitmentTurnRuntimeEvents) => {
    if (signal?.aborted) throw new RecruitmentTurnCancelledError();
    if ((positionAnswer && !PositionSelectionAnswerSchema.safeParse(positionAnswer).success)
      || (playerIdentityAnswer && !PlayerIdentityAnswerSchema.safeParse(playerIdentityAnswer).success)
      || (positionUpdate && !PositionSelectionAnswerSchema.shape.positions.safeParse(positionUpdate).success)
      || (positionAnswer && positionUpdate)
      || ((positionAnswer || positionUpdate) && playerIdentityAnswer)) throw new RecruitmentPositionAnswerError("选择无效，请重新选择后确认。");
    input.assertTurnAllowed(runtimeContext);
    return withThreadTurnLock(threadId, signal, async () => {
      if (signal?.aborted) throw new RecruitmentTurnCancelledError();
      const before = await input.graph.getCheckpoint(threadId);
      if (signal?.aborted) throw new RecruitmentTurnCancelledError();
      const isWaitingForAnswer = before.tasks.some((task) => task.interrupts.length > 0);
      const resumeCheckpoint = !isWaitingForAnswer && Boolean(before.next?.length);
      const hasCheckpoint = Boolean(before.values && Object.keys(before.values).length > 0);
      if (expectsExistingState && !hasCheckpoint) {
        throw input.createExpiredStateError();
      }

      if (positionAnswer && (!isWaitingForAnswer || before.values?.pendingQuestion?.input?.kind !== "positions" || before.values.pendingQuestion.input.questionId !== positionAnswer.questionId
        || (positionAnswer.keepCurrent && !before.values?.pendingQuestion?.input?.allowKeepCurrent))) {
        throw new RecruitmentPositionAnswerError();
      }

      if (playerIdentityAnswer) {
        const question = before.values?.pendingQuestion?.input;
        if (!isWaitingForAnswer || question?.kind !== "player_identity" || question.questionId !== playerIdentityAnswer.questionId
          || (!("rejectAll" in playerIdentityAnswer) && !question.candidates.some(candidate => candidate.entityId === playerIdentityAnswer.entityId))) {
          throw new RecruitmentPositionAnswerError("球员身份选项已更新，请重新选择。");
        }
      }

      if (positionUpdate && isWaitingForAnswer) throw new RecruitmentPositionAnswerError();

      let lastCompletedSteps = 0;
      const publishProgress = (progress: RecruitmentTurnProgress) => {
        lastCompletedSteps = progress.completedSteps;
        onProgress?.(progress);
      };
      const streamProgress = async (graphStream: RecruitmentTurnGraphRun) => {
        const progressDrain = (async () => {
          const drains: Promise<void>[] = [];
          if (graphStream.extensions.recruitmentProgress) {
            drains.push((async () => {
              for await (const update of graphStream.extensions.recruitmentProgress) {
                const { type: _type, ...progress } = update;
                publishProgress(progress);
              }
            })());
          }
          const candidateStream = graphStream.extensions.recruitmentCandidates;
          if (candidateStream) {
            drains.push((async () => {
              for await (const update of candidateStream) {
                onCandidates?.({ candidates: update.candidates, completedSteps: update.completedSteps });
              }
            })());
          }
          if (drains.length) await Promise.all(drains);
        })();
        const [outputResult, progressResult] = await Promise.allSettled([graphStream.output, progressDrain]);
        if (outputResult.status === "rejected") throw outputResult.reason;
        if (progressResult.status === "rejected") throw progressResult.reason;
      };

      try {
        const graphStream = await input.graph.run({
          threadId,
          message,
          ...(positionAnswer ? { positionAnswer } : {}),
          ...(playerIdentityAnswer ? { playerIdentityAnswer } : {}),
          ...(positionUpdate ? { positionUpdate } : {}),
          resume: isWaitingForAnswer,
          resumeCheckpoint,
          ...(signal ? { signal } : {}),
          ...(runControl ? { runControl } : {}),
          ...(runtimeContext ? { context: runtimeContext } : {}),
        });
        await streamProgress(graphStream);
        const after = await input.graph.getCheckpoint(threadId);
        const state = after.values;
        if (!state) throw new Error("LangGraph completed without a recruitment state checkpoint.");
        if (state.runtimeFailure) throw new RecruitmentGraphNodeFailureError(state.runtimeFailure);
        const interrupted = after.tasks.find((task) => task.interrupts.length > 0)?.interrupts[0];
        if (interrupted && state.pendingQuestion) {
          const response = ConversationTurnResponseSchema.parse({
            threadId,
            status: "needs_input",
            message: state.pendingQuestion.question,
            question: { reason: state.pendingQuestion.reason, ...(state.pendingQuestion.input ? { input: state.pendingQuestion.input } : {}) },
            report: null,
            brief: state.brief,
          });
          publishProgress({
            stage: "asking_user",
            status: "waiting_for_user",
            message: "Agent 已暂停调查，等你补充信息后继续",
            completedSteps: lastCompletedSteps,
          });
          return response;
        }
        const response = ConversationTurnResponseSchema.parse({
          threadId,
          status: state.retryMessage ? "failed" : "completed",
          message: state.responseMessage || "调查已完成。",
          question: null,
          report: state.report,
          ...(state.knowledgeAnswer ? { knowledgeAnswer: state.knowledgeAnswer } : {}),
          brief: state.brief,
          ...(state.retryMessage ? { retryMessage: state.retryMessage } : {}),
        });
        publishProgress({
          stage: state.retryMessage ? "failed" : "completed",
          status: state.retryMessage ? "failed" : "completed",
          message: state.retryMessage ? "需求理解未完成，原始输入已保留，可以重试" : state.report ? "调查完成，报告已生成" : "本轮对话已结束",
          completedSteps: lastCompletedSteps,
        });
        return response;
      } catch (error) {
        if (isGraphDrained(error)) {
          publishProgress({
            stage: "service_draining",
            status: "notice",
            message: "服务正在停止；案件已保存到 checkpoint，重启后可继续",
            completedSteps: lastCompletedSteps,
          });
          throw new RecruitmentServiceDrainingError();
        }
        if (signal?.aborted || error instanceof RecruitmentTurnCancelledError) {
          publishProgress({
            stage: "cancelled",
            status: "cancelled",
            message: "本轮已停止，没有生成新的报告",
            completedSteps: lastCompletedSteps,
          });
          throw new RecruitmentTurnCancelledError();
        }
        publishProgress({
          stage: "failed",
          status: "failed",
          message: "本轮调查未能完成，查看错误提示后可重试",
          completedSteps: lastCompletedSteps,
        });
        throw error;
      }
    });
  };
}

export class RecruitmentPositionAnswerError extends Error {
  constructor(message = "这个位置问题已经更新，请刷新当前调查后重新选择。") { super(message); this.name = "RecruitmentPositionAnswerError"; }
}
