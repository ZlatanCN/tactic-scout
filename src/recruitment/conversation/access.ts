import { type PlayerRepository } from "../../players/repository.js";
import { isLoopbackModelEndpoint } from "../chat-model.js";
import { RecruitmentModelUnavailableError } from "../recruitment-planner.js";

export function assertRepositoryModelProcessingAllowed(repository: PlayerRepository): void {
  if (repository.mode === "premier_league") {
    throw new RecruitmentModelUnavailableError(
      "Premier League Pulselive 数据在取得书面批准前不能自动抓取、建库或交给 Agent 处理；请切换到已确认适用的数据源。",
    );
  }
  if (repository.mode === "fpl") {
    throw new RecruitmentModelUnavailableError(
      "FPL 仅保留历史实验和离线测试；官方条款不允许本项目发起新的自动访问与数据提取，因此不能用于招募 Agent。",
    );
  }
  if (repository.mode === "fbref") {
    throw new RecruitmentModelUnavailableError(
      "FBref 数据在取得 Sports Reference 许可前不可交给 Agent 或模型处理；请切换到其他数据源。非商业使用不构成来源许可。",
    );
  }
  if (repository.mode === "understat" || repository.mode === "asa" || repository.mode === "mosaic") {
    if (isLoopbackModelEndpoint(process.env.OPENAI_BASE_URL)) return;
    throw new RecruitmentModelUnavailableError(
      `${repository.sourceName} 的来源处理权限尚未核实，因此只允许交给配置在本机回环地址的模型处理。请将 OPENAI_BASE_URL 配置为本机 Ollama 等回环地址；本机处理限制不代表已获得来源授权。`,
    );
  }
  if (repository.mode !== "statsbomb") return;
  if (process.env.TACTISCOUT_STATSBOMB_AI_PROCESSING_ALLOWED === "true" && isLoopbackModelEndpoint(process.env.OPENAI_BASE_URL)) return;
  throw new RecruitmentModelUnavailableError(
    "StatsBomb 数据仅在审阅使用协议、明确开启本机处理，并将 OPENAI_BASE_URL 配置为本机 Ollama 等回环地址后，才可交给 Agent 处理。",
  );
}
