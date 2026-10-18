import { type LangGraphRunnableConfig, getWriter } from "@langchain/langgraph";
import { type RecruitmentCandidatePreview, type RecruitmentProgress, type RecruitmentProgressEventStatus } from "../../domain/conversation.js";

export type ProgressUpdate = Pick<RecruitmentProgress, "stage" | "message" | "completedSteps"> & { status: RecruitmentProgressEventStatus };

type ProgressUpdateInput = Omit<ProgressUpdate, "status"> & { status?: RecruitmentProgressEventStatus };

export function emitProgress(config: LangGraphRunnableConfig, progress: ProgressUpdateInput): void {
  getWriter(config)?.({ type: "tactiscout/recruitment-progress", status: "started", ...progress });
}

export function emitCandidatePreviews(config: LangGraphRunnableConfig, candidates: RecruitmentCandidatePreview[], completedSteps: number): void {
  if (candidates.length) getWriter(config)?.({ type: "tactiscout/recruitment-candidates", candidates, completedSteps });
}
