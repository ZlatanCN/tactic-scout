import { z } from "zod/v4";
import { PositionSelectionAnswerSchema, RecruitmentReportSchema } from "../../src/domain/schemas";
import { ConversationMessageSchema } from "./plans";

const key = "tactiscout.active-recruitment-session.v1";
const schema = z.object({
  threadId: z.string().min(1),
  messages: z.array(ConversationMessageSchema),
  report: RecruitmentReportSchema.nullable(),
  reportAt: z.string().nullable(),
  status: z.enum(["ready", "needs_input", "completed"]),
  originalBrief: z.string(),
  planName: z.string(),
  activePlanId: z.string().nullable(),
  hasConversationState: z.boolean(),
  pendingTurnRequest: z.object({
    requestId: z.string().uuid(), caseId: z.string(), message: z.string(), expectsExistingState: z.boolean(),
    positionAnswer: PositionSelectionAnswerSchema.optional(), positionUpdate: PositionSelectionAnswerSchema.shape.positions.optional(),
    isReanalysis: z.boolean(), outcomeUnknown: z.boolean(), displayText: z.string(), displayTeamContext: z.string().optional(),
  }).nullable(),
});
export type ActiveRecruitmentSession = z.infer<typeof schema>;

export function loadActiveRecruitmentSession(storage?: Pick<Storage, "getItem">): ActiveRecruitmentSession | null {
  try {
    const target = storage ?? sessionStorage;
    const parsed = schema.safeParse(JSON.parse(target.getItem(key) ?? "null"));
    if (!parsed.success) return null;
    return { ...parsed.data, pendingTurnRequest: parsed.data.pendingTurnRequest ? { ...parsed.data.pendingTurnRequest, outcomeUnknown: true } : null };
  } catch { return null; }
}

export function saveActiveRecruitmentSession(session: ActiveRecruitmentSession, storage: Pick<Storage, "setItem"> = sessionStorage): void {
  storage.setItem(key, JSON.stringify(session));
}
