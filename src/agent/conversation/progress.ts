import { type LangGraphRunnableConfig, getWriter } from "@langchain/langgraph";
import { type RecruitmentProgress, type RecruitmentProgressEventStatus } from "../../domain/schemas.js";

export type ProgressUpdate = Pick<RecruitmentProgress, "stage" | "message" | "completedSteps"> & { status: RecruitmentProgressEventStatus };

type ProgressUpdateInput = Omit<ProgressUpdate, "status"> & { status?: RecruitmentProgressEventStatus };

export function emitProgress(config: LangGraphRunnableConfig, progress: ProgressUpdateInput): void {
  getWriter(config)?.({ type: "tactiscout/recruitment-progress", status: "started", ...progress });
}
