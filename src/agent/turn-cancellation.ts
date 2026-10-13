export class RecruitmentTurnCancelledError extends Error {
  constructor() {
    super("本轮球探调查已停止。");
    this.name = "RecruitmentTurnCancelledError";
  }
}
