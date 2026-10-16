import {
  StreamChannel,
  type StreamTransformer,
} from "@langchain/langgraph";
import { RecruitmentTurnCancelledError } from "./turn-cancellation.js";
import {
  ConversationTurnResponseSchema,
  RecruitmentGraphProgressUpdateSchema,
  type ConversationTurnResponse,
  type RecruitmentGraphProgressUpdate,
  type RecruitmentProgress,
  type RecruitmentProgressEventStatus,
  type RecruitmentReport,
} from "../domain/schemas.js";

export type RecruitmentTurnProgress = Pick<RecruitmentProgress, "stage" | "message" | "completedSteps"> & {
  status: RecruitmentProgressEventStatus;
};

export type RecruitmentTurnInput = {
  threadId: string;
  message: string;
  expectsExistingState?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: RecruitmentTurnProgress) => void;
};

export interface RecruitmentTurnState {
  pendingQuestion: { question: string; reason: string } | null;
  responseMessage: string;
  report: RecruitmentReport | null;
}

export interface RecruitmentTurnCheckpoint {
  values: RecruitmentTurnState | undefined;
  tasks: Array<{ interrupts: unknown[] }>;
}

export interface RecruitmentTurnGraphRun {
  extensions: { recruitmentProgress: AsyncIterable<RecruitmentGraphProgressUpdate> };
  output: Promise<unknown>;
}

export interface RecruitmentTurnGraph {
  getCheckpoint(threadId: string): Promise<RecruitmentTurnCheckpoint>;
  run(input: { threadId: string; message: string; resume: boolean; signal?: AbortSignal }): Promise<RecruitmentTurnGraphRun>;
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
  return {
    init: () => ({ recruitmentProgress: progress }),
    process(event) {
      if (event.method === "custom") {
        const customPayload = typeof event.params.data === "object"
          && event.params.data !== null
          && "payload" in event.params.data
          ? event.params.data.payload
          : event.params.data;
        const parsed = RecruitmentGraphProgressUpdateSchema.safeParse(customPayload);
        if (parsed.success) progress.push(parsed.data);
      }
      return true;
    },
  } satisfies StreamTransformer<{ recruitmentProgress: StreamChannel<RecruitmentGraphProgressUpdate> }>;
};

/**
 * Owns the application-facing lifecycle for one LangGraph thread turn.
 * The injected graph adapter keeps the compiled graph and its checkpoint state
 * authoritative while this module handles serialization, resume selection,
 * progress projection, and the public response.
 */
export function createRecruitmentTurnRuntime(input: {
  graph: RecruitmentTurnGraph;
  assertTurnAllowed: () => void;
  createExpiredStateError: () => Error;
}): (turn: RecruitmentTurnInput) => Promise<ConversationTurnResponse> {
  return async ({ threadId, message, expectsExistingState = false, signal, onProgress }) => {
    if (signal?.aborted) throw new RecruitmentTurnCancelledError();
    input.assertTurnAllowed();
    return withThreadTurnLock(threadId, signal, async () => {
      if (signal?.aborted) throw new RecruitmentTurnCancelledError();
      const before = await input.graph.getCheckpoint(threadId);
      if (signal?.aborted) throw new RecruitmentTurnCancelledError();
      const isWaitingForAnswer = before.tasks.some((task) => task.interrupts.length > 0);
      const hasCheckpoint = Boolean(before.values && Object.keys(before.values).length > 0);
      if (expectsExistingState && !hasCheckpoint) {
        throw input.createExpiredStateError();
      }

      let lastCompletedSteps = 0;
      const publishProgress = (progress: RecruitmentTurnProgress) => {
        lastCompletedSteps = progress.completedSteps;
        onProgress?.(progress);
      };
      const streamProgress = async (graphStream: RecruitmentTurnGraphRun) => {
        const progressDrain = (async () => {
          for await (const update of graphStream.extensions.recruitmentProgress) {
            const { type: _type, ...progress } = update;
            publishProgress(progress);
          }
        })();
        const [outputResult, progressResult] = await Promise.allSettled([graphStream.output, progressDrain]);
        if (outputResult.status === "rejected") throw outputResult.reason;
        if (progressResult.status === "rejected") throw progressResult.reason;
      };

      try {
        const graphStream = await input.graph.run({
          threadId,
          message,
          resume: isWaitingForAnswer,
          ...(signal ? { signal } : {}),
        });
        await streamProgress(graphStream);
        const after = await input.graph.getCheckpoint(threadId);
        const state = after.values;
        if (!state) throw new Error("LangGraph completed without a recruitment state checkpoint.");
        const interrupted = after.tasks.find((task) => task.interrupts.length > 0)?.interrupts[0];
        if (interrupted && state.pendingQuestion) {
          const response = ConversationTurnResponseSchema.parse({
            threadId,
            status: "needs_input",
            message: state.pendingQuestion.question,
            question: { reason: state.pendingQuestion.reason },
            report: null,
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
          status: "completed",
          message: state.responseMessage || "调查已完成。",
          question: null,
          report: state.report,
        });
        publishProgress({
          stage: "completed",
          status: "completed",
          message: "调查完成，报告已生成",
          completedSteps: lastCompletedSteps,
        });
        return response;
      } catch (error) {
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
