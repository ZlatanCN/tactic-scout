export class RecruitmentTurnCancelledError extends Error {
  constructor() {
    super("本轮球探调查已停止。");
    this.name = "RecruitmentTurnCancelledError";
  }
}

export function throwIfTurnCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new RecruitmentTurnCancelledError();
  }
}
