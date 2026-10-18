import { type PlayerIdentityAnswer, type PositionSelectionAnswer, type SelectablePosition } from "../domain/position-contracts.js";
import { RecruitmentTurnCancelledError } from "./turn-cancellation.js";
export { RecruitmentTurnCancelledError } from "./turn-cancellation.js";

type TurnInput = {
  caseId: string;
  requestId: string;
  message: string;
  positionAnswer?: PositionSelectionAnswer;
  playerIdentityAnswer?: PlayerIdentityAnswer;
  positionUpdate?: SelectablePosition[];
  expectsExistingState: boolean;
};

type TurnEntry<Response> = {
  fingerprint: string;
  promise: Promise<Response>;
  inFlightPromise: Promise<Response> | null;
  controller: AbortController;
  settledAt: number | null;
};

export class RecruitmentTurnIdConflictError extends Error {
  constructor() {
    super("本轮请求编号已用于另一条输入，请重新发送。");
    this.name = "RecruitmentTurnIdConflictError";
  }
}

export class RecruitmentTurnCapacityError extends Error {
  constructor() {
    super("当前同时进行的球探调查较多，请稍后重试。");
    this.name = "RecruitmentTurnCapacityError";
  }
}

/**
 * Shares an in-flight turn and caches its outcome for short transport retries.
 * A request ID identifies one outcome; a new ID starts a new attempt.
 */
export class RecruitmentTurnCoordinator<Response> {
  private readonly entries = new Map<string, TurnEntry<Response>>();

  constructor(
    private readonly options: { maxEntries?: number; retentionMs?: number } = {},
  ) {}

  run(
    input: TurnInput,
    execute: (signal: AbortSignal) => Promise<Response>,
    cacheProjection?: (response: Response) => Response,
  ): Promise<Response> {
    this.pruneExpired();
    const key = JSON.stringify([input.caseId, input.requestId]);
    const fingerprint = JSON.stringify({ message: input.positionAnswer || input.playerIdentityAnswer ? null : input.message,
      expectsExistingState: input.expectsExistingState,
      positionUpdate: input.positionUpdate ? [...input.positionUpdate].sort() : undefined,
      positionAnswer: input.positionAnswer ? { questionId: input.positionAnswer.questionId, keepCurrent: input.positionAnswer.keepCurrent ?? false, positions: [...input.positionAnswer.positions].sort() } : undefined,
      playerIdentityAnswer: input.playerIdentityAnswer ? ("rejectAll" in input.playerIdentityAnswer
        ? { questionId: input.playerIdentityAnswer.questionId, rejectAll: true }
        : { questionId: input.playerIdentityAnswer.questionId, entityId: input.playerIdentityAnswer.entityId }) : undefined });
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return Promise.reject(new RecruitmentTurnIdConflictError());
      return existing.inFlightPromise ?? existing.promise;
    }
    this.makeRoom();
    if (this.entries.size >= (this.options.maxEntries ?? 250)) return Promise.reject(new RecruitmentTurnCapacityError());

    const controller = new AbortController();
    const inFlightPromise = Promise.resolve().then(() => execute(controller.signal));
    const entry: TurnEntry<Response> = {
      fingerprint,
      promise: cacheProjection ? inFlightPromise.then(cacheProjection) : inFlightPromise,
      inFlightPromise,
      controller,
      settledAt: null,
    };
    this.entries.set(key, entry);
    void entry.promise.then(
      () => { entry.settledAt = Date.now(); entry.inFlightPromise = null; },
      () => { entry.settledAt = Date.now(); entry.inFlightPromise = null; },
    );
    return inFlightPromise;
  }

  cancel(caseId: string, requestId: string): "requested" | "not_found" | "already_settled" {
    const entry = this.entries.get(JSON.stringify([caseId, requestId]));
    if (!entry) return "not_found";
    if (entry.settledAt !== null) return "already_settled";
    if (!entry.controller.signal.aborted) entry.controller.abort(new RecruitmentTurnCancelledError());
    return "requested";
  }

  private pruneExpired(): void {
    const now = Date.now();
    const retentionMs = this.options.retentionMs ?? 30 * 60 * 1000;
    for (const [key, entry] of this.entries) {
      if (entry.settledAt !== null && now - entry.settledAt > retentionMs) this.entries.delete(key);
    }
  }

  private makeRoom(): void {
    const maxEntries = this.options.maxEntries ?? 250;
    while (this.entries.size >= maxEntries) {
      const oldestSettled = [...this.entries].find(([, entry]) => entry.settledAt !== null)?.[0];
      if (!oldestSettled) return;
      this.entries.delete(oldestSettled);
    }
  }
}
